const { test, expect, day, TODAY } = require('./fixtures');

const nav = (page) => page.getByRole('navigation', { name: 'Main' });

async function seedDays(data, count) {
  const entries = {};
  for (let i = 0; i < count; i += 1) {
    const d = new Date(Date.UTC(2026, 8, 24 - i)).toISOString().slice(0, 10);
    entries[d] = day(d, { lunch: 1500 + (i % 10) * 10 }, 170 + (i % 5) / 10);
  }
  await data.seed(entries);
}

test('Back from a day opened in History returns to the same months and the same place', async ({ page, appURL, data }) => {
  await seedDays(data, 400);
  await page.goto(`${appURL}/#/history`);
  await expect(page.locator('.history-month')).toHaveCount(3);
  await page.getByRole('button', { name: /^Show earlier months/ }).click();
  await expect(page.locator('.history-month')).toHaveCount(7);

  const may10 = page.locator('.history-item[data-date="2026-05-10"]');
  await may10.scrollIntoViewIfNeeded();
  // Scroll a little further so the day isn't pinned to an edge. (Mobile
  // WebKit has no mouse wheel, so scroll the page directly.)
  await page.evaluate(() => window.scrollBy(0, -150));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(3000);
  const before = await may10.boundingBox();
  await may10.click();
  await expect(page.getByRole('heading', { name: 'Sun, May 10' })).toBeVisible();

  await page.goBack();
  await expect(page.getByRole('heading', { name: 'History' })).toBeVisible();
  await expect(page.locator('.history-month')).toHaveCount(7);
  await expect(page.locator('[data-month="2026-05"]')).toBeVisible();
  await expect(may10).toBeInViewport();
  await expect(may10).toBeFocused();
  const after = await may10.boundingBox();
  expect(Math.abs(after.y - before.y)).toBeLessThan(4);

  // Opening History afresh from the tab bar starts at the top.
  await nav(page).getByRole('link', { name: 'Today' }).click();
  await nav(page).getByRole('link', { name: 'History' }).click();
  await expect(page.getByRole('heading', { name: 'History' })).toBeVisible();
  await expect(page.locator('.history-month')).toHaveCount(3);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
});

test('Show earlier months is offered only while there are earlier months', async ({ page, appURL, data }) => {
  // Everything fits on the first page: no button at all.
  await data.seed({ [TODAY]: day(TODAY, { lunch: 600 }) });
  await page.goto(`${appURL}/#/history`);
  await expect(page.locator('.history-item')).toHaveCount(1);
  const more = page.locator('.history-months + button');
  await expect(more).toBeHidden();
  await expect(page.getByRole('button', { name: /Show earlier months/ })).toHaveCount(0);

  // 400 days: pressed until nothing earlier is left, it goes away.
  await seedDays(data, 400);
  await page.goto(`${appURL}/#/history`);
  await page.reload();
  const button = page.getByRole('button', { name: /^Show earlier months/ });
  await expect(button).toBeVisible();
  let presses = 0;
  while ((await button.count()) > 0 && presses < 20) {
    await button.click();
    presses += 1;
  }
  await expect(page.locator('.history-month')).toHaveCount(14);
  await expect(button).toHaveCount(0);
  await expect(more).toBeHidden();
  await expect(page.getByText(/0 more days/)).toHaveCount(0);
  await expect(page.getByText('Show earlier months')).toBeHidden();
  // Out of the tab order too: Tab from the last day leaves the list.
  await page.locator('.history-item').last().focus();
  await page.keyboard.press('Tab');
  expect(await page.evaluate(() => document.activeElement && document.activeElement.textContent)).not.toMatch(/Show earlier months/);
});

test('nothing marked hidden is ever drawn, whatever its classes', async ({ page, appURL }) => {
  await page.goto(appURL);
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
  const shown = await page.evaluate(() => {
    const probes = ['btn btn-secondary', 'btn btn-primary', 'card notice-card', 'loading', 'progress', 'btn-text', 'toast'].map((cls) => {
      const el = document.createElement('div');
      el.className = cls;
      el.hidden = true;
      el.textContent = 'probe';
      document.body.append(el);
      const display = getComputedStyle(el).display;
      el.remove();
      return `${cls}: ${display}`;
    });
    return probes.filter((p) => !p.endsWith(': none'));
  });
  expect(shown).toEqual([]);
});

test('a day edited from History is still in place on the way back, with its new total', async ({ page, appURL, data }) => {
  await seedDays(data, 400);
  await page.goto(`${appURL}/#/history`);
  await page.getByLabel('Go to month').selectOption({ label: 'January 2026 (31 days)' });
  const jan15 = page.locator('.history-item[data-date="2026-01-15"]');
  await jan15.scrollIntoViewIfNeeded();
  await jan15.click();
  await page.getByRole('link', { name: 'Edit Lunch' }).click();
  await page.getByLabel('Lunch calories').fill('999');
  await page.getByRole('button', { name: 'Save and close' }).click();
  await expect(page.getByRole('heading', { name: 'Thu, Jan 15' })).toBeVisible();

  await page.goBack();
  await expect(page.getByRole('heading', { name: 'History' })).toBeVisible();
  await expect(jan15).toBeInViewport();
  await expect(jan15).toContainText('999 cal');
});

test('on a wide screen History shows every month at a glance beside the list', async ({ page, appURL, data }) => {
  await seedDays(data, 400);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${appURL}/#/history`);
  const list = await page.locator('main .card').filter({ has: page.getByRole('heading', { name: 'History' }) }).boundingBox();
  const overview = page.locator('.months-overview');
  await expect(overview).toBeVisible();
  const box = await overview.boundingBox();
  expect(box.x).toBeGreaterThan(list.x + list.width - 1);
  await expect(overview.locator('tr[data-overview-month="2026-09"]')).toHaveText(/September 2026\s*24\s*1,542\s*170.2/);
  await expect(overview.locator('tbody tr')).toHaveCount(14);
  // The overview takes Go to month's place.
  await expect(page.getByLabel('Go to month')).toBeHidden();
  await overview.getByRole('button', { name: 'October 2025' }).click();
  const october = page.getByRole('heading', { name: 'October 2025' });
  await expect(october).toBeFocused();
  await expect(october).toBeInViewport();

  // On a phone the month headings carry the same averages instead.
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(overview).toBeHidden();
  await expect(page.getByLabel('Go to month')).toBeVisible();
});

test('on a wide screen the tabs sit in the header, lined up with the columns below', async ({ page, appURL, data }) => {
  await seedDays(data, 30);
  for (const width of [1440, 2560]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`${appURL}/#/compare`);
    await expect(page.getByRole('heading', { name: 'Compare', exact: true })).toBeVisible();
    const brand = await page.getByRole('heading', { name: 'Kenna' }).boundingBox();
    const tabs = await nav(page).boundingBox();
    const settings = await page.getByRole('link', { name: 'Settings' }).boundingBox();
    const main = await page.locator('main .screen-stack').boundingBox();
    // One row: brand, tabs, Settings.
    expect(tabs.y).toBeLessThan(brand.y + brand.height);
    expect(tabs.x).toBeGreaterThan(brand.x + brand.width);
    expect(settings.x).toBeGreaterThan(tabs.x + tabs.width - 1);
    // The row's outer edges are the content's outer edges.
    expect(Math.abs(brand.x - main.x)).toBeLessThan(2);
    expect(Math.abs(settings.x + settings.width - (main.x + main.width))).toBeLessThan(2);
  }
  // On a phone the tabs have a row of their own, as wide as the screen's content.
  await page.setViewportSize({ width: 390, height: 844 });
  const tabs = await nav(page).boundingBox();
  const brand = await page.getByRole('heading', { name: 'Kenna' }).boundingBox();
  expect(tabs.y).toBeGreaterThan(brand.y + brand.height - 1);
  expect(tabs.width).toBeGreaterThan(390 - 40);
});

test("a month's weight average leaves out today, and averages always show their decimal", async ({ page, appURL, data }) => {
  await data.seed({
    '2026-08-10': day('2026-08-10', {}, 165),
    '2026-08-20': day('2026-08-20', {}, 167),
    '2026-09-23': day('2026-09-23', {}, 170),
    [TODAY]: day(TODAY, {}, 180),
  });
  await page.goto(`${appURL}/#/history`);
  const september = page.locator('.history-month').filter({ hasText: 'September 2026' });
  // Yesterday's 170 alone: today's 180 isn't in the average yet.
  await expect(september.locator('.history-month-sub')).toHaveText('2 days · avg 170.0 lbs');
  const august = page.locator('.history-month').filter({ hasText: 'August 2026' });
  await expect(august.locator('.history-month-sub')).toHaveText('2 days · avg 166.0 lbs');
  await page.setViewportSize({ width: 1440, height: 900 });
  const overview = page.locator('.months-overview');
  await expect(overview).toContainText('not counting today');
  await expect(overview.locator('tr[data-overview-month="2026-08"]')).toHaveText(/August 2026\s*2\s*—\s*166\.0/);
  await expect(overview.locator('tr[data-overview-month="2026-09"]')).toHaveText(/September 2026\s*2\s*—\s*170\.0/);

  await page.goto(`${appURL}/#/compare`);
  // Average of 165, 167 and 170 before today is 167.3; the difference too
  // is to one decimal.
  await expect(page.locator('[data-answer="weight"]')).toContainText('average 167.3 lbs');
  await expect(page.locator('[data-answer="weight"]')).toContainText('12.7 lbs above your average');
});

test('an average that comes out whole still shows its decimal on Compare', async ({ page, appURL, data }) => {
  await data.seed({ '2026-09-20': day('2026-09-20', {}, 165), '2026-09-21': day('2026-09-21', {}, 167), [TODAY]: day(TODAY, {}, 167) });
  await page.goto(`${appURL}/#/compare`);
  const weight = page.locator('[data-answer="weight"]');
  await expect(weight).toContainText('167 lbs today: 1.0 lbs above your average.');
  await expect(weight).toContainText('average 166.0 lbs');
});
