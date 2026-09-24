const { default: AxeBuilder } = require('@axe-core/playwright');
const { test, expect, TODAY, day, WHATS_NEW_VERSION } = require('./fixtures');

test.use({ whatsNewSeen: false });

const tour = (page) => page.getByRole('dialog');
const spot = (page) => page.locator('.tour-spot');
const STOPS = 11;

// Someone who logged days with the version before this update: days are
// stored and what's new has never been seen.
async function returningUser(page, appURL) {
  await page.goto(appURL);
  // The empty app has settled (and marked what's new as seen) before the
  // days are put in place, so it can't mark it again after they are.
  await expect.poll(() => page.evaluate(() => localStorage.getItem('kenna:whatsNewSeen'))).not.toBeNull();
  await page.evaluate(
    (e) => {
      localStorage.setItem('kenna:entries', JSON.stringify(e));
      localStorage.removeItem('kenna:whatsNewSeen');
    },
    { '2026-09-20': day('2026-09-20', { dinner: 700 }, 181), '2026-09-22': day('2026-09-22', { lunch: 500 }, 180.4), [TODAY]: day(TODAY, { breakfast: 400 }, 180) }
  );
  await page.reload();
}

/** Waits for the stop to settle, then checks the card is on screen and the light is on `target`. */
async function expectStop(page, name, target) {
  await expect(tour(page).getByRole('heading', { name })).toBeFocused();
  await expect(page.locator('.tour-layer.is-moving')).toHaveCount(0);
  // Let the glide finish before measuring.
  await page.waitForTimeout(450);
  const viewport = page.viewportSize();
  const card = await tour(page).boundingBox();
  expect(card.y).toBeGreaterThanOrEqual(0);
  expect(card.y + card.height).toBeLessThanOrEqual(viewport.height);
  expect(card.x).toBeGreaterThanOrEqual(0);
  expect(card.x + card.width).toBeLessThanOrEqual(viewport.width);
  if (!target) return;
  const [lit, feature] = await Promise.all([spot(page).boundingBox(), target.boundingBox()]);
  // The light covers the feature's top and sides (a tall one is lit as far as fits)...
  expect(lit.x).toBeLessThanOrEqual(feature.x + 1);
  expect(lit.x + lit.width).toBeGreaterThanOrEqual(feature.x + feature.width - 1);
  expect(lit.y).toBeLessThanOrEqual(Math.max(feature.y, 12) + 1);
  // ...and the card doesn't cover it.
  const overlap = Math.min(card.y + card.height, lit.y + lit.height) - Math.max(card.y, lit.y);
  expect(overlap).toBeLessThanOrEqual(0);
}

test('opens once for someone who had logged days, and lights up each new feature on its own screen', async ({ page, appURL }) => {
  await returningUser(page, appURL);
  await expect(tour(page)).toBeVisible();
  await expectStop(page, 'What’s new in Kenna', null);
  await expect(tour(page).getByText(`1 of ${STOPS}`)).toBeVisible();
  await expect(tour(page).getByRole('button', { name: 'Back' })).toBeDisabled();

  const next = () => tour(page).getByRole('button', { name: 'Next' }).click();
  const main = page.locator('main');
  await next();
  await expectStop(page, 'View or fix any past day', main.locator('.day-switch, .field:has(input[type="date"])').first());
  await next();
  await expectStop(page, 'Tap a meal to log it', main.locator('.meal-list'));
  await next();
  await expect(page).toHaveURL(/#\/log$/);
  await expectStop(page, 'One number per meal, saved as you go', main.locator('.meal-picker'));
  // Back returns to the stop before, on its own screen.
  await tour(page).getByRole('button', { name: 'Back' }).click();
  await expect(page).toHaveURL(/#\/$/);
  await expectStop(page, 'Tap a meal to log it', main.locator('.meal-list'));
  await next();
  await expectStop(page, 'One number per meal, saved as you go', main.locator('.meal-picker'));
  await next();
  await expect(page).toHaveURL(/#\/$/);
  await expectStop(page, 'Your weight saves itself', main.locator('.field', { has: page.getByLabel('Weight (lbs)') }));
  await next();
  await expectStop(page, 'Clearer graphs', main.getByRole('group', { name: 'Chart range' }));
  await next();
  await expectStop(page, 'Kenna reminds you to back up', main.locator('[data-backup-status], [data-backup-reminder]').first());
  await next();
  await expect(page).toHaveURL(/#\/history$/);
  await expectStop(page, 'History by month', main.locator('.history-month').first());
  await next();
  await expect(page).toHaveURL(/#\/compare$/);
  await expectStop(page, 'How am I doing today?', main.locator('.compare-answer').first());
  await next();
  await expect(page).toHaveURL(/#\/photos$/);
  await expectStop(page, 'Progress photos, filed by day', main.locator('.file-btn'));
  await next();
  await expect(page).toHaveURL(/#\/settings$/);
  await expectStop(page, 'Back up everything in one file', main.getByRole('button', { name: 'Export Backup' }));
  await expect(tour(page).getByText(`${STOPS} of ${STOPS}`)).toBeVisible();

  await tour(page).getByRole('button', { name: 'Done' }).click();
  await expect(tour(page)).toHaveCount(0);
  await expect(page.locator('[data-tour]')).toHaveCount(0);
  // Back where it started, and usable again.
  await expect(page).toHaveURL(/#\/$/);
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
  await page.getByLabel('Weight (lbs)').fill('179');
  await expect(page.getByLabel('Weight (lbs)')).toHaveValue('179');

  // Once only.
  expect(await page.evaluate(() => localStorage.getItem('kenna:whatsNewSeen'))).toBe(WHATS_NEW_VERSION);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
  await expect(tour(page)).toHaveCount(0);
});

test('the screens behind the tour can’t be used, and focus stays in its card', async ({ page, appURL }) => {
  await returningUser(page, appURL);
  await expect(tour(page)).toBeVisible();
  expect(await page.evaluate(() => document.querySelector('.app').inert)).toBe(true);
  for (let i = 0; i < 5; i += 1) {
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => !!document.activeElement.closest('[data-whats-new]'))).toBe(true);
  }
});

test('Close or Escape ends it where it started, and it stays closed', async ({ page, appURL }) => {
  await returningUser(page, appURL);
  await tour(page).getByRole('button', { name: 'Next' }).click();
  await tour(page).getByRole('button', { name: 'Next' }).click();
  await tour(page).getByRole('button', { name: 'Next' }).click();
  await expect(page).toHaveURL(/#\/log$/);
  await tour(page).getByRole('button', { name: 'Close' }).click();
  await expect(tour(page)).toHaveCount(0);
  await expect(page).toHaveURL(/#\/$/);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
  await expect(tour(page)).toHaveCount(0);

  await page.evaluate(() => localStorage.removeItem('kenna:whatsNewSeen'));
  await page.reload();
  await expect(tour(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(tour(page)).toHaveCount(0);
});

test('a new user isn’t shown it, then or later', async ({ page, appURL }) => {
  await page.goto(appURL);
  await expect(page.getByLabel('Weight (lbs)')).toBeVisible();
  await expect(tour(page)).toHaveCount(0);
  await page.getByLabel('Weight (lbs)').fill('180');
  await page.getByLabel('Weight (lbs)').press('Enter');
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
  await expect(tour(page)).toHaveCount(0);
});

test('it doesn’t start by itself on a screen other than Today', async ({ page, appURL }) => {
  await returningUser(page, appURL);
  await expect(tour(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(tour(page)).toHaveCount(0);
  await page.evaluate(() => localStorage.removeItem('kenna:whatsNewSeen'));
  await page.goto(`${appURL}/#/history`);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'History' }).first()).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('kenna:whatsNewSeen'))).toBeNull();
  await expect(tour(page)).toHaveCount(0);
});

test('Settings starts it again and it ends back on Settings; axe finds no problems in it', async ({ page, appURL }) => {
  // No color transitions, so axe reads each theme's settled colors.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await returningUser(page, appURL);
  await expect(tour(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(tour(page)).toHaveCount(0);
  await page.goto(`${appURL}/#/settings`);
  await page.getByRole('button', { name: 'Take the tour' }).click();
  await expect(tour(page).getByRole('heading', { name: 'What’s new in Kenna' })).toBeFocused();
  await tour(page).getByRole('button', { name: 'Next' }).click();
  await expect(page).toHaveURL(/#\/$/);
  await expectStop(page, 'View or fix any past day', page.locator('main .day-switch, main .field:has(input[type="date"])').first());
  for (const theme of ['light', 'dark']) {
    await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
    const results = await new AxeBuilder({ page }).include('[data-tour]').withTags(['wcag2a', 'wcag2aa', 'best-practice']).analyze();
    expect(results.violations.map((v) => `${theme}: ${v.id} — ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
  }
  await tour(page).getByRole('button', { name: 'Close' }).click();
  await expect(page).toHaveURL(/#\/settings$/);
  await expect(page.getByRole('button', { name: 'Take the tour' })).toBeVisible();
});

for (const size of [
  { width: 320, height: 568 },
  { width: 1024, height: 768 },
]) {
  test(`every stop fits a ${size.width}×${size.height} screen, card beside the lit feature`, async ({ page, appURL }) => {
    await page.setViewportSize(size);
    await returningUser(page, appURL);
    await expectStop(page, 'What’s new in Kenna', null);
    for (let i = 1; i < STOPS; i += 1) {
      await tour(page).getByRole('button', { name: 'Next' }).click();
      await expect(tour(page).getByText(`${i + 1} of ${STOPS}`)).toBeVisible();
      await expectStop(page, await tour(page).getByRole('heading').textContent(), null);
      const [lit, card] = await Promise.all([spot(page).boundingBox(), tour(page).boundingBox()]);
      expect(lit.height, `stop ${i + 1}`).toBeGreaterThan(20);
      const overlap = Math.min(card.y + card.height, lit.y + lit.height) - Math.max(card.y, lit.y);
      expect(overlap).toBeLessThanOrEqual(0);
    }
  });
}

test('with nothing logged, every stop still opens straight away and says where the feature will show', async ({ page, appURL }) => {
  await page.goto(`${appURL}/#/settings`);
  await page.getByRole('button', { name: 'Take the tour' }).click();
  await expect(tour(page).getByText(`1 of ${STOPS}`)).toBeVisible();
  for (let i = 1; i < STOPS; i += 1) {
    await tour(page).getByRole('button', { name: 'Next' }).click();
    // Well inside the time a screen gets before the tour gives up on it.
    await expect(tour(page).getByText(`${i + 1} of ${STOPS}`)).toBeVisible({ timeout: 1500 });
    await expect(page.locator('.tour-layer.is-moving')).toHaveCount(0, { timeout: 1500 });
  }
  await expect(tour(page).getByRole('heading', { name: 'Back up everything in one file' })).toBeVisible();
  await tour(page).getByRole('button', { name: 'Back' }).click();
  await tour(page).getByRole('button', { name: 'Back' }).click();
  await expect(tour(page).getByRole('heading', { name: 'How am I doing today?' })).toBeFocused();
  await expect(tour(page).getByText('The answers show up here once you’ve logged a day or two.')).toBeVisible();
  await tour(page).getByRole('button', { name: 'Back' }).click();
  await expect(tour(page).getByText('Your months show up here once you’ve logged a day.')).toBeVisible();
});
