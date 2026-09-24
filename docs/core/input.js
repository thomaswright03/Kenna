// The rules for what can be logged, with the message for anything that
// breaks them: typed into a box, or read from storage or a backup file.

/**
 * @typedef {import('./entries.js').Entry} Entry
 * @typedef {import('./entries.js').EntryPatch} EntryPatch
 * @typedef {{ ok: true, value: number | null } | { ok: false, error: string }} Validation
 */
'use strict';

const { isValidDateStr, formatDate } = require('./dates.js');
const { formatNumber } = require('./numbers.js');
const { MEAL_STEPS, emptyMeals, normalizeMealValue, roundWeight } = require('./entries.js');

const LIMITS = {
  caloriesMin: 0,
  caloriesMax: 10000,
  weightMin: 50,
  weightMax: 1000,
};

const FUTURE_DAY = "You can't log a day that hasn't happened yet.";
const FUTURE_PHOTO = "A photo can't be filed under a day that hasn't happened yet.";

// Validates what the user typed. Returns { ok, value } or { ok: false, error }.
/** @param {unknown} raw @returns {Validation} */
function validateCalories(raw) {
  const text = String(raw === null || raw === undefined ? '' : raw).trim();
  if (text === '') return { ok: true, value: null };
  // "1,200" is read as 1200: commas are fine between groups of thousands.
  const plain = /^\d{1,3}(,\d{3})+$/.test(text) ? text.replace(/,/g, '') : text;
  if (!/^\d+$/.test(plain)) {
    if (/^-\s*\d/.test(text)) return { ok: false, error: "Calories can't be negative. Enter 0 or more." };
    if (/^\d*[.,]\d+$/.test(text)) return { ok: false, error: 'Enter calories as a whole number, like 450, without decimals.' };
    return { ok: false, error: 'Enter calories using digits only, like 450.' };
  }
  const value = Number(plain);
  if (value > LIMITS.caloriesMax) {
    return { ok: false, error: `That's over ${formatNumber(LIMITS.caloriesMax)} calories for one meal. Check the number.` };
  }
  return { ok: true, value };
}

/** @param {unknown} raw @returns {Validation} */
function validateWeight(raw) {
  const typed = String(raw === null || raw === undefined ? '' : raw).trim();
  if (typed === '') return { ok: true, value: null };
  const grouped = /^\d{1,3}(,\d{3})+(\.\d*)?$/.test(typed) ? typed.replace(/,/g, '') : typed;
  // "165." (easy to leave on a decimal keypad) is read as 165.
  const text = /^\d+\.$/.test(grouped) ? grouped.slice(0, -1) : grouped;
  const range = `Enter a weight between ${LIMITS.weightMin} and ${formatNumber(LIMITS.weightMax)} lbs.`;
  if (/^-\s*\d/.test(text)) return { ok: false, error: range };
  if (/^\d*,\d+$/.test(text)) return { ok: false, error: 'Use a period for the decimal point, like 165.2.' };
  if (/^\d*\.\d{3,}$/.test(text)) return { ok: false, error: 'Use at most two decimal places, like 165.25.' };
  if (!/^\d+(\.\d{1,2})?$/.test(text) && !/^\.\d{1,2}$/.test(text)) {
    return { ok: false, error: 'Enter your weight using digits and a decimal point only, like 165.2.' };
  }
  const value = Number(text);
  if (value < LIMITS.weightMin || value > LIMITS.weightMax) return { ok: false, error: range };
  return { ok: true, value };
}

// A number that arrives as data rather than typed (a stored change, a
// backup file) follows exactly the rules for typed input, with the same
// messages: whole calories from 0 to 10,000, and a weight from 50 to
// 1,000 lbs with at most two decimals. Nothing is rounded to fit.
/** @param {unknown} v @returns {Validation} */
function validateCaloriesValue(v) {
  if (v === null || v === undefined) return { ok: true, value: null };
  if (typeof v !== 'number' || !Number.isFinite(v)) return { ok: false, error: 'Enter calories using digits only, like 450.' };
  return validateCalories(String(v));
}

/** @param {unknown} v @returns {Validation} */
function validateWeightValue(v) {
  if (v === null || v === undefined) return { ok: true, value: null };
  if (typeof v !== 'number' || !Number.isFinite(v)) return { ok: false, error: 'Enter your weight using digits and a decimal point only, like 165.2.' };
  return validateWeight(String(v));
}

// What a change the screens never make says (a fault in Kenna itself, so
// it is also noted in the problem log): nothing the user typed was wrong.
const UNREADABLE_CHANGE = "Not saved: Kenna couldn't read this change. Close Kenna completely, open it again and try once more.";

// Checks a change to one day ({ weight?, meals?: { key: calories } }),
// as the phone's storage applies it. A value outside the rules says what
// to type instead; a change of any other shape is Kenna's own fault
// (`fault: true`).
/**
 * @param {any} body
 * @returns {{ ok: true, patch: EntryPatch } | { ok: false, error: string, fault?: true }}
 */
function validatePatch(body) {
  /** @type {{ ok: false, error: string, fault: true }} */
  const unreadable = { ok: false, error: UNREADABLE_CHANGE, fault: true };
  if (!body || typeof body !== 'object' || Array.isArray(body)) return unreadable;
  if (Object.keys(body).some((key) => key !== 'weight' && key !== 'meals')) return unreadable;
  /** @type {EntryPatch} */
  const patch = {};
  if (Object.prototype.hasOwnProperty.call(body, 'weight')) {
    const checked = validateWeightValue(body.weight);
    if (!checked.ok) return { ok: false, error: `Weight not saved. ${checked.error}` };
    patch.weight = checked.value;
  }
  if (body.meals !== undefined) {
    if (!body.meals || typeof body.meals !== 'object' || Array.isArray(body.meals)) return unreadable;
    /** @type {Record<string, number | null>} */
    const meals = {};
    for (const key of Object.keys(body.meals)) {
      const step = MEAL_STEPS.find((m) => m.key === key);
      if (!step) return unreadable;
      const checked = validateCaloriesValue(body.meals[key]);
      if (!checked.ok) return { ok: false, error: `${step.label} not saved. ${checked.error}` };
      meals[key] = checked.value;
    }
    patch.meals = meals;
  }
  return { ok: true, patch };
}

// Checks one incoming entry (from a backup file) strictly, by the same
// rules as typed input. Returns { ok, entry } or { ok: false, error }
// naming the day, the meal and the problem. Meals stored by the first
// version as lists of foods are read as their total, as always.
/**
 * @param {string} date
 * @param {any} raw
 * @returns {{ ok: true, entry: Entry } | { ok: false, error: string }}
 */
function validateIncomingEntry(date, raw) {
  if (!isValidDateStr(date)) return { ok: false, error: `"${String(date).slice(0, 40)}" isn't a real date.` };
  const when = formatDate(date, date);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: `The entry for ${when} isn't in the expected format.` };
  }
  if (raw.date !== undefined && raw.date !== date) {
    return { ok: false, error: `The entry for ${when} is labelled with a different date.` };
  }
  if (!raw.meals || typeof raw.meals !== 'object' || Array.isArray(raw.meals)) {
    return { ok: false, error: `The entry for ${when} has no meals section.` };
  }
  const meals = emptyMeals();
  for (const step of MEAL_STEPS) {
    const v = raw.meals[step.key];
    if (v === null || v === undefined) continue;
    if (Array.isArray(v)) {
      const valid = v.every((f) => f && typeof f === 'object' && Number.isFinite(Number(f.calories)));
      if (!valid) return { ok: false, error: `${step.label} on ${when} isn't in the expected format.` };
      const total = normalizeMealValue(v);
      const checked = validateCaloriesValue(total);
      if (!checked.ok) return { ok: false, error: `${step.label} on ${when} (${String(total)} cal): ${checked.error}` };
      meals[step.key] = checked.value;
      continue;
    }
    if (typeof v !== 'number') return { ok: false, error: `${step.label} on ${when} isn't a number.` };
    const checked = validateCaloriesValue(v);
    if (!checked.ok) return { ok: false, error: `${step.label} on ${when} (${String(v).slice(0, 20)}): ${checked.error}` };
    meals[step.key] = checked.value;
  }
  let weight = null;
  if (raw.weight !== null && raw.weight !== undefined) {
    // The first version saved weights exactly as typed; a backup from
    // then may hold more than two decimals. They're read as the app shows
    // them, rounded to two, the same rounding a backup is written with.
    const checked = validateWeightValue(typeof raw.weight === 'number' ? roundWeight(raw.weight) : raw.weight);
    if (!checked.ok) return { ok: false, error: `The weight on ${when} (${String(raw.weight).slice(0, 20)}): ${checked.error}` };
    weight = checked.value;
  }
  return { ok: true, entry: { date, weight, meals } };
}

module.exports = {
  LIMITS,
  FUTURE_DAY,
  FUTURE_PHOTO,
  validateCalories,
  validateWeight,
  validateCaloriesValue,
  validateWeightValue,
  validatePatch,
  validateIncomingEntry,
};
