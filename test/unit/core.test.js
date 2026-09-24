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

test('numbers from the API or a backup follow the typed-input rules, with the same messages, and are never rounded', () => {
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
  const longWeight = core.parseBackup(JSON.stringify({ app: 'kenna', version: 2, entries: { '2026-09-24': { weight: 150.123, meals: {} } } }));
  assert.equal(longWeight.error, 'Nothing was imported. The weight on Thu, Sep 24 (150.123): Use at most two decimal places, like 165.25.');
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
