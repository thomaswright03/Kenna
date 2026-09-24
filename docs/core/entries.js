// A day's entry: its weight and each meal's calorie total. Reading stored
// days from any version of Kenna, applying a change, and the day's totals.

/**
 * One day as the app works with it. A meal is its calorie total, or null
 * when it wasn't logged.
 * @typedef {{ date: string, weight: number | null, meals: Record<string, number | null> }} Entry
 * @typedef {{ weight?: number | null, meals?: Record<string, number | null> }} EntryPatch
 */
'use strict';

const { isValidDateStr } = require('./dates.js');

const MEAL_STEPS = [
  { key: 'breakfast', label: 'Breakfast' },
  { key: 'snack1', label: 'Snack 1' },
  { key: 'lunch', label: 'Lunch' },
  { key: 'snack2', label: 'Snack 2' },
  { key: 'dinner', label: 'Dinner' },
  { key: 'snack3', label: 'Snack 3' },
];
const MEAL_KEYS = MEAL_STEPS.map((m) => m.key);

/** @returns {Record<string, number | null>} */
function emptyMeals() {
  /** @type {Record<string, number | null>} */
  const meals = {};
  for (const key of MEAL_KEYS) meals[key] = null;
  return meals;
}

// A meal's value is a single calorie total (number) or null if not logged.
// Older versions logged individual foods per meal as an array; those are
// read as their summed total, so old history keeps working unchanged.
/** @param {unknown} raw @returns {number | null} */
function normalizeMealValue(raw) {
  if (raw === null || raw === undefined || raw === '') return null;
  if (Array.isArray(raw)) {
    if (raw.length === 0) return null;
    const total = raw.reduce(
      (sum, f) => sum + ((Number(f && f.calories) || 0) * (Number(f && f.percent) || 0)) / 100,
      0
    );
    return Math.round(total);
  }
  if (typeof raw === 'object' || typeof raw === 'boolean') return null;
  const num = Number(raw);
  return Number.isFinite(num) ? Math.round(num) : null;
}

/** @param {unknown} raw @returns {number | null} */
function normalizeWeight(raw) {
  if (raw === null || raw === undefined || raw === '' || typeof raw === 'boolean') return null;
  const num = Number(raw);
  return Number.isFinite(num) ? num : null;
}

// A weight to the two decimals the app shows and accepts (165.333 is
// 165.33). Non-finite values are left for validation to refuse.
/** @param {number} value */
function roundWeight(value) {
  return Number.isFinite(value) ? Math.round(value * 100) / 100 : value;
}

// Turns one stored entry into the clean shape the app works with, or null
// when it can't be read at all. Tolerant on purpose: stored data may come
// from any older version of the app.
/**
 * @param {string} date
 * @param {unknown} raw
 * @returns {Entry | null}
 */
function normalizeEntry(date, raw) {
  if (!isValidDateStr(date)) return null;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const obj = /** @type {Record<string, any>} */ (raw);
  const meals = emptyMeals();
  const rawMeals = obj.meals && typeof obj.meals === 'object' && !Array.isArray(obj.meals) ? obj.meals : {};
  for (const key of MEAL_KEYS) meals[key] = normalizeMealValue(rawMeals[key]);
  return { date, weight: normalizeWeight(obj.weight), meals };
}

// Reads a whole stored entries object, keeping every readable day and
// counting (not throwing on) the ones that can't be read.
/**
 * @param {unknown} raw
 * @returns {{ entries: Record<string, Entry>, skipped: number }}
 */
function sanitizeEntries(raw) {
  /** @type {Record<string, Entry>} */
  const entries = {};
  let skipped = 0;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { entries, skipped };
  const obj = /** @type {Record<string, unknown>} */ (raw);
  for (const key of Object.keys(obj)) {
    const entry = normalizeEntry(key, obj[key]);
    if (entry) entries[key] = entry;
    else skipped += 1;
  }
  return { entries, skipped };
}

/** @param {Record<string, unknown> | null | undefined} meals */
function hasMeals(meals) {
  if (!meals) return false;
  return MEAL_KEYS.some((k) => normalizeMealValue(meals[k]) !== null);
}

/** @param {Entry | null | undefined} entry */
function isEntryEmpty(entry) {
  return !entry || (entry.weight === null && !hasMeals(entry.meals));
}

// The day's calorie total, or null when no meal has been logged. A day
// with only a weight is "no calorie data", never "0 calories".
/** @param {Record<string, unknown> | null | undefined} meals @returns {number | null} */
function totalCalories(meals) {
  if (!meals || !hasMeals(meals)) return null;
  let total = 0;
  for (const key of MEAL_KEYS) {
    const v = normalizeMealValue(meals[key]);
    if (v !== null) total += v;
  }
  return total;
}

// Applies a partial update ({ weight?, meals?: { key: value } }) to an
// entry. Only the fields in the patch change, so two screens or tabs
// editing different meals of the same day never overwrite each other.
/**
 * @param {string} date
 * @param {unknown} existing
 * @param {EntryPatch} patch
 * @returns {Entry}
 */
function applyPatch(date, existing, patch) {
  const base = existing ? normalizeEntry(date, existing) : null;
  const next = base || { date, weight: null, meals: emptyMeals() };
  if (patch && Object.prototype.hasOwnProperty.call(patch, 'weight')) next.weight = normalizeWeight(patch.weight);
  if (patch && patch.meals && typeof patch.meals === 'object') {
    for (const key of MEAL_KEYS) {
      if (Object.prototype.hasOwnProperty.call(patch.meals, key)) next.meals[key] = normalizeMealValue(patch.meals[key]);
    }
  }
  return next;
}

/**
 * @param {Entry | null | undefined} entry
 * @returns {Record<string, number | null>} weight, total and each meal
 */
function computeDayStats(entry) {
  /** @type {Record<string, number | null>} */
  const stats = { weight: null, total: null };
  for (const key of MEAL_KEYS) stats[key] = null;
  if (!entry) return stats;
  stats.weight = normalizeWeight(entry.weight);
  stats.total = totalCalories(entry.meals);
  for (const key of MEAL_KEYS) stats[key] = normalizeMealValue(entry.meals && entry.meals[key]);
  return stats;
}

module.exports = {
  MEAL_STEPS,
  MEAL_KEYS,
  emptyMeals,
  normalizeMealValue,
  normalizeWeight,
  roundWeight,
  normalizeEntry,
  sanitizeEntries,
  hasMeals,
  isEntryEmpty,
  totalCalories,
  applyPatch,
  computeDayStats,
};
