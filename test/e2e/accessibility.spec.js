const { default: AxeBuilder } = require('@axe-core/playwright');
const { test, expect, TODAY, day } = require('./fixtures');

const SCREENS = ['#/', '#/log', '#/history', '#/compare', '#/photos', '#/settings', '#/day/2026-09-20'];

test('no screen has accessibility problems axe can find, in either theme', async ({ page, appURL, data }) => {
  await data.seed({ '2026-09-20': day('2026-09-20', { dinner: 700 }, 181), [TODAY]: day(TODAY, { breakfast: 400 }, 180) });
  // A lunch typed for Sep 20 and waiting to be confirmed, shown on that day and in History.
  await page.evaluate(() =>
    localStorage.setItem('kenna:unsavedInput', JSON.stringify([{ field: 'lunch', date: '2026-09-20', text: '4000', error: 'Far more than usual.', ask: true }]))
  );
  await page.goto(appURL);
  for (const theme of ['light', 'dark']) {
    await page.evaluate((t) => localStorage.setItem('kenna:theme', t), theme);
    for (const hash of SCREENS) {
      await page.goto(`${appURL}/${hash}`);
      await page.locator('main h2').first().waitFor();
      if (hash === '#/history' || hash === '#/day/2026-09-20') await expect(page.locator('.history-waiting, .meal-waiting')).toHaveCount(1);
      const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'best-practice']).analyze();
      const found = results.violations.map((v) => `${hash} (${theme}): ${v.id} — ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
      expect(found).toEqual([]);
    }
  }
});

test('the backup save panel, the Change day box, the meal table, the photo viewer and the "Log a day in …?" question have no problems axe can find', async ({ page, appURL, data }) => {
  await data.seed({ [TODAY]: day(TODAY, { breakfast: 400 }, 180) });
  const check = async (label) => {
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'best-practice']).analyze();
    expect(results.violations.map((v) => `${label}: ${v.id} — ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
  };
  await page.goto(appURL);
  await page.getByRole('button', { name: 'Back up now' }).click();
  await expect(page.getByRole('button', { name: 'I’ve saved it' })).toBeVisible();
  await check('reminder');
  await page.goto(`${appURL}/#/settings`);
  await page.getByRole('button', { name: 'Export Backup' }).click();
  await expect(page.getByRole('button', { name: 'I’ve saved it' })).toBeVisible();
  await check('settings');
  await page.goto(appURL);
  await page.getByRole('button', { name: 'Change day' }).press('Enter');
  await expect(page.getByLabel('Day to open')).toBeVisible();
  await check('change day');
  await page.goto(`${appURL}/#/day/2001-01-01`);
  await expect(page.locator('[data-far-back]')).toBeVisible();
  await check('far back');
  await page.goto(`${appURL}/#/compare`);
  await page.locator('.compare-meals summary').click();
  await expect(page.locator('.meal-table')).toBeVisible();
  await check('compare meals');
  await page.goto(`${appURL}/#/photos`);
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8z8DAwMDAxMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg==', 'base64');
  await page.locator('input[type=file]').setInputFiles({ name: 'me.png', mimeType: 'image/png', buffer: png });
  await expect(page.getByRole('group', { name: 'Which day was this photo taken?' })).toBeVisible();
  await check('photo day');
  await page.getByRole('button', { name: 'Save photo' }).click();
  await expect(page.locator('.photo-thumb img')).toBeVisible();
  await check('photos');
  await page.locator('.photo-thumb').click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await check('viewer');
});

test('the restore question, its result, photo comparison and the damaged-data card have no problems axe can find', async ({ page, appURL, data }, testInfo) => {
  await data.seed({ [TODAY]: day(TODAY, { breakfast: 400 }, 180) });
  const check = async (label) => {
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'best-practice']).analyze();
    expect(results.violations.map((v) => `${label}: ${v.id} — ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
  };
  const file = testInfo.outputPath('mixed.json');
  require('node:fs').writeFileSync(
    file,
    JSON.stringify({ app: 'kenna', version: 2, entries: { [TODAY]: day(TODAY, { breakfast: 500 }), '2026-09-01': day('2026-09-01', { lunch: -5 }) } })
  );
  await page.goto(`${appURL}/#/settings`);
  await page.locator('input[type=file]').setInputFiles(file);
  await expect(page.getByRole('dialog')).toBeVisible();
  await check('restore question');
  await page.getByRole('button', { name: 'Restore the rest' }).click();
  await expect(page.getByRole('button', { name: 'Undo restore' })).toBeVisible();
  await check('restore result');

  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8z8DAwMDAxMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg==', 'base64');
  await page.goto(`${appURL}/#/photos`);
  for (const [i, date] of ['2026-09-10', '2026-09-20'].entries()) {
    await page.clock.setFixedTime(new Date(Date.parse('2026-09-24T10:00:00-05:00') + i * 60000));
    await page.locator('input[type=file]').setInputFiles({ name: 'me.png', mimeType: 'image/png', buffer: png });
    await page.getByLabel('Day this photo was taken').fill(date);
    await page.getByRole('button', { name: 'Save photo' }).click();
    await expect(page.locator('.photo-thumb img')).toHaveCount(i + 1);
  }
  await page.getByRole('button', { name: 'Compare photos' }).click();
  await check('picking photos');
  await page.locator('.photo-thumb').first().click();
  await page.locator('.photo-thumb').nth(1).click();
  await expect(page.getByRole('dialog', { name: 'Compare photos' }).locator('img').nth(1)).toBeVisible();
  await check('comparing photos');

  await page.evaluate(() => localStorage.setItem('kenna:entries:corrupt', '{broken'));
  await page.goto(`${appURL}/#/settings`);
  await expect(page.locator('[data-damaged-data]')).toBeVisible();
  await check('damaged data');
});

test('the wide layout (tabs in the header, History month by month) and a photo that cannot be shown have no problems axe can find', async ({ page, appURL, data }) => {
  const entries = {};
  for (let i = 0; i < 120; i += 1) {
    const d = new Date(Date.UTC(2026, 8, 24 - i)).toISOString().slice(0, 10);
    entries[d] = day(d, { lunch: 1500 + (i % 10) * 10 }, 170 + (i % 5) / 10);
  }
  await data.seed(entries);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(appURL);
  for (const theme of ['light', 'dark']) {
    await page.evaluate((t) => localStorage.setItem('kenna:theme', t), theme);
    await page.goto(`${appURL}/#/history`);
    await expect(page.locator('.months-overview')).toBeVisible();
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'best-practice']).analyze();
    expect(results.violations.map((v) => `history (${theme}): ${v.id}`)).toEqual([]);
  }

  await page.goto(`${appURL}/#/photos`);
  const heic = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypheic'), Buffer.alloc(64)]);
  await page.locator('input[type=file]').setInputFiles({ name: 'IMG_0001.HEIC', mimeType: 'image/heic', buffer: heic });
  await page.getByRole('button', { name: 'Save photo' }).click();
  await page.getByRole('button', { name: 'Progress photo, Thu, Sep 24' }).click();
  await expect(page.getByRole('dialog').getByText("Can't preview in this browser")).toBeVisible();
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'best-practice']).analyze();
  expect(results.violations.map((v) => `photo viewer: ${v.id} — ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
});
