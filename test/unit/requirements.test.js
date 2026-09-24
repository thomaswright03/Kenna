// REQUIREMENTS.md lists every business rule with the value the app uses,
// for the owner to confirm. These tests keep each value there the same as
// in the code, so a change to one can't leave the other behind.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const core = require('../../docs/core.js');
const { UNUSUAL } = require('../../docs/core/unusual.js');
const { FAR_BACK } = require('../../docs/core/dates.js');

const root = path.join(__dirname, '..', '..');
const source = (file) => fs.readFileSync(path.join(root, file), 'utf8');

/** The rows of REQUIREMENTS.md's table, by id. */
function rules() {
  /** @type {Map<string, { value: string, agreed: string }>} */
  const rows = new Map();
  for (const line of source('REQUIREMENTS.md').split('\n')) {
    const cells = line.split('|').map((c) => c.trim());
    if (cells.length !== 7 || !/^[a-z][a-z-]+$/.test(cells[1])) continue;
    assert.ok(!rows.has(cells[1]), `${cells[1]} is listed twice`);
    rows.set(cells[1], { value: cells[3], agreed: cells[5] });
  }
  return rows;
}

const number = (text) => Number(text.replace(/,/g, '').replace(/%$/, ''));
/** A constant in a source file: `const NAME = 1600;` */
const constantIn = (file, name) => Number(new RegExp(`const ${name} = (\\d+);`).exec(source(file))[1]);

// What each value must be, read from the code (or, where the rule is
// behaviour rather than a number, checked by running it).
const expected = {
  'calories-min': () => core.LIMITS.caloriesMin,
  'calories-max': () => core.LIMITS.caloriesMax,
  'weight-min': () => core.LIMITS.weightMin,
  'weight-max': () => core.LIMITS.weightMax,
  'weight-decimals': (value) => {
    const n = number(value);
    assert.equal(core.validateWeight(`165.${'2'.repeat(n)}`).ok, true);
    assert.equal(core.validateWeight(`165.${'2'.repeat(n + 1)}`).ok, false);
    return n;
  },
  units: () => 'lbs, US English',
  'future-days': (value) => {
    assert.equal(core.isFutureDate('2026-09-25', '2026-09-24'), true);
    assert.equal(core.isFutureDate('2026-09-24', '2026-09-24'), false);
    return value === 'today and earlier' ? value : null;
  },
  'far-back-years': () => FAR_BACK.YEAR_DAYS,
  'far-back-before-first': () => FAR_BACK.BEFORE_FIRST_DAYS,
  'meal-times': () => UNUSUAL.mealTimes,
  'meal-margin': () => UNUSUAL.mealMargin,
  'meal-recent': () => UNUSUAL.mealRecent,
  'meal-history': () => UNUSUAL.mealHistory,
  'meal-no-history': () => UNUSUAL.mealNoHistory,
  'weight-base': () => UNUSUAL.weightBase,
  'weight-per-day': () => UNUSUAL.weightPerDay,
  'weight-share': () => UNUSUAL.weightShare * 100,
  'averages-today': (value) => {
    const avg = core.computeAllTimeAverages({ a: { date: '2026-09-23', weight: 180, meals: core.emptyMeals() }, b: { date: '2026-09-24', weight: 170, meals: core.emptyMeals() } }, '2026-09-24');
    assert.equal(avg.weight, 180);
    return value === 'leave out today' ? value : null;
  },
  'averages-calories': (value) => {
    const avg = core.computeAllTimeAverages([{ date: '2026-09-22', weight: 180, meals: core.emptyMeals() }, { date: '2026-09-23', weight: null, meals: { ...core.emptyMeals(), lunch: 600 } }], '2026-09-24');
    assert.equal(avg.total, 600);
    return value === 'only days with a meal' ? value : null;
  },
  'recent-days': () => core.RECENT_DAYS,
  'backup-remind-from': () => core.BACKUP_REMINDER.REMIND_FROM_DAYS,
  'backup-every-default': () => core.BACKUP_REMINDER.DEFAULT_EVERY_DAYS,
  'backup-every-choices': () => core.BACKUP_REMINDER.EVERY_DAYS_CHOICES.join(', '),
  'backup-photo': (value) => {
    const due = core.backupReminderDue({ loggedDays: 1, backup: null, snooze: null, photoAddedAt: [new Date().toISOString()], everyDays: 7, now: new Date() });
    assert.ok(due && due.photos === 1);
    return value === 'straight away' ? value : null;
  },
  'backup-snooze': (value) => {
    assert.equal(core.backupSnoozeEnd(new Date(2026, 8, 24, 10)), new Date(2026, 8, 25).toISOString());
    return value === 'until the next day' ? value : null;
  },
  'install-note-snooze': () => constantIn('docs/ui/install-note.js', 'INSTALL_NOTE_SNOOZE_DAYS'),
  'photo-size': () => constantIn('docs/ui/screen-photos.js', 'KEPT_SIZE'),
};

test('REQUIREMENTS.md lists every rule, and each value matches the code', () => {
  const rows = rules();
  assert.deepEqual([...rows.keys()].sort(), Object.keys(expected).sort(), 'the rules listed are the rules checked');
  for (const [id, row] of rows) {
    const want = expected[id](row.value);
    const got = typeof want === 'number' ? number(row.value) : row.value;
    assert.equal(got, want, `${id}: REQUIREMENTS.md says ${row.value}`);
  }
});

test("REQUIREMENTS.md's Owner agreed column holds a date or says not yet", () => {
  for (const [id, row] of rules()) {
    assert.match(row.agreed, /^(not yet|\d{4}-\d{2}-\d{2})$/, `${id}: "${row.agreed}"`);
  }
});

test('the README links to REQUIREMENTS.md', () => {
  assert.match(source('README.md'), /\(REQUIREMENTS\.md\)/);
});
