// Numbers as Kenna shows them: US English grouping ("1,200"), calories as
// whole numbers and weights in pounds.
'use strict';

const { LOCALE } = require('./dates.js');

/** @type {Record<number, Intl.NumberFormat>} */
const numberFormats = {};
/** @param {number} value @param {number} [maxDecimals] */
function formatNumber(value, maxDecimals) {
  const digits = maxDecimals || 0;
  if (!numberFormats[digits]) {
    numberFormats[digits] = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: digits, minimumFractionDigits: 0 });
  }
  return numberFormats[digits].format(value);
}

/** @param {number} value */
function formatCalories(value) {
  return `${formatNumber(Math.round(value))} cal`;
}

// A logged weight is shown as it was entered (up to two decimals, the
// most the input accepts); averages pass 1 for one decimal.
/** @param {number} value @param {number} [decimals] */
function formatWeight(value, decimals) {
  return `${formatNumber(value, decimals === undefined ? 2 : decimals)} lbs`;
}

module.exports = {
  formatNumber,
  formatCalories,
  formatWeight,
};
