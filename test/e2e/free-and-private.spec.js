const { test, expect } = require('./fixtures');

test('a new user is told on Today that Kenna is free and their data stays on the phone, until they log something', async ({ page, appURL }) => {
  await page.goto(appURL);
  const note = page.locator('main [data-your-data]');
  await expect(note).toContainText('Kenna is free. Your calories and weight stay on this phone and are never uploaded.');
  await note.getByRole('link', { name: 'About your data' }).click();
  await expect(page).toHaveURL(/#\/settings$/);
  await expect(page.getByRole('heading', { name: 'Free and private' })).toBeVisible();
  await expect(page.locator('main [data-your-data]')).toContainText('Kenna has no server, so nothing is ever uploaded.');

  await page.goto(`${appURL}/#/`);
  await page.getByLabel('Weight (lbs)').fill('180');
  await page.getByLabel('Weight (lbs)').press('Enter');
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
  await expect(page.locator('main [data-your-data]')).toHaveCount(0);
});
