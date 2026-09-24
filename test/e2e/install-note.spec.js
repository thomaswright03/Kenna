const { default: AxeBuilder } = require('@axe-core/playwright');
const { test, expect, TODAY, day } = require('./fixtures');

// Kenna in a Safari tab on an iPhone (the test browser has an iPhone's
// screen and user agent), not opened from the Home Screen.
test.use({ installed: false });

const note = (page) => page.locator('[data-install-note]');

test.describe('phone version in a Safari tab', () => {
  test('on first open the day comes first, with a welcome, and the Home Screen note waits below it', async ({ page, appURL }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(appURL);
    await expect(page.locator('[data-welcome]')).toContainText('Welcome to Kenna.');
    await expect(page.getByLabel('Weight (lbs)')).toBeInViewport({ ratio: 1 });
    await expect(page.getByRole('link', { name: 'Log Meal' })).toBeInViewport({ ratio: 1 });
    await expect(note(page)).toBeVisible();
    const [dayCard, noteBox] = await Promise.all([page.locator('.card', { has: page.getByLabel('Weight (lbs)') }).boundingBox(), note(page).boundingBox()]);
    expect(noteBox.y).toBeGreaterThan(dayCard.y + dayCard.height - 1);

    // With something logged, it moves above the day: now there's data to lose.
    await page.getByLabel('Weight (lbs)').fill('180');
    await page.getByLabel('Weight (lbs)').press('Enter');
    await expect(page.getByText('Saved', { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.locator('[data-welcome]')).toHaveCount(0);
    const [dayAfter, noteAfter] = await Promise.all([page.locator('.card', { has: page.getByLabel('Weight (lbs)') }).boundingBox(), note(page).boundingBox()]);
    expect(noteAfter.y).toBeLessThan(dayAfter.y);
    // One meal is too little to ask for a backup about.
    await expect(page.locator('[data-backup-reminder]')).toHaveCount(0);
  });

  test('Today says iPhone may delete the data and gives the Home Screen steps', async ({ page, appURL }) => {
    await page.goto(appURL);
    await expect(note(page)).toBeVisible();
    await expect(note(page).getByText('Add Kenna to your Home Screen')).toBeVisible();
    await expect(note(page)).toContainText('iPhone may delete your days and photos from a tab that hasn’t been used for about a week');
    // The steps are one tap away.
    await expect(note(page).locator('li').first()).toBeHidden();
    await note(page).getByText('How to add it').click();
    await expect(note(page).locator('li').first()).toBeVisible();
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

  test('the card’s rows are evenly spaced, with no gap before its buttons', async ({ page, appURL }) => {
    await page.goto(appURL);
    await expect(note(page)).toBeVisible();
    const gaps = await note(page).evaluate((card) => {
      const textBox = (el) => {
        const range = document.createRange();
        range.selectNodeContents(el);
        return range.getBoundingClientRect();
      };
      const why = textBox(card.querySelectorAll('.notice-text')[0]);
      const how = textBox(card.querySelector('summary'));
      const button = card.querySelector('.notice-actions .btn').getBoundingClientRect();
      return { above: how.top - why.bottom, below: button.top - how.bottom };
    });
    // The space under "How to add it" matches the space above it.
    expect(gaps.below).toBeLessThanOrEqual(24);
    expect(Math.abs(gaps.below - gaps.above)).toBeLessThanOrEqual(6);
  });

  test('with days logged it says to back up first, since the Home Screen app starts separately', async ({ page, appURL, data }) => {
    await data.seed({ [TODAY]: day(TODAY, { breakfast: 400 }) });
    await page.goto(appURL);
    await expect(note(page)).toContainText('It starts empty there, so save a backup file here first, then import it there');
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

test.describe('only one notice above the day', () => {
  test('with days logged and no backup, the Home Screen note is the only card above the day, and the Weight box is in view', async ({ page, appURL, data }) => {
    await data.seed({
      '2026-09-21': day('2026-09-21', { lunch: 500 }),
      '2026-09-22': day('2026-09-22', { lunch: 600 }),
      [TODAY]: day(TODAY, { breakfast: 400 }),
    });
    await page.goto(appURL);
    await expect(note(page)).toBeVisible();
    await expect(page.locator('[data-backup-reminder]')).toHaveCount(0);
    await expect(page.locator('.notice-card')).toHaveCount(1);
    await expect(page.getByLabel('Weight (lbs)')).toBeInViewport({ ratio: 1 });

    // Hiding the note brings the backup reminder in its place.
    await note(page).getByRole('button', { name: 'Not now' }).click();
    await expect(note(page)).toHaveCount(0);
    await expect(page.locator('[data-backup-reminder]')).toBeVisible();
    await expect(page.locator('[data-backup-reminder]')).toBeFocused();
    await expect(page.locator('.notice-card')).toHaveCount(1);
    await page.reload();
    await expect(page.locator('[data-backup-reminder]')).toBeVisible();
    await expect(page.locator('.notice-card')).toHaveCount(1);
  });
});
