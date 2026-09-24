const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../../docs/core.js');

const meals = (m) => ({ ...core.emptyMeals(), ...m });
const entry = (date, m, weight = null) => ({ date, weight, meals: meals(m) });

test('daily total is null when no meal is logged, and the sum otherwise', () => {
  assert.equal(core.totalCalories(meals({})), null);
  assert.equal(core.totalCalories(meals({ breakfast: 400, dinner: 650 })), 1050);
  assert.equal(core.totalCalories(meals({ breakfast: 0 })), 0, 'a logged 0 is a real 0');
  assert.equal(core.totalCalories(undefined), null);
});

test('legacy per-food arrays are read as their summed total', () => {
  const legacy = [
    { name: 'toast', calories: 200, percent: 100 },
    { name: 'jam', calories: 100, percent: 50 },
  ];
  assert.equal(core.normalizeMealValue(legacy), 250);
  assert.equal(core.normalizeMealValue([]), null);
  assert.equal(core.normalizeMealValue('300'), 300);
  assert.equal(core.normalizeMealValue('abc'), null);
  assert.equal(core.normalizeMealValue({}), null);
  const e = core.normalizeEntry('2026-01-02', { weight: '180', meals: { lunch: legacy } });
  assert.deepEqual(e, { date: '2026-01-02', weight: 180, meals: meals({ lunch: 250 }) });
});

test('all-time averages skip days without meals and exclude today', () => {
  const entries = {
    '2026-09-22': entry('2026-09-22', { breakfast: 1500, dinner: 500 }, 181),
    '2026-09-23': entry('2026-09-23', {}, 180),
    '2026-09-24': entry('2026-09-24', { lunch: 1000 }, 179),
  };
  const avg = core.computeAllTimeAverages(entries, '2026-09-24');
  assert.equal(avg.total, 2000, 'the weight-only day is not a 0-calorie day');
  assert.equal(avg.weight, 180.5, 'weight uses every day with a weight');
  assert.equal(avg.breakfast, 1500);
  assert.equal(avg.lunch, null, "today's lunch is excluded");

  const yesterday = core.computeDayStats(entries['2026-09-23']);
  assert.equal(yesterday.total, null);
  assert.equal(yesterday.weight, 180);

  const rows = core.buildDailyRows(entries);
  assert.deepEqual(
    rows.map((r) => r.calories),
    [2000, null, 1000]
  );
});

test("today's calories so far are compared with the same meals on earlier days", () => {
  const entries = {
    '2026-09-21': entry('2026-09-21', { breakfast: 400, lunch: 700, dinner: 900 }),
    '2026-09-22': entry('2026-09-22', { breakfast: 600, lunch: 500, dinner: 800, snack2: 200 }),
    '2026-09-23': entry('2026-09-23', { lunch: 600, dinner: 700 }),
  };
  const avg = core.computeAllTimeAverages(entries, '2026-09-24');
  // Only breakfast so far: against the average breakfast, not a whole day.
  const breakfastOnly = core.computeDayStats(entry('2026-09-24', { breakfast: 450 }));
  assert.deepEqual(core.compareSameMeals(breakfastOnly, avg), { meals: ['breakfast'], today: 450, average: 500, unmatched: [] });
  // Breakfast and lunch against the average breakfast plus the average lunch
  // (each averaged over the days it was logged).
  const twoMeals = core.computeDayStats(entry('2026-09-24', { breakfast: 450, lunch: 700 }));
  assert.deepEqual(core.compareSameMeals(twoMeals, avg), { meals: ['breakfast', 'lunch'], today: 1150, average: 1100, unmatched: [] });
  // A meal never logged before has no average and is left out of both sides.
  const withNew = core.computeDayStats(entry('2026-09-24', { breakfast: 450, snack3: 150 }));
  assert.deepEqual(core.compareSameMeals(withNew, avg), { meals: ['breakfast'], today: 450, average: 500, unmatched: ['snack3'] });
  assert.equal(core.compareSameMeals(core.computeDayStats(entry('2026-09-24', { snack3: 150 })), avg), null);
  assert.equal(core.compareSameMeals(core.computeDayStats(null), avg), null);
});

test('averages are null with no usable history', () => {
  const avg = core.computeAllTimeAverages({}, '2026-09-24');
  assert.equal(avg.total, null);
  assert.equal(avg.weight, null);
});

test('yesterday is correct across month and year ends and leap days', () => {
  assert.equal(core.shiftDate('2026-03-01', -1), '2026-02-28');
  assert.equal(core.shiftDate('2024-03-01', -1), '2024-02-29');
  assert.equal(core.shiftDate('2026-01-01', -1), '2025-12-31');
  assert.equal(core.shiftDate('2026-10-31', 1), '2026-11-01');
  assert.equal(core.daysBetween('2026-09-01', '2026-10-01'), 30);
});

test('date handling across daylight-saving changes', () => {
  const { execFileSync } = require('node:child_process');
  const script = `
    const core = require(${JSON.stringify(require.resolve('../../docs/core.js'))});
    const out = [
      core.shiftDate('2026-03-09', -1),              // US spring forward is 2026-03-08
      core.shiftDate('2026-03-08', -1),
      core.shiftDate('2026-11-02', -1),              // US fall back is 2026-11-01
      core.todayStr(new Date(2026, 2, 8, 0, 30)),
      core.todayStr(new Date(2026, 2, 8, 23, 30)),
      core.todayStr(new Date(2026, 10, 1, 23, 59)),
      core.daysBetween('2026-03-01', '2026-03-31'),
    ];
    process.stdout.write(JSON.stringify(out));`;
  for (const tz of ['America/New_York', 'Europe/London', 'Australia/Sydney']) {
    const out = JSON.parse(execFileSync(process.execPath, ['-e', script], { env: { ...process.env, TZ: tz } }).toString());
    assert.deepEqual(out, ['2026-03-08', '2026-03-07', '2026-11-01', '2026-03-08', '2026-03-08', '2026-11-01', 30], tz);
  }
});

test('dates are validated as real calendar dates', () => {
  assert.equal(core.isValidDateStr('2026-02-29'), false);
  assert.equal(core.isValidDateStr('2024-02-29'), true);
  assert.equal(core.isValidDateStr('2026-99-99'), false);
  assert.equal(core.isValidDateStr(''), false);
  assert.equal(core.isValidDateStr('garbage'), false);
});

test('dates and numbers are formatted for people', () => {
  assert.equal(core.formatDate('2026-09-24', '2026-09-24'), 'Thu, Sep 24');
  assert.equal(core.formatDate('2025-12-31', '2026-09-24'), 'Wed, Dec 31, 2025');
  assert.equal(core.formatRelativeDate('2026-09-24', '2026-09-24'), 'Today');
  assert.equal(core.formatRelativeDate('2026-09-23', '2026-09-24'), 'Yesterday');
  assert.equal(core.formatRelativeDate('2026-09-21', '2026-09-24'), 'Mon, Sep 21');
  assert.equal(core.formatCalories(1000), '1,000 cal');
  assert.equal(core.formatWeight(180.44), '180.44 lbs');
  assert.equal(core.formatWeight(180.4), '180.4 lbs');
  assert.equal(core.formatWeight(180), '180 lbs');
  assert.equal(core.formatWeight(180.44, 1), '180.4 lbs', 'averages are shown to one decimal');
  assert.equal(core.formatWeight(180), '180 lbs');
});

test('calorie and weight input validation', () => {
  assert.deepEqual(core.validateCalories(''), { ok: true, value: null });
  assert.deepEqual(core.validateCalories('450'), { ok: true, value: 450 });
  for (const bad of ['-300', '1e3', '12.5', 'abc', '99999999999', '10001']) {
    assert.equal(core.validateCalories(bad).ok, false, bad);
  }
  assert.equal(core.validateCalories('10000').ok, true);
  assert.deepEqual(core.validateWeight('180.4'), { ok: true, value: 180.4 });
  for (const bad of ['-5', '0', '49', '1001', '1e2', 'abc']) {
    assert.equal(core.validateWeight(bad).ok, false, bad);
  }
});

test('each rejected number is told what is actually wrong with it', () => {
  const calError = (text) => core.validateCalories(text).error;
  const weightError = (text) => core.validateWeight(text).error;

  // Thousands separators in calories are understood.
  assert.deepEqual(core.validateCalories('1,200'), { ok: true, value: 1200 });
  assert.deepEqual(core.validateCalories(' 10,000 '), { ok: true, value: 10000 });
  assert.match(calError('12,00'), /without decimals/);
  assert.match(calError('450.5'), /without decimals/);
  assert.match(calError('-300'), /can't be negative/);
  assert.match(calError('64o'), /digits only/);
  assert.match(calError('1e3'), /digits only/);
  assert.match(calError('10,001'), /over 10,000 calories/);

  assert.equal(weightError('165.255'), 'Use at most two decimal places, like 165.25.');
  assert.equal(weightError('165,2'), 'Use a period for the decimal point, like 165.2.');
  assert.deepEqual(core.validateWeight('1,000'), { ok: true, value: 1000 });
  assert.deepEqual(core.validateWeight('165.25'), { ok: true, value: 165.25 });
  assert.deepEqual(core.validateWeight('165.'), { ok: true, value: 165 }, 'a trailing decimal point is read as the whole number');
  assert.deepEqual(core.validateWeight('1,000.'), { ok: true, value: 1000 });
  assert.match(weightError('165..'), /digits and a decimal point/);
  assert.match(weightError('1e2'), /digits and a decimal point/);
  assert.match(weightError('abc'), /digits and a decimal point/);
  assert.equal(weightError('49'), 'Enter a weight between 50 and 1,000 lbs.');
  assert.equal(weightError('-165'), 'Enter a weight between 50 and 1,000 lbs.');
});

test('numbers from the API or a backup follow the typed-input rules, with the same messages; only old long weights are rounded', () => {
  assert.deepEqual(core.validateCaloriesValue(450), { ok: true, value: 450 });
  assert.deepEqual(core.validateCaloriesValue(null), { ok: true, value: null });
  assert.equal(core.validateCaloriesValue(450.7).error, core.validateCalories('450.7').error);
  assert.match(core.validateCaloriesValue(450.5).error, /whole number/);
  assert.match(core.validateCaloriesValue(-5).error, /can't be negative/);
  assert.match(core.validateCaloriesValue(10001).error, /over 10,000/);
  assert.equal(core.validateCaloriesValue('450').ok, false, 'text is not a number');
  assert.equal(core.validateCaloriesValue(NaN).ok, false);
  assert.deepEqual(core.validateWeightValue(165.25), { ok: true, value: 165.25 });
  assert.equal(core.validateWeightValue(165.123).error, 'Use at most two decimal places, like 165.25.');
  assert.equal(core.validateWeightValue(49).error, 'Enter a weight between 50 and 1,000 lbs.');
  assert.equal(core.validateWeightValue(Infinity).ok, false);

  assert.deepEqual(core.validatePatch({ weight: 180.5, meals: { lunch: 600 } }), { ok: true, patch: { weight: 180.5, meals: { lunch: 600 } } });
  assert.equal(core.validatePatch({ weight: 165.123 }).error, 'Weight not saved. Use at most two decimal places, like 165.25.');
  assert.equal(core.validatePatch({ meals: { lunch: 450.5 } }).error, 'Lunch not saved. Enter calories as a whole number, like 450, without decimals.');
  assert.match(core.validatePatch({ meals: { brunch: 1 } }).error, /Unknown meal/);
  assert.match(core.validatePatch({ height: 1 }).error, /Unknown field/);

  const decimalCalories = core.parseBackup(JSON.stringify({ entries: { '2026-09-24': { weight: null, meals: { lunch: 450.7 } } } }));
  assert.equal(decimalCalories.ok, false);
  assert.equal(decimalCalories.error, 'Nothing was imported. Lunch on Thu, Sep 24 (450.7): Enter calories as a whole number, like 450, without decimals.');
  // The first version saved weights as typed; a backup from then imports
  // them rounded to two decimals, as the app shows them and exports them.
  const longWeight = core.parseBackup(JSON.stringify({ app: 'kenna', version: 2, entries: { '2026-09-16': { date: '2026-09-16', weight: 165.333, meals: { breakfast: 300 } } } }));
  assert.equal(longWeight.ok, true);
  assert.equal(longWeight.entries['2026-09-16'].weight, 165.33);
  assert.match(core.parseBackup({ entries: { '2026-09-16': { weight: 40.004, meals: {} } } }).error, /between 50 and 1,000/);
  // Lists of foods from the first version still import as their total.
  const foods = core.parseBackup(JSON.stringify({ entries: { '2026-09-24': { meals: { lunch: [{ calories: 301, percent: 50 }] } } } }));
  assert.equal(foods.ok, true);
  assert.equal(foods.entries['2026-09-24'].meals.lunch, 151);
});

test('a backup writes old weights with more than two decimals as the app shows them, so it can be imported again', () => {
  const old = { date: '2026-09-20', weight: 165.333, meals: core.emptyMeals() };
  const written = core.entryForBackup(old);
  assert.equal(written.weight, 165.33);
  assert.equal(old.weight, 165.333, 'the stored day is not changed');
  assert.equal(core.parseBackup(JSON.stringify({ app: 'kenna', version: 2, entries: { [old.date]: written } })).ok, true);
  assert.equal(core.entryForBackup({ ...old, weight: null }).weight, null);
});

test('patches change only the given fields, and empty days are detectable', () => {
  const base = entry('2026-09-24', { breakfast: 400 }, 180);
  const next = core.applyPatch('2026-09-24', base, { meals: { lunch: 650 } });
  assert.equal(next.meals.breakfast, 400);
  assert.equal(next.meals.lunch, 650);
  assert.equal(next.weight, 180);
  const cleared = core.applyPatch('2026-09-24', next, { weight: null, meals: { breakfast: null, lunch: null } });
  assert.equal(core.isEntryEmpty(cleared), true);
  assert.equal(core.applyPatch('2026-09-24', 'garbage', { weight: 170 }).weight, 170);
});

test('stored entries are read tolerantly: unreadable days are skipped, not fatal', () => {
  const { entries, skipped } = core.sanitizeEntries({
    '2026-01-01': 5,
    garbage: { weight: 'x' },
    '2026-01-02': { weight: 180 },
    '2026-01-03': { date: '2026-01-03', weight: null, meals: { dinner: 700 } },
  });
  assert.equal(skipped, 2);
  assert.deepEqual(Object.keys(entries).sort(), ['2026-01-02', '2026-01-03']);
  assert.equal(core.totalCalories(entries['2026-01-02'].meals), null);
});

test('backup parsing rejects malformed files with a specific message', () => {
  const bad = core.parseBackup(JSON.stringify({ entries: { '2026-01-01': 5, garbage: { weight: 'x' } } }));
  assert.equal(bad.ok, false);
  assert.match(bad.error, /^Nothing was imported\./);
  assert.match(bad.error, /1 more problem/);

  assert.equal(core.parseBackup('not json').ok, false);
  assert.equal(core.parseBackup('[]').ok, false);
  assert.equal(core.parseBackup(JSON.stringify({ app: 'other', entries: {} })).ok, false);
  assert.match(core.parseBackup(JSON.stringify({ entries: { '2026-01-01': { meals: { breakfast: -300 } } } })).error, /Breakfast on .*can't be negative/);
  assert.match(core.parseBackup(JSON.stringify({ entries: { '2026-01-01': { weight: 5, meals: {} } } })).error, /weight/);
  assert.match(core.parseBackup(JSON.stringify({ version: 99, entries: {} })).error, /newer version/);
  assert.match(
    core.parseBackup(JSON.stringify({ entries: {}, photos: [{ date: '2026-01-01', createdAt: 'x', type: 'image/jpeg', data: 'AA==' }] })).error,
    /upload time/
  );
});

test('a whole backup parses with its days and photos; version-1 files still import', () => {
  const entries = {
    '2026-09-23': entry('2026-09-23', { breakfast: 400 }, 180.2),
    '2026-09-24': entry('2026-09-24', {}, 179.8),
  };
  const photos = [{ date: '2026-09-23', createdAt: '2026-09-23T08:00:00.000Z', type: 'image/jpeg', data: 'AAECAw==' }];
  const parsed = core.parseBackup(JSON.stringify({ app: 'kenna', version: 2, exportedAt: '2026-09-24T10:00:00.000Z', entries, photos }));
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.entries, entries);
  assert.deepEqual(parsed.photos, photos);
  assert.equal(parsed.dayCount, 2);
  assert.equal(parsed.photoCount, 1);

  const v1 = core.parseBackup(
    JSON.stringify({ exportedAt: 'x', entries: { '2025-05-01': { date: '2025-05-01', weight: null, meals: { lunch: [{ calories: 500, percent: 100 }] } } } })
  );
  assert.equal(v1.ok, true);
  assert.equal(v1.entries['2025-05-01'].meals.lunch, 500);
  assert.deepEqual(v1.photos, []);
});

test('axis ticks are unique and carry the precision of the step', () => {
  const wide = core.niceTicks(149.2, 151.8, 5, 0.1);
  assert.deepEqual(wide.ticks, [149, 150, 151, 152]);
  const { ticks, decimals } = core.niceTicks(149.6, 151.4, 5, 0.1);
  assert.equal(decimals, 1);
  assert.deepEqual(ticks, [149.5, 150, 150.5, 151, 151.5]);
  const labels = ticks.map((t) => core.formatNumber(t, decimals));
  assert.equal(new Set(labels).size, labels.length, labels.join());
  assert.ok(ticks[0] <= 149.6 && ticks[ticks.length - 1] >= 151.4);
  const flat = core.niceTicks(1050, 1050, 5, 1);
  assert.equal(new Set(flat.ticks).size, flat.ticks.length);
  assert.ok(flat.ticks.length >= 2);
  const big = core.niceTicks(1200, 2600, 5, 1);
  assert.equal(big.decimals, 0);
});

test('one day, or days that barely differ, get an axis in proportion to the values', () => {
  const oneDay = core.niceTicks(1300, 1300, 5, 10, 0, core.axisMinSpan('cal', 1300));
  assert.ok(oneDay.ticks[0] <= 1170 && oneDay.ticks[oneDay.ticks.length - 1] >= 1430, oneDay.ticks.join());
  assert.equal(new Set(oneDay.ticks).size, oneDay.ticks.length);
  const small = core.niceTicks(150, 180, 5, 10, 0, core.axisMinSpan('cal', 180));
  assert.ok(small.ticks.every((t) => t >= 0));
  assert.ok(small.ticks[small.ticks.length - 1] - small.ticks[0] >= 200);
  const weight = core.niceTicks(180, 180, 5, 0.1, undefined, core.axisMinSpan('lbs', 180));
  assert.ok(weight.ticks[0] <= 179 && weight.ticks[weight.ticks.length - 1] >= 181, weight.ticks.join());
  const wide = core.niceTicks(1200, 2600, 5, 10, 0, core.axisMinSpan('cal', 2600));
  assert.deepEqual(wide.ticks, core.niceTicks(1200, 2600, 5, 10, 0).ticks, 'a real spread is left as it is');
});

test('a calorie axis never goes below zero', () => {
  const zero = core.niceTicks(0, 0, 5, 10, 0);
  assert.equal(zero.ticks[0], 0);
  assert.ok(zero.ticks.length >= 2);
  assert.ok(zero.ticks.every((t) => t >= 0));
  const low = core.niceTicks(0, 120, 5, 10, 0);
  assert.ok(low.ticks.every((t) => t >= 0));
  assert.ok(low.ticks[low.ticks.length - 1] >= 120);
  const normal = core.niceTicks(1800, 2100, 5, 10, 0);
  assert.ok(normal.ticks[0] > 0, 'an axis well above zero is not stretched down to it');
});

test('rolling average uses the trailing seven calendar days', () => {
  const pts = [
    { date: '2026-09-01', value: 100 },
    { date: '2026-09-02', value: 200 },
    { date: '2026-09-08', value: 300 },
    { date: '2026-09-09', value: 400 },
  ];
  const out = core.rollingAverage(pts, 7);
  assert.deepEqual(
    out.map((p) => p.value),
    [100, 150, 250, 350]
  );
});

test("the 7-day calorie trend leaves out today's unfinished day; weight keeps it", () => {
  /** @type {Record<string, any>} */
  const entries = {};
  for (let i = 1; i <= 7; i += 1) {
    const date = core.shiftDate('2026-09-24', -i);
    entries[date] = { date, weight: 180 - i / 10, meals: { breakfast: 500, lunch: 700, dinner: 700 } };
  }
  entries['2026-09-24'] = { date: '2026-09-24', weight: 179.8, meals: { breakfast: 400 } };
  const rows = core.buildDailyRows(entries);
  const calories = core.trendSeries(rows, 'calories', '2026-09-24');
  const last = calories[calories.length - 1];
  assert.equal(last.date, '2026-09-23');
  assert.equal(last.value, 1900);
  assert.ok(calories.every((p) => p.date < '2026-09-24'));
  const weight = core.trendSeries(rows, 'weight', '2026-09-24');
  assert.equal(weight[weight.length - 1].date, '2026-09-24');
  assert.equal(weight.length, 8);
});

test('the settled days that chart averages are taken from leave out today’s calories and every later day', () => {
  const rows = core.buildDailyRows({
    '2026-09-23': { date: '2026-09-23', weight: 180, meals: { lunch: 700 } },
    '2026-09-24': { date: '2026-09-24', weight: 179.8, meals: { breakfast: 400 } },
    '2026-09-25': { date: '2026-09-25', weight: 179, meals: { lunch: 900 } },
  });
  assert.deepEqual(core.settledSeries(rows, 'calories', '2026-09-24'), [{ date: '2026-09-23', value: 700 }]);
  assert.deepEqual(core.settledSeries(rows, 'weight', '2026-09-24'), [
    { date: '2026-09-23', value: 180 },
    { date: '2026-09-24', value: 179.8 },
  ]);
  // The trend is the rolling average of exactly those days.
  assert.deepEqual(core.trendSeries(rows, 'weight', '2026-09-24'), core.rollingAverage(core.settledSeries(rows, 'weight', '2026-09-24'), 7));
});

test('image sniffing recognises photos and rejects other files', () => {
  const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
  const heic = Uint8Array.from([0, 0, 0, 24, ...Buffer.from('ftypheic')]);
  const text = Uint8Array.from(Buffer.from('hello, world!'));
  assert.equal(core.sniffImageType(jpeg), 'image/jpeg');
  assert.equal(core.sniffImageType(heic), 'image/heic');
  assert.equal(core.sniffImageType(text), null);
});

test('a backup reminder is due with data and no backup, or a week after the last one', () => {
  const now = new Date(2026, 8, 24, 10);
  const at = (d) => new Date(2026, 8, d, 9).toISOString();
  const due = (state) => core.backupReminderDue({ hasData: true, lastBackupAt: null, snoozedUntil: null, now, ...state });
  assert.equal(due({ hasData: false }), null, 'nothing to back up');
  assert.deepEqual(due({}), { never: true });
  assert.deepEqual(due({ lastBackupAt: 'garbage' }), { never: true });
  assert.equal(due({ lastBackupAt: at(20) }), null, '4 days is recent enough');
  assert.deepEqual(due({ lastBackupAt: at(17) }), { never: false, days: 7 });
  assert.deepEqual(due({ lastBackupAt: at(14) }), { never: false, days: 10 });
  assert.equal(due({ snoozedUntil: new Date(2026, 8, 25).toISOString() }), null, 'snoozed');
  assert.deepEqual(due({ snoozedUntil: new Date(2026, 8, 23).toISOString() }), { never: true }, 'snooze over');
});

test('days after today never count toward averages', () => {
  const entries = {
    '2026-09-23': entry('2026-09-23', { lunch: 1000 }, 180),
    '2030-01-01': entry('2030-01-01', { lunch: 5000 }, 300),
  };
  const avg = core.computeAllTimeAverages(entries, '2026-09-24');
  assert.equal(avg.total, 1000);
  assert.equal(avg.weight, 180);
  assert.equal(core.isFutureDate('2026-09-25', '2026-09-24'), true);
  assert.equal(core.isFutureDate('2026-09-24', '2026-09-24'), false);
});

test('backup days dated after the latest allowed day are left out and counted', () => {
  const parsed = core.parseBackup(
    { entries: { '2026-09-23': entry('2026-09-23', { lunch: 600 }), '2030-01-01': entry('2030-01-01', { lunch: 500 }) } },
    '2026-09-24'
  );
  assert.equal(parsed.ok, true);
  assert.deepEqual(Object.keys(parsed.entries), ['2026-09-23']);
  assert.equal(parsed.futureDays, 1);
  assert.equal(core.parseBackup({ entries: { '2030-01-01': entry('2030-01-01', { lunch: 500 }) } }).futureDays, 0, 'no limit given');
});

test('chart dates carry their year on every label when the range crosses a year', () => {
  const end = core.dayNumber('2026-09-24');
  const within = core.dateAxisLabels(end - 29, end, 4).map((l) => l.text);
  assert.deepEqual(within, ['Aug 26', 'Sep 5', 'Sep 14', 'Sep 24']);
  const across = core.dateAxisLabels(end - 400, end, 4).map((l) => l.text);
  assert.equal(across.length, 4);
  for (const text of across) assert.match(text, /, \d{4}$/);
  assert.equal(across[0], 'Aug 20, 2025');
  assert.equal(across[3], 'Sep 24, 2026');
  assert.equal(core.dateAxisLabels(end - 400, end, 3).length, 3);
});

test('a day long before anything logged is flagged as a likely mistyped year', () => {
  assert.equal(core.isFarBack('2026-09-01', '2026-09-24', null), false);
  assert.equal(core.isFarBack('2025-09-24', '2026-09-24', null), false, 'a year ago is fine');
  assert.equal(core.isFarBack('2025-09-23', '2026-09-24', null), true);
  assert.equal(core.isFarBack('2002-09-24', '2026-09-24', '2026-01-10'), true);
  assert.equal(core.isFarBack('2023-06-01', '2026-09-24', '2023-06-20'), false, 'close to the first logged day');
  assert.equal(core.isFarBack('2023-04-01', '2026-09-24', '2023-06-20'), true);
  assert.equal(core.yearsBetween('1990-01-01', '2026-09-24'), 36);
  assert.equal(core.yearsBetween('2025-09-25', '2026-09-24'), 0);
  assert.equal(core.yearsBetween('2024-09-24', '2026-09-24'), 2);
});

test('photo bytes are encoded as base64 exactly as the browser would', async () => {
  const bytes = new Uint8Array(70000);
  for (let i = 0; i < bytes.length; i += 1) bytes[i] = (i * 7) % 256;
  assert.equal(await core.blobToBase64(new Blob([bytes])), Buffer.from(bytes).toString('base64'));
  assert.equal(await core.blobToBase64(new Blob([])), '');
});

test('a backup with some days outside the rules restores the rest and lists what it left out', () => {
  const parsed = core.parseBackup({
    app: 'kenna',
    version: 2,
    entries: {
      '2026-09-01': { date: '2026-09-01', weight: null, meals: { breakfast: -5 } },
      '2026-09-02': entry('2026-09-02', { lunch: 600 }),
      '2026-09-03': { date: '2026-09-03', weight: 12, meals: {} },
    },
    photos: [{ date: '2026-09-02', createdAt: 'never', type: 'image/jpeg', data: 'AA==' }],
  });
  assert.equal(parsed.ok, true);
  assert.deepEqual(Object.keys(parsed.entries), ['2026-09-02']);
  assert.deepEqual(parsed.skipped, [
    "Breakfast on Tue, Sep 1 (-5): Calories can't be negative. Enter 0 or more.",
    'The weight on Thu, Sep 3 (12): Enter a weight between 50 and 1,000 lbs.',
    'Photo 1 has no valid upload time.',
  ]);
  assert.deepEqual(core.parseBackup({ entries: { '2026-09-02': entry('2026-09-02', { lunch: 600 }) } }).skipped, []);
});

test('a restore is described by how many stored days it replaces and adds', () => {
  const stored = {
    '2026-09-20': entry('2026-09-20', { breakfast: 700 }),
    '2026-09-21': entry('2026-09-21', { breakfast: 400 }, 180),
    '2026-09-22': entry('2026-09-22', {}),
  };
  const incoming = {
    '2026-09-20': entry('2026-09-20', { breakfast: 500 }),
    '2026-09-21': entry('2026-09-21', { breakfast: 400 }, 180),
    '2026-09-22': entry('2026-09-22', { lunch: 300 }),
    '2026-09-23': entry('2026-09-23', {}, 179),
  };
  assert.deepEqual(core.compareWithStored(stored, incoming), { replaced: ['2026-09-20'], added: ['2026-09-22', '2026-09-23'], unchanged: 1 });
});

test('long chart ranges are averaged by week, and multi-year ranges by month', () => {
  assert.equal(core.chartPeriod(30), 'day');
  assert.equal(core.chartPeriod(120), 'day');
  assert.equal(core.chartPeriod(121), 'week');
  assert.equal(core.chartPeriod(3 * 365), 'week');
  assert.equal(core.chartPeriod(160 * 7 + 1), 'month');

  // Thu Sep 17 .. Wed Sep 23: the week starting Sun Sep 13, then Sun Sep 20.
  const points = ['2026-09-17', '2026-09-18', '2026-09-20', '2026-09-23'].map((date, i) => ({ date, value: 100 * (i + 1) }));
  const weeks = core.periodAverages(points, 'week');
  assert.deepEqual(
    weeks.map((w) => [core.dateFromDayNumber(w.start), core.dateFromDayNumber(w.end), w.value, w.count]),
    [
      ['2026-09-13', '2026-09-19', 150, 2],
      ['2026-09-20', '2026-09-26', 350, 2],
    ]
  );
  const months = core.periodAverages([{ date: '2026-02-03', value: 1 }, { date: '2026-02-28', value: 3 }, { date: '2026-03-01', value: 5 }], 'month');
  assert.deepEqual(
    months.map((m) => [core.dateFromDayNumber(m.start), core.dateFromDayNumber(m.end), m.value]),
    [
      ['2026-02-01', '2026-02-28', 2],
      ['2026-03-01', '2026-03-31', 5],
    ]
  );
  assert.equal(core.formatPeriod(weeks[1].start, 'week'), 'Week of Sep 20');
  assert.equal(core.formatPeriod(weeks[1].start, 'week', true), 'Week of Sep 20, 2026');
  assert.equal(core.formatPeriod(months[0].start, 'month'), 'February 2026');
});

test('an average weight always shows its one decimal; a logged weight shows as entered', () => {
  assert.equal(core.formatAverageWeight(166), '166.0 lbs');
  assert.equal(core.formatAverageWeight(165.96), '166.0 lbs');
  assert.equal(core.formatAverageWeight(164.34), '164.3 lbs');
  assert.equal(core.formatAverageWeight(1000), '1,000.0 lbs');
  assert.equal(core.formatWeight(166), '166 lbs');
  assert.equal(core.formatWeight(165.25), '165.25 lbs');
  assert.equal(core.formatNumber(166, 1, 1), '166.0');
  assert.equal(core.formatNumber(166, 1), '166');
  assert.equal(core.formatNumber(1.25, 0, 2), '1', 'never more decimals than the most asked for');
});

test('weights shown together share their decimals: one, or two when any was logged with two', () => {
  const plain = core.weightFormatFor([171, 180.6, null, undefined]);
  assert.equal(plain.decimals, 1);
  assert.equal(plain.format(171), '171.0 lbs');
  assert.equal(plain.format(180.6), '180.6 lbs');
  assert.equal(plain.format(179.5333), '179.5 lbs', 'an average among them is rounded to fit');
  const fine = core.weightFormatFor([171, 165.25]);
  assert.equal(fine.decimals, 2);
  assert.equal(fine.format(171), '171.00 lbs');
  assert.equal(fine.format(165.25), '165.25 lbs', 'never rounded away');
  assert.equal(core.weightFormatFor([165.3 + 0.0000001]).decimals, 1, 'floating-point noise is not a second decimal');
  assert.equal(core.weightFormatFor([]).format(1000), '1,000.0 lbs');
});

test("a month's averages leave out today, like every other average", () => {
  const days = [
    { date: '2026-09-22', weight: null, meals: { ...core.emptyMeals(), breakfast: 500 } },
    { date: '2026-09-23', weight: 170, meals: { ...core.emptyMeals(), breakfast: 1500 } },
    { date: '2026-09-24', weight: 180, meals: { ...core.emptyMeals(), breakfast: 100 } },
    { date: '2026-09-25', weight: 200, meals: core.emptyMeals() },
  ];
  assert.deepEqual(core.computeMonthAverages(days, '2026-09-24'), { calories: 1000, weight: 170 });
  assert.deepEqual(core.computeMonthAverages(days.slice(2), '2026-09-24'), { calories: null, weight: null });
  // A past month is unaffected.
  assert.deepEqual(core.computeMonthAverages(days, '2026-10-02'), { calories: 700, weight: (170 + 180 + 200) / 3 });
  // The same as Compare's all-time averages over the same days.
  const all = core.computeAllTimeAverages(days, '2026-09-24');
  assert.equal(all.weight, 170);
  assert.equal(all.total, 1000);
});

test('a problem event names what failed and the kind of error, never its message', () => {
  const quota = new Error('Setting the value of "kenna:entries" exceeded the quota: {"2026-09-24":{"weight":181.2}}');
  quota.name = 'QuotaExceededError';
  const err = new core.KennaError('Not saved. There is no room left.', { cause: quota });
  const e = core.problemEvent('Save a meal', err, { now: new Date('2026-09-24T15:04:05Z') });
  assert.equal(e.at, '2026-09-24T15:04:05.000Z');
  assert.equal(e.op, 'Save a meal');
  assert.equal(e.error, 'KennaError ← QuotaExceededError');
  assert.doesNotMatch(JSON.stringify(e), /181|room|exceeded the quota/i, 'no message and no logged value');
  // Where in the code, from the stack: a file name and position only.
  const thrown = new TypeError("Cannot read properties of null (reading '181.2')");
  thrown.stack = "TypeError: Cannot read properties of null (reading 'data.js:9:9')\n    at x (https://example.com/Kenna/build/app.js:1:2345)";
  assert.deepEqual(core.problemEvent('Unexpected error', thrown, { now: new Date(0) }), {
    at: '1970-01-01T00:00:00.000Z',
    op: 'Unexpected error',
    error: 'TypeError',
    where: 'app.js:1:2345',
  });
  // Safari writes frames only.
  const safari = new TypeError('x');
  safari.stack = 'draw@https://example.com/Kenna/build/app.js:1:999\nglobal code@https://example.com/Kenna/build/app.js:1:5';
  assert.equal(core.problemEvent('x', safari).where, 'app.js:1:999');
  // Whatever was thrown, a name comes out.
  assert.equal(core.problemEvent('x', 'a string').error, 'string');
  assert.equal(core.problemEvent('x', undefined).error, 'undefined');
  assert.equal(core.problemEvent('x', null).error, 'null');
  assert.equal(core.problemEvent('x', { name: 'has spaces and "quotes"' }).error, 'object');
  assert.equal(core.problemEvent('x', { name: 'StorageBlocked' }, { where: null }).where, undefined);
});

test('the problem log says what went wrong in plain words, from the innermost error it knows', () => {
  assert.equal(core.plainProblem('KennaError ← QuotaExceededError'), 'The device’s storage was full');
  assert.equal(core.plainProblem('StorageBlocked'), 'The browser wouldn’t let Kenna save anything');
  assert.equal(core.plainProblem('TypeError'), 'A fault in Kenna itself');
  assert.equal(core.plainProblem('KennaError ← UnknownError ← object'), 'The browser’s storage reported an error');
  for (const unknown of ['KennaError', 'object', 'Error', 'SomethingNew']) assert.equal(core.plainProblem(unknown), 'Something unexpected went wrong');
});

test('a mistake in what was entered is a Kenna message, but not a fault', () => {
  const err = new core.InputError("That file isn't a photo we can show.");
  assert.ok(err instanceof core.KennaError);
  assert.equal(err.name, 'InputError');
});

test('the problem log keeps the newest events, counting a failure repeated in a row once', () => {
  let list = [];
  for (let i = 0; i < 100; i += 1) list = core.addProblem(list, core.problemEvent(`Op ${i}`, new Error('x'), { now: new Date(i * 1000), where: null }));
  assert.equal(list.length, core.PROBLEM_LOG_LIMIT);
  assert.equal(list[0].op, `Op ${100 - core.PROBLEM_LOG_LIMIT}`);
  assert.equal(list[list.length - 1].op, 'Op 99');

  const again = core.addProblem(core.addProblem(list, list[list.length - 1]), list[list.length - 1]);
  assert.equal(again.length, core.PROBLEM_LOG_LIMIT);
  assert.equal(again[again.length - 1].count, 3);
  assert.equal(core.addProblem([], list[0], 5).length, 1);
});

test('a stored problem log is read back tolerantly, and copied as plain text, newest first', () => {
  assert.deepEqual(core.parseProblemLog(null), []);
  assert.deepEqual(core.parseProblemLog('not json'), []);
  assert.deepEqual(core.parseProblemLog('{"at":1}'), []);
  const good = { at: '2026-09-24T10:00:00.000Z', op: 'Save a meal', error: 'KennaError ← QuotaExceededError' };
  const later = { at: '2026-09-24T11:00:00.000Z', op: 'Add a photo', error: 'KennaError', where: 'app.js:1:2', count: 2 };
  const text = JSON.stringify([good, { at: 'yesterday', op: 'x', error: 'y' }, { op: 'x' }, 7, later]);
  assert.deepEqual(core.parseProblemLog(text), [good, later]);
  const many = JSON.stringify(Array.from({ length: 80 }, () => good));
  assert.equal(core.parseProblemLog(many).length, core.PROBLEM_LOG_LIMIT);

  const report = core.problemReport([good, later], { app: 'phone app', browser: 'Test/1.0', copiedAt: new Date('2026-09-24T12:00:00Z') });
  assert.equal(
    report,
    [
      'Kenna problem log (phone app)',
      'Browser: Test/1.0',
      'Copied: 2026-09-24T12:00:00.000Z',
      '',
      '2026-09-24T11:00:00.000Z  Add a photo: KennaError at app.js:1:2 (2 times in a row)',
      '2026-09-24T10:00:00.000Z  Save a meal: KennaError ← QuotaExceededError',
      '',
    ].join('\n')
  );
  assert.match(core.problemReport([], { app: 'phone app', browser: 'B' }), /Nothing recorded\./);
});
