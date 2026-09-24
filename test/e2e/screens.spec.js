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
  const calories = page.locator('[data-answer="calories"]');
  // Lunch has never been logged before, so there's no usual lunch to compare with.
  await expect(calories.locator('.compare-answer-text')).toHaveText("1,000 cal so far today. Today’s meals haven’t been logged on an earlier day, so there’s no average for them yet.");
  await expect(calories).toContainText('average day 2,000 cal · no meals logged yesterday');
  await expect(page.locator('[data-answer="weight"]')).toContainText('from yesterday (180 lbs)');
  expect(await visibleText(page)).not.toMatch(ISO_DATE);

  await page.goto(`${appURL}/#/history`);
  const yesterday = page.locator('.history-item', { hasText: 'Yesterday' });
  await expect(yesterday).toContainText('No meals logged · 180 lbs');
  await expect(page.locator('.history-item', { hasText: 'Tue, Sep 22' })).toContainText('2,000 cal · 181 lbs');
  expect(await visibleText(page)).not.toMatch(/\b0 cal/);
  expect(await visibleText(page)).not.toMatch(ISO_DATE);

  await page.goto(appURL);
  await expect(page.locator('.chart-svg.series-calories .dot:not(.dot-hover)')).toHaveCount(2);
  // Today's total is still in progress: a lone hollow dot marked "so far",
  // never joined to the finished days.
  await expect(page.locator('.chart-svg.series-calories .dot-partial')).toHaveCount(1);
  await expect(page.locator('.chart-svg.series-calories .partial-label')).toHaveText('so far');
  await expect(page.locator('.chart-svg.series-calories .line, .chart-svg.series-calories .line-gap')).toHaveCount(0);
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
  await page.getByRole('button', { name: 'Save and close' }).click();
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
  await page.getByRole('button', { name: 'Save and close' }).click();
  await expect(page.getByRole('heading', { name: 'Sun, Sep 20' })).toBeVisible();
  expect((await data.entry('2026-09-20')).meals.breakfast).toBe(250);
  await page.getByRole('link', { name: 'Back to today' }).click();
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
});

test('Settings, where backups are made, is named in the header on a phone, not only shown as a gear', async ({ page, appURL, data }) => {
  await data.seed({ [TODAY]: day(TODAY, { breakfast: 400 }) });
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 700 });
    await page.goto(appURL);
    const label = page.locator('header').getByText('Settings', { exact: true });
    await expect(label).toBeVisible();
    const box = await label.boundingBox();
    expect(box.x + box.width).toBeLessThanOrEqual(width);
    expect(box.y + box.height).toBeLessThanOrEqual(700);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  }
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Backup', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Settings', exact: true })).toHaveAttribute('aria-current', 'page');
});

test('every label on a chart’s value axis has the same number of decimals', async ({ page, appURL, data }) => {
  await data.seed({
    '2026-09-23': day('2026-09-23', { lunch: 1500 }, 180.4),
    [TODAY]: day(TODAY, { lunch: 1650 }, 181.2),
  });
  for (const screen of ['/', '/#/compare']) {
    await page.goto(`${appURL}${screen}`);
    const weightTicks = await page.locator('.chart-svg.series-weight .axis-value').allTextContents();
    expect(weightTicks.length).toBeGreaterThan(1);
    for (const t of weightTicks) expect(t).toMatch(/^\d{1,3}(,\d{3})*\.\d$/);
    const calorieTicks = await page.locator('.chart-svg.series-calories .axis-value').allTextContents();
    for (const t of calorieTicks) expect(t).toMatch(/^\d{1,3}(,\d{3})*$/);
  }
});

test('the header controls are reachable by keyboard', async ({ page, appURL }) => {
  await page.goto(appURL);
  await page.keyboard.press('Tab');
  await expect(nav(page).getByRole('link', { name: 'Today' })).toBeFocused();
  for (let i = 0; i < 4; i += 1) await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Settings' })).toBeFocused();
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
    // The labels don't run into each other, measured in the chart's own
    // coordinates, where each label's box already reflects its text-anchor.
    const boxes = await chart.locator('.axis-label').evaluateAll((els) =>
      els
        .filter((el) => /^[A-Z]/.test(el.textContent || ''))
        .map((el) => {
          const b = /** @type {SVGTextElement} */ (el).getBBox();
          return { x: b.x, width: b.width };
        })
    );
    expect(boxes.length).toBeGreaterThanOrEqual(3);
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
  const weight = page.locator('[data-answer="weight"]');
  await expect(weight).toContainText('165.25 lbs today: 0.8 lbs below your average.');
  // A difference is always to one decimal, whatever the weights' own.
  await expect(weight).toContainText('average 166.0 lbs · 0.8 lbs down from yesterday (166 lbs)');
});

test('every weight difference on Compare has one decimal, however the weights were entered', async ({ page, appURL, data }) => {
  await data.seed({ '2026-09-23': day('2026-09-23', {}, 185.2), [TODAY]: day(TODAY, {}, 173.2) });
  await page.goto(`${appURL}/#/compare`);
  const weight = page.locator('[data-answer="weight"]');
  await expect(weight.locator('.compare-answer-text')).toHaveText('173.2 lbs today: 12.0 lbs below your average.');
  await expect(weight).toContainText('average 185.2 lbs · 12.0 lbs down from yesterday (185.2 lbs)');

  // Too small to show at one decimal, but not the same.
  await data.seed({ '2026-09-23': day('2026-09-23', {}, 180), [TODAY]: day(TODAY, {}, 180.04) });
  await page.goto(appURL);
  await page.goto(`${appURL}/#/compare`);
  await expect(weight).toContainText('less than 0.1 lbs up from yesterday (180 lbs)');
  await expect(weight.locator('.compare-answer-text')).toHaveText('180.04 lbs today: less than 0.1 lbs above your average.');
});

test('Compare answers how today stands in plain sentences, within the first screenful', async ({ page, appURL, data }) => {
  await data.seed({
    '2026-09-22': day('2026-09-22', { breakfast: 400, lunch: 1500 }, 174.7),
    '2026-09-23': day('2026-09-23', { breakfast: 500, lunch: 1600 }, 180.3),
    [TODAY]: day(TODAY, { breakfast: 450, lunch: 2300 }, 179),
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${appURL}/#/compare`);
  const calories = page.locator('[data-answer="calories"]');
  const weight = page.locator('[data-answer="weight"]');
  await expect(calories.locator('.compare-answer-text')).toHaveText('So far today: 750 cal more than your average breakfast and lunch.');
  await expect(weight.locator('.compare-answer-text')).toHaveText('179 lbs today: 1.5 lbs above your average.');
  await expect(weight).toContainText('average 177.5 lbs · 1.3 lbs down from yesterday (180.3 lbs)');
  for (const a of [calories.locator('.compare-answer-text'), weight.locator('.compare-answer-text')]) {
    const box = await a.boundingBox();
    expect(box.y + box.height).toBeLessThanOrEqual(844);
  }

  // Bars are plain amounts from zero, each labelled with its value; today's
  // is set apart by shade only.
  const rows = calories.locator('.amount-row');
  // The average day is the same as the usual breakfast and lunch here, so
  // it isn't shown twice.
  await expect(rows).toHaveText([/^Today so far\s*2,750 cal$/, /^Usual for these meals\s*2,000 cal$/, /^Yesterday\s*2,100 cal$/]);
  // With one average there's nothing to tell apart.
  await expect(calories.locator('[data-baseline-note]')).toHaveCount(0);
  const widths = await rows.locator('.amount-bar').evaluateAll((els) => els.map((el) => el.getBoundingClientRect().width));
  expect(widths[0]).toBeGreaterThan(widths[2]);
  expect(widths[2]).toBeGreaterThan(widths[1]);
  expect(Math.abs(widths[1] / widths[0] - 2000 / 2750)).toBeLessThan(0.02);

  // Each meal is one tap further down.
  const meals = page.locator('.compare-meals');
  await expect(meals.locator('summary')).toHaveText('Each meal: today, yesterday and average (2 logged today)');
  await expect(meals.locator('table')).toBeHidden();
  await meals.locator('summary').click();
  await expect(meals.locator('tr[data-meal="lunch"]')).toHaveText(/Lunch\s*2,300\s*1,600\s*1,550/);
  await expect(meals).toContainText('Never logged: Snack 1, Snack 2, Dinner, Snack 3.');
});

test("on Compare, a meal with no average yet gets its own bar, so today's compared bar and the usual one differ by the sentence's amount", async ({ page, appURL, data }) => {
  await data.seed({
    '2026-09-22': day('2026-09-22', { breakfast: 400, lunch: 600 }),
    '2026-09-23': day('2026-09-23', { breakfast: 380, lunch: 600 }),
    [TODAY]: day(TODAY, { breakfast: 420, lunch: 610, snack2: 200 }),
  });
  await page.goto(`${appURL}/#/compare`);
  const calories = page.locator('[data-answer="calories"]');
  await expect(calories.locator('.compare-answer-text')).toHaveText('So far today: 40 cal more than your average breakfast and lunch.');
  const rows = calories.locator('.amount-row');
  await expect(rows).toHaveText([
    /^Today, these meals\s*1,030 cal$/,
    /^Usual for these meals\s*990 cal$/,
    /^Snack 2 \(no average yet\)\s*200 cal$/,
    /^Yesterday\s*980 cal$/,
  ]);
  const values = (await rows.locator('.amount-value').allTextContents()).map((v) => Number(v.replace(/[^\d]/g, '')));
  expect(values[0] - values[1]).toBe(40);
  await expect(calories).toContainText('1,230 cal so far');
  await expect(calories).toContainText('snack 2 not compared: not logged before today');
});

test('with no meals yet today, Compare says so and gives the average day', async ({ page, appURL, data }) => {
  await data.seed({ '2026-09-23': day('2026-09-23', { lunch: 1600 }, 180), [TODAY]: day(TODAY, {}, 180) });
  await page.goto(`${appURL}/#/compare`);
  await expect(page.locator('[data-answer="calories"] .compare-answer-text')).toHaveText('No meals logged yet today. Your average day is 1,600 cal.');
  await expect(page.locator('[data-answer="weight"] .compare-answer-text')).toHaveText('180 lbs today: the same as your average.');
  await expect(page.locator('.amount-bars')).toHaveCount(0);
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
  const calories = page.locator('[data-answer="calories"]');
  await expect(calories.locator('.compare-answer-text')).toHaveText('So far today: 100 cal less than your average breakfast.');
  await expect(calories.locator('.amount-row')).toHaveText([/^Today so far\s*400 cal$/, /^Usual for these meals\s*500 cal$/, /^Average day\s*1,900 cal$/, /^Yesterday\s*1,900 cal$/]);
  await expect(calories.locator('.amount-row').first()).toContainText('Today so far');
  // Two averages: which one the sentence used is said in words.
  await expect(calories.locator('[data-baseline-note]')).toHaveText(
    'The sentence compares today with “Usual for these meals”: your average for just the meals logged so far today. “Average day” covers whole days, so it’s a fair match only once today is finished.'
  );
  await expect(page.locator('[data-answer="weight"]')).not.toContainText('So far');

  // The daily chart on Today shows the running total, marked as unfinished.
  await page.goto(appURL);
  await expect(page.locator('.chart-latest.series-calories')).toContainText('400 cal');
  await expect(page.locator('.chart-latest.series-calories')).toContainText('Today so far');
  await expect(page.locator('.chart-svg.series-calories .dot-partial')).toHaveCount(1);
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

test('every piece of text outside the charts is at least 14px', async ({ page, appURL, data }) => {
  await data.seed({
    '2026-09-22': day('2026-09-22', { breakfast: 400, lunch: 1500 }, 174.7),
    '2026-09-23': day('2026-09-23', { breakfast: 500, lunch: 1600, dinner: 700 }, 180.3),
    [TODAY]: day(TODAY, { breakfast: 450 }, 179),
  });
  await page.setViewportSize({ width: 390, height: 844 });
  const small = [];
  for (const hash of ['#/', '#/log', '#/history', '#/compare', '#/photos', '#/settings']) {
    await page.goto(`${appURL}/${hash}`);
    await page.locator('main h2').first().waitFor();
    await page.locator('details').evaluateAll((els) => els.forEach((d) => (d.open = true)));
    const found = await page.evaluate(() => {
      const out = [];
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const el = n.parentElement;
        if (!el || !n.textContent.trim() || el.closest('svg, .visually-hidden, script, style')) continue;
        const r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) continue;
        const size = parseFloat(getComputedStyle(el).fontSize);
        if (size < 14) out.push(`"${n.textContent.trim().slice(0, 40)}" ${size}px`);
      }
      return out;
    });
    small.push(...found.map((f) => `${hash} ${f}`));
  }
  expect(small).toEqual([]);
  // The explanation under each chart included.
  await page.goto(appURL);
  const sub = await page.locator('.chart-sub').first().evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  expect(sub).toBeGreaterThanOrEqual(14);
});

test('on a tablet the screens use its width, in two columns', async ({ page, appURL, data }) => {
  await data.seed({ '2026-08-23': day('2026-08-23', { lunch: 1500 }, 181), '2026-09-23': day('2026-09-23', { lunch: 1600 }, 180), [TODAY]: day(TODAY, { breakfast: 400 }, 179) });
  await page.setViewportSize({ width: 768, height: 1024 });
  for (const [hash, heading] of [['#/', 'Today'], ['#/compare', 'Compare'], ['#/history', 'History']]) {
    await page.goto(`${appURL}/${hash}`);
    await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
    const cards = await page.locator('main .two-col > *').evaluateAll((els) =>
      els.filter((el) => !el.classList.contains('notice-card')).map((el) => el.getBoundingClientRect().toJSON())
    );
    expect(cards.length).toBeGreaterThanOrEqual(2);
    const [left, right] = cards;
    expect(right.x).toBeGreaterThan(left.x + left.width - 1);
    expect(Math.abs(right.y - left.y)).toBeLessThan(2);
    // Even margins, and most of the width used.
    const leftMargin = left.x;
    const rightMargin = 768 - (right.x + right.width);
    expect(Math.abs(leftMargin - rightMargin)).toBeLessThan(2);
    expect(right.x + right.width - left.x).toBeGreaterThan(700);
  }
  // The months' averages sit beside History's list.
  await expect(page.locator('.months-overview')).toBeVisible();
});

test('Log Meal has one way out on screen, Save and close, and its label never wraps', async ({ page, appURL }) => {
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto(`${appURL}/#/day/2026-09-20/log`);
    const save = page.getByRole('button', { name: 'Save and close' });
    await expect(save).toBeVisible();
    // No second button that also leaves (and also saves) under another name.
    await expect(page.locator('main .card .btn')).toHaveCount(1);
    const lines = await save.evaluate((el) => {
      const range = document.createRange();
      range.selectNodeContents(el);
      return range.getClientRects().length;
    });
    expect(lines, `${width}px`).toBe(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  }
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
  await expect(page.locator('.compare-answer')).toHaveCount(0);

  await data.seed({ [TODAY]: day(TODAY, { breakfast: 450 }, 181) });
  await page.goto(`${appURL}/#/compare`);
  await page.reload();
  await expect(page.getByText('Log a few more days to see how today compares.')).toHaveCount(1);
  await expect(page.locator('[data-answer="calories"] .compare-answer-text')).toHaveText('450 cal so far today.');
  await expect(page.locator('[data-answer="weight"] .compare-answer-text')).toHaveText('181 lbs today.');
  await expect(page.locator('.compare-answer-detail')).toHaveCount(0);
  await expect(page.getByText('No weight logged')).toHaveCount(0);
});

test('a single day gets a proportionate axis, and the latest value never wraps', async ({ page, appURL, data }) => {
  await data.seed({ [TODAY]: day(TODAY, { lunch: 1300 }, 180) });
  await page.goto(appURL);
  await expect(page.locator('.chart-svg.series-calories .axis-label').first()).toBeVisible();
  await expect(page.locator('.chart-svg.series-weight .axis-label').first()).toBeVisible();
  const numbers = async (series) =>
    (await page.locator(`.chart-svg.series-${series} .axis-label`).allTextContents()).filter((t) => /^[\d,.]+$/.test(t)).map((t) => Number(t.replace(/,/g, '')));
  const cal = await numbers('calories');
  expect(cal[cal.length - 1] - cal[0]).toBeGreaterThanOrEqual(200);
  const lbs = await numbers('weight');
  expect(lbs[lbs.length - 1] - lbs[0]).toBeGreaterThanOrEqual(2);

  const entries = {};
  for (let i = 1; i <= 10; i += 1) {
    const d = new Date(Date.UTC(2026, 8, 24 - i)).toISOString().slice(0, 10);
    entries[d] = day(d, { breakfast: 1000, dinner: 917 }, 180.25);
  }
  await data.seed(entries);
  for (const width of [375, 390]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto(`${appURL}/#/compare`);
    for (const series of ['calories', 'weight']) {
      const spans = page.locator(`.chart-latest.series-${series} span`);
      await expect(spans.first()).toBeVisible();
      for (const box of await spans.evaluateAll((els) => els.map((el) => el.getClientRects().length))) expect(box).toBe(1);
    }
  }
});

test('History groups days by month and shows older months on request, even with ten years of days', async ({ page, appURL, data }) => {
  const entries = {};
  for (let i = 0; i < 3650; i += 1) {
    const d = new Date(Date.UTC(2026, 8, 24 - i)).toISOString().slice(0, 10);
    entries[d] = day(d, { lunch: 1500 + (i % 10) * 10 }, 170 + (i % 5) / 10);
  }
  await data.seed(entries);
  const started = Date.now();
  await page.goto(`${appURL}/#/history`);
  await expect(page.getByRole('heading', { name: 'September 2026' })).toBeVisible();
  expect(Date.now() - started).toBeLessThan(5000);
  await expect(page.getByText('3,650 days logged.')).toBeVisible();
  const september = page.locator('[data-month="2026-09"]');
  await expect(september.locator('.history-month-sub')).toHaveText('24 days · avg 1,542 cal · avg 170.2 lbs');
  // Only recent months are on the page to start with.
  const first = await page.locator('.history-item').count();
  expect(first).toBeGreaterThanOrEqual(60);
  expect(first).toBeLessThan(120);
  await expect(page.locator('.history-month')).toHaveCount(3);

  const more = page.getByRole('button', { name: /^Show earlier months/ });
  await more.click();
  await expect(page.locator('.history-month')).toHaveCount(7);
  await expect(page.getByRole('heading', { name: 'June 2026' })).toBeFocused();

  // Any month is one choice away.
  await page.getByLabel('Go to month').selectOption({ label: 'March 2017 (31 days)' });
  const march = page.getByRole('heading', { name: 'March 2017' });
  await expect(march).toBeFocused();
  await expect(march).toBeInViewport();
  await expect(more).toBeVisible();
  // Going to the oldest month shows every month, so nothing earlier is offered.
  const jump = page.getByLabel('Go to month');
  await jump.selectOption(await jump.locator('option').last().getAttribute('value'));
  await expect(more).toHaveCount(0);
  await expect(page.locator('.history-months + button')).toBeHidden();
  await page.getByLabel('Go to month').selectOption({ label: 'March 2017 (31 days)' });
  await page.locator('[data-month="2017-03"] .history-item', { hasText: 'Wed, Mar 15, 2017' }).click();
  await expect(page.getByRole('heading', { name: 'Wed, Mar 15, 2017' })).toBeVisible();
});

test('on a wide screen Today and Compare use two columns', async ({ page, appURL, data }) => {
  await data.seed({ '2026-09-23': day('2026-09-23', { lunch: 1600 }, 180), [TODAY]: day(TODAY, { breakfast: 400 }, 179) });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(appURL);
  const entry = await page.locator('main .card').filter({ has: page.getByRole('heading', { name: 'Today', exact: true }) }).boundingBox();
  const charts = await page.locator('main .card').filter({ has: page.getByRole('heading', { name: 'Graphs' }) }).boundingBox();
  expect(charts.x).toBeGreaterThan(entry.x + entry.width - 1);
  expect(Math.abs(charts.y - entry.y)).toBeLessThan(2);
  expect(entry.width + charts.width).toBeGreaterThan(900);
  await page.goto(`${appURL}/#/compare`);
  const answers = await page.locator('.compare-answers').boundingBox();
  const trends = await page.locator('main .card').filter({ has: page.getByRole('heading', { name: 'Trends' }) }).boundingBox();
  expect(trends.x).toBeGreaterThan(answers.x + answers.width);
});

test('the chosen theme and chart range stand out in dark mode', async ({ page, appURL }) => {
  await page.goto(appURL);
  await page.evaluate(() => localStorage.setItem('kenna:theme', 'dark'));
  await page.goto(`${appURL}/#/settings`);
  const look = (el) => {
    const s = getComputedStyle(el);
    return { bg: s.backgroundColor, shadow: s.boxShadow };
  };
  const chosen = await page.locator('label.segment', { hasText: 'Dark' }).evaluate(look);
  const other = await page.locator('label.segment', { hasText: 'Light' }).evaluate(look);
  const track = await page.locator('fieldset.segmented').evaluate(look);
  expect(chosen.bg).not.toBe(other.bg);
  expect(chosen.bg).not.toBe(track.bg);
  expect(chosen.shadow).toContain('inset');
  await page.goto(appURL);
  const range = await page.locator('.segment[aria-pressed="true"]').first().evaluate(look);
  expect(range.shadow).toContain('inset');
});

test('over years of data, All plots weekly averages that stay readable', async ({ page, appURL, data }) => {
  const entries = {};
  for (let i = 0; i < 3 * 365; i += 1) {
    const d = new Date(Date.UTC(2026, 8, 24 - i)).toISOString().slice(0, 10);
    entries[d] = day(d, { lunch: 1800 + (i % 7) * 50 }, 200 - i / 30 + (i % 3) * 0.4);
  }
  await data.seed(entries);
  await page.goto(appURL);
  await page.getByRole('button', { name: 'All' }).first().click();
  for (const series of ['calories', 'weight']) {
    const chart = page.locator(`.chart-svg.series-${series}`);
    const summary = await chart.getAttribute('aria-label');
    const weeks = Number(/all time, weekly averages: (\d+) weeks with data/.exec(summary)[1]);
    expect(weeks).toBeGreaterThan(150);
    expect(weeks).toBeLessThanOrEqual(160);
    const points = await chart.locator('polyline.line').evaluateAll((lines) => lines.reduce((n, l) => n + l.getAttribute('points').trim().split(/\s+/).length, 0));
    expect(points).toBe(weeks);
  }
  await expect(page.locator('.chart-sub').nth(0)).toHaveText('Weekly average of daily intake, not counting today');
  await expect(page.locator('.chart-sub').nth(1)).toHaveText('Weekly average weight');
  await expect(page.locator('.chart-latest.series-weight')).toContainText('Week of Sep 20');
  await page.locator('.chart-svg.series-calories').focus();
  await page.keyboard.press('End');
  // Sun Sep 20 to Wed Sep 23: today's calories aren't counted until the day is over.
  await expect(page.locator('.chart-tooltip.visible')).toContainText('Week of Sep 20, 2026 · average of 4 days');

  // Back to 90 days: every day again.
  await page.getByRole('button', { name: '90 days' }).first().click();
  await expect(page.locator('.chart-sub').nth(1)).toHaveText('Weight each day');
});

test("today's calories so far are a lone marker, never a line diving from yesterday", async ({ page, appURL, data }) => {
  const entries = {};
  for (let i = 1; i <= 30; i += 1) {
    const d = new Date(Date.UTC(2026, 8, 24 - i)).toISOString().slice(0, 10);
    entries[d] = day(d, { breakfast: 500, lunch: 700, dinner: 800 });
  }
  entries[TODAY] = day(TODAY, { breakfast: 420 });
  await data.seed(entries);
  await page.goto(appURL);
  const chart = page.locator('.chart-svg.series-calories');
  const marker = chart.locator('.dot-partial');
  await expect(marker).toHaveCount(1);
  await expect(chart.locator('.partial-label')).toHaveText('so far');
  const todayX = Number(await marker.getAttribute('cx'));
  const reached = await chart.locator('polyline, line.line-gap').evaluateAll(
    (els, x) =>
      els.some((el) =>
        el.tagName === 'polyline'
          ? el.getAttribute('points').split(/\s+/).some((p) => Math.abs(Number(p.split(',')[0]) - x) < 0.5)
          : Math.abs(Number(el.getAttribute('x2')) - x) < 0.5
      ),
    todayX
  );
  expect(reached).toBe(false);
  await expect(page.locator('.chart-latest.series-calories')).toContainText('Today so far');
});
