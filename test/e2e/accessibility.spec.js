const { default: AxeBuilder } = require('@axe-core/playwright');
const { test, expect, TODAY, day } = require('./fixtures');

const SCREENS = ['#/', '#/log', '#/history', '#/compare', '#/photos', '#/settings', '#/day/2026-09-20'];

test('no screen has accessibility problems axe can find, in either theme', async ({ page, appURL, data }) => {
  await data.seed({ '2026-09-20': day('2026-09-20', { dinner: 700 }, 181), [TODAY]: day(TODAY, { breakfast: 400 }, 180) });
  await page.goto(appURL);
  for (const theme of ['light', 'dark']) {
    await page.evaluate((t) => localStorage.setItem('kenna:theme', t), theme);
    for (const hash of SCREENS) {
      await page.goto(`${appURL}/${hash}`);
      await page.locator('main h2').first().waitFor();
      const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'best-practice']).analyze();
      const found = results.violations.map((v) => `${hash} (${theme}): ${v.id} — ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
      expect(found).toEqual([]);
    }
  }
});

test('the backup save panel, the meal table, the photo viewer and the "Log a day in …?" question have no problems axe can find', async ({ page, appURL, data }) => {
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
  await expect(page.locator('.photo-thumb img')).toBeVisible();
  await check('photos');
  await page.locator('.photo-thumb').click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await check('viewer');
});
