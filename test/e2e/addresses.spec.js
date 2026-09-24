const { test, expect, TODAY, day } = require('./fixtures');

const today = (page) => page.getByRole('heading', { name: 'Today', exact: true });

test('a day that has not happened yet opens Today instead, with a message', async ({ page, appURL, data }) => {
  await page.goto(`${appURL}/#/day/2030-01-01/log/lunch`);
  await expect(today(page)).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: "You can't log a day that hasn't happened yet." })).toBeVisible();
  expect(new URL(page.url()).hash).toBe('#/');
  expect(await data.entry('2030-01-01')).toEqual(expect.not.objectContaining({ meals: expect.objectContaining({ lunch: expect.any(Number) }) }));
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
  const total = page.locator('.compare-metric').filter({ has: page.getByRole('heading', { name: 'Total calories' }) });
  await expect(total.locator('.compare-row').nth(2)).toContainText('2,000 cal');
});
