const fs = require('node:fs');
const { test, expect, TODAY, day } = require('./fixtures');

// A 2x2 PNG.
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8z8DAwMDAxMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg==';

async function importFile(page, appURL, file) {
  await page.goto(`${appURL}/#/settings`);
  await page.locator('input[type=file]').setInputFiles(file);
  return page.getByRole('dialog', { name: 'Restore from this backup?' });
}

test('a backup from the first version, with a weight to three decimals, restores rounded to two', async ({ page, appURL, data }, testInfo) => {
  const file = testInfo.outputPath('old.json');
  fs.writeFileSync(
    file,
    JSON.stringify({
      exportedAt: '2025-01-01T00:00:00.000Z',
      entries: {
        '2026-09-16': { date: '2026-09-16', weight: 165.333, meals: { breakfast: 300 } },
        '2026-09-17': day('2026-09-17', { lunch: 500 }, 165),
      },
    })
  );
  const dialog = await importFile(page, appURL, file);
  await expect(dialog).toContainText('It has 2 days and no photos');
  await expect(dialog).toContainText('2 days will be added');
  await dialog.getByRole('button', { name: 'Restore', exact: true }).click();
  await expect(page.getByText('Restored 2 days.', { exact: true })).toBeVisible();
  expect((await data.entry('2026-09-16')).weight).toBe(165.33);
});

test('a backup with one day outside the rules offers to restore the rest, then names the day it left out', async ({ page, appURL, data }, testInfo) => {
  const file = testInfo.outputPath('mixed.json');
  fs.writeFileSync(
    file,
    JSON.stringify({
      app: 'kenna',
      version: 2,
      entries: {
        '2026-09-01': day('2026-09-01', { breakfast: -5 }),
        '2026-09-02': day('2026-09-02', { lunch: 600 }, 170),
        '2026-09-03': day('2026-09-03', { dinner: 800 }),
      },
    })
  );
  const dialog = await importFile(page, appURL, file);
  await expect(dialog).toContainText('It has 2 days and no photos');
  await expect(dialog).toContainText('These can’t be restored and will be left out:');
  await expect(dialog.getByRole('listitem')).toHaveText(["Breakfast on Tue, Sep 1 (-5): Calories can't be negative. Enter 0 or more."]);
  await dialog.getByRole('button', { name: 'Restore the rest' }).click();
  await expect(page.getByText('Restored 2 days.', { exact: true })).toBeVisible();
  const result = page.locator('.import-result');
  await expect(result).toContainText('Left out, because it can’t be restored:');
  await expect(result.getByRole('listitem')).toHaveText(["Breakfast on Tue, Sep 1 (-5): Calories can't be negative. Enter 0 or more."]);
  expect((await data.entry('2026-09-02')).meals.lunch).toBe(600);
  const skipped = await data.entry('2026-09-01');
  expect(skipped ? skipped.meals.breakfast : null).toBe(null);
});

test('restoring says how many days it will replace, and Undo restore puts them back', async ({ page, appURL, data, backend }, testInfo) => {
  await data.seed({ [TODAY]: day(TODAY, { breakfast: 500 }) });
  // A backup with today's 500 cal breakfast and a photo.
  const file = testInfo.outputPath('backup.json');
  fs.writeFileSync(
    file,
    JSON.stringify({
      app: 'kenna',
      version: 2,
      entries: { [TODAY]: day(TODAY, { breakfast: 500 }), '2026-09-20': day('2026-09-20', { dinner: 900 }) },
      photos: [{ date: '2026-09-20', createdAt: '2026-09-20T08:00:00.000Z', type: 'image/png', data: PNG }],
    })
  );
  // Since then, breakfast was corrected to 700.
  await page.goto(`${appURL}/#/log/breakfast`);
  await page.getByLabel('Breakfast calories').fill('700');
  await page.getByRole('button', { name: 'Save and close' }).click();
  await expect(page.locator('.total-num')).toHaveText('700');

  const dialog = await importFile(page, appURL, file);
  const where = backend === 'server' ? 'in Kenna' : 'on this device';
  await expect(dialog).toContainText(`1 day ${where} will be replaced by the file’s version, and 1 day will be added.`);
  await expect(dialog).toContainText('you can undo the restore afterwards');
  await dialog.getByRole('button', { name: 'Restore' }).click();
  await expect(page.getByText('Restored 2 days and 1 photo.', { exact: true })).toBeVisible();
  expect((await data.entry(TODAY)).meals.breakfast).toBe(500);

  await page.getByRole('button', { name: 'Undo restore' }).click();
  await expect(page.getByText('Restore undone: your days are as they were before it, and the 1 photo it added was removed.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Undo restore' })).toHaveCount(0);
  expect((await data.entry(TODAY)).meals.breakfast).toBe(700);
  const added = await data.entry('2026-09-20');
  expect(added ? added.meals.dinner : null).toBe(null);
  await page.goto(`${appURL}/#/photos`);
  await expect(page.getByText('No photos yet.')).toBeVisible();
});

test('the restore dialog says when nothing already here will change', async ({ page, appURL, data }, testInfo) => {
  await data.seed({ [TODAY]: day(TODAY, { breakfast: 500 }) });
  const file = testInfo.outputPath('same.json');
  fs.writeFileSync(file, JSON.stringify({ app: 'kenna', version: 2, entries: { [TODAY]: day(TODAY, { breakfast: 500 }) } }));
  const dialog = await importFile(page, appURL, file);
  await expect(dialog).toContainText('Every day in it is already');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('button', { name: 'Undo restore' })).toHaveCount(0);

  // Restoring it anyway changes nothing, and says so.
  await page.locator('input[type=file]').setInputFiles(file);
  await page.getByRole('dialog').getByRole('button', { name: 'Restore' }).click();
  await expect(page.getByText('Nothing new to restore. 1 day was already here.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Undo restore' })).toHaveCount(0);
});

test('a backup with photos and no days is described as such, before and after', async ({ page, appURL, data }, testInfo) => {
  await data.seed({ [TODAY]: day(TODAY, { breakfast: 500 }) });
  const file = testInfo.outputPath('photos-only.json');
  fs.writeFileSync(
    file,
    JSON.stringify({ app: 'kenna', version: 2, entries: {}, photos: [{ date: '2026-09-20', createdAt: '2026-09-20T08:00:00.000Z', type: 'image/png', data: PNG }] })
  );
  const dialog = await importFile(page, appURL, file);
  await expect(dialog).toContainText('It has 1 photo and no days (');
  await expect(dialog).toContainText('will change, and photos already here aren’t added again. You can undo the restore afterwards.');
  await expect(dialog).not.toContainText('Every day');
  await dialog.getByRole('button', { name: 'Restore' }).click();
  await expect(page.getByText('Restored 1 photo.', { exact: true })).toBeVisible();
  expect((await data.entry(TODAY)).meals.breakfast).toBe(500);
});
