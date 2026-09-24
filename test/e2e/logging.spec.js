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

  await page.getByRole('button', { name: 'Save and close' }).tap();
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

test('the date field cannot be emptied or set to the future', async ({ page, appURL }) => {
  await page.goto(appURL);
  const date = page.getByLabel('Day to view or edit');
  await date.fill('');
  await date.dispatchEvent('change');
  await expect(date).toHaveValue(TODAY);
  await page.getByLabel('Weight (lbs)').fill('181');
  await page.getByLabel('Weight (lbs)').blur();
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();
  const keys = await page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('kenna:entries'))));
  expect(keys).toEqual([TODAY]);
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
  await page.getByRole('button', { name: 'Save and close' }).click();
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

test('Log Meal is the one main way in, and each saved meal keeps a tick', async ({ page, appURL }) => {
  await page.goto(appURL);
  // The primary button comes before the meal rows, whose Add links are quieter.
  const logMeal = page.getByRole('link', { name: 'Log Meal' });
  const firstRow = page.locator('.meal-row').first();
  expect((await logMeal.boundingBox()).y).toBeLessThan((await firstRow.boundingBox()).y);
  await expect(page.getByRole('link', { name: 'Add Breakfast' }).locator('.meal-go')).toHaveClass(/btn-quiet/);

  await logMeal.click();
  await page.getByLabel('Breakfast calories').fill('400');
  await page.getByRole('button', { name: /^Lunch/ }).click();
  const breakfast = page.locator('.meal-pill[data-meal="breakfast"]');
  await expect(breakfast).toHaveAccessibleName('Breakfast, 400 cal, saved');
  await expect(breakfast.locator('.pill-value')).toHaveText('✓ 400');
  // The tick stays; it isn't a message that fades.
  await page.clock.runFor(10000);
  await expect(breakfast.locator('.pill-value')).toHaveText('✓ 400');
  await page.getByRole('button', { name: 'Save and close' }).click();
  await expect(page.locator('.toast')).toHaveText(['Saved for Today: 400 cal']);
});

test('one message at a time, cleared when another screen opens, and a tap dismisses it', async ({ page, appURL }) => {
  await page.goto(`${appURL}/#/log/breakfast`);
  await page.getByLabel('Breakfast calories').fill('400');
  await page.getByRole('button', { name: 'Save and close' }).click();
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
  await page.getByRole('button', { name: 'Save and close' }).click();
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
  await page.getByRole('button', { name: 'Save and close' }).click();
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
  await page.getByRole('button', { name: 'Save and close' }).evaluate((btn) => {
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

test('tapping a meal’s name opens Log Meal at that meal', async ({ page, appURL, data }) => {
  await data.seed({ [TODAY]: day(TODAY, { breakfast: 400 }) });
  await page.goto(appURL);
  await expect(page.locator('.meal-row[data-meal="lunch"] .meal-name')).toHaveCSS('color', await page.locator('.total-label').evaluate(() => getComputedStyle(document.body).color));
  await page.locator('.meal-row[data-meal="lunch"] .meal-name').click();
  await expect(page.getByRole('heading', { name: 'Log Meal' })).toBeVisible();
  await expect(page.locator('.meal-pill[data-meal="lunch"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByLabel('Lunch calories')).toBeVisible();

  // A logged meal's value opens it too; its Remove button doesn't.
  await page.goBack();
  await page.locator('.meal-row[data-meal="breakfast"] .meal-value').click();
  await expect(page.getByLabel('Breakfast calories')).toHaveValue('400');
  await page.goBack();
  await page.getByRole('button', { name: 'Remove Breakfast' }).click();
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
  await expect(page.locator('.meal-row[data-meal="breakfast"]')).toContainText('Removed (was 400 cal)');
});

test('clearing the weight can be undone', async ({ page, appURL, data }) => {
  await page.goto(appURL);
  const weight = page.getByLabel('Weight (lbs)');
  await weight.fill('165.4');
  await weight.blur();
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();
  await weight.fill('');
  await weight.blur();
  await expect(page.getByText('Weight cleared')).toBeVisible();
  const cleared = await data.entry(TODAY);
  expect(cleared ? cleared.weight : null).toBe(null);
  // Undo stays until it's used; it doesn't fade like "Saved".
  await page.clock.runFor(10000);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(weight).toHaveValue('165.4');
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();
  expect((await data.entry(TODAY)).weight).toBe(165.4);
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toHaveCount(0);
});

test('every way out of Log Meal saves the number in the box, and the next screen says so', async ({ page, appURL, data }) => {
  const nav = page.getByRole('navigation', { name: 'Main' });
  const saved = (n) => page.locator('.toast').filter({ hasText: `Lunch saved: ${n} cal` });
  const lunch = async () => {
    const e = await data.entry(TODAY);
    return e ? e.meals.lunch : null;
  };
  /** Opens Lunch from Today and types `n`, without leaving the box. */
  const open = async (n) => {
    await page.goto(appURL);
    await page.locator('.meal-row[data-meal="lunch"] .meal-name').click();
    await page.getByLabel('Lunch calories').tap();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type(String(n));
  };

  // The on-screen Back button, tapped with the number still in the box.
  await open(222);
  await page.getByRole('button', { name: 'Back to Today' }).tap();
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
  await expect(saved(222)).toBeVisible();
  await expect.poll(lunch).toBe(222);
  await expect(page.locator('.total-num')).toHaveText('222');

  // The tab bar.
  await open(333);
  await nav.getByRole('link', { name: 'History' }).click();
  await expect(page.getByRole('heading', { name: 'History' })).toBeVisible();
  await expect(saved(333)).toBeVisible();
  await expect.poll(lunch).toBe(333);

  // The browser's or phone's Back.
  await open(444);
  await page.goBack();
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
  await expect(saved(444)).toBeVisible();
  await expect.poll(lunch).toBe(444);

  // Undo on that message puts back what was there before.
  await saved(444).getByRole('button', { name: 'Undo' }).click();
  await expect(page.locator('.toast').filter({ hasText: 'Lunch is back to 333 cal' })).toBeVisible();
  await expect.poll(lunch).toBe(333);
  await expect(page.locator('.total-num')).toHaveText('333');

  // Save and close says it once, its own way.
  await open(555);
  await page.getByRole('button', { name: 'Save and close' }).click();
  await expect(page.locator('.toast').filter({ hasText: 'Saved for Today: 555 cal' })).toBeVisible();
  await expect(saved(555)).toHaveCount(0);
  expect(await lunch()).toBe(555);
});

test('leaving Log Meal with a number that can’t be saved keeps it, says why, and leads back to it', async ({ page, appURL, data }) => {
  await data.seed({ [TODAY]: day(TODAY, { breakfast: 400 }) });
  await page.goto(`${appURL}/#/log/lunch`);
  await page.getByLabel('Lunch calories').fill('22x');
  await page.getByRole('button', { name: 'Back to Today' }).click();
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
  const message = page.locator('.toast').filter({ hasText: 'Lunch not saved (“22x”). Enter calories using digits only, like 450.' });
  await expect(message).toBeVisible();
  expect((await data.entry(TODAY)).meals.lunch).toBe(null);
  await message.getByRole('button', { name: 'Fix it' }).click();
  await expect(page.getByLabel('Lunch calories')).toHaveValue('22x');
  await expect(page.getByText('Not saved yet. Enter calories using digits only, like 450.')).toBeVisible();

  // Opening Log Meal from Today's button goes to it too.
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Today' }).click();
  await expect(page.locator('.toast').filter({ hasText: 'Lunch not saved' })).toBeVisible();
  await page.getByRole('link', { name: 'Log Meal' }).click();
  await expect(page.getByLabel('Lunch calories')).toHaveValue('22x');
});

test('leaving Today saves the weight typed in its box and says so; one that can’t be saved waits in the box', async ({ page, appURL, data }) => {
  const nav = page.getByRole('navigation', { name: 'Main' });
  await page.goto(appURL);
  await page.getByLabel('Weight (lbs)').fill('181.2');
  await nav.getByRole('link', { name: 'Compare' }).click();
  await expect(page.getByRole('heading', { name: 'Compare', exact: true })).toBeVisible();
  await expect(page.locator('.toast').filter({ hasText: 'Weight saved: 181.2 lbs' })).toBeVisible();
  expect((await data.entry(TODAY)).weight).toBe(181.2);

  await nav.getByRole('link', { name: 'Today' }).click();
  await page.getByLabel('Weight (lbs)').fill('18l');
  await nav.getByRole('link', { name: 'History' }).click();
  await expect(page.locator('.toast').filter({ hasText: 'Weight not saved (“18l”).' })).toBeVisible();
  expect((await data.entry(TODAY)).weight).toBe(181.2);
  await nav.getByRole('link', { name: 'Today' }).click();
  await expect(page.getByLabel('Weight (lbs)')).toHaveValue('18l');
  await expect(page.getByText(/^Not saved yet\./)).toBeVisible();
});

test('Back from a past day’s Log Meal returns to that day, and Escape puts back what was saved', async ({ page, appURL, data }) => {
  await data.seed({ '2026-09-20': day('2026-09-20', { breakfast: 300 }) });
  await page.goto(`${appURL}/#/day/2026-09-20/log/breakfast`);
  const cal = page.getByLabel('Breakfast calories');
  await expect(cal).toHaveValue('300');
  await cal.fill('999');
  await expect(page.getByText('Breakfast not saved yet')).toBeVisible();
  await cal.press('Escape');
  await expect(cal).toHaveValue('300');
  await expect(page.getByText('Breakfast not saved yet')).toHaveCount(0);
  await expect(page.locator('.dialog[open]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Back to Sep 20' }).click();
  await expect(page.getByRole('heading', { name: 'Sun, Sep 20' })).toBeVisible();
  await expect(page.locator('.toast')).toHaveCount(0);
  expect((await data.entry('2026-09-20')).meals.breakfast).toBe(300);

  await page.goto(`${appURL}/#/day/2026-09-23/log`);
  await expect(page.getByRole('button', { name: 'Back to Yesterday' })).toBeVisible();
});

test('the Weight box says how it saves before anything is typed', async ({ page, appURL, data }) => {
  await page.goto(appURL);
  const weight = page.getByLabel('Weight (lbs)');
  const hint = page.getByText('Saves when you leave the box');
  await expect(hint).toBeVisible();
  await expect(weight).toHaveAccessibleDescription(/Saves when you leave the box/);
  await weight.fill('170.2');
  await weight.blur();
  // The status takes the hint's place while it shows.
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();
  await expect(hint).toBeHidden();
  await page.clock.runFor(5000);
  await expect(hint).toBeVisible();
  expect((await data.entry(TODAY)).weight).toBe(170.2);
});

test('a meal removed just before leaving Today can be put back from the next screen', async ({ page, appURL, data }) => {
  await data.seed({ [TODAY]: day(TODAY, { breakfast: 450, lunch: 650 }) });
  await page.goto(appURL);
  await page.getByRole('button', { name: 'Remove Breakfast' }).click();
  await expect(page.locator('.total-num')).toHaveText('650');
  await page.locator('[data-tab="history"]').click();
  await expect(page.getByRole('heading', { name: 'History' })).toBeVisible();
  const offer = page.locator('.toast').filter({ hasText: 'Breakfast removed from today (450 cal)' });
  await expect(offer).toBeVisible();
  // It's still offered on the screen after that.
  await page.locator('[data-tab="compare"]').click();
  await expect(page.getByRole('heading', { name: 'Compare' })).toBeVisible();
  await expect(offer).toBeVisible();
  await offer.getByRole('button', { name: 'Undo' }).click();
  await expect(page.locator('.toast').filter({ hasText: 'Breakfast put back for today: 450 cal' })).toBeVisible();
  expect((await data.entry(TODAY)).meals.breakfast).toBe(450);
  await expect(page.locator('[data-answer="calories"]')).toContainText('1,100 cal so far');
  await page.locator('[data-tab="today"]').click();
  await expect(page.locator('.total-num')).toHaveText('1,100');
});

test('an Undo offered after leaving Today leaves a meal logged again since as it is', async ({ page, appURL, data }) => {
  await data.seed({ [TODAY]: day(TODAY, { breakfast: 450 }) });
  await page.goto(appURL);
  await page.getByRole('button', { name: 'Remove Breakfast' }).click();
  await expect(page.locator('.meal-row[data-meal="breakfast"]')).toContainText('Removed (was 450 cal)');
  // Straight to Log Meal for that meal, and a new number.
  await page.locator('.meal-row[data-meal="breakfast"] .meal-name').click();
  await page.getByLabel('Breakfast calories').fill('300');
  await page.getByLabel('Breakfast calories').blur();
  await expect(page.getByText('Breakfast saved')).toBeVisible();
  await page.locator('.toast').filter({ hasText: 'Breakfast removed from today' }).getByRole('button', { name: 'Undo' }).click();
  await expect(page.locator('.toast').filter({ hasText: 'Breakfast has been logged again since' })).toBeVisible();
  expect((await data.entry(TODAY)).meals.breakfast).toBe(300);
});
