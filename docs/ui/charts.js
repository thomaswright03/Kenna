// The card with the Calories and Weight line charts and their shared
// 30 days / 90 days / All range picker. Each chart is drawn by
// chart-draw.js.

import { core, h, prefs, today } from './dom.js';
import { drawChart } from './chart-draw.js';

/** @typedef {import('./chart-draw.js').SeriesInfo} SeriesInfo */

const RANGES = [
  { key: '30', label: '30 days', days: 30 },
  { key: '90', label: '90 days', days: 90 },
  { key: 'all', label: 'All', days: null },
];

/** @type {Set<() => void>} */
const activeCharts = new Set();
/** @type {ReturnType<typeof setTimeout> | undefined} */
let resizeTimer;
let lastWidth = window.innerWidth;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (window.innerWidth === lastWidth) return;
    lastWidth = window.innerWidth;
    activeCharts.forEach((redraw) => redraw());
  }, 150);
});

/**
 * A card with the Calories and Weight charts and a shared range picker.
 * `smoothing` plots the 7-day rolling average instead of daily values.
 * @param {{ title: string, entries: Record<string, import('../core.js').Entry>, smoothing: boolean, footer?: HTMLElement }} options
 * @returns {{ root: HTMLElement, draw: () => void }}
 */
export function buildChartsCard({ title, entries, smoothing, footer }) {
  const rows = core.buildDailyRows(entries);
  const now = today();
  let rangeKey = prefs.get('chartRange', '30');
  if (!RANGES.some((r) => r.key === rangeKey)) rangeKey = '30';

  /** @type {SeriesInfo[]} */
  const infos = [
    {
      field: 'calories',
      title: 'Calories',
      unit: 'cal',
      sub: smoothing ? '7-day average of daily intake, not counting today until it’s over' : 'Total intake each day; today’s is so far',
      partialDay: smoothing ? null : now,
    },
    { field: 'weight', title: 'Weight', unit: 'lbs', sub: smoothing ? '7-day average weight' : 'Weight each day', averaged: smoothing },
  ];
  // A daily chart plots each day (today's calories as "so far"), a trend
  // chart the 7-day average. Weekly and monthly averages, for a long range,
  // are of the finished days: today's calories aren't counted until the
  // day is over.
  const series = infos.map((s) => {
    const settled = core.seriesFromRows(rows, s.field).filter((p) => (s.field === 'calories' ? p.date < now : p.date <= now));
    const points = smoothing ? core.rollingAverage(settled, 7) : core.seriesFromRows(rows, s.field);
    return { ...s, data: { points, settled }, host: h('div', { class: 'chart' }) };
  });

  const buttons = RANGES.map((r) =>
    h('button', {
      type: 'button',
      class: 'segment',
      'data-range': r.key,
      'aria-pressed': r.key === rangeKey ? 'true' : 'false',
      text: r.label,
      onClick: () => {
        rangeKey = r.key;
        prefs.set('chartRange', r.key);
        buttons.forEach((b) => b.setAttribute('aria-pressed', b.dataset.range === r.key ? 'true' : 'false'));
        draw();
      },
    })
  );

  function draw() {
    const range = RANGES.find((r) => r.key === rangeKey) || RANGES[0];
    for (const s of series) drawChart(s.host, s.data, { ...s, rangeDays: range.days });
  }

  const root = h(
    'section',
    { class: 'card' },
    h(
      'div',
      { class: 'card-head' },
      h('h2', { class: 'card-title', text: title }),
      h('div', { class: 'segmented', role: 'group', 'aria-label': 'Chart range' }, buttons)
    ),
    ...series.map((s) => s.host),
    footer || null
  );

  return {
    root,
    draw: () => {
      activeCharts.clear();
      activeCharts.add(draw);
      draw();
    },
  };
}
