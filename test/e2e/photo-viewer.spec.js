const { test, expect } = require('./fixtures');

// A 2x2 PNG.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8z8DAwMDAxMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg==',
  'base64'
);

// Adds one photo filed under each of `days`, oldest first.
async function addPhotos(page, appURL, days) {
  await page.goto(`${appURL}/#/photos`);
  for (const date of days) {
    // Each photo is added at its own time, as it would be.
    await page.clock.setFixedTime(new Date(Date.parse('2026-09-24T10:00:00-05:00') + days.indexOf(date) * 60000));
    await page.getByLabel('Day this photo was taken').fill(date);
    await page.locator('input[type=file]').setInputFiles({ name: 'me.png', mimeType: 'image/png', buffer: PNG });
    await expect(page.locator('.photo-thumb')).toHaveCount(days.indexOf(date) + 1);
  }
}

test('the viewer steps through photos in date order, with buttons, keys and a swipe', async ({ page, appURL }) => {
  await addPhotos(page, appURL, ['2026-09-01', '2026-09-10', '2026-09-20']);
  await page.getByRole('button', { name: 'Progress photo, Sun, Sep 20' }).click();
  const viewer = page.getByRole('dialog');
  await expect(viewer).toHaveAccessibleName('Progress photo, Sun, Sep 20');
  await expect(viewer).toContainText('3 of 3, oldest first');
  await expect(viewer.getByRole('button', { name: 'Next photo' })).toBeDisabled();

  await viewer.getByRole('button', { name: 'Previous photo' }).click();
  await expect(viewer).toHaveAccessibleName('Progress photo, Thu, Sep 10');
  await viewer.getByRole('button', { name: 'Previous photo' }).click();
  await expect(viewer).toHaveAccessibleName('Progress photo, Tue, Sep 1');
  await expect(viewer.getByRole('button', { name: 'Previous photo' })).toBeDisabled();
  await expect(viewer.getByLabel('Day this photo was taken')).toHaveValue('2026-09-01');
  await expect(viewer.getByRole('img', { name: 'Progress photo, Tue, Sep 1' })).toBeVisible();

  await page.keyboard.press('ArrowRight');
  await expect(viewer).toHaveAccessibleName('Progress photo, Thu, Sep 10');

  // A swipe to the left shows the next photo.
  const frame = viewer.locator('.viewer-frame');
  const box = await frame.boundingBox();
  await frame.dispatchEvent('pointerdown', { clientX: box.x + box.width - 20, clientY: box.y + 40, pointerId: 1 });
  await frame.dispatchEvent('pointerup', { clientX: box.x + 20, clientY: box.y + 45, pointerId: 1 });
  await expect(viewer).toHaveAccessibleName('Progress photo, Sun, Sep 20');
});

test('two photos can be compared side by side, labelled with their days and weights', async ({ page, appURL, data }) => {
  await data.seed({ '2026-09-01': { date: '2026-09-01', weight: 182.4, meals: {} }, '2026-09-20': { date: '2026-09-20', weight: 176, meals: {} } });
  await addPhotos(page, appURL, ['2026-09-01', '2026-09-10', '2026-09-20']);

  // From the viewer: this photo, then pick another.
  await page.getByRole('button', { name: 'Progress photo, Sun, Sep 20' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Compare…' }).click();
  await expect(page.locator('[data-compare-bar]')).toContainText('Now tap a second photo.');
  await expect(page.getByRole('button', { name: 'Progress photo, Sun, Sep 20' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Progress photo, Tue, Sep 1' }).click();

  const compare = page.getByRole('dialog', { name: 'Compare photos' });
  await expect(compare).toContainText('19 days apart, 6.4 lbs down');
  await expect(compare.locator('figcaption')).toHaveText([/Tue, Sep 1\s*182.4 lbs/, /Sun, Sep 20\s*176 lbs/]);
  await expect(compare.getByRole('img', { name: 'Progress photo, Tue, Sep 1' })).toBeVisible();
  await expect(compare.getByRole('img', { name: 'Progress photo, Sun, Sep 20' })).toBeVisible();
  await compare.getByRole('button', { name: 'Close' }).click();
  await expect(page.locator('[data-compare-bar]')).toBeHidden();

  // From the Photos screen: Compare photos, then two taps.
  await page.getByRole('button', { name: 'Compare photos' }).click();
  await expect(page.locator('[data-compare-bar]')).toContainText('Tap two photos to see them side by side.');
  await page.getByRole('button', { name: 'Progress photo, Thu, Sep 10' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'Progress photo, Sun, Sep 20' }).click();
  await expect(page.getByRole('dialog', { name: 'Compare photos' })).toContainText('10 days apart');
  await page.keyboard.press('Escape');
  // Picking is over: a tap opens the viewer again.
  await page.getByRole('button', { name: 'Progress photo, Thu, Sep 10' }).click();
  await expect(page.getByRole('dialog')).toHaveAccessibleName('Progress photo, Thu, Sep 10');
});
