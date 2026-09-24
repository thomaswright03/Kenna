const { test, expect, TODAY, day } = require('./fixtures');

// A week of breakfasts of about 450 cal, and yesterday's weight of 180.4.
function usualWeek() {
  const days = {};
  for (let d = 17; d <= 23; d += 1) days[`2026-09-${d}`] = day(`2026-09-${d}`, { breakfast: 440 + (d % 3) * 10 }, d === 23 ? 180.4 : null);
  return days;
}

const hide = (page) =>
  page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    delete document.visibilityState;
  });

test('a meal far above its usual size is asked about before it is saved', async ({ page, appURL, data }) => {
  await data.seed(usualWeek());
  await page.goto(`${appURL}/#/log/breakfast`);
  const box = page.getByLabel('Breakfast calories');
  await box.fill('4500');
  await box.press('Enter');
  const question = page.getByRole('dialog', { name: 'Keep 4,500 cal for breakfast?' });
  await expect(question).toContainText("That's far more than your usual breakfast (450 cal).");
  // Nothing is saved until it's answered.
  expect(await data.entry(TODAY)).toBe(null);

  // Change it: the number stays in the box, not saved.
  await question.getByRole('button', { name: 'Change it' }).click();
  await expect(question).toHaveCount(0);
  await expect(box).toBeFocused();
  await expect(box).toHaveValue('4500');
  await expect(page.getByText("Not saved yet. That's far more than your usual breakfast (450 cal).")).toBeVisible();
  expect(await data.entry(TODAY)).toBe(null);

  // A usual number saves without a question.
  await box.fill('480');
  await box.press('Enter');
  await expect(page.getByLabel('Snack 1 calories')).toBeVisible();
  expect((await data.entry(TODAY)).meals.breakfast).toBe(480);
  await expect(page.getByRole('dialog')).toHaveCount(0);

  // With no history for a meal, only a very large number is asked about;
  // Keep it saves it.
  await page.getByLabel('Snack 1 calories').fill('3500');
  await page.getByRole('button', { name: 'Save and close' }).click();
  const snack = page.getByRole('dialog', { name: 'Keep 3,500 cal for snack 1?' });
  await expect(snack).toContainText("That's more than 3,000 cal for one meal.");
  await snack.getByRole('button', { name: 'Keep it' }).click();
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
  expect((await data.entry(TODAY)).meals.snack1).toBe(3500);
});

test('a weight far from yesterday’s is asked about; a usual one is saved at once', async ({ page, appURL, data }) => {
  await data.seed(usualWeek());
  await page.goto(appURL);
  const weight = page.getByLabel('Weight (lbs)');
  await weight.fill('108.4');
  await weight.press('Enter');
  const question = page.getByRole('dialog', { name: 'Keep 108.4 lbs?' });
  await expect(question).toContainText("That's 72.0 lbs less than your weight yesterday (180.4 lbs).");
  await question.getByRole('button', { name: 'Change it' }).click();
  await expect(weight).toHaveValue('108.4');
  expect(await data.entry(TODAY)).toBe(null);

  await weight.fill('180.8');
  await weight.press('Enter');
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect((await data.entry(TODAY)).weight).toBe(180.8);
});

test('leaving the screen keeps a number waiting to be asked about, and asks when its box is next shown', async ({ page, appURL, data }) => {
  await data.seed(usualWeek());
  await page.goto(appURL);
  await page.getByLabel('Weight (lbs)').fill('108.4');
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'History' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Weight not saved (“108.4”).' })).toContainText("That's 72.0 lbs less than your weight yesterday");
  expect(await data.entry(TODAY)).toBe(null);

  await page.getByRole('button', { name: 'Fix it' }).click();
  const question = page.getByRole('dialog', { name: 'Keep 108.4 lbs?' });
  await expect(question).toBeVisible();
  await expect(page.getByLabel('Weight (lbs)')).toHaveValue('108.4');
  await question.getByRole('button', { name: 'Keep it' }).click();
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();
  expect((await data.entry(TODAY)).weight).toBe(108.4);
});

test('a number waiting to be asked about is not saved when the app is put away, and is asked about on the next visit', async ({ page, appURL, data }) => {
  await data.seed(usualWeek());
  await page.goto(`${appURL}/#/log/breakfast`);
  await page.getByLabel('Breakfast calories').fill('4500');
  await hide(page);
  await expect(page.getByText("Not saved yet. That's far more than your usual breakfast (450 cal).")).toBeVisible();
  await page.reload();
  const question = page.getByRole('dialog', { name: 'Keep 4,500 cal for breakfast?' });
  await expect(question).toBeVisible();
  await expect(page.getByLabel('Breakfast calories')).toHaveValue('4500');
  expect(await data.entry(TODAY)).toBe(null);
  await question.getByRole('button', { name: 'Keep it' }).click();
  await expect(page.getByText('Breakfast saved')).toBeVisible();
  expect((await data.entry(TODAY)).meals.breakfast).toBe(4500);
});

test('leaving the box for elsewhere on the screen asks too, and Keep it under the box saves after Change it', async ({ page, appURL, data }) => {
  await data.seed(usualWeek());
  await page.goto(appURL);
  await page.getByLabel('Weight (lbs)').fill('108.4');
  await page.getByRole('heading', { name: 'Today', exact: true }).click();
  const question = page.getByRole('dialog', { name: 'Keep 108.4 lbs?' });
  await question.getByRole('button', { name: 'Change it' }).click();
  expect(await data.entry(TODAY)).toBe(null);
  await page.locator('.field-status').getByRole('button', { name: 'Keep it' }).click();
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();
  expect((await data.entry(TODAY)).weight).toBe(108.4);
  await expect(page.getByRole('dialog')).toHaveCount(0);
});
