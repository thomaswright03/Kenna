const { test, expect, TODAY, day } = require('./fixtures');

test('a calorie number typed but not yet saved survives a reload', async ({ page, appURL, data }) => {
  await page.goto(`${appURL}/#/log/dinner`);
  await page.getByLabel('Dinner calories').fill('640');
  await page.reload();
  await expect(page.getByLabel('Dinner calories')).toHaveValue('640');
  await expect.poll(async () => (await data.entry(TODAY)).meals.dinner).toBe(640);
  await expect(page.locator('[data-meal="dinner"]')).toContainText('640');
});

test('a weight typed but not yet saved survives a reload', async ({ page, appURL, data }) => {
  await page.goto(appURL);
  await page.getByLabel('Weight (lbs)').fill('181.2');
  await page.reload();
  await expect(page.getByLabel('Weight (lbs)')).toHaveValue('181.2');
  await expect.poll(async () => (await data.entry(TODAY)).weight).toBe(181.2);
});

test('typed values are saved when the app is sent to the background, only once', async ({ page, appURL, data, backend }) => {
  let patches = 0;
  if (backend === 'server') {
    await page.route('**/api/entries/*', (route) => {
      if (route.request().method() === 'PATCH') patches += 1;
      return route.continue();
    });
  }
  const hide = () =>
    page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
      Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    });

  await page.goto(`${appURL}/#/log/lunch`);
  await page.getByLabel('Lunch calories').fill('720');
  await hide();
  await expect.poll(async () => (await data.entry(TODAY)).meals.lunch).toBe(720);
  await expect(page.getByText('Lunch saved')).toBeVisible();
  await hide();
  await page.getByLabel('Lunch calories').blur();
  await page.getByRole('button', { name: 'Save and close' }).click();
  await expect(page.locator('.total-num')).toHaveText('720');

  await page.getByLabel('Weight (lbs)').fill('179.8');
  await hide();
  await expect.poll(async () => (await data.entry(TODAY)).weight).toBe(179.8);
  if (backend === 'server') expect(patches).toBe(2);
});

test('an invalid number is not saved; the next visit puts it back and says why', async ({ page, appURL, data, context }) => {
  await data.seed({ [TODAY]: day(TODAY, { breakfast: 400 }) });
  await page.goto(`${appURL}/#/log/dinner`);
  await page.getByLabel('Dinner calories').fill('64o');
  await page.reload();
  await expect(page.getByLabel('Dinner calories')).toHaveValue('64o');
  await expect(page.getByText('Not saved yet. Enter calories using digits only, like 450.')).toBeVisible();
  expect((await data.entry(TODAY)).meals.dinner).toBe(null);

  // The app is discarded in the background and reopened on another screen:
  // a banner explains what happened.
  await page.getByLabel('Dinner calories').fill('9x');
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  const reopened = await context.newPage();
  await reopened.clock.setFixedTime(new Date('2026-09-24T10:00:00-05:00'));
  await page.close();
  await reopened.goto(`${appURL}/#/history`);
  await expect(reopened.getByRole('status').filter({ hasText: "The Dinner calories you typed for Today (“9x”) wasn't saved." })).toBeVisible();
});

test('the day total follows the number being typed until it is saved', async ({ page, appURL, data }) => {
  await data.seed({ [TODAY]: day(TODAY, { breakfast: 450, snack1: 150 }) });
  await page.goto(`${appURL}/#/log/lunch`);
  const total = page.locator('.running-total');
  await expect(total).toHaveText('Day total: 600 cal');
  await page.getByLabel('Lunch calories').fill('700');
  await expect(total).toHaveText('Day total: 1,300 cal · Lunch not saved yet');
  await page.getByLabel('Lunch calories').blur();
  await expect(page.getByText('Lunch saved')).toBeVisible();
  await expect(total).toHaveText('Day total: 1,300 cal');
});
