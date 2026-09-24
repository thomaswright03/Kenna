const { test, expect, TODAY, day } = require('./fixtures');

test('typing then tapping another control takes effect on the first tap', async ({ page, appURL, data }) => {
  await page.goto(appURL);
  const weight = page.getByLabel('Weight (lbs)');
  await weight.tap();
  await page.keyboard.type('180.4');
  await page.getByRole('link', { name: 'Log Meal' }).tap();
  await expect(page.getByRole('heading', { name: 'Log Meal' })).toBeVisible();
  expect((await data.entry(TODAY)).weight).toBe(180.4);

  const cal = page.getByLabel('Breakfast calories');
  await cal.tap();
  await page.keyboard.type('400');
  await page.locator('[data-meal="lunch"]').tap();
  await expect(page.getByLabel('Lunch calories')).toBeVisible();
  await page.getByLabel('Lunch calories').tap();
  await page.keyboard.type('650');
  await page.locator('[data-meal="dinner"]').tap();
  await expect(page.locator('[data-meal="dinner"]')).toHaveAttribute('aria-pressed', 'true');

  const saved = await data.entry(TODAY);
  expect(saved.meals.breakfast).toBe(400);
  expect(saved.meals.lunch).toBe(650);
  await expect(page.getByText('Day total: 1,050 cal')).toBeVisible();

  await page.getByRole('button', { name: 'Done' }).tap();
  await expect(page.getByRole('status').filter({ hasText: 'Saved for Today: 1,050 cal' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
  await expect(page.locator('.total-num')).toHaveText('1,050');
});

test('Enter moves on to the next meal that has not been logged', async ({ page, appURL, data }) => {
  await page.goto(`${appURL}/#/log/breakfast`);
  await page.getByLabel('Breakfast calories').fill('300');
  await page.keyboard.press('Enter');
  await expect(page.getByLabel('Snack 1 calories')).toBeFocused();
  expect((await data.entry(TODAY)).meals.breakfast).toBe(300);
});

test('out-of-range values show a message and are not saved', async ({ page, appURL, data }) => {
  await page.goto(`${appURL}/#/log/breakfast`);
  const cal = page.getByLabel('Breakfast calories');
  await cal.fill('-300');
  await cal.blur();
  await expect(page.getByText("Calories can't be negative. Enter 0 or more.")).toBeVisible();
  await expect(cal).toHaveAttribute('aria-invalid', 'true');
  await page.locator('[data-meal="lunch"]').click();
  await expect(page.locator('[data-meal="breakfast"]')).toHaveAttribute('aria-pressed', 'true');
  await cal.fill('99999999999');
  await cal.blur();
  await expect(page.getByText(/over 10,000 calories/)).toBeVisible();
  expect(await data.entry(TODAY)).toEqual(expect.not.objectContaining({ meals: expect.objectContaining({ breakfast: expect.any(Number) }) }));

  await page.goto(appURL);
  const weight = page.getByLabel('Weight (lbs)');
  for (const bad of ['-5', '0', '1001']) {
    await weight.fill(bad);
    await weight.blur();
    await expect(page.getByText('Enter a weight between 50 and 1,000 lbs.')).toBeVisible();
  }
  await weight.fill('165.255');
  await weight.blur();
  await expect(page.getByText('Use at most two decimal places, like 165.25.')).toBeVisible();
  const stored = await data.entry(TODAY);
  expect(stored === null || stored.weight === null).toBe(true);

  // A decimal point left at the end is read as the whole number.
  await weight.fill('165.');
  await weight.blur();
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();
  expect((await data.entry(TODAY)).weight).toBe(165);
});

test('the date field cannot be emptied or set to the future', async ({ page, appURL, backend }) => {
  await page.goto(appURL);
  const date = page.getByLabel('Day to view or edit');
  await date.fill('');
  await date.dispatchEvent('change');
  await expect(date).toHaveValue(TODAY);
  await page.getByLabel('Weight (lbs)').fill('181');
  await page.getByLabel('Weight (lbs)').blur();
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();
  if (backend === 'local') {
    const keys = await page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('kenna:entries'))));
    expect(keys).toEqual([TODAY]);
  }
  await date.fill('2026-12-01');
  await date.dispatchEvent('change');
  await expect(page.getByText("You can't log a day that hasn't happened yet.")).toBeVisible();
  await expect(date).toHaveValue(TODAY);
});

test('saving a weight shows that it was saved', async ({ page, appURL }) => {
  await page.goto(appURL);
  await page.getByLabel('Weight (lbs)').fill('179.6');
  await page.getByLabel('Weight (lbs)').press('Enter');
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();
});

test('removing a meal can be undone', async ({ page, appURL, data }) => {
  await data.seed({ [TODAY]: day(TODAY, { breakfast: 400, lunch: 650 }) });
  await page.goto(appURL);
  await page.getByRole('button', { name: 'Remove Breakfast' }).click();
  await expect(page.locator('.total-num')).toHaveText('650');
  expect((await data.entry(TODAY)).meals.breakfast).toBe(null);
  const row = page.locator('.meal-row[data-meal="breakfast"]');
  await expect(row).toContainText('Removed (was 400 cal)');
  // Undo sits in the meal's own row and takes focus; no message covers
  // anything.
  const undo = row.getByRole('button', { name: 'Undo removing Breakfast' });
  await expect(undo).toBeFocused();
  await expect(page.locator('.toast')).toHaveCount(0);
  await undo.click();
  await expect(page.locator('.total-num')).toHaveText('1,050');
  await expect(row).toContainText('400 cal');
  await expect(row.getByRole('link', { name: 'Edit Breakfast' })).toBeFocused();
  expect((await data.entry(TODAY)).meals.breakfast).toBe(400);
});

test('a confirmation message never blocks a tap on what is under it', async ({ page, appURL }) => {
  await page.goto(`${appURL}/#/log/breakfast`);
  await page.getByLabel('Breakfast calories').fill('400');
  await page.getByRole('button', { name: 'Done' }).click();
  const saved = page.locator('.toast').filter({ hasText: 'Saved for Today' });
  await expect(saved).toBeVisible();
  // Put the Log Meal button right where the message is.
  const logMeal = page.getByRole('link', { name: 'Log Meal' });
  const toastBox = await saved.boundingBox();
  const buttonBox = await logMeal.boundingBox();
  await page.evaluate((dy) => window.scrollBy(0, dy), buttonBox.y - toastBox.y);
  const moved = await logMeal.boundingBox();
  const now = await saved.boundingBox();
  expect(Math.abs(moved.y - now.y)).toBeLessThan(now.height);
  // A tap there reaches the button, not the message.
  await page.mouse.click(moved.x + moved.width / 2, moved.y + moved.height / 2);
  await expect(page.getByRole('heading', { name: 'Log Meal' })).toBeVisible();
});

test('one message at a time, cleared when another screen opens, and a tap dismisses it', async ({ page, appURL }) => {
  await page.goto(`${appURL}/#/log/breakfast`);
  await page.getByLabel('Breakfast calories').fill('400');
  await page.getByRole('button', { name: 'Done' }).click();
  // Done's confirmation belongs to the screen it returns to, so it stays.
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
  await expect(page.locator('.toast')).toHaveText(['Saved for Today: 400 cal']);

  // A second message replaces it rather than stacking.
  await page.evaluate(() => {
    window.location.hash = '#/day/2030-01-01';
  });
  await expect(page.locator('.toast')).toHaveText(["You can't log a day that hasn't happened yet."]);

  // Opening another screen clears it.
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Compare' }).click();
  await expect(page.getByRole('heading', { name: 'Compare' })).toBeVisible();
  await expect(page.locator('.toast')).toHaveCount(0);

  // A tap on a message dismisses it.
  await page.goto(`${appURL}/#/log/lunch`);
  await page.getByRole('button', { name: 'Done' }).click();
  const saved = page.locator('.toast');
  await expect(saved).toHaveText(['Saved for Today: 400 cal']);
  const box = await saved.boundingBox();
  await page.touchscreen.tap(box.x + 20, box.y + box.height / 2);
  await expect(saved).toHaveCount(0);
});

test('a day left open past midnight moves to the new day', async ({ page, appURL, data }) => {
  await page.clock.install({ time: new Date('2026-09-24T23:58:00-05:00') });
  await page.goto(appURL);
  await expect(page.getByText('Thu, Sep 24')).toBeVisible();
  await page.clock.setSystemTime(new Date('2026-09-25T00:03:00-05:00'));
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect(page.getByText('Fri, Sep 25')).toBeVisible();
  await page.getByRole('link', { name: 'Log Meal' }).click();
  await page.getByLabel('Breakfast calories').fill('350');
  await page.getByRole('button', { name: 'Done' }).click();
  expect((await data.entry('2026-09-25')).meals.breakfast).toBe(350);
  const old = await data.entry('2026-09-24');
  expect(old === null || old.meals.breakfast === null).toBe(true);
});

test('a meal typed just after midnight saves to the new day', async ({ page, appURL, data }) => {
  await page.clock.install({ time: new Date('2026-09-24T23:59:00-05:00') });
  await page.goto(`${appURL}/#/log/dinner`);
  await page.getByLabel('Dinner calories').fill('500');
  await page.clock.setSystemTime(new Date('2026-09-25T00:01:00-05:00'));
  await page.getByLabel('Dinner calories').blur();
  await expect.poll(async () => (await data.entry('2026-09-25')).meals.dinner).toBe(500);
  await expect(page.getByText(/For today, Fri, Sep 25/)).toBeVisible();
});

test('a past day opened on purpose stays put after midnight', async ({ page, appURL }) => {
  await page.clock.install({ time: new Date('2026-09-24T23:58:00-05:00') });
  await page.goto(`${appURL}/#/day/2026-09-20`);
  await page.clock.setSystemTime(new Date('2026-09-25T00:03:00-05:00'));
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect(page.getByRole('heading', { name: 'Sun, Sep 20' })).toBeVisible();
});

test('a second tap on Done while it is saving does nothing more', async ({ page, appURL, data }) => {
  await page.goto(`${appURL}/#/history`);
  await page.goto(`${appURL}/#/log/breakfast`);
  await page.getByLabel('Breakfast calories').fill('420');
  // Two taps in the same instant: the second arrives while the first is saving.
  await page.getByRole('button', { name: 'Done' }).evaluate((btn) => {
    btn.click();
    btn.click();
  });
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
  await expect(page.locator('.toast').filter({ hasText: 'Saved for Today' })).toHaveCount(1);
  expect((await data.entry(TODAY)).meals.breakfast).toBe(420);
  await page.goBack();
  await expect(page.getByRole('heading', { name: 'History' })).toBeVisible();
});

test('calories typed with a thousands comma are saved as that number', async ({ page, appURL, data }) => {
  await page.goto(`${appURL}/#/log/dinner`);
  await page.getByLabel('Dinner calories').fill('1,200');
  await page.getByLabel('Dinner calories').blur();
  await expect.poll(async () => (await data.entry(TODAY))?.meals.dinner).toBe(1200);
  await expect(page.getByText('Day total: 1,200 cal')).toBeVisible();
});

test('a day long before anything logged asks first, so a mistyped year is not saved silently', async ({ page, appURL, data }) => {
  await data.seed({ '2026-09-20': day('2026-09-20', { dinner: 700 }, 180) });
  await page.goto(`${appURL}/#/day/1990-01-01`);
  const gate = page.getByRole('group', { name: 'Log a day in 1990?' });
  await expect(gate).toContainText('Mon, Jan 1, 1990 is 36 years ago, long before anything else you’ve logged.');
  await expect(page.getByLabel('Weight (lbs)')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Log Meal' })).toHaveCount(0);
  await page.goto(`${appURL}/#/day/1990-01-01/log`);
  await expect(page.getByRole('group', { name: 'Log a day in 1990?' })).toBeVisible();
  await expect(page.getByLabel(/calories/)).toHaveCount(0);

  // The day picker lands on the same question for a mistyped year.
  await page.goto(appURL);
  const picker = page.getByLabel('Day to view or edit');
  await picker.fill('2002-09-23');
  await picker.dispatchEvent('change');
  await expect(page.getByRole('group', { name: 'Log a day in 2002?' })).toBeVisible();
  await page.getByRole('link', { name: 'Back to today' }).first().click();
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();

  // Confirming opens the day as usual.
  await page.goto(`${appURL}/#/day/1990-01-01`);
  await page.getByRole('button', { name: 'Log 1990' }).click();
  await page.getByLabel('Weight (lbs)').fill('170');
  await page.getByLabel('Weight (lbs)').press('Enter');
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();
  expect((await data.entry('1990-01-01')).weight).toBe(170);

  // A day that already has data never asks, and nor does last month.
  await page.reload();
  await expect(page.getByLabel('Weight (lbs)')).toHaveValue('170');
  await page.goto(`${appURL}/#/day/2026-08-15`);
  await expect(page.getByLabel('Weight (lbs)')).toBeVisible();
  await expect(page.locator('[data-far-back]')).toHaveCount(0);
});
