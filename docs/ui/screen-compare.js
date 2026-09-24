// Compare: how today stands against your average day and yesterday. The
// top answers that in two sentences, calories and weight; each meal's
// numbers are one tap further down; then the 7-day trend charts.

import { core, h, MEAL_STEPS, today } from './dom.js';
import { store } from './store.js';
import { buildChartsCard } from './charts.js';

/** @typedef {Record<string, number | null>} Stats */

/** @param {number} n */
const cal = (n) => core.formatCalories(n);
/** @param {number} n @param {number} [decimals] */
const lbs = (n, decimals) => core.formatWeight(n, decimals);

/**
 * "500 cal more than", "the same as": today against a reference value.
 * Calories compare in whole calories, weight to one decimal.
 * @param {number} diff
 * @param {'cal' | 'lbs'} unit
 * @param {[string, string]} words above/below words, e.g. ['more than', 'less than']
 * @param {number} [decimals] for weight: 1 against an average, 2 between two days as entered
 */
function difference(diff, unit, words, decimals = 1) {
  const scale = 10 ** decimals;
  // Rounded the same way above and below (0.75 is 0.8 either way).
  const rounded = (Math.sign(diff) * Math.round(Math.abs(diff) * (unit === 'lbs' ? scale : 1))) / (unit === 'lbs' ? scale : 1);
  if (rounded === 0) return { amount: '', text: 'the same as', direction: 'same' };
  const amount = unit === 'lbs' ? lbs(Math.abs(rounded), decimals) : cal(Math.abs(rounded));
  return { amount, text: rounded > 0 ? words[0] : words[1], direction: rounded > 0 ? 'above' : 'below' };
}

/**
 * One headline answer: a label, a sentence with the difference in bold,
 * and the numbers behind it.
 * @param {{ id: string, label: string, sentence: Node[], details: string[], extra?: HTMLElement | null }} a
 */
function answer(a) {
  return h(
    'div',
    { class: 'compare-answer', 'data-answer': a.id },
    h('h3', { class: 'compare-answer-label', text: a.label }),
    h('p', { class: 'compare-answer-text' }, a.sentence),
    a.details.length ? h('p', { class: 'compare-answer-detail', text: a.details.join(' · ') }) : null,
    a.extra || null
  );
}

/**
 * Plain bars for calories: each starts at zero and is labelled with its
 * value, so longer simply means more. Today's bar is darker; no colour
 * means good or bad.
 * @param {{ label: string, value: number | null, today?: boolean }[]} rows
 */
function calorieBars(rows) {
  const shown = rows.filter((r) => r.value !== null);
  if (shown.length < 2) return null;
  const max = Math.max(...shown.map((r) => Number(r.value)), 1);
  return h(
    'ul',
    { class: 'amount-bars', 'aria-label': 'Calories side by side' },
    shown.map((r) =>
      h(
        'li',
        { class: `amount-row${r.today ? ' is-today' : ''}` },
        h('span', { class: 'amount-label', text: r.label }),
        h(
          'span',
          { class: 'amount-track', 'aria-hidden': 'true' },
          h('span', { class: 'amount-bar', style: `width:${Math.max(1, (Number(r.value) / max) * 100).toFixed(1)}%` })
        ),
        h('span', { class: 'amount-value', text: cal(Number(r.value)) })
      )
    )
  );
}

/**
 * @param {Stats} t today
 * @param {Stats} y yesterday
 * @param {Stats} avg all-time averages (before today)
 * @param {boolean} earlier there's a day before today to compare with
 */
function calorieAnswer(t, y, avg, earlier) {
  const details = [];
  if (t.total !== null) details.push(`${cal(t.total)} so far`);
  if (avg.total !== null) details.push(`average day ${cal(avg.total)}`);
  if (y.total !== null) details.push(`yesterday ${cal(y.total)}`);
  else if (earlier) details.push('no meals logged yesterday');
  /** @type {Node[]} */
  let sentence;
  if (t.total === null) {
    sentence = [document.createTextNode(avg.total === null ? 'No meals logged yet today.' : `No meals logged yet today. Your average day is ${cal(avg.total)}.`)];
    details.splice(0, details.length, ...(y.total !== null ? [`yesterday ${cal(y.total)}`] : []));
  } else if (avg.total === null) {
    sentence = [document.createTextNode(`${cal(t.total)} so far today.${earlier ? ' No earlier day has meals logged to compare with yet.' : ''}`)];
    details.length = 0;
  } else {
    const d = difference(t.total - avg.total, 'cal', ['more than', 'less than']);
    sentence = [
      document.createTextNode('So far today: '),
      d.amount ? h('strong', { text: d.amount }) : null,
      document.createTextNode(`${d.amount ? ' ' : ''}${d.text} your average day.`),
    ].filter((n) => n !== null);
  }
  const bars =
    t.total !== null && avg.total !== null
      ? calorieBars([
        { label: 'Today so far', value: t.total, today: true },
        { label: 'Average day', value: avg.total },
        { label: 'Yesterday', value: y.total },
      ])
    : null;
  return answer({ id: 'calories', label: 'Calories', sentence, details, extra: bars });
}

/**
 * @param {Stats} t
 * @param {Stats} y
 * @param {Stats} avg
 */
function weightAnswer(t, y, avg) {
  /** @type {Node[]} */
  let sentence;
  const details = [];
  if (t.weight === null) {
    sentence = [document.createTextNode('No weight logged yet today.')];
    if (avg.weight !== null) details.push(`average ${lbs(avg.weight, 1)}`);
    if (y.weight !== null) details.push(`yesterday ${lbs(y.weight)}`);
  } else if (avg.weight === null) {
    sentence = [document.createTextNode(`${lbs(t.weight)} today.`)];
  } else {
    const d = difference(t.weight - avg.weight, 'lbs', ['above', 'below']);
    sentence = [
      document.createTextNode(`${lbs(t.weight)} today: `),
      d.amount ? h('strong', { text: d.amount }) : null,
      document.createTextNode(`${d.amount ? ' ' : ''}${d.text} your average.`),
    ].filter((n) => n !== null);
    details.push(`average ${lbs(avg.weight, 1)}`);
    if (y.weight !== null) {
      const dy = difference(t.weight - y.weight, 'lbs', ['up', 'down'], 2);
      details.push(dy.direction === 'same' ? `same as yesterday (${lbs(y.weight)})` : `${dy.amount} ${dy.text} from yesterday (${lbs(y.weight)})`);
    }
  }
  return answer({ id: 'weight', label: 'Weight', sentence, details });
}

/**
 * Each meal's numbers, one tap away.
 * @param {Stats} t
 * @param {Stats} y
 * @param {Stats} avg
 */
function mealsTable(t, y, avg) {
  const logged = MEAL_STEPS.filter((m) => [t[m.key], y[m.key], avg[m.key]].some((v) => v !== null));
  const never = MEAL_STEPS.filter((m) => !logged.includes(m));
  if (logged.length === 0) return null;
  /** @param {number | null} v */
  const cell = (v) => h('td', { text: v === null ? '—' : core.formatNumber(Math.round(v)) });
  const todayCount = logged.filter((m) => t[m.key] !== null).length;
  return h(
    'details',
    { class: 'compare-meals' },
    h('summary', { text: `Each meal: today, yesterday and average (${todayCount} logged today)` }),
    h(
      'table',
      { class: 'meal-table' },
      h('caption', { class: 'visually-hidden', text: 'Calories for each meal' }),
      h(
        'thead',
        null,
        h('tr', null, h('th', { scope: 'col', text: 'Meal' }), h('th', { scope: 'col', text: 'Today' }), h('th', { scope: 'col', text: 'Yesterday' }), h('th', { scope: 'col', text: 'Average' }))
      ),
      h(
        'tbody',
        null,
        logged.map((m) => h('tr', { 'data-meal': m.key }, h('th', { scope: 'row', text: m.label }), cell(t[m.key]), cell(y[m.key]), cell(avg[m.key])))
      )
    ),
    h('p', {
      class: 'compare-caption',
      text: `In calories; — means not logged. A meal’s average counts only the days it was logged.${
        never.length ? ` Never logged: ${never.map((m) => m.label).join(', ')}.` : ''
      }`,
    })
  );
}

/** @type {import('./render.js').ScreenBuilder} */
export async function buildCompare() {
  const now = today();
  const entries = await store.loadEntries();
  const t = core.computeDayStats(entries[now]);
  const y = core.computeDayStats(entries[core.shiftDate(now, -1)]);
  const avg = core.computeAllTimeAverages(entries, now);
  const earlier = Object.values(entries).some((e) => e.date < now && !core.isEntryEmpty(e));
  const loggedToday = !core.isEntryEmpty(entries[now]);

  const card = h(
    'section',
    { class: 'card' },
    h('h2', { class: 'card-title', text: 'Compare' }),
    h('p', {
      class: 'card-sub',
      text: `Today, ${core.formatDate(now, now)}, against your average day and yesterday. Averages leave out today and days with nothing logged.`,
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
    card.append(h('div', { class: 'compare-answers' }, calorieAnswer(t, y, avg, earlier), weightAnswer(t, y, avg)));
    const meals = mealsTable(t, y, avg);
    if (meals) card.append(meals);
  }
  const trends = buildChartsCard({ title: 'Trends', entries, smoothing: true });
  return { title: 'Compare', root: h('div', { class: 'screen-stack two-col' }, card, trends.root), mounted: trends.draw };
}
