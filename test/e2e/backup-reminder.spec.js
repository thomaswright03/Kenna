const { test, expect, TODAY, day } = require('./fixtures');

const reminder = (page) => page.locator('[data-backup-reminder]');
const daysAgo = (n) => new Date(new Date('2026-09-24T10:00:00-05:00').getTime() - n * 86400000).toISOString();

async function setPref(page, key, value) {
  await page.evaluate(([k, v]) => (v === null ? localStorage.removeItem(`kenna:${k}`) : localStorage.setItem(`kenna:${k}`, v)), [key, value]);
}

test('Today reminds to back up until a backup is confirmed saved, and again once it is a week old', async ({ page, appURL, data }) => {
  await data.seed({ '2026-09-22': day('2026-09-22', { lunch: 600 }, 180), [TODAY]: day(TODAY, { breakfast: 400 }) });
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
  await expect(note).toContainText('2 days and 0 photos');
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

  await setPref(page, 'backupConfirmedAt', daysAgo(3));
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
  await expect(reminder(page)).toHaveCount(0);
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
  await data.seed({ [TODAY]: day(TODAY, { breakfast: 400 }) });
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
  await data.seed({ [TODAY]: day(TODAY, { breakfast: 400 }) });
  await page.goto(`${appURL}/#/settings`);
  await page.getByRole('button', { name: 'Export Backup' }).click();
  await expect(page.locator('[data-backup-delivery]')).toContainText("It isn't saved anywhere yet");
  await page.getByRole('button', { name: 'Save or share…' }).click();
  await expect(page.getByText('Backup shared. Kenna will remind you again in a week.')).toBeVisible();
  await expect(page.getByText('Last backup file saved today.')).toBeVisible();
  await page.goto(appURL);
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
  await expect(reminder(page)).toHaveCount(0);
});

test('a backup time recorded by an older version is read but not shown as confirmed', async ({ page, appURL, data }) => {
  await data.seed({ [TODAY]: day(TODAY, { breakfast: 400 }) });
  await page.goto(appURL);
  await setPref(page, 'lastBackupAt', daysAgo(2));
  await page.goto(`${appURL}/#/settings`);
  await expect(page.getByText(/A backup file was made on Tue, Sep 22, but Kenna can't tell whether it was saved/)).toBeVisible();
  await page.goto(appURL);
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
  await expect(reminder(page)).toHaveCount(0);
  await setPref(page, 'lastBackupAt', daysAgo(9));
  await page.reload();
  await expect(page.getByRole('region', { name: 'Your last backup was 9 days ago' })).toBeVisible();
});

test('"Not now" hides the reminder for a few days, not for good', async ({ page, appURL, data }) => {
  await data.seed({ [TODAY]: day(TODAY, { breakfast: 400 }) });
  await page.goto(appURL);
  await reminder(page).getByRole('button', { name: 'Not now' }).click();
  await expect(reminder(page)).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
  await expect(reminder(page)).toHaveCount(0);

  await page.clock.setFixedTime(new Date('2026-09-28T10:00:00-05:00'));
  await page.reload();
  await expect(reminder(page)).toBeVisible();
});

test('there is no reminder before anything is logged', async ({ page, appURL }) => {
  await page.goto(appURL);
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
  await expect(reminder(page)).toHaveCount(0);
});

test('the reminder is readable in light and dark themes', async ({ page, appURL, data }) => {
  await data.seed({ [TODAY]: day(TODAY, { breakfast: 400 }) });
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
