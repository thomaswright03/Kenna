// Numbers as Kenna shows them: US English grouping ("1,200"), calories as
// whole numbers and weights in pounds.
'use strict';

const { LOCALE } = require('./dates.js');

/** @type {Record<string, Intl.NumberFormat>} */
const numberFormats = {};
/**
 * @param {number} value
 * @param {number} [maxDecimals] at most this many decimals (0 when omitted)
 * @param {number} [minDecimals] at least this many (0 when omitted): 1 keeps "166.0"
 */
function formatNumber(value, maxDecimals, minDecimals) {
  const most = maxDecimals || 0;
  const least = Math.min(minDecimals || 0, most);
  const key = `${most}.${least}`;
  if (!numberFormats[key]) {
    numberFormats[key] = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: most, minimumFractionDigits: least });
  }
  return numberFormats[key].format(value);
}

/** @param {number} value */
function formatCalories(value) {
  return `${formatNumber(Math.round(value))} cal`;
}

// A logged weight is shown as it was entered (up to two decimals, the
// most the input accepts).
/** @param {number} value @param {number} [decimals] at most this many (2 when omitted) */
function formatWeight(value, decimals) {
  return `${formatNumber(value, decimals === undefined ? 2 : decimals)} lbs`;
}

// An average weight, or a difference from one, always to one decimal, so
// "166.0 lbs" sits beside "164.3 lbs" rather than "166 lbs".
/** @param {number} value */
function formatAverageWeight(value) {
  return `${formatNumber(value, 1, 1)} lbs`;
}

// Weights shown together (in one sentence, line or list) are all written
// with the same number of decimals: one, or two when any logged weight
// among them has two. So a weight of 171 beside an average of 171 reads
// "171.0 lbs" twice, and 165.25 is never rounded to 165.3.
/**
 * @param {(number | null | undefined)[]} logged the logged weights shown together (averages don't count: they're rounded to fit)
 * @returns {1 | 2}
 */
function sharedWeightDecimals(logged) {
  return logged.some((v) => typeof v === 'number' && Math.round(v * 100) % 10 !== 0) ? 2 : 1;
}

/**
 * A formatter for weights shown together (see sharedWeightDecimals).
 * @param {(number | null | undefined)[]} logged
 * @returns {{ decimals: 1 | 2, format: (value: number) => string }}
 */
function weightFormatFor(logged) {
  const decimals = sharedWeightDecimals(logged);
  return { decimals, format: (value) => `${formatNumber(value, decimals, decimals)} lbs` };
}

module.exports = {
  formatNumber,
  formatCalories,
  formatWeight,
  formatAverageWeight,
  weightFormatFor,
};
