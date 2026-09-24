// Compare: today next to yesterday and the all-time average, then 7-day
// rolling averages.

import { core, h, MEAL_STEPS, today } from './dom.js';
import { store } from './store.js';
import { buildChartsCard } from './charts.js';

/**
 * @typedef {'cal' | 'lbs'} Unit
 * @typedef {{ key: string, label: string, unit: Unit, empty: string, emptyToday: string, optional?: boolean }} Metric
 */

/** @param {number} value @param {Unit} unit */
function formatMetric(value, unit) {
  return unit === 'lbs' ? core.formatWeight(value) : core.formatCalories(value);
}

/** @param {number} diff @param {Unit} unit */
function formatDelta(diff, unit) {
  const rounded = unit === 'lbs' ? Math.round(diff * 10) / 10 : Math.round(diff);
  const arrow = rounded > 0 ? '▲' : rounded < 0 ? '▼' : '=';
  const sign = rounded > 0 ? '+' : rounded < 0 ? '−' : '';
  return `${arrow} ${sign}${formatMetric(Math.abs(rounded), unit)}`;
}

/**
 * @param {string} catLabel
 * @param {number | null} value
 * @param {Unit} unit
 * @param {number} maxVal
 * @param {boolean} isToday
 * @param {string} emptyText
 */
function compareRow(catLabel, value, unit, maxVal, isToday, emptyText) {
  const row = h('div', { class: `compare-row${isToday ? ' is-today' : ''}` }, h('div', { class: 'compare-cat', text: catLabel }));
  if (value === null || value === undefined) {
    row.append(h('div', { class: 'compare-empty', text: emptyText }));
    return row;
  }
  const pct = maxVal > 0 ? Math.max((value / maxVal) * 100, value > 0 ? 3 : 0) : 0;
  row.append(
    h('div', { class: 'compare-track' }, h('div', { class: `compare-bar${isToday ? ' is-today' : ''}`, style: `width:${pct}%` })),
    h('div', { class: 'compare-value', text: formatMetric(value, unit) })
  );
  return row;
}

/**
 * @param {Metric} metric
 * @param {number | null} t today
 * @param {number | null} y yesterday
 * @param {number | null} avg all-time average
 */
function compareMetric(metric, t, y, avg) {
  const values = [t, y, avg].filter((v) => v !== null && v !== undefined);
  const maxVal = values.length ? Math.max(...values, 0) : 0;
  const parts = [];
  if (t !== null && y !== null) parts.push(`${formatDelta(t - y, metric.unit)} vs yesterday`);
  if (t !== null && avg !== null) parts.push(`${formatDelta(t - avg, metric.unit)} vs average`);
  let caption = parts.join(' · ');
  if (!caption) caption = t === null ? `${metric.emptyToday} yet today.` : 'Not enough history to compare yet.';
  return h(
    'div',
    { class: 'compare-metric' },
    h('h3', { class: 'compare-label', text: metric.label }),
    compareRow('Today', t, metric.unit, maxVal, true, metric.empty),
    compareRow('Yesterday', y, metric.unit, maxVal, false, metric.empty),
    compareRow('All-time avg', avg, metric.unit, maxVal, false, metric.empty),
    h('p', { class: 'compare-caption', text: caption })
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
  const card = h(
    'section',
    { class: 'card' },
    h('h2', { class: 'card-title', text: 'Compare' }),
    h('p', {
      class: 'card-sub',
      text: `Today (${core.formatDate(now, now)}) against yesterday and your all-time average. Averages leave out today and days with nothing logged.`,
    }),
    ...metrics
      .filter((m) => !m.optional || [todayStats[m.key], yStats[m.key], avgs[m.key]].some((v) => v !== null))
      .map((m) => compareMetric(m, todayStats[m.key], yStats[m.key], avgs[m.key]))
  );
  const neverLogged = metrics.filter((m) => m.optional && [todayStats[m.key], yStats[m.key], avgs[m.key]].every((v) => v === null));
  if (neverLogged.length) {
    card.append(h('p', { class: 'compare-caption', text: `Never logged, so nothing to compare: ${neverLogged.map((m) => m.label).join(', ')}.` }));
  }
  const trends = buildChartsCard({ title: 'Trends', entries, smoothing: true });
  return { title: 'Compare', root: h('div', { class: 'screen-stack' }, card, trends.root), mounted: trends.draw };
}
