const { default: AxeBuilder } = require('@axe-core/playwright');
const { test, expect, TODAY, day, WHATS_NEW_VERSION } = require('./fixtures');

test.use({ whatsNewSeen: false });

const tour = (page) => page.getByRole('dialog');

// Someone who logged days with the version before this update: days are
// stored and what's new has never been seen.
async function returningUser(page, appURL) {
  await page.goto(appURL);
  // The empty app has settled (and marked what's new as seen) before the
  // days are put in place, so it can't mark it again after they are.
  await expect.poll(() => page.evaluate(() => localStorage.getItem('kenna:whatsNewSeen'))).not.toBeNull();
  await page.evaluate((e) => {
    localStorage.setItem('kenna:entries', JSON.stringify(e));
    localStorage.removeItem('kenna:whatsNewSeen');
  }, { '2026-09-20': day('2026-09-20', { dinner: 700 }, 181), [TODAY]: day(TODAY, { breakfast: 400 }, 180) });
  await page.reload();
}

test('opens once on launch for someone who had logged days, and steps through every card', async ({ page, appURL }) => {
  await returningUser(page, appURL);
  await expect(tour(page)).toBeVisible();
  await expect(tour(page).getByRole('heading', { name: 'What’s new in Kenna' })).toBeVisible();
  await expect(tour(page).getByText('1 of 9')).toBeVisible();
  await expect(tour(page).getByRole('button', { name: 'Back' })).toBeDisabled();
  await expect(tour(page).getByRole('button', { name: 'Next' })).toBeFocused();

  await tour(page).getByRole('button', { name: 'Next' }).click();
  await expect(tour(page).getByRole('heading', { name: 'View or fix any past day' })).toBeFocused();
  await expect(tour(page).getByText('2 of 9')).toBeVisible();
  await tour(page).getByRole('button', { name: 'Back' }).click();
  await expect(tour(page).getByText('1 of 9')).toBeVisible();

  for (let i = 1; i < 9; i += 1) await tour(page).getByRole('button', { name: 'Next' }).click();
  await expect(tour(page).getByRole('heading', { name: 'Back up everything in one file' })).toBeVisible();
  await tour(page).getByRole('button', { name: 'Done' }).click();
  await expect(tour(page)).toHaveCount(0);

  // Once only.
  expect(await page.evaluate(() => localStorage.getItem('kenna:whatsNewSeen'))).toBe(WHATS_NEW_VERSION);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
  await expect(tour(page)).toHaveCount(0);
});

test('Close or Escape skips it, and it stays closed', async ({ page, appURL }) => {
  await returningUser(page, appURL);
  await tour(page).getByRole('button', { name: 'Close' }).click();
  await expect(tour(page)).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
  await expect(tour(page)).toHaveCount(0);

  await page.evaluate(() => localStorage.removeItem('kenna:whatsNewSeen'));
  await page.reload();
  await expect(tour(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(tour(page)).toHaveCount(0);
});

test('a new user gets the welcome instead, and never "what’s new" later', async ({ page, appURL }) => {
  await page.goto(appURL);
  await expect(page.locator('[data-welcome]')).toBeVisible();
  await expect(tour(page)).toHaveCount(0);
  await page.getByLabel('Weight (lbs)').fill('180');
  await page.getByLabel('Weight (lbs)').press('Enter');
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
  await expect(tour(page)).toHaveCount(0);
});

test('it doesn’t open by itself on a screen other than Today', async ({ page, appURL }) => {
  await returningUser(page, appURL);
  await page.keyboard.press('Escape');
  await page.evaluate(() => localStorage.removeItem('kenna:whatsNewSeen'));
  await page.goto(`${appURL}/#/history`);
  await expect(page.getByRole('heading', { name: 'History' }).first()).toBeVisible();
  await expect(tour(page)).toHaveCount(0);
});

test('Settings opens it again, and axe finds no problems in it', async ({ page, appURL }) => {
  await returningUser(page, appURL);
  await page.keyboard.press('Escape');
  await page.goto(`${appURL}/#/settings`);
  await page.getByRole('button', { name: 'Show what’s new' }).click();
  await expect(tour(page).getByRole('heading', { name: 'What’s new in Kenna' })).toBeVisible();
  for (const theme of ['light', 'dark']) {
    await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
    const results = await new AxeBuilder({ page }).include('dialog').withTags(['wcag2a', 'wcag2aa', 'best-practice']).analyze();
    expect(results.violations.map((v) => `${theme}: ${v.id} — ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
  }
  await tour(page).getByRole('button', { name: 'Close' }).click();
  await expect(page.getByRole('button', { name: 'Show what’s new' })).toBeFocused();
});

test('every card fits a small phone screen without scrolling', async ({ page, appURL }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await returningUser(page, appURL);
  for (let i = 0; i < 9; i += 1) {
    const box = await tour(page).boundingBox();
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(568);
    const overflow = await tour(page).evaluate((d) => d.scrollHeight - d.clientHeight);
    expect(overflow).toBeLessThanOrEqual(0);
    if (i < 8) await tour(page).getByRole('button', { name: 'Next' }).click();
  }
});
