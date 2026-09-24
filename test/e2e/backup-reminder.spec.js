const { test, expect, TODAY, day } = require('./fixtures');

const reminder = (page) => page.locator('[data-backup-reminder]');
const status = (page) => page.locator('[data-backup-status]');
// Three days logged: enough for the reminder to ask.
const threeDays = (extra = {}) => ({
  '2026-09-21': day('2026-09-21', { lunch: 500 }),
  '2026-09-22': day('2026-09-22', { lunch: 600 }, 180),
  [TODAY]: day(TODAY, { breakfast: 400 }),
  ...extra,
});
const daysAgo = (n) => new Date(new Date('2026-09-24T10:00:00-05:00').getTime() - n * 86400000).toISOString();

async function setPref(page, key, value) {
  await page.evaluate(([k, v]) => (v === null ? localStorage.removeItem(`kenna:${k}`) : localStorage.setItem(`kenna:${k}`, v)), [key, value]);
}

test('Today reminds to back up until a backup is confirmed saved, and again once 3 days have passed', async ({ page, appURL, data }) => {
  await data.seed(threeDays());
  await page.goto(appURL);
  await setPref(page, 'backupConfirmedAt', null);
  await page.reload();

  const note = reminder(page);
  await expect(note).toBeVisible();
  await expect(page.getByRole('region', { name: "You haven't saved a backup yet" })).toBeVisible();
  await expect(page.locator('#announcer')).toContainText("You haven't saved a backup yet");

  // Starting a download isn't the same as the file being saved.
  const downloadPromise = page.waitForEvent('download');
  await note.getByRole('button', { name: 'Back up now' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('kenna-backup-2026-09-24.json');
  await expect(page.getByRole('region', { name: 'Backup file not saved yet' })).toBeVisible();
  await expect(note).toContainText('Backup file created');
  await expect(note).toContainText('kenna-backup-2026-09-24.json, with 3 days and no photos');
  await expect(note).not.toContainText('Backup saved');
  expect(await page.evaluate(() => localStorage.getItem('kenna:backupConfirmedAt'))).toBeNull();
  await page.reload();
  await expect(reminder(page)).toBeVisible();

  await reminder(page).getByRole('button', { name: 'Back up now' }).click();
  await reminder(page).getByRole('button', { name: 'I’ve saved it' }).click();
  await expect(reminder(page)).toContainText('Backup saved');
  expect(await page.evaluate(() => localStorage.getItem('kenna:backupConfirmedAt'))).toBeTruthy();
  await reminder(page).getByRole('button', { name: 'Done' }).click();
  await expect(reminder(page)).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
  await expect(reminder(page)).toHaveCount(0);
  await page.goto(`${appURL}/#/settings`);
  await expect(page.getByText('Last backup file saved today.')).toBeVisible();

  await page.goto(appURL);
  await setPref(page, 'backupConfirmedAt', daysAgo(10));
  await page.reload();
  await expect(page.getByRole('region', { name: 'Your last backup was 10 days ago' })).toBeVisible();

  // Every 3 days unless changed in Settings.
  await setPref(page, 'backupConfirmedAt', daysAgo(2));
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
  await expect(reminder(page)).toHaveCount(0);
  await setPref(page, 'backupConfirmedAt', daysAgo(3));
  await page.reload();
  await expect(page.getByRole('region', { name: 'Your last backup was 3 days ago' })).toBeVisible();
});

// Stands in for the share sheet of a phone browser: `outcome` is what the
// user does with it.
async function fakeShareSheet(page, outcome) {
  await page.addInitScript((result) => {
    window.__shared = [];
    navigator.canShare = (data) => !!(data && data.files && data.files.length);
    navigator.share = async (data) => {
      window.__shared.push(data.files.map((f) => f.name));
      if (result === 'cancel') throw new DOMException('Share canceled', 'AbortError');
    };
  }, outcome);
}

test('on a phone, cancelling the share sheet leaves the backup unsaved and the reminder in place', async ({ page, appURL, data }) => {
  await fakeShareSheet(page, 'cancel');
  await data.seed(threeDays());
  await page.goto(appURL);
  await reminder(page).getByRole('button', { name: 'Back up now' }).click();
  await expect(reminder(page)).toContainText('Backup file ready');
  await reminder(page).getByRole('button', { name: 'Save or share…' }).click();
  await expect(reminder(page).getByRole('alert')).toContainText('Not saved: sharing was cancelled.');
  await expect(reminder(page)).not.toContainText('Backup saved');
  expect(await page.evaluate(() => window.__shared)).toEqual([['kenna-backup-2026-09-24.json']]);
  expect(await page.evaluate(() => localStorage.getItem('kenna:backupConfirmedAt'))).toBeNull();
  await page.reload();
  await expect(reminder(page)).toBeVisible();

  await page.goto(`${appURL}/#/settings`);
  await page.getByRole('button', { name: 'Export Backup' }).click();
  await page.getByRole('button', { name: 'Save or share…' }).click();
  await expect(page.getByRole('alert')).toContainText('Not saved: sharing was cancelled.');
  await expect(page.getByText('No backup file has been saved from this device yet.')).toBeVisible();
});

test('on a phone, a completed share counts as a saved backup', async ({ page, appURL, data }) => {
  await fakeShareSheet(page, 'complete');
  await data.seed(threeDays());
  await page.goto(`${appURL}/#/settings`);
  await page.getByRole('button', { name: 'Export Backup' }).click();
  await expect(page.locator('[data-backup-delivery]')).toContainText("It isn't saved anywhere yet");
  await page.getByRole('button', { name: 'Save or share…' }).click();
  await expect(page.getByText('Backup shared. Kenna will remind you again in 3 days.')).toBeVisible();
  await expect(page.getByText('Last backup file saved today.')).toBeVisible();
  await page.goto(appURL);
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
  await expect(reminder(page)).toHaveCount(0);
});

test('a backup time recorded by an older version is read but not shown as confirmed', async ({ page, appURL, data }) => {
  await data.seed(threeDays());
  await page.goto(appURL);
  await setPref(page, 'lastBackupAt', daysAgo(2));
  await page.goto(`${appURL}/#/settings`);
  await expect(page.getByText(/A backup file was made on Tue, Sep 22, but Kenna can't tell whether it was saved/)).toBeVisible();
  await page.goto(appURL);
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
  await expect(reminder(page)).toHaveCount(0);
  await expect(status(page)).toContainText('Backup file made 2 days ago, not confirmed saved');
  await setPref(page, 'lastBackupAt', daysAgo(9));
  await page.reload();
  await expect(page.getByRole('region', { name: 'Your last backup was 9 days ago' })).toBeVisible();
});

test('"Not now" hides the reminder until the next day', async ({ page, appURL, data }) => {
  await data.seed(threeDays());
  await page.goto(appURL);
  await reminder(page).getByRole('button', { name: 'Not now' }).click();
  await expect(reminder(page)).toHaveCount(0);
  await expect(page.locator('#announcer')).toHaveText('Backup reminder hidden until tomorrow.');
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
  await expect(reminder(page)).toHaveCount(0);

  await page.clock.setFixedTime(new Date('2026-09-24T23:50:00-05:00'));
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
  await expect(reminder(page)).toHaveCount(0);
  await page.clock.setFixedTime(new Date('2026-09-25T00:05:00-05:00'));
  await page.reload();
  await expect(reminder(page)).toBeVisible();
});

test('a reminder put off by an earlier version stays put off for its three days', async ({ page, appURL, data }) => {
  await data.seed(threeDays());
  await page.goto(appURL);
  await setPref(page, 'backupReminderSnoozedUntil', new Date('2026-09-26T09:00:00-05:00').toISOString());
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
  await expect(reminder(page)).toHaveCount(0);
  await page.clock.setFixedTime(new Date('2026-09-26T10:00:00-05:00'));
  await page.reload();
  await expect(reminder(page)).toBeVisible();
});

test('there is no reminder or backup line before anything is logged', async ({ page, appURL }) => {
  await page.goto(appURL);
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
  await expect(reminder(page)).toHaveCount(0);
  await expect(status(page)).toHaveCount(0);
});

test('a first meal brings no card, only a quiet line saying there is no backup yet; three days bring the reminder', async ({ page, appURL, data }) => {
  await page.goto(`${appURL}/#/log/breakfast`);
  await page.getByLabel('Breakfast calories').fill('400');
  await page.getByRole('button', { name: 'Save and close' }).click();
  await expect(page.locator('.total-num')).toHaveText('400');
  await expect(page.locator('.notice-card')).toHaveCount(0);
  await expect(status(page)).toContainText('No backup saved yet');
  await expect(status(page)).not.toHaveClass(/is-overdue/);

  await data.seed(threeDays());
  await page.reload();
  await expect(reminder(page)).toBeVisible();
  // The card says how old the backup is, so the line waits until it's gone.
  await expect(status(page)).toBeHidden();
});

test('Today always shows how old the last backup is, snoozed or not, and backs up from there in one tap', async ({ page, data }) => {
  const days = {};
  for (let i = 0; i < 30; i += 1) {
    const date = new Date(Date.UTC(2026, 7, 26 + i)).toISOString().slice(0, 10);
    days[date] = day(date, { lunch: 500 + i }, 180 - i / 10);
  }
  await data.seed(days);
  await page.reload();
  await expect(reminder(page)).toContainText("You haven't saved a backup yet");
  await reminder(page).getByRole('button', { name: 'Not now' }).click();
  // Put off, the question goes; the age stays in view, marked as overdue.
  await expect(reminder(page)).toHaveCount(0);
  await expect(status(page)).toBeVisible();
  await expect(status(page)).toContainText('No backup saved yet');
  await expect(status(page)).toHaveClass(/is-overdue/);
  await page.reload();
  await expect(status(page)).toContainText('No backup saved yet');

  const downloadPromise = page.waitForEvent('download');
  await status(page).getByRole('button', { name: 'Back up now' }).click();
  await downloadPromise;
  await expect(status(page)).toContainText('Backup file not saved yet');
  await status(page).getByRole('button', { name: 'I’ve saved it' }).click();
  await expect(status(page)).toContainText('Last backup: today');
  await expect(status(page)).toContainText('Backup saved. Kenna will remind you again in 3 days.');
  await expect(status(page)).not.toHaveClass(/is-overdue/);
  expect(await page.evaluate(() => localStorage.getItem('kenna:backupConfirmedAt'))).toBeTruthy();

  await setPref(page, 'backupConfirmedAt', daysAgo(2));
  await page.reload();
  await expect(status(page)).toContainText('Last backup: 2 days ago');
  await expect(reminder(page)).toHaveCount(0);
  await setPref(page, 'backupConfirmedAt', daysAgo(8));
  await page.reload();
  await expect(reminder(page)).toContainText('Your last backup was 8 days ago');
});

test('the reminder is readable in light and dark themes', async ({ page, appURL, data }) => {
  await data.seed(threeDays());
  for (const theme of ['light', 'dark']) {
    await page.goto(appURL);
    await setPref(page, 'theme', theme);
    await page.reload();
    await expect(reminder(page)).toBeVisible();
    const ratio = await reminder(page).evaluate((el) => {
      const rgb = (c) => c.match(/\d+/g).slice(0, 3).map(Number);
      const lum = ([r, g, b]) => {
        const f = (v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
        return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
      };
      const style = getComputedStyle(el);
      const a = lum(rgb(style.color));
      const b = lum(rgb(style.backgroundColor));
      return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    });
    expect(ratio, theme).toBeGreaterThan(4.5);
  }
});

// A 2x2 PNG.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8z8DAwMDAxMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg==',
  'base64'
);
async function addPhoto(page) {
  await page.locator('input[type=file]').setInputFiles({ name: 'me.png', mimeType: 'image/png', buffer: PNG });
  await page.getByRole('button', { name: 'Save photo' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Photo added' })).toBeVisible();
}

test('a new photo that is not in a saved backup is asked about straight away, on Photos and on Today', async ({ page, appURL, data }) => {
  await data.seed(threeDays());
  await page.goto(appURL);
  // A backup saved this morning: nothing is due.
  await setPref(page, 'backupConfirmedAt', new Date('2026-09-24T08:00:00-05:00').toISOString());
  await setPref(page, 'backupMadeAt', new Date('2026-09-24T07:59:00-05:00').toISOString());
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
  await expect(reminder(page)).toHaveCount(0);

  await page.goto(`${appURL}/#/photos`);
  await addPhoto(page);
  await expect(page.getByRole('region', { name: "A photo isn’t in a backup yet" })).toBeVisible();

  await page.goto(appURL);
  await expect(page.getByRole('region', { name: "A photo isn’t in a backup yet" })).toBeVisible();
  await expect(status(page)).toBeHidden();

  // Saving a backup from the Photos screen covers it everywhere.
  await page.goto(`${appURL}/#/photos`);
  await reminder(page).getByRole('button', { name: 'Back up now' }).click();
  await reminder(page).getByRole('button', { name: 'I’ve saved it' }).click();
  await expect(reminder(page)).toContainText('Backup saved. Kenna will remind you again in 3 days.');
  await reminder(page).getByRole('button', { name: 'Done' }).click();
  await expect(reminder(page)).toHaveCount(0);
  await page.goto(appURL);
  await expect(status(page)).toContainText('Last backup: today');
  await expect(reminder(page)).toHaveCount(0);
  await page.goto(`${appURL}/#/photos`);
  await expect(page.getByRole('button', { name: 'Progress photo, Thu, Sep 24' })).toBeVisible();
  await expect(reminder(page)).toHaveCount(0);
});

test('a photo added after "Not now" brings the question back', async ({ page, appURL, data }) => {
  await data.seed(threeDays());
  await page.goto(`${appURL}/#/photos`);
  await addPhoto(page);
  await expect(page.getByRole('region', { name: "A photo isn’t in a backup yet" })).toBeVisible();
  await reminder(page).getByRole('button', { name: 'Not now' }).click();
  await expect(reminder(page)).toHaveCount(0);
  await page.goto(appURL);
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
  await expect(reminder(page)).toHaveCount(0);
  await expect(status(page)).toContainText('No backup saved yet');
  await expect(status(page)).toHaveClass(/is-overdue/);

  // Later that day, another photo.
  await page.clock.setFixedTime(new Date('2026-09-24T12:00:00-05:00'));
  await page.goto(`${appURL}/#/photos`);
  await addPhoto(page);
  await expect(page.getByRole('region', { name: "2 photos aren’t in a backup yet" })).toBeVisible();
});

test('how often Kenna asks is chosen in Settings, kept, and used on Today', async ({ page, appURL, data }) => {
  await data.seed(threeDays());
  await page.goto(appURL);
  await setPref(page, 'backupConfirmedAt', daysAgo(4));
  await page.goto(`${appURL}/#/settings`);
  const choice = page.getByRole('group', { name: 'Remind me to back up' });
  await expect(choice.getByRole('radio', { name: 'Every 3 days' })).toBeChecked();
  await expect(page.locator('[data-backup-every]')).toHaveText('Once 3 days are logged, Kenna asks you to back up every 3 days, and as soon as you add a photo that isn’t in a backup yet.');
  await choice.getByText('Weekly').click();
  await expect(page.locator('[data-backup-every]')).toContainText('Kenna asks you to back up every week');
  await page.reload();
  await expect(page.getByRole('group', { name: 'Remind me to back up' }).getByRole('radio', { name: 'Weekly' })).toBeChecked();
  await expect(page.locator('[data-backup-every]')).toContainText('every week');

  // Four days since the last backup: not due every week, due every 3 days.
  await page.goto(appURL);
  await expect(status(page)).toContainText('Last backup: 4 days ago');
  await expect(reminder(page)).toHaveCount(0);
  await expect(status(page)).not.toHaveClass(/is-overdue/);

  await page.goto(`${appURL}/#/settings`);
  await page.getByRole('group', { name: 'Remind me to back up' }).getByText('Daily').click();
  await setPref(page, 'backupConfirmedAt', daysAgo(1));
  await page.goto(appURL);
  await expect(page.getByRole('region', { name: 'Your last backup was yesterday' })).toBeVisible();
  await reminder(page).getByRole('button', { name: 'Back up now' }).click();
  await reminder(page).getByRole('button', { name: 'I’ve saved it' }).click();
  await expect(reminder(page)).toContainText('Backup saved. Kenna will remind you again tomorrow.');
});
