// Calories and Weight line charts with a shared 30 days / 90 days / All
// range picker.

import { core, h, svg, prefs, today } from './dom.js';

/**
 * @typedef {{ date: string, value: number }} Point
 * @typedef {{ field: 'calories' | 'weight', title: string, unit: 'cal' | 'lbs', sub: string }} SeriesInfo
 */

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
  let rangeKey = prefs.get('chartRange', '30');
  if (!RANGES.some((r) => r.key === rangeKey)) rangeKey = '30';

  /** @type {SeriesInfo[]} */
  const infos = [
    { field: 'calories', title: 'Calories', unit: 'cal', sub: smoothing ? '7-day average of daily intake' : 'Total intake each day' },
    { field: 'weight', title: 'Weight', unit: 'lbs', sub: smoothing ? '7-day average weight' : 'Weight each day' },
  ];
  const series = infos.map((s) => {
    const daily = core.seriesFromRows(rows, s.field);
    return { ...s, points: smoothing ? core.rollingAverage(daily, 7) : daily, host: h('div', { class: 'chart' }) };
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
    for (const s of series) drawChart(s.host, s.points, { ...s, rangeDays: range.days });
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

/**
 * Line chart with a real time axis: each point sits at its calendar date, so
 * days without data show as gaps (dashed where the line bridges them). It
 * always ends at today, so the latest data is what's on screen.
 * @param {HTMLElement} host
 * @param {Point[]} points
 * @param {SeriesInfo & { rangeDays: number | null }} opts
 */
function drawChart(host, points, opts) {
  const now = today();
  const endDay = core.dayNumber(now);
  const firstDay = points.length ? core.dayNumber(points[0].date) : endDay;
  const startDay = opts.rangeDays ? endDay - opts.rangeDays + 1 : Math.min(firstDay, endDay - 6);
  const visible = points.filter((p) => {
    const d = core.dayNumber(p.date);
    return d >= startDay && d <= endDay;
  });
  /** @param {number} v */
  const fmt = (v) => (opts.unit === 'lbs' ? core.formatWeight(v) : core.formatCalories(v));

  const latest = visible[visible.length - 1];
  const head = h(
    'div',
    { class: 'chart-head' },
    h('div', null, h('h3', { class: 'chart-title', text: opts.title }), h('p', { class: 'chart-sub', text: opts.sub })),
    latest
      ? h(
          'div',
          { class: `chart-latest series-${opts.field}` },
          h('span', { text: fmt(latest.value) }),
          h('span', { class: 'chart-latest-date', text: core.formatRelativeDate(latest.date, now) })
        )
      : null
  );
  host.replaceChildren(head);

  if (visible.length === 0) {
    host.append(
      h('p', {
        class: 'empty-hint',
        text: points.length === 0 ? 'Nothing logged yet.' : `Nothing logged in the last ${opts.rangeDays} days. Choose All to see older data.`,
      })
    );
    return;
  }

  const width = Math.max(260, host.clientWidth || 320);
  const height = 220;
  const values = visible.map((p) => p.value);
  const { ticks, decimals } = core.niceTicks(Math.min(...values), Math.max(...values), 5, opts.unit === 'lbs' ? 0.1 : 1);
  const tickText = ticks.map((t) => core.formatNumber(t, decimals));
  const leftPad = 12 + Math.max(...tickText.map((t) => t.length)) * 7.5;
  const rightPad = 12;
  const topPad = 12;
  const bottomPad = 28;
  const plotW = width - leftPad - rightPad;
  const plotH = height - topPad - bottomPad;
  const yMin = ticks[0];
  const yMax = ticks[ticks.length - 1];
  const span = Math.max(1, endDay - startDay);
  /** @param {number} day */
  const x = (day) => leftPad + ((day - startDay) / span) * plotW;
  /** @param {number} v */
  const y = (v) => topPad + plotH - ((v - yMin) / (yMax - yMin || 1)) * plotH;

  const summary = `${opts.title} chart, ${opts.rangeDays ? `last ${opts.rangeDays} days` : 'all time'}: ${visible.length} day${
    visible.length === 1 ? '' : 's'
  } with data, latest ${fmt(latest.value)} on ${core.formatDate(latest.date, now)}. Use the arrow keys to read each point.`;
  const chart = svg('svg', {
    class: `chart-svg series-${opts.field}`,
    width,
    height,
    viewBox: `0 0 ${width} ${height}`,
    role: 'img',
    tabindex: '0',
    'aria-label': summary,
  });

  ticks.forEach((t, i) => {
    chart.append(svg('line', { class: 'gridline', x1: leftPad, x2: width - rightPad, y1: y(t), y2: y(t) }));
    chart.append(svg('text', { class: 'axis-label', x: leftPad - 6, y: y(t) + 4, 'text-anchor': 'end' }, tickText[i]));
  });

  const labelCount = Math.min(4, span + 1);
  const withYear = String(core.dateFromDayNumber(startDay)).slice(0, 4) !== now.slice(0, 4);
  for (let k = 0; k < labelCount; k += 1) {
    const day = Math.round(startDay + (k * span) / Math.max(1, labelCount - 1));
    const anchor = k === 0 ? 'start' : k === labelCount - 1 ? 'end' : 'middle';
    chart.append(
      svg(
        'text',
        { class: 'axis-label', x: x(day), y: height - 8, 'text-anchor': anchor },
        core.formatMonthDay(core.dateFromDayNumber(day), withYear && k === 0)
      )
    );
  }

  // Solid line between consecutive days; dashed across skipped days.
  /** @type {string[]} */
  let solid = [];
  const flush = () => {
    if (solid.length > 1) chart.append(svg('polyline', { class: 'line', points: solid.join(' ') }));
    solid = [];
  };
  visible.forEach((p, i) => {
    const day = core.dayNumber(p.date);
    const pt = `${x(day)},${y(p.value)}`;
    if (i > 0) {
      const prev = visible[i - 1];
      const prevDay = core.dayNumber(prev.date);
      if (day - prevDay > 1) {
        flush();
        chart.append(svg('line', { class: 'line-gap', x1: x(prevDay), y1: y(prev.value), x2: x(day), y2: y(p.value) }));
      }
    }
    solid.push(pt);
  });
  flush();

  const showAllDots = visible.length <= 45;
  visible.forEach((p, i) => {
    if (showAllDots || i === visible.length - 1) {
      chart.append(svg('circle', { class: 'dot', cx: x(core.dayNumber(p.date)), cy: y(p.value), r: i === visible.length - 1 ? 4.5 : 3.5 }));
    }
  });

  const crosshair = svg('line', { class: 'crosshair', y1: topPad, y2: topPad + plotH, visibility: 'hidden' });
  const hoverDot = svg('circle', { class: 'dot dot-hover', r: 6, visibility: 'hidden' });
  chart.append(crosshair, hoverDot);

  const tooltip = h('div', { class: 'chart-tooltip', 'aria-live': 'polite' });
  const plotWrap = h('div', { class: 'chart-plot' }, chart, tooltip);
  host.append(plotWrap);

  let current = -1;
  /** @param {number} i */
  function show(i) {
    current = Math.max(0, Math.min(visible.length - 1, i));
    const p = visible[current];
    const cx = x(core.dayNumber(p.date));
    const cy = y(p.value);
    crosshair.setAttribute('x1', String(cx));
    crosshair.setAttribute('x2', String(cx));
    crosshair.setAttribute('visibility', 'visible');
    hoverDot.setAttribute('cx', String(cx));
    hoverDot.setAttribute('cy', String(cy));
    hoverDot.setAttribute('visibility', 'visible');
    tooltip.replaceChildren(h('div', { class: 'tt-value', text: fmt(p.value) }), h('div', { class: 'tt-date', text: core.formatDate(p.date, now) }));
    tooltip.style.left = `${Math.min(Math.max(cx, 60), width - 60)}px`;
    tooltip.style.top = `${cy}px`;
    tooltip.classList.add('visible');
  }
  function hide() {
    current = -1;
    crosshair.setAttribute('visibility', 'hidden');
    hoverDot.setAttribute('visibility', 'hidden');
    tooltip.classList.remove('visible');
  }
  /** @param {number} clientX */
  function nearest(clientX) {
    const rect = chart.getBoundingClientRect();
    const px = ((clientX - rect.left) / rect.width) * width;
    let best = 0;
    let bestDist = Infinity;
    visible.forEach((p, i) => {
      const d = Math.abs(x(core.dayNumber(p.date)) - px);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    });
    return best;
  }
  chart.addEventListener('pointermove', (e) => show(nearest(/** @type {PointerEvent} */ (e).clientX)));
  chart.addEventListener('pointerdown', (e) => show(nearest(/** @type {PointerEvent} */ (e).clientX)));
  chart.addEventListener('pointerleave', (e) => {
    if (/** @type {PointerEvent} */ (e).pointerType === 'mouse') hide();
  });
  chart.addEventListener('keydown', (event) => {
    const e = /** @type {KeyboardEvent} */ (event);
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      show(current === -1 ? visible.length - 1 : current + (e.key === 'ArrowLeft' ? -1 : 1));
    } else if (e.key === 'Home') {
      e.preventDefault();
      show(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      show(visible.length - 1);
    } else if (e.key === 'Escape') {
      hide();
    }
  });
  chart.addEventListener('blur', hide);
}
