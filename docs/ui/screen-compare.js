// Compare: today next to yesterday and the all-time average, then 7-day
// rolling averages.

import { core, h, MEAL_STEPS, today } from './dom.js';
import { store } from './store.js';
import { buildChartsCard } from './charts.js';

/**
 * @typedef {'cal' | 'lbs'} Unit
 * @typedef {{ key: string, label: string, unit: Unit, empty: string, emptyToday: string, optional?: boolean }} Metric
 */

// Weights logged on a day are shown as entered (up to two decimals);
// averages, and differences from them, to one.
/** @param {number} value @param {Unit} unit @param {number} [decimals] */
function formatMetric(value, unit, decimals) {
  return unit === 'lbs' ? core.formatWeight(value, decimals) : core.formatCalories(value);
}

/** @param {number} diff @param {Unit} unit @param {number} decimals */
function formatDelta(diff, unit, decimals) {
  const scale = 10 ** decimals;
  const rounded = unit === 'lbs' ? Math.round(diff * scale) / scale : Math.round(diff);
  const arrow = rounded > 0 ? '▲' : rounded < 0 ? '▼' : '=';
  const sign = rounded > 0 ? '+' : rounded < 0 ? '−' : '';
  return `${arrow} ${sign}${formatMetric(Math.abs(rounded), unit, decimals)}`;
}

// Bars show each day's difference from the all-time average (the line down
// the middle of each track): right of it is above average, left below. The
// scale is set by the largest difference shown, but never finer than these,
// so a trivial difference doesn't look dramatic.
/** @type {Record<Unit, number>} */
const MIN_SCALE = { lbs: 1, cal: 100 };

/**
 * @param {{ label: string, value: number | null, unit: Unit, decimals: number, isToday: boolean, emptyText: string, baseline: number | null, scale: number, isBaseline?: boolean }} row
 */
function compareRow(row) {
  const el = h('div', { class: `compare-row${row.isToday ? ' is-today' : ''}` }, h('div', { class: 'compare-cat', text: row.label }));
  if (row.value === null || row.value === undefined) {
    el.append(h('div', { class: 'compare-empty', text: row.emptyText }));
    return el;
  }
  const track = h('div', { class: `compare-track${row.baseline === null ? ' is-plain' : ''}`, 'aria-hidden': 'true' });
  if (row.baseline !== null && !row.isBaseline) {
    const diff = row.value - row.baseline;
    const pct = Math.min(50, (Math.abs(diff) / row.scale) * 50);
    if (pct > 0) {
      const side = diff > 0 ? 'is-above' : 'is-below';
      track.append(h('div', { class: `compare-bar ${side}${row.isToday ? ' is-today' : ''}`, style: `width:${Math.max(pct, 1.5)}%` }));
    }
  }
  el.append(track, h('div', { class: 'compare-value', text: formatMetric(row.value, row.unit, row.decimals) }));
  return el;
}

/**
 * @param {Metric} metric
 * @param {number | null} t today
 * @param {number | null} y yesterday
 * @param {number | null} avg all-time average
 * @param {boolean} withCaption false when there's no earlier day: only today's value is shown
 */
function compareMetric(metric, t, y, avg, withCaption) {
  const baseline = withCaption ? avg : null;
  const diffs = [t, y].filter((v) => v !== null && v !== undefined && baseline !== null).map((v) => Math.abs(Number(v) - Number(baseline)));
  const scale = Math.max(MIN_SCALE[metric.unit], ...diffs);
  const parts = [];
  if (t !== null && y !== null) parts.push(`${formatDelta(t - y, metric.unit, 2)} vs yesterday`);
  if (t !== null && avg !== null) parts.push(`${formatDelta(t - avg, metric.unit, 1)} vs average`);
  // Today's calories are still being logged, so they're compared as "so far".
  const partial = metric.unit === 'cal';
  let caption = parts.length ? `${partial ? 'So far today: ' : ''}${parts.join(' · ')}` : '';
  if (!caption) caption = t === null ? `${metric.emptyToday} yet today.` : 'Not enough history to compare yet.';
  const common = { unit: metric.unit, emptyText: metric.empty, baseline, scale };
  return h(
    'div',
    { class: 'compare-metric' },
    h('h3', { class: 'compare-label', text: metric.label }),
    compareRow({ ...common, label: partial ? 'Today so far' : 'Today', value: t, decimals: 2, isToday: true }),
    withCaption ? compareRow({ ...common, label: 'Yesterday', value: y, decimals: 2, isToday: false }) : null,
    withCaption ? compareRow({ ...common, label: 'All-time avg', value: avg, decimals: 1, isToday: false, isBaseline: true }) : null,
    withCaption ? h('p', { class: 'compare-caption', text: caption }) : null
  );
}

/** @type {import('./render.js').ScreenBuilder} */
export async function buildCompare() {
  const now = today();
  const entries = await store.loadEntries();
  /** @type {Record<string, number | null>} */
  const todayStats = core.computeDayStats(entries[now]);
  /** @type {Record<string, number | null>} */
  const yStats = core.computeDayStats(entries[core.shiftDate(now, -1)]);
  /** @type {Record<string, number | null>} */
  const avgs = core.computeAllTimeAverages(entries, now);
  /** @type {Metric[]} */
  const metrics = [
    { key: 'weight', label: 'Weight', unit: 'lbs', empty: 'No weight logged', emptyToday: 'No weight logged' },
    { key: 'total', label: 'Total calories', unit: 'cal', empty: 'No meals logged', emptyToday: 'No meals logged' },
    ...MEAL_STEPS.map((m) => /** @type {Metric} */ ({ key: m.key, label: m.label, unit: 'cal', empty: 'Not logged', emptyToday: `${m.label} not logged`, optional: true })),
  ];
  // Before there's an earlier day, one explanation replaces the same
  // "nothing to compare" line under every metric.
  const earlier = Object.values(entries).some((e) => e.date < now && !core.isEntryEmpty(e));
  const loggedToday = !core.isEntryEmpty(entries[now]);
  const card = h(
    'section',
    { class: 'card' },
    h('h2', { class: 'card-title', text: 'Compare' }),
    h('p', {
      class: 'card-sub',
      text: `Today (${core.formatDate(now, now)}) against yesterday and your all-time average. Bars run from the average (the middle line): right is above it, left is below. Averages leave out today and days with nothing logged.`,
    })
  );
  if (!earlier) {
    card.append(
      h('p', {
        class: 'inline-note compare-first',
        text: loggedToday
          ? 'Log a few more days to see how today compares.'
          : "Nothing logged yet. Log today's weight and meals, then come back over the next few days to see how each day compares.",
      })
    );
  }
  if (earlier || loggedToday) {
    card.append(
      ...metrics
        .filter((m) => !m.optional || [todayStats[m.key], yStats[m.key], avgs[m.key]].some((v) => v !== null))
        .map((m) => compareMetric(m, todayStats[m.key], yStats[m.key], avgs[m.key], earlier))
    );
  }
  const neverLogged = metrics.filter((m) => m.optional && [todayStats[m.key], yStats[m.key], avgs[m.key]].every((v) => v === null));
  if (earlier && neverLogged.length) {
    card.append(h('p', { class: 'compare-caption', text: `Never logged, so nothing to compare: ${neverLogged.map((m) => m.label).join(', ')}.` }));
  }
  const trends = buildChartsCard({ title: 'Trends', entries, smoothing: true });
  return { title: 'Compare', root: h('div', { class: 'screen-stack' }, card, trends.root), mounted: trends.draw };
}
