// Drawing one line chart: a real time axis (each point at its calendar
// date, gaps where nothing was logged), a value axis, the line and its
// dots, and a tooltip for touch, mouse and keyboard. Over a long range the
// chart plots weekly or monthly averages instead of every day.

import { core, h, svg, today } from './dom.js';

/**
 * @typedef {{ date: string, value: number }} Point
 * @typedef {{ field: 'calories' | 'weight', title: string, unit: 'cal' | 'lbs', sub: string, partialDay?: string | null, averaged?: boolean }} SeriesInfo
 *   partialDay: a day whose value is still growing (today's calories), drawn apart as "so far"
 * @typedef {{ points: Point[], settled: Point[] }} SeriesData
 *   points: what a daily chart plots; settled: the daily values averaged per week or month
 * @typedef {{ start: number, end: number, day: number, value: number, label: string, note: string, partial: boolean }} Plotted
 *   start/end: the days (day numbers) the point stands for; day: where it's drawn; label: the day or
 *   period ("Week of Sep 20"); note: what an average is of ("average of 5 days")
 * @typedef {{ startDay: number, endDay: number, period: 'day' | 'week' | 'month' }} Frame
 * @typedef {{ width: number, height: number, left: number, right: number, top: number, bottom: number, x: (day: number) => number, y: (v: number) => number, ticks: number[], tickText: string[] }} Scale
 */

const HEIGHT = 220;
const PAD = { right: 12, top: 12, bottom: 28 };

/**
 * The days the chart covers: the last `rangeDays` days, or everything
 * (at least a week) for All. It always ends today.
 * @param {number | null} rangeDays
 * @param {Point[]} points
 * @returns {Frame}
 */
function timeFrame(rangeDays, points) {
  const endDay = core.dayNumber(today());
  const firstDay = points.length ? core.dayNumber(points[0].date) : endDay;
  const startDay = rangeDays ? endDay - rangeDays + 1 : Math.min(firstDay, endDay - 6);
  return { startDay, endDay, period: core.chartPeriod(endDay - startDay + 1) };
}

/**
 * The points to draw: each day in the frame, or each week's or month's
 * average (placed in the middle of the part of it that has happened).
 * @param {SeriesData} data
 * @param {Frame} frame
 * @param {SeriesInfo} opts
 * @returns {Plotted[]}
 */
function plotPoints(data, frame, opts) {
  /** @param {Point} p */
  const inFrame = (p) => {
    const d = core.dayNumber(p.date);
    return d >= frame.startDay && d <= frame.endDay;
  };
  const now = today();
  if (frame.period === 'day') {
    return data.points.filter(inFrame).map((p) => {
      const day = core.dayNumber(p.date);
      const partial = !!opts.partialDay && p.date === opts.partialDay;
      return { start: day, end: day, day, value: p.value, partial, label: partial ? 'Today so far' : core.formatDate(p.date, now), note: '' };
    });
  }
  const period = frame.period;
  const withYear = core.dateFromDayNumber(frame.startDay).slice(0, 4) !== now.slice(0, 4);
  return core.periodAverages(data.settled.filter(inFrame), period).map((a) => ({
    start: a.start,
    end: a.end,
    day: (Math.max(a.start, frame.startDay) + Math.min(a.end, frame.endDay)) / 2,
    value: a.value,
    partial: false,
    label: core.formatPeriod(a.start, period, withYear),
    note: `average of ${a.count} day${a.count === 1 ? '' : 's'}`,
  }));
}

/** @param {SeriesInfo} opts @param {Frame['period']} period */
function subtitle(opts, period) {
  if (period === 'day') return opts.sub;
  const every = period === 'week' ? 'Weekly' : 'Monthly';
  return opts.field === 'calories' ? `${every} average of daily intake, not counting today` : `${every} average weight`;
}

/** @param {SeriesInfo} opts */
function formatter(opts) {
  const averaged = opts.averaged;
  return (/** @type {number} */ v) => (opts.unit === 'lbs' ? core.formatWeight(v, averaged ? 1 : 2) : core.formatCalories(v));
}

/**
 * The title, subtitle and the latest value.
 * @param {Plotted[]} plotted
 * @param {Frame} frame
 * @param {SeriesInfo} opts
 */
function chartHead(plotted, frame, opts) {
  const latest = plotted[plotted.length - 1];
  const fmt = formatter({ ...opts, averaged: opts.averaged || frame.period !== 'day' });
  const when = !latest ? '' : latest.partial ? 'Today so far' : frame.period === 'day' ? core.formatRelativeDate(core.dateFromDayNumber(latest.start), today()) : latest.label;
  return h(
    'div',
    { class: 'chart-head' },
    h('div', null, h('h3', { class: 'chart-title', text: opts.title }), h('p', { class: 'chart-sub', text: subtitle(opts, frame.period) })),
    latest
      ? h('div', { class: `chart-latest series-${opts.field}` }, h('span', { text: fmt(latest.value) }), h('span', { class: 'chart-latest-date', text: when }))
      : null
  );
}

/**
 * Where days and values land on the chart.
 * @param {Plotted[]} plotted
 * @param {Frame} frame
 * @param {number} width
 * @param {SeriesInfo} opts
 * @returns {Scale}
 */
function chartScale(plotted, frame, width, opts) {
  const values = plotted.map((p) => p.value);
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const minSpan = core.axisMinSpan(opts.unit, hi);
  // Calories can't go below zero, so neither does their axis.
  const { ticks, decimals } = opts.unit === 'lbs' ? core.niceTicks(lo, hi, 5, 0.1, undefined, minSpan) : core.niceTicks(lo, hi, 5, 10, 0, minSpan);
  const tickText = ticks.map((t) => core.formatNumber(t, decimals));
  const left = 12 + Math.max(...tickText.map((t) => t.length)) * 7.5;
  const plotW = width - left - PAD.right;
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const yMin = ticks[0];
  const yMax = ticks[ticks.length - 1];
  const span = Math.max(1, frame.endDay - frame.startDay);
  return {
    width,
    height: HEIGHT,
    left,
    right: width - PAD.right,
    top: PAD.top,
    bottom: PAD.top + plotH,
    x: (day) => left + ((day - frame.startDay) / span) * plotW,
    y: (v) => PAD.top + plotH - ((v - yMin) / (yMax - yMin || 1)) * plotH,
    ticks,
    tickText,
  };
}

/**
 * Gridlines with their values, and date labels along the bottom. Dates
 * that carry their year are longer, so a narrow chart shows fewer.
 * @param {SVGElement} chart
 * @param {Scale} s
 * @param {Frame} frame
 */
function drawAxes(chart, s, frame) {
  s.ticks.forEach((t, i) => {
    chart.append(svg('line', { class: 'gridline', x1: s.left, x2: s.right, y1: s.y(t), y2: s.y(t) }));
    chart.append(svg('text', { class: 'axis-label', x: s.left - 6, y: s.y(t) + 4, 'text-anchor': 'end' }, s.tickText[i]));
  });
  const crossesYear = core.dateFromDayNumber(frame.startDay).slice(0, 4) !== today().slice(0, 4);
  const labels = core.dateAxisLabels(frame.startDay, frame.endDay, crossesYear && s.right - s.left < 330 ? 3 : 4);
  labels.forEach((label, k) => {
    const anchor = k === 0 ? 'start' : k === labels.length - 1 ? 'end' : 'middle';
    chart.append(svg('text', { class: 'axis-label', x: s.x(label.day), y: s.height - 8, 'text-anchor': anchor }, label.text));
  });
}

/**
 * A solid line between neighbouring points, dashed across a gap (days,
 * weeks or months with nothing logged). A day still in progress is never
 * joined to the line: it's a separate hollow dot labelled "so far".
 * @param {SVGElement} chart
 * @param {Plotted[]} plotted
 * @param {Scale} s
 */
function drawLines(chart, plotted, s) {
  /** @type {string[]} */
  let solid = [];
  const flush = () => {
    if (solid.length > 1) chart.append(svg('polyline', { class: 'line', points: solid.join(' ') }));
    solid = [];
  };
  /** @type {Plotted | null} */
  let prev = null;
  for (const p of plotted) {
    if (p.partial) continue;
    if (prev && p.start > prev.end + 1) {
      flush();
      chart.append(svg('line', { class: 'line-gap', x1: s.x(prev.day), y1: s.y(prev.value), x2: s.x(p.day), y2: s.y(p.value) }));
    }
    solid.push(`${s.x(p.day)},${s.y(p.value)}`);
    prev = p;
  }
  flush();
}

/**
 * @param {SVGElement} chart
 * @param {Plotted[]} plotted
 * @param {Scale} s
 */
function drawDots(chart, plotted, s) {
  const showAll = plotted.length <= 45;
  plotted.forEach((p, i) => {
    const last = i === plotted.length - 1;
    if (!showAll && !last && !p.partial) return;
    chart.append(svg('circle', { class: p.partial ? 'dot dot-partial' : 'dot', cx: s.x(p.day), cy: s.y(p.value), r: last ? 4.5 : 3.5 }));
    if (p.partial) {
      const above = s.y(p.value) - 10 > s.top + 8;
      chart.append(svg('text', { class: 'partial-label', x: s.x(p.day) - 8, y: above ? s.y(p.value) - 10 : s.y(p.value) + 18, 'text-anchor': 'end' }, 'so far'));
    }
  });
}

/**
 * The tooltip: follows a finger or the mouse, and the arrow, Home and End
 * keys step through the points.
 * @param {SVGElement} chart
 * @param {Plotted[]} plotted
 * @param {Scale} s
 * @param {(v: number) => string} fmt
 * @returns {HTMLElement} the tooltip, to add next to the chart
 */
function attachTooltip(chart, plotted, s, fmt) {
  const crosshair = svg('line', { class: 'crosshair', y1: s.top, y2: s.bottom, visibility: 'hidden' });
  const hoverDot = svg('circle', { class: 'dot dot-hover', r: 6, visibility: 'hidden' });
  chart.append(crosshair, hoverDot);
  const tooltip = h('div', { class: 'chart-tooltip', 'aria-live': 'polite' });
  let current = -1;
  /** @param {number} i */
  function show(i) {
    current = Math.max(0, Math.min(plotted.length - 1, i));
    const p = plotted[current];
    const cx = s.x(p.day);
    const cy = s.y(p.value);
    for (const [k, v] of [['x1', cx], ['x2', cx], ['visibility', 'visible']]) crosshair.setAttribute(String(k), String(v));
    for (const [k, v] of [['cx', cx], ['cy', cy], ['visibility', 'visible']]) hoverDot.setAttribute(String(k), String(v));
    tooltip.replaceChildren(h('div', { class: 'tt-value', text: fmt(p.value) }), h('div', { class: 'tt-date', text: p.note ? `${p.label} · ${p.note}` : p.label }));
    tooltip.style.left = `${Math.min(Math.max(cx, 60), s.width - 60)}px`;
    tooltip.style.top = `${cy}px`;
    tooltip.classList.add('visible');
  }
  function hide() {
    current = -1;
    crosshair.setAttribute('visibility', 'hidden');
    hoverDot.setAttribute('visibility', 'hidden');
    tooltip.classList.remove('visible');
  }
  /** @param {Event} e */
  const nearest = (e) => {
    const rect = chart.getBoundingClientRect();
    const px = ((/** @type {PointerEvent} */ (e).clientX - rect.left) / rect.width) * s.width;
    let best = 0;
    plotted.forEach((p, i) => {
      if (Math.abs(s.x(p.day) - px) < Math.abs(s.x(plotted[best].day) - px)) best = i;
    });
    return best;
  };
  chart.addEventListener('pointermove', (e) => show(nearest(e)));
  chart.addEventListener('pointerdown', (e) => show(nearest(e)));
  chart.addEventListener('pointerleave', (e) => {
    if (/** @type {PointerEvent} */ (e).pointerType === 'mouse') hide();
  });
  /** @type {Record<string, () => number>} */
  const keys = {
    ArrowLeft: () => (current === -1 ? plotted.length - 1 : current - 1),
    ArrowRight: () => (current === -1 ? plotted.length - 1 : current + 1),
    Home: () => 0,
    End: () => plotted.length - 1,
  };
  chart.addEventListener('keydown', (event) => {
    const key = /** @type {KeyboardEvent} */ (event).key;
    if (key === 'Escape') hide();
    if (!keys[key]) return;
    event.preventDefault();
    show(keys[key]());
  });
  chart.addEventListener('blur', hide);
  return tooltip;
}

/**
 * What a screen reader hears for the chart.
 * @param {Plotted[]} plotted
 * @param {Frame} frame
 * @param {SeriesInfo & { rangeDays: number | null }} opts
 * @param {(v: number) => string} fmt
 */
function chartSummary(plotted, frame, opts, fmt) {
  const latest = plotted[plotted.length - 1];
  const range = opts.rangeDays ? `last ${opts.rangeDays} days` : 'all time';
  const unit = { day: 'day', week: 'week', month: 'month' }[frame.period];
  const averages = frame.period === 'day' ? '' : `, ${unit}ly averages`;
  const when = latest.partial ? 'so far today' : frame.period === 'day' ? `on ${core.formatDate(core.dateFromDayNumber(latest.start), today())}` : frame.period === 'week' ? `for the ${latest.label.replace('Week', 'week')}` : `for ${latest.label}`;
  const count = `${plotted.length} ${unit}${plotted.length === 1 ? '' : 's'} with data`;
  return `${opts.title} chart, ${range}${averages}: ${count}, latest ${fmt(latest.value)} ${when}. Use the arrow keys to read each point.`;
}

/**
 * @param {HTMLElement} host
 * @param {SeriesData} data
 * @param {SeriesInfo & { rangeDays: number | null }} opts
 */
export function drawChart(host, data, opts) {
  const frame = timeFrame(opts.rangeDays, data.points);
  const plotted = plotPoints(data, frame, opts);
  host.replaceChildren(chartHead(plotted, frame, opts));
  if (plotted.length === 0) {
    const text = data.points.length === 0 ? 'Nothing logged yet.' : `Nothing logged in the last ${opts.rangeDays} days. Choose All to see older data.`;
    host.append(h('p', { class: 'empty-hint', text }));
    return;
  }
  const fmt = formatter({ ...opts, averaged: opts.averaged || frame.period !== 'day' });
  const s = chartScale(plotted, frame, Math.max(260, host.clientWidth || 320), opts);
  const chart = svg('svg', {
    class: `chart-svg series-${opts.field}`,
    width: s.width,
    height: s.height,
    viewBox: `0 0 ${s.width} ${s.height}`,
    role: 'img',
    tabindex: '0',
    'aria-label': chartSummary(plotted, frame, opts, fmt),
  });
  drawAxes(chart, s, frame);
  drawLines(chart, plotted, s);
  drawDots(chart, plotted, s);
  const tooltip = attachTooltip(chart, plotted, s, fmt);
  host.append(h('div', { class: 'chart-plot' }, chart, tooltip));
}
