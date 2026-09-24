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

// The start of a HEIC file: a real photo format, but not one this browser
// can draw (Chromium can't draw HEIC at all, and these bytes are only the
// header).
const HEIC = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypheic'), Buffer.alloc(64)]);

test("a photo this browser can't draw says so, in the viewer and in Compare photos, never as a broken image", async ({ page, appURL }) => {
  await addPhotos(page, appURL, ['2026-09-01']);
  await page.clock.setFixedTime(new Date(Date.parse('2026-09-24T10:00:00-05:00') + 5 * 60000));
  await page.getByLabel('Day this photo was taken').fill('2026-09-20');
  await page.locator('input[type=file]').setInputFiles({ name: 'IMG_0001.HEIC', mimeType: 'image/heic', buffer: HEIC });
  await expect(page.getByRole('status').filter({ hasText: 'Photo added to Sun, Sep 20.' })).toContainText(
    "It's saved, but this browser can't show this kind of photo, so it can't be previewed here."
  );
  const thumb = page.getByRole('button', { name: 'Progress photo, Sun, Sep 20' });
  await expect(thumb).toContainText("Can't preview in this browser");

  await thumb.click();
  const viewer = page.getByRole('dialog');
  await expect(viewer).toHaveAccessibleName('Progress photo, Sun, Sep 20');
  await expect(viewer.getByText("Can't preview in this browser")).toBeVisible();
  await expect(viewer.getByText('The photo is saved as it is and included in backups.')).toBeVisible();
  await expect(viewer.locator('img')).toHaveCount(0);
  // Everything else in the viewer still works.
  await expect(viewer.getByLabel('Day this photo was taken')).toHaveValue('2026-09-20');
  await expect(viewer.getByRole('button', { name: 'Delete…' })).toBeEnabled();
  await viewer.getByRole('button', { name: 'Previous photo' }).click();
  await expect(viewer).toHaveAccessibleName('Progress photo, Tue, Sep 1');
  await expect(viewer.getByRole('img', { name: 'Progress photo, Tue, Sep 1' })).toBeVisible();
  await viewer.getByRole('button', { name: 'Next photo' }).click();
  await expect(viewer.getByText("Can't preview in this browser")).toBeVisible();

  await viewer.getByRole('button', { name: 'Compare…' }).click();
  await page.getByRole('button', { name: 'Progress photo, Tue, Sep 1' }).click();
  const compare = page.getByRole('dialog', { name: 'Compare photos' });
  await expect(compare.locator('figcaption')).toHaveText([/Tue, Sep 1/, /Sun, Sep 20/]);
  await expect(compare.getByRole('img', { name: 'Progress photo, Tue, Sep 1' })).toBeVisible();
  await expect(compare.getByRole('img', { name: "Progress photo, Sun, Sep 20: can't preview in this browser" })).toBeVisible();
  await expect(compare.locator('img')).toHaveCount(1);
  expect(await compare.locator('img').evaluate((img) => img.naturalWidth)).toBeGreaterThan(0);
});

test('while the viewer asks whether to delete, the arrow keys and swipes stay on that photo', async ({ page, appURL }) => {
  const { default: AxeBuilder } = require('@axe-core/playwright');
  await addPhotos(page, appURL, ['2026-09-01', '2026-09-10']);
  await page.getByRole('button', { name: 'Progress photo, Tue, Sep 1' }).click();
  const viewer = page.getByRole('dialog');
  await viewer.getByRole('button', { name: 'Delete…' }).click();
  await expect(viewer.getByRole('group', { name: 'Delete this photo from Tue, Sep 1?' })).toBeVisible();
  await expect(viewer.getByRole('button', { name: 'Next photo' })).toBeHidden();
  await page.keyboard.press('ArrowRight');
  await expect(viewer).toHaveAccessibleName('Progress photo, Tue, Sep 1');
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(results.violations.map((v) => v.id)).toEqual([]);
  await viewer.getByRole('button', { name: 'Delete photo' }).click();
  await expect(viewer).toBeHidden();
  await expect(page.locator('.photo-thumb')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Progress photo, Thu, Sep 10' })).toBeVisible();
});

test('with no photos, Photos says what they are for and offers to add the first one', async ({ page, appURL }) => {
  await page.goto(`${appURL}/#/photos`);
  const empty = page.locator('[data-photos-empty]');
  await expect(empty.getByRole('heading', { name: 'No photos yet' })).toBeVisible();
  await expect(empty).toContainText('Add one every week or two');
  await expect(empty).toContainText('Compare photos then puts two side by side, with your weight on each day');
  const chooser = page.waitForEvent('filechooser');
  await empty.getByRole('button', { name: 'Add your first photo' }).click();
  await (await chooser).setFiles({ name: 'me.png', mimeType: 'image/png', buffer: PNG });
  await expect(page.locator('.photo-thumb')).toHaveCount(1);
  await expect(empty).toHaveCount(0);
});
