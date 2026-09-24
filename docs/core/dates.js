// Dates are plain "YYYY-MM-DD" strings in the user's local calendar. Date
// arithmetic goes through UTC so daylight-saving changes can never make a
// "day" 23 or 25 hours long and skip or repeat a date. Dates are written
// the US English way ("Thu, Sep 24").
'use strict';

const LOCALE = 'en-US';
const DAY_MS = 24 * 60 * 60 * 1000;

/** @param {number} n */
const pad = (n) => String(n).padStart(2, '0');

/** @param {Date} d */
function localDateStr(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** @param {Date} [now] */
function todayStr(now) {
  return localDateStr(now || new Date());
}

/** @param {unknown} str @returns {{ y: number, m: number, d: number } | null} */
function parseDateStr(str) {
  if (typeof str !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (y < 1900 || y > 2999 || mo < 1 || mo > 12 || d < 1) return null;
  const utc = new Date(Date.UTC(y, mo - 1, d));
  if (utc.getUTCMonth() !== mo - 1 || utc.getUTCDate() !== d) return null;
  return { y, m: mo, d };
}

/** @param {unknown} str @returns {str is string} */
function isValidDateStr(str) {
  return parseDateStr(str) !== null;
}

/** @param {string} str */
function dayNumber(str) {
  const p = parseDateStr(str);
  if (!p) return NaN;
  return Date.UTC(p.y, p.m - 1, p.d) / DAY_MS;
}

/** @param {number} n */
function dateFromDayNumber(n) {
  const d = new Date(n * DAY_MS);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/**
 * True when `date` is after `today` (both YYYY-MM-DD).
 * @param {string} date
 * @param {string} [today]
 */
function isFutureDate(date, today) {
  return date > (today || todayStr());
}

/** @param {string} str @param {number} days */
function shiftDate(str, days) {
  return dateFromDayNumber(dayNumber(str) + days);
}

/** @param {string} a @param {string} b */
function daysBetween(a, b) {
  return dayNumber(b) - dayNumber(a);
}

const shortDayFmt = new Intl.DateTimeFormat(LOCALE, { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
const shortDayYearFmt = new Intl.DateTimeFormat(LOCALE, {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  timeZone: 'UTC',
});
const monthYearFmt = new Intl.DateTimeFormat(LOCALE, { month: 'long', year: 'numeric', timeZone: 'UTC' });
const monthDayFmt = new Intl.DateTimeFormat(LOCALE, { month: 'short', day: 'numeric', timeZone: 'UTC' });
const monthDayYearFmt = new Intl.DateTimeFormat(LOCALE, { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

/** @param {string} str */
function utcDate(str) {
  return new Date(dayNumber(str) * DAY_MS);
}

// "Thu, Sep 24" (with the year when it isn't the current one).
/** @param {string} str @param {string} [today] */
function formatDate(str, today) {
  if (!isValidDateStr(str)) return 'Unknown date';
  const ref = today || todayStr();
  const sameYear = str.slice(0, 4) === ref.slice(0, 4);
  return (sameYear ? shortDayFmt : shortDayYearFmt).format(utcDate(str));
}

// "Today", "Yesterday" or "Thu, Sep 24".
/** @param {string} str @param {string} [today] */
function formatRelativeDate(str, today) {
  const ref = today || todayStr();
  if (str === ref) return 'Today';
  if (str === shiftDate(ref, -1)) return 'Yesterday';
  return formatDate(str, ref);
}

// "Sep 24" — for chart axes, where space is tight.
/** @param {string} str @param {boolean} [withYear] */
function formatMonthDay(str, withYear) {
  if (!isValidDateStr(str)) return '';
  return (withYear ? monthDayYearFmt : monthDayFmt).format(utcDate(str));
}

// "September 2026", for a "YYYY-MM" month or any day in it.
/** @param {string} str */
function formatMonth(str) {
  const day = `${String(str).slice(0, 7)}-01`;
  return isValidDateStr(day) ? monthYearFmt.format(utcDate(day)) : 'Unknown month';
}

// A day more than a year ago that is also well before the first day
// logged is most likely a mistyped year (2002 for 2026), so the app asks
// before logging it. Days that already have data never ask.
const FAR_BACK = { YEAR_DAYS: 365, BEFORE_FIRST_DAYS: 30 };

/**
 * @param {string} date
 * @param {string} today
 * @param {string | null} firstLogged the earliest day with data, if any
 */
function isFarBack(date, today, firstLogged) {
  if (!isValidDateStr(date)) return false;
  if (date >= shiftDate(today, -FAR_BACK.YEAR_DAYS)) return false;
  return !firstLogged || date < shiftDate(firstLogged, -FAR_BACK.BEFORE_FIRST_DAYS);
}

/** Whole years from `date` to `today`, for "36 years ago". @param {string} date @param {string} today */
function yearsBetween(date, today) {
  const a = parseDateStr(date);
  const b = parseDateStr(today);
  if (!a || !b) return 0;
  let years = b.y - a.y;
  if (b.m < a.m || (b.m === a.m && b.d < a.d)) years -= 1;
  return years;
}

module.exports = {
  FAR_BACK,
  LOCALE,
  DAY_MS,
  todayStr,
  localDateStr,
  isValidDateStr,
  dayNumber,
  dateFromDayNumber,
  shiftDate,
  isFutureDate,
  daysBetween,
  formatDate,
  formatRelativeDate,
  formatMonthDay,
  formatMonth,
  isFarBack,
  yearsBetween,
};
