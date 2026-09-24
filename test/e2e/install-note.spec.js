const { default: AxeBuilder } = require('@axe-core/playwright');
const { test, expect, TODAY, day } = require('./fixtures');

// Kenna in a Safari tab on an iPhone (the test browser has an iPhone's
// screen and user agent), not opened from the Home Screen.
test.use({ installed: false });

const note = (page) => page.locator('[data-install-note]');

test.describe('phone version in a Safari tab', () => {
  test.beforeEach(({ backend }) => test.skip(backend !== 'local', 'the server version keeps data on the server'));

  test('Today says iPhone may delete the data and gives the Home Screen steps', async ({ page, appURL }) => {
    await page.goto(appURL);
    await expect(note(page)).toBeVisible();
    await expect(note(page).getByText('Add Kenna to your Home Screen')).toBeVisible();
    await expect(note(page)).toContainText('iPhone may delete your days and photos from a tab that hasn’t been used for about a week');
    const steps = await note(page).locator('li').allTextContents();
    expect(steps).toEqual([
      'Tap the Share button (the square with an arrow) in Safari’s toolbar.',
      'Tap Add to Home Screen, then Add.',
      'From now on, open Kenna from its new icon.',
    ]);
    // Nothing logged yet, so there's nothing to carry over.
    await expect(note(page).getByRole('link', { name: 'Back up first' })).toHaveCount(0);
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'best-practice']).analyze();
    expect(results.violations.map((v) => v.id)).toEqual([]);
  });

  test('with days logged it says to back up first, since the Home Screen app starts separately', async ({ page, appURL, data }) => {
    await data.seed({ [TODAY]: day(TODAY, { breakfast: 400 }) });
    await page.goto(appURL);
    await expect(note(page)).toContainText('Save a backup file here first, then import it there');
    await note(page).getByRole('link', { name: 'Back up first' }).click();
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  });

  test('Not now hides it for a week, then it comes back', async ({ page, appURL }) => {
    await page.goto(appURL);
    await note(page).getByRole('button', { name: 'Not now' }).click();
    await expect(note(page)).toHaveCount(0);
    await page.reload();
    await expect(page.getByLabel('Weight (lbs)')).toBeVisible();
    await expect(note(page)).toHaveCount(0);
    await page.clock.setFixedTime(new Date('2026-09-30T10:00:00-05:00'));
    await page.reload();
    await expect(page.getByLabel('Weight (lbs)')).toBeVisible();
    await expect(note(page)).toHaveCount(0);
    await page.clock.setFixedTime(new Date('2026-10-02T10:00:00-05:00'));
    await page.reload();
    await expect(note(page)).toBeVisible();
  });

  test('Settings explains the risk and repeats the steps', async ({ page, appURL }) => {
    await page.goto(`${appURL}/#/settings`);
    await expect(page.getByText('Safari may delete a website’s data, Kenna’s included, when it hasn’t been used for about a week')).toBeVisible();
    await expect(page.locator('[data-install-steps]')).toContainText('You’re using Kenna in a Safari tab');
    await expect(page.locator('[data-install-steps] li')).toHaveCount(3);
  });

  test('opened from the Home Screen, there is no note', async ({ page, appURL }) => {
    await page.addInitScript(() => {
      Object.defineProperty(Navigator.prototype, 'standalone', { get: () => true, configurable: true });
    });
    await page.goto(appURL);
    await expect(page.getByLabel('Weight (lbs)')).toBeVisible();
    await expect(note(page)).toHaveCount(0);
    await page.goto(`${appURL}/#/settings`);
    await expect(page.getByText('Kenna is running from your Home Screen')).toBeVisible();
    await expect(page.locator('[data-install-steps]')).toHaveCount(0);
  });

  test('installed as an app by display mode alone, there is no note', async ({ page, appURL }) => {
    await page.addInitScript(() => {
      const original = window.matchMedia.bind(window);
      window.matchMedia = (query) => (query === '(display-mode: standalone)' ? { ...original(query), matches: true, media: query } : original(query));
    });
    await page.goto(appURL);
    await expect(page.getByLabel('Weight (lbs)')).toBeVisible();
    await expect(note(page)).toHaveCount(0);
  });
});

test.describe('not on an iPhone', () => {
  test.use({ userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36' });

  test('on Android there is no note', async ({ page, appURL }) => {
    await page.goto(appURL);
    await expect(page.getByLabel('Weight (lbs)')).toBeVisible();
    await expect(note(page)).toHaveCount(0);
  });
});

test('the server version never shows the note, even in a Safari tab', async ({ page, appURL, backend }) => {
  test.skip(backend !== 'server', 'server version only');
  await page.goto(appURL);
  await expect(page.getByLabel('Weight (lbs)')).toBeVisible();
  await expect(note(page)).toHaveCount(0);
});
