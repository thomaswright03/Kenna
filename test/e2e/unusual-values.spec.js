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

test('a meal waiting to be confirmed shows on Today and in History until it is kept', async ({ page, appURL, data }) => {
  await page.goto(`${appURL}/#/log/breakfast`);
  const box = page.getByLabel('Breakfast calories');
  await box.fill('4000');
  await box.press('Enter');
  const question = page.getByRole('dialog', { name: 'Keep 4,000 cal for breakfast?' });
  await question.getByRole('button', { name: 'Change it' }).click();
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Today' }).click();
  const message = page.locator('.toast').filter({ hasText: 'Breakfast not saved (“4000”).' });
  await message.getByRole('button', { name: 'Dismiss' }).click();
  await expect(message).toHaveCount(0);
  expect(await data.entry(TODAY)).toBe(null);

  // Today's row shows the number waiting, and the total says it isn't in it.
  const row = page.locator('[data-meal="breakfast"]');
  await expect(row).toContainText('4,000 cal not saved yet');
  await expect(row).toContainText('Confirm');
  await expect(row).not.toContainText('Not logged');
  await expect(page.locator('.total-box')).toContainText('+ 4,000 cal not saved yet');
  await expect(page.locator('[data-meal="lunch"]')).toContainText('Not logged');

  // It's still there after the app is closed and opened again, and History marks the day.
  await page.reload();
  await expect(row).toContainText('4,000 cal not saved yet');
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'History' }).click();
  const historyDay = page.locator(`.history-item[data-date="${TODAY}"]`);
  await expect(historyDay).toContainText('Breakfast not saved yet');
  await expect(page.getByText('No days logged yet. Tap a day to view or edit it.')).toBeVisible();
  await historyDay.click();

  // A tap on the row asks again; Keep it saves it and the marker goes.
  await page.getByRole('link', { name: 'Confirm Breakfast, 4,000 cal not saved yet' }).click();
  await expect(page.getByLabel('Breakfast calories')).toHaveValue('4000');
  await page.getByRole('dialog', { name: 'Keep 4,000 cal for breakfast?' }).getByRole('button', { name: 'Keep it' }).click();
  await expect(page.getByText('Breakfast saved')).toBeVisible();
  expect((await data.entry(TODAY)).meals.breakfast).toBe(4000);
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Today' }).click();
  await expect(row).toContainText('4,000 cal');
  await expect(row).not.toContainText('not saved');
  await expect(page.locator('.total-waiting')).toBeHidden();
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'History' }).click();
  await expect(historyDay).not.toContainText('not saved');
});

test('a meal waiting on Log Meal is marked on its button and comes back when picked; changing it clears the mark', async ({ page, appURL, data }) => {
  await data.seed(usualWeek());
  await page.goto(`${appURL}/#/log/breakfast`);
  await page.getByLabel('Breakfast calories').fill('4500');
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Today' }).click();
  await expect(page.locator('[data-meal="breakfast"]')).toContainText('4,500 cal not saved yet');

  // Log Meal opened for another meal shows breakfast as not saved.
  await page.locator('[data-meal="lunch"] a').click();
  const pill = page.locator('.meal-pill[data-meal="breakfast"]');
  await expect(pill).toContainText('Not saved');
  await pill.click();
  const question = page.getByRole('dialog', { name: 'Keep 4,500 cal for breakfast?' });
  await question.getByRole('button', { name: 'Change it' }).click();
  await expect(page.getByLabel('Breakfast calories')).toHaveValue('4500');
  await page.getByLabel('Breakfast calories').fill('450');
  await page.getByLabel('Breakfast calories').press('Enter');
  await expect.poll(async () => (await data.entry(TODAY)).meals.breakfast).toBe(450);
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Today' }).click();
  await expect(page.locator('[data-meal="breakfast"]')).toContainText('450 cal');
  await expect(page.locator('[data-meal="breakfast"]')).not.toContainText('not saved');
});

test('an unsaved value kept by an earlier version is still read', async ({ page, appURL }) => {
  await page.addInitScript((date) => {
    if (!sessionStorage.getItem('seeded')) {
      sessionStorage.setItem('seeded', '1');
      localStorage.setItem('kenna:unsavedInput', JSON.stringify({ field: 'dinner', date, text: '3900', error: "That's more than 3,000 cal for one meal.", ask: true }));
    }
  }, TODAY);
  await page.goto(appURL);
  await expect(page.locator('[data-meal="dinner"]')).toContainText('3,900 cal not saved yet');
});

// The status line under a box, read from the box's own description.
async function statusUnder(page, box) {
  const ids = (await box.getAttribute('aria-describedby')).split(' ');
  return page.locator(`#${ids[0]}`);
}

test('a meal corrected after an error is asked about without the old error beside the question', async ({ page, appURL, data }) => {
  await page.goto(`${appURL}/#/log/breakfast`);
  const box = page.getByLabel('Breakfast calories');
  const status = await statusUnder(page, box);
  await box.fill('99999');
  await box.press('Tab');
  await expect(status).toHaveText("That's over 10,000 calories for one meal. Check the number.");
  await expect(box).toHaveAttribute('aria-invalid', 'true');

  await box.fill('3500');
  await box.press('Enter');
  const question = page.getByRole('dialog', { name: 'Keep 3,500 cal for breakfast?' });
  await expect(question).toBeVisible();
  await expect(page.getByText('over 10,000 calories')).toHaveCount(0);
  await expect(status).toHaveText('');
  await expect(box).not.toHaveAttribute('aria-invalid', /.*/);

  // Escape (Change it) leaves only why this number isn't saved, with Keep it.
  await page.keyboard.press('Escape');
  await expect(question).toHaveCount(0);
  await expect(status).toHaveText("Not saved yet. That's more than 3,000 cal for one meal.Keep it");
  await expect(box).toHaveAttribute('aria-invalid', 'true');
  expect(await data.entry(TODAY)).toBe(null);
});

test('a weight corrected after an error is asked about without the old error beside the question', async ({ page, appURL, data }) => {
  await data.seed({ '2026-09-20': day('2026-09-20', {}, 180) });
  await page.goto(appURL);
  const weight = page.getByLabel('Weight (lbs)');
  const status = await statusUnder(page, weight);
  await weight.fill('2000');
  await weight.press('Tab');
  await expect(status).toHaveText('Enter a weight between 50 and 1,000 lbs.');
  await expect(weight).toHaveAttribute('aria-invalid', 'true');

  await weight.fill('195');
  await weight.press('Enter');
  const question = page.getByRole('dialog', { name: 'Keep 195 lbs?' });
  await expect(question).toBeVisible();
  await expect(page.getByText('Enter a weight between 50 and 1,000 lbs.')).toHaveCount(0);
  await expect(status).toHaveText('');
  await expect(weight).not.toHaveAttribute('aria-invalid', /.*/);

  await question.getByRole('button', { name: 'Change it' }).click();
  await expect(status).toContainText('Not saved yet.');
  await expect(status.getByRole('button', { name: 'Keep it' })).toBeVisible();
  await expect(page.getByText('Enter a weight between 50 and 1,000 lbs.')).toHaveCount(0);
  expect(await data.entry(TODAY)).toBe(null);
});

test('a number kept from an earlier visit is asked about with nothing else under its box', async ({ page, appURL, data }) => {
  // A number the rules refuse, kept when Log Meal was left, then corrected.
  await page.goto(`${appURL}/#/log/breakfast`);
  await page.getByLabel('Breakfast calories').fill('99999');
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Today' }).click();
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
  await page.goto(`${appURL}/#/log/breakfast`);
  const box = page.getByLabel('Breakfast calories');
  const status = await statusUnder(page, box);
  await expect(box).toHaveValue('99999');
  await expect(status).toContainText("Not saved yet. That's over 10,000 calories for one meal.");
  await box.fill('3500');
  await box.press('Enter');
  const question = page.getByRole('dialog', { name: 'Keep 3,500 cal for breakfast?' });
  await expect(question).toBeVisible();
  await expect(status).toHaveText('');
  await expect(box).not.toHaveAttribute('aria-invalid', /.*/);
  await question.getByRole('button', { name: 'Change it' }).click();

  // The number waiting to be asked about, shown again, is asked about at once.
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Today' }).click();
  await page.getByRole('link', { name: 'Confirm Breakfast, 3,500 cal not saved yet' }).click();
  const again = page.getByRole('dialog', { name: 'Keep 3,500 cal for breakfast?' });
  await expect(again).toBeVisible();
  const shown = await statusUnder(page, page.getByLabel('Breakfast calories'));
  await expect(shown).toHaveText('');
  await expect(page.getByLabel('Breakfast calories')).not.toHaveAttribute('aria-invalid', /.*/);
  await page.keyboard.press('Escape');
  await expect(shown).toHaveText("Not saved yet. That's more than 3,000 cal for one meal.Keep it");
  expect(await data.entry(TODAY)).toBe(null);
});
