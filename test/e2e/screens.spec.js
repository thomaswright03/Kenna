const { test, expect, TODAY, day } = require('./fixtures');

const nav = (page) => page.getByRole('navigation', { name: 'Main' });
const ISO_DATE = /\d{4}-\d{2}-\d{2}/;

async function visibleText(page) {
  return page.locator('body').innerText();
}

test('days with only a weight are not counted as 0-calorie days', async ({ page, appURL, data }) => {
  await data.seed({
    '2026-09-22': day('2026-09-22', { breakfast: 1200, dinner: 800 }, 181),
    '2026-09-23': day('2026-09-23', {}, 180),
    [TODAY]: day(TODAY, { lunch: 1000 }, 179.5),
  });

  await page.goto(`${appURL}/#/compare`);
  const total = page.locator('.compare-metric').filter({ has: page.getByRole('heading', { name: 'Total calories' }) });
  await expect(total.locator('.compare-row').nth(1)).toContainText('No meals logged');
  await expect(total.locator('.compare-row').nth(2)).toContainText('2,000 cal');
  await expect(total).toContainText('▼ −1,000 cal vs average');
  const weight = page.locator('.compare-metric').filter({ has: page.getByRole('heading', { name: 'Weight' }) });
  await expect(weight.locator('.compare-row').nth(1)).toContainText('180 lbs');
  expect(await visibleText(page)).not.toMatch(ISO_DATE);

  await page.goto(`${appURL}/#/history`);
  const yesterday = page.locator('.history-item', { hasText: 'Yesterday' });
  await expect(yesterday).toContainText('No meals logged · 180 lbs');
  await expect(page.locator('.history-item', { hasText: 'Tue, Sep 22' })).toContainText('2,000 cal · 181 lbs');
  expect(await visibleText(page)).not.toMatch(/\b0 cal/);
  expect(await visibleText(page)).not.toMatch(ISO_DATE);

  await page.goto(appURL);
  await expect(page.locator('.chart-svg.series-calories .dot:not(.dot-hover)')).toHaveCount(2);
  // Today's total is still in progress, so it's joined by the dotted "so far" line.
  await expect(page.locator('.chart-svg.series-calories .line-partial')).toHaveCount(1);
  await expect(page.locator('.chart-svg.series-calories .line')).toHaveCount(0);
  await expect(page.locator('.chart-svg.series-weight .dot:not(.dot-hover)')).toHaveCount(3);
  expect(await visibleText(page)).not.toMatch(ISO_DATE);
});

test('Back moves between screens inside the app and refresh keeps the screen', async ({ page, appURL }) => {
  await page.goto(appURL);
  await nav(page).getByRole('link', { name: 'History' }).click();
  await expect(page.getByRole('heading', { name: 'History' })).toBeVisible();
  await nav(page).getByRole('link', { name: 'Compare' }).click();
  await expect(page.getByRole('heading', { name: 'Compare' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Compare' })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('heading', { name: 'History' })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
  expect(page.url().startsWith(appURL)).toBe(true);
  await expect(nav(page).getByRole('link', { name: 'Today' })).toHaveAttribute('aria-current', 'page');
});

test('Done returns to the screen the log was opened from without stacking history', async ({ page, appURL }) => {
  await page.goto(`${appURL}/#/history`);
  await nav(page).getByRole('link', { name: 'Today' }).click();
  await page.getByRole('link', { name: 'Log Meal' }).click();
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('heading', { name: 'History' })).toBeVisible();
});

test('tapping a History day opens it for editing, with a way back to today', async ({ page, appURL, data }) => {
  await data.seed({ '2026-09-20': day('2026-09-20', { dinner: 700 }, 182) });
  await page.goto(`${appURL}/#/history`);
  await page.locator('.history-item', { hasText: 'Sun, Sep 20' }).tap();
  await expect(page.getByRole('heading', { name: 'Sun, Sep 20' })).toBeVisible();
  await expect(page.getByLabel('Weight (lbs)')).toHaveValue('182');
  await page.getByRole('link', { name: 'Add Breakfast' }).click();
  await page.getByLabel('Breakfast calories').fill('250');
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByRole('heading', { name: 'Sun, Sep 20' })).toBeVisible();
  expect((await data.entry('2026-09-20')).meals.breakfast).toBe(250);
  await page.getByRole('link', { name: 'Back to today' }).click();
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
});

test('the header controls are reachable by keyboard', async ({ page, appURL }) => {
  await page.goto(appURL);
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Settings' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(nav(page).getByRole('link', { name: 'Today' })).toBeFocused();
});

test('charts use a time axis, open on the newest data and label ticks uniquely', async ({ page, appURL, data }) => {
  const entries = {};
  for (let i = 0; i < 40; i += 1) {
    const d = new Date(Date.UTC(2026, 7, 1 + i)).toISOString().slice(0, 10); // Aug 1 .. Sep 9
    entries[d] = day(d, { lunch: 1800 + (i % 5) * 10 }, 150 + (i % 4) * 0.4);
  }
  entries[TODAY] = day(TODAY, { lunch: 1900 }, 151.2);
  await data.seed(entries);
  await page.goto(appURL);
  const weightChart = page.locator('.chart-svg.series-weight');
  await expect(weightChart).toBeVisible();
  // 30-day view ends today; the two-week gap before today is visible.
  await expect(page.locator('.chart-latest.series-weight')).toContainText('Today');
  await expect(page.locator('.chart-svg.series-weight .line-gap')).toHaveCount(1);
  const labels = await weightChart.locator('.axis-label').allTextContents();
  const yLabels = labels.filter((t) => /^\d/.test(t));
  expect(new Set(yLabels).size).toBe(yLabels.length);
  expect(yLabels.some((t) => t.includes('.'))).toBe(true);

  await page.getByRole('button', { name: 'All' }).first().click();
  const box = await weightChart.boundingBox();
  const card = await page.locator('.chart').nth(1).boundingBox();
  expect(box.width).toBeLessThanOrEqual(card.width + 1);
  const gap = page.locator('.chart-svg.series-weight .line-gap');
  await expect(gap).toHaveCount(1);
  const gapBox = await gap.boundingBox();
  expect(gapBox.width).toBeGreaterThan(box.width * 0.15);

  await weightChart.focus();
  await page.keyboard.press('End');
  await expect(page.locator('.chart-tooltip.visible').nth(0)).toContainText('151.2 lbs');
});

test('a chart that spans more than one year dates every label with its year', async ({ page, appURL, data }) => {
  const entries = {};
  for (let i = 0; i <= 400; i += 20) {
    const d = new Date(Date.UTC(2026, 8, 24 - i)).toISOString().slice(0, 10);
    entries[d] = day(d, { lunch: 1800 + (i % 3) * 50 }, 170 + (i % 7) / 2);
  }
  await data.seed(entries);
  await page.goto(appURL);
  await page.getByRole('button', { name: 'All' }).first().click();
  for (const series of ['calories', 'weight']) {
    const chart = page.locator(`.chart-svg.series-${series}`);
    const labels = (await chart.locator('.axis-label').allTextContents()).filter((t) => /^[A-Z][a-z]{2} /.test(t));
    expect(labels.length).toBeGreaterThanOrEqual(3);
    for (const label of labels) expect(label).toMatch(/^[A-Z][a-z]{2} \d{1,2}, 20\d\d$/);
    // The labels don't run into each other.
    const boxes = [];
    for (const el of await chart.locator('.axis-label').all()) if (/^[A-Z]/.test(await el.textContent())) boxes.push(await el.boundingBox());
    for (let i = 1; i < boxes.length; i += 1) expect(boxes[i].x).toBeGreaterThan(boxes[i - 1].x + boxes[i - 1].width);
  }
});

test('the calorie axis never shows a negative value', async ({ page, appURL, data }) => {
  await data.seed({ [TODAY]: day(TODAY, { breakfast: 0 }) });
  await page.goto(appURL);
  const labels = await page.locator('.chart-svg.series-calories .axis-label').allTextContents();
  const values = labels.filter((t) => /^-?[\d,]+$/.test(t)).map((t) => Number(t.replace(/,/g, '')));
  expect(values[0]).toBe(0);
  expect(values.every((v) => v >= 0)).toBe(true);
  expect(labels.join(' ')).not.toMatch(/[-−]\d/);
});

test('a weight is shown everywhere as it was entered, to two decimals', async ({ page, appURL, data }) => {
  await data.seed({ '2026-09-23': day('2026-09-23', {}, 166) });
  await page.goto(appURL);
  await page.getByLabel('Weight (lbs)').fill('165.25');
  await page.getByLabel('Weight (lbs)').press('Enter');
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.locator('.chart-latest.series-weight')).toContainText('165.25 lbs');
  await page.goto(`${appURL}/#/history`);
  await expect(page.locator('.history-item', { hasText: 'Today' })).toContainText('165.25 lbs');
  await page.goto(`${appURL}/#/compare`);
  const weight = page.locator('.compare-metric').filter({ has: page.getByRole('heading', { name: 'Weight' }) });
  await expect(weight.locator('.compare-row').first()).toContainText('165.25 lbs');
  await expect(weight.locator('.compare-caption')).toContainText('▼ −0.75 lbs vs yesterday');
});

test('Compare bars show the difference from the all-time average', async ({ page, appURL, data }) => {
  await data.seed({
    '2026-09-22': day('2026-09-22', { lunch: 1900 }, 174.7),
    '2026-09-23': day('2026-09-23', { lunch: 2100 }, 180.3),
    [TODAY]: day(TODAY, { lunch: 1800 }, 179),
  });
  await page.goto(`${appURL}/#/compare`);
  const weight = page.locator('.compare-metric').filter({ has: page.getByRole('heading', { name: 'Weight' }) });
  const rows = weight.locator('.compare-row');
  await expect(rows.nth(2)).toContainText('177.5 lbs');
  await expect(rows.nth(2).locator('.compare-bar')).toHaveCount(0);
  const track = await rows.nth(1).locator('.compare-track').boundingBox();
  const yBar = await rows.nth(1).locator('.compare-bar.is-above').boundingBox();
  const tBar = await rows.nth(0).locator('.compare-bar.is-above').boundingBox();
  // Yesterday is the furthest from average (2.8 lbs), so its bar fills half the track.
  expect(yBar.width).toBeGreaterThan(track.width * 0.45);
  expect(tBar.width).toBeGreaterThan(track.width * 0.2);
  expect(tBar.width).toBeLessThan(yBar.width * 0.7);
  expect(Math.abs(yBar.x - (track.x + track.width / 2))).toBeLessThan(2);

  const total = page.locator('.compare-metric').filter({ has: page.getByRole('heading', { name: 'Total calories' }) });
  await expect(total.locator('.compare-row').nth(0).locator('.compare-bar.is-below')).toHaveCount(1);
  await expect(total.locator('.compare-row').nth(1).locator('.compare-bar.is-above')).toHaveCount(1);
});

test('Compare shows 7-day averages instead of repeating the daily charts', async ({ page, appURL, data }) => {
  await data.seed({
    '2026-09-22': day('2026-09-22', { lunch: 1000 }),
    '2026-09-23': day('2026-09-23', { lunch: 2000 }),
  });
  await page.goto(`${appURL}/#/compare`);
  await expect(page.getByText('7-day average of daily intake')).toBeVisible();
  await expect(page.locator('.chart-latest.series-calories')).toContainText('1,500 cal');
});

test("today's unfinished day doesn't drag the calorie trend, and is compared as 'so far'", async ({ page, appURL, data }) => {
  const entries = {};
  for (let i = 1; i <= 7; i += 1) {
    const d = new Date(Date.UTC(2026, 8, 24 - i)).toISOString().slice(0, 10);
    entries[d] = day(d, { breakfast: 500, lunch: 700, dinner: 700 }, 180);
  }
  entries[TODAY] = day(TODAY, { breakfast: 400 }, 179.5);
  await data.seed(entries);

  await page.goto(`${appURL}/#/compare`);
  const trend = page.locator('.chart-latest.series-calories');
  await expect(trend).toContainText('1,900 cal');
  await expect(trend).toContainText('Yesterday');
  await expect(page.locator('.chart-latest.series-weight')).toContainText('Today');
  const total = page.locator('.compare-metric').filter({ has: page.getByRole('heading', { name: 'Total calories' }) });
  await expect(total.locator('.compare-caption')).toHaveText('So far today: ▼ −1,500 cal vs yesterday · ▼ −1,500 cal vs average');
  await expect(total.locator('.compare-row').first()).toContainText('Today so far');
  const weight = page.locator('.compare-metric').filter({ has: page.getByRole('heading', { name: 'Weight' }) });
  await expect(weight.locator('.compare-caption')).not.toContainText('So far');

  // The daily chart on Today shows the running total, marked as unfinished.
  await page.goto(appURL);
  await expect(page.locator('.chart-latest.series-calories')).toContainText('400 cal');
  await expect(page.locator('.chart-latest.series-calories')).toContainText('Today so far');
  await expect(page.locator('.chart-svg.series-calories .dot-partial')).toHaveCount(1);
  await expect(page.locator('.chart-svg.series-calories .line-partial')).toHaveCount(1);
  await expect(page.locator('.chart-svg.series-weight .dot-partial')).toHaveCount(0);
});

test('light and dark themes follow the system and can be overridden', async ({ browser, appURL }) => {
  const light = await browser.newContext({ colorScheme: 'light' });
  const page = await light.newPage();
  await page.goto(appURL);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.goto(`${appURL}/#/settings`);
  await page.locator('label', { hasText: 'Dark' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(bg).toBe('rgb(15, 23, 42)');
  const scheme = await page.evaluate(() => getComputedStyle(document.querySelector('input[type=radio]')).colorScheme);
  expect(scheme).toBe('dark');
  await light.close();

  const dark = await browser.newContext({ colorScheme: 'dark' });
  const page2 = await dark.newPage();
  await page2.goto(appURL);
  await expect(page2.locator('html')).toHaveAttribute('data-theme', 'dark');
  await dark.close();
});

test('every control is at least 44 by 44 pixels', async ({ page, appURL, data }) => {
  await data.seed({ [TODAY]: day(TODAY, { breakfast: 400 }, 180), '2026-09-20': day('2026-09-20', { dinner: 700 }) });
  const small = [];
  for (const hash of ['#/', '#/log', '#/history', '#/compare', '#/photos', '#/settings']) {
    await page.goto(`${appURL}/${hash}`);
    await page.locator('main h2').first().waitFor();
    const found = await page.evaluate(() => {
      const out = [];
      for (const el of document.querySelectorAll('a, button, label.btn, label.segment, input:not(.visually-hidden)')) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) continue;
        if (r.width < 44 || r.height < 44) out.push(`${el.tagName} "${(el.textContent || el.getAttribute('aria-label') || '').trim()}" ${Math.round(r.width)}x${Math.round(r.height)}`);
      }
      return out;
    });
    small.push(...found.map((f) => `${hash} ${f}`));
  }
  expect(small).toEqual([]);
});

test('the header says what the app is, and each screen has its own title', async ({ page, appURL, data }) => {
  await data.seed({ '2026-09-20': day('2026-09-20', { dinner: 700 }) });
  await page.setViewportSize({ width: 375, height: 667 });
  await page.goto(appURL);
  const tagline = page.getByText('Calorie & weight tracker');
  await expect(tagline).toBeInViewport();
  await expect(page).toHaveTitle('Today · Kenna');
  const titles = { '#/history': 'History · Kenna', '#/compare': 'Compare · Kenna', '#/photos': 'Photos · Kenna', '#/settings': 'Settings · Kenna', '#/log': 'Log Meal · Kenna', '#/day/2026-09-20': 'Sun, Sep 20 · Kenna', '#/day/2026-09-20/log': 'Log Meal, Sun, Sep 20 · Kenna' };
  for (const [hash, title] of Object.entries(titles)) {
    await page.goto(`${appURL}/${hash}`);
    await expect(page).toHaveTitle(title);
  }
});

test('Compare explains once that there is nothing to compare with yet', async ({ page, appURL, data }) => {
  await page.goto(`${appURL}/#/compare`);
  await expect(page.getByText(/^Nothing logged yet\. Log today's weight/)).toBeVisible();
  await expect(page.locator('.compare-metric')).toHaveCount(0);

  await data.seed({ [TODAY]: day(TODAY, { breakfast: 450 }, 181) });
  await page.goto(`${appURL}/#/compare`);
  await page.reload();
  await expect(page.getByText('Log a few more days to see how today compares.')).toHaveCount(1);
  await expect(page.getByText('Not enough history to compare yet.')).toHaveCount(0);
  await expect(page.locator('.compare-caption')).toHaveCount(0);
  await expect(page.getByText('No weight logged')).toHaveCount(0);
  const total = page.locator('.compare-metric').filter({ has: page.getByRole('heading', { name: 'Total calories' }) });
  await expect(total.locator('.compare-row').first()).toContainText('450 cal');
  await expect(page.locator('.compare-metric').filter({ has: page.getByRole('heading', { name: 'Weight' }) })).toContainText('181 lbs');
});
