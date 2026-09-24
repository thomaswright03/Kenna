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
    await page.reload();
    await expect(page.locator('main h2').first()).toBeVisible();
    expect(new URL(page.url()).hash, bad).toBe(bad === '#/log/brunch' ? '#/log' : '#/');
  }
});

test('days dated in the future are left out of History and averages', async ({ page, appURL, backend }) => {
  test.skip(backend !== 'local', 'the server refuses such days outright');
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
