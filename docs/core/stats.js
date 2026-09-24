// Averages and trends: all-time averages, today against the same meals on
// earlier days, and the daily rows and rolling averages the charts draw.

/** @typedef {import('./entries.js').Entry} Entry */
'use strict';

const { isValidDateStr, dayNumber } = require('./dates.js');
const { MEAL_KEYS, normalizeMealValue, normalizeWeight, totalCalories } = require('./entries.js');

/** @param {number[]} vals @returns {number | null} */
const mean = (vals) => (vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null);

// All-time averages of the days before `today`: today itself is left out
// so it's compared with a typical day rather than diluting its own
// baseline (and a day wrongly dated in the future never counts). Weight
// averages every day with a weight; calories average only days with at
// least one meal; a meal averages only the days that meal was logged.
/**
 * @param {Record<string, Entry> | Entry[]} entries
 * @param {string} today
 * @returns {Record<string, number | null>} weight, total and each meal
 */
function computeAllTimeAverages(entries, today) {
  const list = (Array.isArray(entries) ? entries : Object.values(entries || {})).filter((e) => e && e.date < today);
  /** @type {Record<string, number | null>} */
  const result = { weight: null, total: null };
  result.weight = mean(list.map((e) => normalizeWeight(e.weight)).filter((w) => w !== null));
  result.total = mean(list.map((e) => totalCalories(e.meals)).filter((t) => t !== null));
  for (const key of MEAL_KEYS) {
    result[key] = mean(list.map((e) => normalizeMealValue(e.meals && e.meals[key])).filter((v) => v !== null));
  }
  return result;
}

// Today's calories so far, compared like with like: the meals logged
// today against the average of those same meals (each meal's average
// counting only the days it was logged, as the Each meal table shows).
// Before dinner that says how breakfast and lunch went, rather than that
// half a day is less than a whole one. A meal logged today that has never
// been logged before has no average and is listed in `unmatched`.
/**
 * @param {Record<string, number | null>} todayStats computeDayStats of today
 * @param {Record<string, number | null>} averages computeAllTimeAverages
 * @returns {{ meals: string[], today: number, average: number, unmatched: string[] } | null}
 *   null when no meal logged today has an average to compare with
 */
function compareSameMeals(todayStats, averages) {
  /** @type {string[]} */
  const meals = [];
  /** @type {string[]} */
  const unmatched = [];
  let todaySum = 0;
  let averageSum = 0;
  for (const key of MEAL_KEYS) {
    const value = todayStats[key];
    if (value === null || value === undefined) continue;
    const average = averages[key];
    if (average === null || average === undefined) {
      unmatched.push(key);
      continue;
    }
    meals.push(key);
    todaySum += value;
    averageSum += average;
  }
  if (meals.length === 0) return null;
  return { meals, today: todaySum, average: averageSum, unmatched };
}

// One row per logged day, oldest first; calories is null on days without
// meals so charts show a gap there instead of a drop to zero.
/**
 * @param {Record<string, Entry>} entries
 * @returns {{ date: string, calories: number | null, weight: number | null }[]}
 */
function buildDailyRows(entries) {
  return Object.values(entries || {})
    .filter((e) => e && isValidDateStr(e.date))
    .map((e) => ({ date: e.date, calories: totalCalories(e.meals), weight: normalizeWeight(e.weight) }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/**
 * @param {{ date: string, calories: number | null, weight: number | null }[]} rows
 * @param {'calories' | 'weight'} field
 * @returns {{ date: string, value: number }[]}
 */
function seriesFromRows(rows, field) {
  /** @type {{ date: string, value: number }[]} */
  const out = [];
  for (const r of rows) {
    const value = r[field];
    if (value !== null && value !== undefined) out.push({ date: r.date, value });
  }
  return out;
}

// Trailing rolling average: for each logged day, the mean of the values
// logged in the `windowDays` calendar days ending on it.
/**
 * @param {{ date: string, value: number }[]} points
 * @param {number} windowDays
 * @returns {{ date: string, value: number, count: number }[]}
 */
function rollingAverage(points, windowDays) {
  const days = windowDays || 7;
  const out = [];
  let start = 0;
  let sum = 0;
  for (let i = 0; i < points.length; i += 1) {
    sum += points[i].value;
    const n = dayNumber(points[i].date);
    while (dayNumber(points[start].date) <= n - days) {
      sum -= points[start].value;
      start += 1;
    }
    out.push({ date: points[i].date, value: sum / (i - start + 1), count: i - start + 1 });
  }
  return out;
}

// A month's averages, as History shows them: calories over the days with
// meals, weight over the days with a weight. Today is left out of both, as
// it is from every average, so a month reads the same in History as the
// averages on Compare; days after today never count. Null where there's
// nothing to average.
/**
 * @param {Entry[]} days the month's days
 * @param {string} today
 * @returns {{ calories: number | null, weight: number | null }}
 */
function computeMonthAverages(days, today) {
  const before = days.filter((e) => e && e.date < today);
  return {
    calories: mean(/** @type {number[]} */ (before.map((e) => totalCalories(e.meals)).filter((t) => t !== null))),
    weight: mean(/** @type {number[]} */ (before.map((e) => normalizeWeight(e.weight)).filter((w) => w !== null))),
  };
}

// The 7-day trend line on Compare. Today's calories are left out: the day
// isn't over, so its running total (breakfast only, at 10 AM) would drag
// the average down every morning. Weight is one reading a day and keeps
// today; days after today never count.
/**
 * @param {{ date: string, calories: number | null, weight: number | null }[]} rows
 * @param {'calories' | 'weight'} field
 * @param {string} today
 * @param {number} [windowDays]
 * @returns {{ date: string, value: number, count: number }[]}
 */
function trendSeries(rows, field, today, windowDays) {
  const daily = seriesFromRows(rows, field).filter((p) => (field === 'calories' ? p.date < today : p.date <= today));
  return rollingAverage(daily, windowDays || 7);
}

module.exports = {
  computeAllTimeAverages,
  compareSameMeals,
  buildDailyRows,
  seriesFromRows,
  rollingAverage,
  trendSeries,
  computeMonthAverages,
};
