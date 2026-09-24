// Chart maths: when to plot weekly or monthly averages, the averages
// themselves, and the value and date axes.
'use strict';

const { DAY_MS, dayNumber, dateFromDayNumber, formatMonthDay, formatMonth } = require('./dates.js');

// Over a long range, one point a day turns a line chart into a solid
// band, so it plots an average per week (up to about three years, at
// most 160 points) or per calendar month beyond that.
const CHART_PERIODS = { DAILY_UP_TO_DAYS: 120, WEEKLY_UP_TO_DAYS: 160 * 7 };

/** @param {number} spanDays days the chart covers @returns {'day' | 'week' | 'month'} */
function chartPeriod(spanDays) {
  if (spanDays <= CHART_PERIODS.DAILY_UP_TO_DAYS) return 'day';
  return spanDays <= CHART_PERIODS.WEEKLY_UP_TO_DAYS ? 'week' : 'month';
}

/**
 * The first day (day number) of the week (Sunday to Saturday) or month
 * that `day` is in.
 * @param {number} day
 * @param {'week' | 'month'} period
 */
function periodStart(day, period) {
  const d = new Date(day * DAY_MS);
  if (period === 'week') return day - d.getUTCDay();
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) / DAY_MS;
}

/** The last day of the period starting on `start`. @param {number} start @param {'week' | 'month'} period */
function periodEnd(start, period) {
  if (period === 'week') return start + 6;
  const d = new Date(start * DAY_MS);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) / DAY_MS - 1;
}

/**
 * The average of the values logged in each week or month (only periods
 * with at least one value), oldest first. `start` and `end` are day
 * numbers; `count` is how many days the average is of.
 * @param {{ date: string, value: number }[]} points oldest first
 * @param {'week' | 'month'} period
 * @returns {{ start: number, end: number, value: number, count: number }[]}
 */
function periodAverages(points, period) {
  /** @type {{ start: number, end: number, value: number, count: number }[]} */
  const out = [];
  let sum = 0;
  for (const p of points) {
    const start = periodStart(dayNumber(p.date), period);
    const last = out[out.length - 1];
    if (last && last.start === start) {
      sum += p.value;
      last.count += 1;
      last.value = sum / last.count;
    } else {
      sum = p.value;
      out.push({ start, end: periodEnd(start, period), value: p.value, count: 1 });
    }
  }
  return out;
}

/**
 * "Week of Sep 20" or "September 2026".
 * @param {number} start the period's first day (day number)
 * @param {'week' | 'month'} period
 * @param {boolean} [withYear] for a week
 */
function formatPeriod(start, period, withYear) {
  const date = dateFromDayNumber(start);
  return period === 'week' ? `Week of ${formatMonthDay(date, withYear)}` : formatMonth(date);
}

// The least a chart's value axis covers: 2 lbs of weight, and 200 cal
// or a fifth of the value of calories, whichever is more.
/** @param {'cal' | 'lbs'} unit @param {number} max the largest value shown */
function axisMinSpan(unit, max) {
  return unit === 'lbs' ? 2 : Math.max(200, Math.abs(max) * 0.2);
}

/** @param {number} range @param {boolean} round */
function niceNum(range, round) {
  const exponent = Math.floor(Math.log10(range));
  const fraction = range / Math.pow(10, exponent);
  let nice;
  if (round) {
    if (fraction < 1.5) nice = 1;
    else if (fraction < 3) nice = 2;
    else if (fraction < 7) nice = 5;
    else nice = 10;
  } else if (fraction <= 1) nice = 1;
  else if (fraction <= 2) nice = 2;
  else if (fraction <= 5) nice = 5;
  else nice = 10;
  return nice * Math.pow(10, exponent);
}

// Evenly spaced, unique axis ticks covering [min, max], plus how many
// decimals the step needs (a 0.5 step shows 149.5, 150, 150.5, ...).
// `floor` is the lowest value the axis may show (0 for calories, which
// can't be negative). `minSpan` is the least the axis covers, centred on
// the data, so one day, or days that barely differ, don't fill the chart
// as if they were a dramatic change.
/**
 * @param {number} min
 * @param {number} max
 * @param {number} [count]
 * @param {number} [minStep]
 * @param {number} [floor]
 * @param {number} [minSpan]
 * @returns {{ ticks: number[], decimals: number }}
 */
function niceTicks(min, max, count, minStep, floor, minSpan) {
  let lo = min;
  let hi = max;
  if (minSpan && hi - lo < minSpan) {
    const mid = (lo + hi) / 2;
    lo = mid - minSpan / 2;
    hi = mid + minSpan / 2;
  }
  const floorStep = minStep || 0;
  if (hi - lo < floorStep * 2 || lo === hi) {
    const mid = (lo + hi) / 2;
    const half = Math.max(floorStep * 2, Math.abs(mid) * 0.01, 1) / 2;
    lo = mid - half;
    hi = mid + half;
  }
  if (floor !== undefined && lo < floor) {
    hi += floor - lo;
    lo = floor;
  }
  const range = niceNum(hi - lo, false);
  let step = niceNum(range / Math.max(1, (count || 5) - 1), true);
  if (step < floorStep) step = floorStep;
  const decimals = Math.max(0, -Math.floor(Math.log10(step) + 1e-9));
  let start = Math.floor(lo / step + 1e-9) * step;
  if (floor !== undefined && start < floor) start = Math.ceil(floor / step - 1e-9) * step;
  const end = Math.ceil(hi / step - 1e-9) * step;
  const ticks = [];
  for (let i = 0; start + i * step <= end + step / 2; i += 1) {
    ticks.push(Number((start + i * step).toFixed(decimals)));
  }
  return { ticks, decimals };
}

/**
 * Evenly spaced date labels for a chart's time axis, from `startDay` to
 * `endDay` (day numbers). When the range crosses into another year every
 * label carries its year, so each can be placed in time.
 * @param {number} startDay
 * @param {number} endDay
 * @param {number} maxLabels
 * @returns {{ day: number, text: string }[]}
 */
function dateAxisLabels(startDay, endDay, maxLabels) {
  const span = Math.max(1, endDay - startDay);
  const count = Math.max(2, Math.min(maxLabels, span + 1));
  const withYear = dateFromDayNumber(startDay).slice(0, 4) !== dateFromDayNumber(endDay).slice(0, 4);
  const labels = [];
  for (let k = 0; k < count; k += 1) {
    const day = Math.round(startDay + (k * span) / (count - 1));
    labels.push({ day, text: formatMonthDay(dateFromDayNumber(day), withYear) });
  }
  return labels;
}

module.exports = {
  CHART_PERIODS,
  chartPeriod,
  periodAverages,
  formatPeriod,
  axisMinSpan,
  niceTicks,
  dateAxisLabels,
};
