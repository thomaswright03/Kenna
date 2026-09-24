const { test, expect, TODAY, day } = require('./fixtures');

const reminder = (page) => page.locator('[data-backup-reminder]');
const daysAgo = (n) => new Date(new Date('2026-09-24T10:00:00-05:00').getTime() - n * 86400000).toISOString();

async function setPref(page, key, value) {
  await page.evaluate(([k, v]) => (v === null ? localStorage.removeItem(`kenna:${k}`) : localStorage.setItem(`kenna:${k}`, v)), [key, value]);
}

test('Today reminds to back up until a backup is saved, and again once it is a week old', async ({ page, appURL, data }) => {
  await data.seed({ '2026-09-22': day('2026-09-22', { lunch: 600 }, 180), [TODAY]: day(TODAY, { breakfast: 400 }) });
  await page.goto(appURL);
  await setPref(page, 'lastBackupAt', null);
  await page.reload();

  const note = reminder(page);
  await expect(note).toBeVisible();
  await expect(page.getByRole('region', { name: "You haven't saved a backup yet" })).toBeVisible();
  await expect(page.locator('#announcer')).toContainText("You haven't saved a backup yet");

  const downloadPromise = page.waitForEvent('download');
  await note.getByRole('button', { name: 'Back up now' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('kenna-backup-2026-09-24.json');
  await expect(note).toContainText('Backup saved');
  await expect(note).toContainText('2 days and 0 photos');
  await expect(note).not.toContainText("You haven't saved a backup yet");
  expect(await page.evaluate(() => localStorage.getItem('kenna:lastBackupAt'))).toBeTruthy();
  await note.getByRole('button', { name: 'Done' }).click();
  await expect(note).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
  await expect(reminder(page)).toHaveCount(0);

  await setPref(page, 'lastBackupAt', daysAgo(10));
  await page.reload();
  await expect(page.getByRole('region', { name: 'Your last backup was 10 days ago' })).toBeVisible();

  await setPref(page, 'lastBackupAt', daysAgo(3));
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
  await expect(reminder(page)).toHaveCount(0);
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
