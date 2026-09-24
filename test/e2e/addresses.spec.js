const { test, expect, TODAY, day } = require('./fixtures');

const today = (page) => page.getByRole('heading', { name: 'Today', exact: true });

test('a day that has not happened yet opens Today instead, with a message', async ({ page, appURL, data }) => {
  await page.goto(`${appURL}/#/day/2030-01-01/log/lunch`);
  await expect(today(page)).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: "You can't log a day that hasn't happened yet." })).toBeVisible();
  expect(new URL(page.url()).hash).toBe('#/');
  expect(await data.entry('2030-01-01')).toEqual(expect.not.objectContaining({ meals: expect.objectContaining({ lunch: expect.any(Number) }) }));
});

test('a date that does not exist opens Today and says so', async ({ page, appURL }) => {
  await page.goto(`${appURL}/#/day/2026-02-30`);
  await expect(today(page)).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: "That date doesn't exist, so Today is shown." })).toBeVisible();
  expect(new URL(page.url()).hash).toBe('#/');
});

test('an address without a date, or with a year Kenna does not keep, opens Today with its own message', async ({ page, appURL }) => {
  const nowhere = "That address doesn't lead anywhere, so Today is shown.";
  for (const [bad, message] of [
    ['#/day/garbage', nowhere],
    ['#/garbage', nowhere],
    ['#/day/2026-9-24', nowhere],
    ['#/day/1899-12-31', 'Kenna opens days from 1900 to 2999, so Today is shown.'],
  ]) {
    await page.goto(`${appURL}/${bad}`);
    await expect(today(page)).toBeVisible();
    const status = page.getByRole('status').filter({ hasText: 'so Today is shown.' });
    await expect(status, bad).toHaveText(message);
    expect(new URL(page.url()).hash).toBe('#/');
    await page.goto(`${appURL}/#/history`);
    await expect(page.getByRole('heading', { name: 'History' })).toBeVisible();
  }
  // Addresses that lead somewhere say nothing.
  await page.goto(`${appURL}/#/`);
  await expect(today(page)).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'so Today is shown.' })).toHaveCount(0);
});

test('an address that leads nowhere is replaced by Today, without a history entry', async ({ page, appURL }) => {
  await page.goto(`${appURL}/#/history`);
  await expect(page.getByRole('heading', { name: 'History' })).toBeVisible();
  await page.goto(`${appURL}/#/garbage`);
  await expect(today(page)).toBeVisible();
  expect(new URL(page.url()).hash).toBe('#/');
  await page.goBack();
  await expect(page.getByRole('heading', { name: 'History' })).toBeVisible();

  for (const bad of ['#/day/1899-12-31', '#/day/2026-02-30', '#/log/brunch']) {
    await page.goto(`${appURL}/${bad}`);
    // Let the app settle on the address it replaces this with, then reload.
    await expect.poll(() => new URL(page.url()).hash, bad).toBe('#/');
    await expect(page.locator('main h2').first()).toBeVisible();
    await page.reload();
    await expect(page.locator('main h2').first()).toBeVisible();
    expect(new URL(page.url()).hash, bad).toBe('#/');
  }
});

test('an address with a part that means nothing leads nowhere, and says so', async ({ page, appURL }) => {
  const nowhere = "That address doesn't lead anywhere, so Today is shown.";
  for (const bad of ['#/log/notameal', '#/history/foo', '#/settings/x', '#/log/lunch/extra', '#/day']) {
    await page.goto(`${appURL}/#/photos`);
    await expect(page.getByRole('heading', { name: 'Progress Photos' })).toBeVisible();
    await page.goto(`${appURL}/${bad}`);
    await expect(today(page), bad).toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: 'lead anywhere' }), bad).toHaveText(nowhere);
    expect(new URL(page.url()).hash, bad).toBe('#/');
  }
});

test("a day in the wrong part of an address shows that day, never today's Log Meal", async ({ page, appURL, data }) => {
  for (const [bad, heading] of [
    ['#/log/2026-09-20', 'Sun, Sep 20'],
    ['#/log/2026-09-20/lunch', 'Sun, Sep 20'],
    ['#/day/2026-09-20/lunch', 'Sun, Sep 20'],
    ['#/day/2026-09-20/log/brunch', 'Sun, Sep 20'],
    ['#/day/2025-12-31/foo', 'Wed, Dec 31, 2025'],
  ]) {
    await page.goto(`${appURL}/#/photos`);
    await expect(page.getByRole('heading', { name: 'Progress Photos' })).toBeVisible();
    await page.goto(`${appURL}/${bad}`);
    await expect(page.getByRole('heading', { name: heading }), bad).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Log Meal' })).toHaveCount(0);
    await expect(page.getByRole('status').filter({ hasText: 'lead anywhere' }), bad).toHaveText(`That address doesn't lead anywhere, so ${heading} is shown.`);
    expect(new URL(page.url()).hash, bad).toBe(`#/day/${bad.match(/\d{4}-\d{2}-\d{2}/)[0]}`);
  }
  // A day after today still isn't opened.
  await page.goto(`${appURL}/#/log/2030-01-01`);
  await expect(today(page)).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: "You can't log a day that hasn't happened yet." })).toBeVisible();

  // The right address still opens that day's Log Meal, and logs to it.
  await page.goto(`${appURL}/#/day/2026-09-20/log`);
  await expect(page.getByRole('heading', { name: 'Log Meal' })).toBeVisible();
  await expect(page.getByText('For Sun, Sep 20.')).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'lead anywhere' })).toHaveCount(0);
  await page.getByLabel('Breakfast calories').fill('380');
  await page.getByLabel('Breakfast calories').blur();
  await expect.poll(async () => ((await data.entry('2026-09-20')) || { meals: {} }).meals.breakfast).toBe(380);
  expect(await data.entry(TODAY)).toBe(null);
});

test('days dated in the future are left out of History and averages', async ({ page, appURL }) => {
  await page.goto(appURL);
  await page.evaluate((entries) => localStorage.setItem('kenna:entries', JSON.stringify(entries)), {
    [TODAY]: day(TODAY, { lunch: 1000 }),
    '2026-09-23': day('2026-09-23', { lunch: 2000 }),
    '2030-01-01': day('2030-01-01', { lunch: 9000 }),
  });
  await page.goto(`${appURL}/#/history`);
  await expect(page.locator('.history-item')).toHaveCount(2);
  await page.goto(`${appURL}/#/compare`);
  await expect(page.locator('[data-answer="calories"]')).toContainText('average day 2,000 cal');
});

test('an unknown page on the site shows Kenna’s “Page not found”, with a way into the app', async ({ page, appURL }) => {
  for (const scheme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: scheme });
    const res = await page.goto(`${appURL}/nope/deeper`);
    expect(res.status()).toBe(404);
    await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(bg).toBe(scheme === 'light' ? 'rgb(241, 245, 249)' : 'rgb(15, 23, 42)');
  }
  await page.getByRole('link', { name: 'Open Kenna' }).click();
  await expect(today(page)).toBeVisible();
});
