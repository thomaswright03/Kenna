// Values far from the user's own history: most likely a slip of the finger
// (4500 for 450, 108.4 for 180.4) that would otherwise shift every average
// and chart it's part of. The screens ask before saving one. Only the
// absolute limits (input.js) refuse a value; this decides whether to ask.
'use strict';

const { MEAL_STEPS } = require('./entries.js');
const { daysBetween, formatRelativeDate } = require('./dates.js');
const { formatCalories, formatWeight, weightFormatFor } = require('./numbers.js');

/** @typedef {import('./entries.js').Entry} Entry */

/**
 * A value worth asking about: the question, and why it's asked.
 * @typedef {{ title: string, reason: string }} Unusual
 */

const UNUSUAL = {
  // A meal is asked about when it's more than this many times its usual
  // size, and more than mealMargin above it (so a 350 cal snack isn't
  // asked about beside a usual 100).
  mealTimes: 3,
  mealMargin: 1000,
  // Its usual size is the median of this many of its most recent logs...
  mealRecent: 30,
  // ...once it has been logged at least this many times; until then, a
  // meal over mealNoHistory is asked about.
  mealHistory: 3,
  mealNoHistory: 3000,
  // A weight is asked about when it's further than this from the nearest
  // other day's weight, plus weightPerDay for each further day between
  // them, but never allowing more than weightShare of that weight.
  weightBase: 5,
  weightPerDay: 0.5,
  weightShare: 0.25,
};

/** @param {number[]} values at least one */
function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * @param {Record<string, Entry>} entries
 * @param {string} date the day it's for (its own value isn't history)
 * @param {string} key the meal
 * @param {number} value
 * @returns {Unusual | null}
 */
function unusualMeal(entries, date, key, value) {
  const step = MEAL_STEPS.find((m) => m.key === key);
  const name = step ? step.label.toLowerCase() : key;
  const logged = Object.values(entries)
    .filter((e) => e && e.date !== date && e.meals && typeof e.meals[key] === 'number')
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .slice(0, UNUSUAL.mealRecent)
    .map((e) => Number(e.meals[key]));
  const title = `Keep ${formatCalories(value)} for ${name}?`;
  if (logged.length < UNUSUAL.mealHistory) {
    if (value <= UNUSUAL.mealNoHistory) return null;
    return { title, reason: `That's more than ${formatCalories(UNUSUAL.mealNoHistory)} for one meal.` };
  }
  const usual = median(logged);
  if (value <= Math.max(usual * UNUSUAL.mealTimes, usual + UNUSUAL.mealMargin)) return null;
  return { title, reason: `That's far more than your usual ${name} (${formatCalories(usual)}).` };
}

/**
 * The weight logged nearest to `date` on another day (the earlier one when
 * two are as near), and how many days away it is.
 * @param {Record<string, Entry>} entries
 * @param {string} date
 * @returns {{ entry: Entry & { weight: number }, days: number } | null}
 */
function nearestWeight(entries, date) {
  /** @type {{ entry: Entry & { weight: number }, days: number } | null} */
  let found = null;
  for (const e of Object.values(entries)) {
    if (!e || e.date === date || typeof e.weight !== 'number') continue;
    const days = Math.abs(daysBetween(e.date, date));
    const nearer = !found || days < found.days || (days === found.days && e.date < found.entry.date);
    if (nearer) found = { entry: /** @type {Entry & { weight: number }} */ (e), days };
  }
  return found;
}

/**
 * @param {Record<string, Entry>} entries
 * @param {string} date
 * @param {number} value
 * @param {string} [today]
 * @returns {Unusual | null}
 */
function unusualWeight(entries, date, value, today) {
  const near = nearestWeight(entries, date);
  if (!near) return null;
  const other = near.entry.weight;
  const allowed = Math.min(UNUSUAL.weightBase + UNUSUAL.weightPerDay * (near.days - 1), other * UNUSUAL.weightShare);
  const diff = value - other;
  if (Math.abs(diff) <= allowed + 1e-9) return null;
  const lbs = weightFormatFor([value, other]).format;
  const when = formatRelativeDate(near.entry.date, today);
  const onDay = when === 'Today' || when === 'Yesterday' ? when.toLowerCase() : `on ${when}`;
  return {
    title: `Keep ${formatWeight(value)}?`,
    reason: `That's ${lbs(Math.abs(diff))} ${diff > 0 ? 'more' : 'less'} than your weight ${onDay} (${lbs(other)}).`,
  };
}

/**
 * Whether a value about to be saved is far from the user's own history,
 * and so worth asking about first; null when it isn't (or is empty).
 * @param {Record<string, Entry>} entries every stored day
 * @param {string} date the day it's for
 * @param {'weight' | string} field the weight, or a meal's key
 * @param {number | null} value
 * @param {string} [today] YYYY-MM-DD, for naming the other day
 * @returns {Unusual | null}
 */
function unusualValue(entries, date, field, value, today) {
  if (value === null) return null;
  return field === 'weight' ? unusualWeight(entries, date, value, today) : unusualMeal(entries, date, field, value);
}

module.exports = { UNUSUAL, unusualValue };
