// Compare: how today stands against your average day and yesterday. The
// top answers that in two sentences, calories and weight; each meal's
// numbers are one tap further down; then the 7-day trend charts.

import { core, h, MEAL_STEPS, today, mealLabel } from './dom.js';
import { store } from './store.js';
import { buildChartsCard } from './charts.js';

/** @typedef {Record<string, number | null>} Stats */

/** @param {number} n */
const cal = (n) => core.formatCalories(n);
/** A weight as entered. @param {number} n */
const lbs = (n) => core.formatWeight(n);
/** An average weight, or any difference between weights: always one decimal. @param {number} n */
const avgLbs = (n) => core.formatAverageWeight(n);

/**
 * "500 cal more than", "the same as": today against a reference value.
 * Calories compare in whole calories; every weight difference is written
 * to one decimal ("12.0 lbs", "0.4 lbs"), and one too small to show at
 * that is "less than 0.1 lbs" rather than "the same".
 * @param {number} diff
 * @param {'cal' | 'lbs'} unit
 * @param {[string, string]} words above/below words, e.g. ['more than', 'less than']
 */
function difference(diff, unit, words) {
  const scale = unit === 'lbs' ? 10 : 1;
  // Rounded the same way above and below (0.75 is 0.8 either way).
  const rounded = (Math.sign(diff) * Math.round(Math.abs(diff) * scale)) / scale;
  const direction = diff > 0 ? 'above' : 'below';
  if (rounded === 0) {
    // Weights are kept to two decimals, so anything smaller is the same.
    if (unit === 'cal' || Math.abs(diff) < 0.005) return { amount: '', text: 'the same as', direction: 'same' };
    return { amount: 'less than 0.1 lbs', text: diff > 0 ? words[0] : words[1], direction };
  }
  const amount = unit === 'cal' ? cal(Math.abs(rounded)) : avgLbs(Math.abs(rounded));
  return { amount, text: rounded > 0 ? words[0] : words[1], direction };
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
 * value, so longer simply means more. Today's bars are darker; no colour
 * means good or bad.
 * @param {({ label: string, value: number | null, today?: boolean } | null)[]} rows
 */
function calorieBars(rows) {
  const shown = rows.filter(/** @returns {r is { label: string, value: number, today?: boolean }} */ (r) => r !== null && r.value !== null);
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

/** "breakfast, snack 1 and lunch" @param {string[]} keys */
function mealNames(keys) {
  const names = keys.map((k) => mealLabel(k).toLowerCase());
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0];
}

/**
 * The calorie sentence once today and earlier days both have meals: today's
 * meals so far against your average for those same meals.
 * @param {Stats} t
 * @param {Stats} avg
 * @param {ReturnType<typeof core.compareSameMeals>} same
 * @returns {Node[]}
 */
function sameMealsSentence(t, avg, same) {
  if (!same) {
    return [document.createTextNode(`${cal(Number(t.total))} so far today. Today’s meals haven’t been logged on an earlier day, so there’s no average for them yet.`)];
  }
  const d = difference(same.today - same.average, 'cal', ['more than', 'less than']);
  return [
    document.createTextNode('So far today: '),
    d.amount ? h('strong', { text: d.amount }) : null,
    document.createTextNode(`${d.amount ? ' ' : ''}${d.text} your average ${mealNames(same.meals)}.`),
  ].filter((n) => n !== null);
}

/**
 * The bars under the calorie sentence. Today's bar covers exactly the meals
 * the sentence compares, so the gap between it and "Usual for these meals"
 * is the difference the sentence gives; a meal left out of the comparison
 * (no average yet) has its own bar, named.
 * @param {Stats} t
 * @param {Stats} y
 * @param {ReturnType<typeof core.compareSameMeals>} same
 * @param {number | null} usual
 * @param {number | null} averageDay
 */
function calorieBarRows(t, y, same, usual, averageDay) {
  const left = same ? same.unmatched : [];
  const leftNames = left.map((k) => mealLabel(k));
  const leftLabel = leftNames.length > 1 ? `${leftNames.slice(0, -1).join(', ')} and ${leftNames[leftNames.length - 1]}` : leftNames[0];
  return calorieBars([
    same && left.length ? { label: 'Today, these meals', value: same.today, today: true } : { label: 'Today so far', value: t.total, today: true },
    { label: 'Usual for these meals', value: usual },
    left.length ? { label: `${leftLabel} (no average yet)`, value: left.reduce((sum, k) => sum + Number(t[k]), 0), today: true } : null,
    { label: 'Average day', value: averageDay },
    { label: 'Yesterday', value: y.total },
  ]);
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
  const same = core.compareSameMeals(t, avg);
  /** @type {Node[]} */
  let sentence;
  if (t.total === null) {
    sentence = [document.createTextNode(avg.total === null ? 'No meals logged yet today.' : `No meals logged yet today. Your average day is ${cal(avg.total)}.`)];
    details.splice(0, details.length, ...(y.total !== null ? [`yesterday ${cal(y.total)}`] : []));
  } else if (avg.total === null) {
    sentence = [document.createTextNode(`${cal(t.total)} so far today.${earlier ? ' No earlier day has meals logged to compare with yet.' : ''}`)];
    details.length = 0;
  } else {
    sentence = sameMealsSentence(t, avg, same);
    if (same && same.unmatched.length) details.push(`${mealNames(same.unmatched)} not compared: not logged before today`);
  }
  // The average for today's meals, and the average whole day when that's
  // different (it is until the day's usual meals are all logged).
  const usual = same && avg.total !== null ? same.average : null;
  const averageDay = usual !== null && Math.round(usual) === Math.round(Number(avg.total)) ? null : avg.total;
  const bars = t.total !== null && avg.total !== null ? calorieBarRows(t, y, same, usual, averageDay) : null;
  // Two averages side by side: say which one the sentence used.
  const note =
    bars && usual !== null && averageDay !== null
      ? h('p', {
        class: 'compare-caption',
        'data-baseline-note': '',
        text: `${
          same && same.unmatched.length
            ? 'The sentence compares “Today, these meals” with “Usual for these meals”: your average for those same meals.'
            : 'The sentence compares today with “Usual for these meals”: your average for just the meals logged so far today.'
        } “Average day” covers whole days, so it’s a fair match only once today is finished.`,
      })
      : null;
  return answer({ id: 'calories', label: 'Calories', sentence, details, extra: bars ? h('div', null, bars, note) : null });
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
    if (avg.weight !== null) details.push(`average ${avgLbs(avg.weight)}`);
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
    details.push(`average ${avgLbs(avg.weight)}`);
    if (y.weight !== null) {
      const dy = difference(t.weight - y.weight, 'lbs', ['up', 'down']);
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
      text: `Today, ${core.formatDate(now, now)}, against your averages and yesterday. Averages leave out today and days with nothing logged.`,
    })
  );
  if (!earlier && !loggedToday) {
    card.append(
      h('p', { class: 'compare-first', text: "Nothing logged yet. Log today's weight and meals, then come back over the next few days to see how each day compares." }),
      h('a', { class: 'btn btn-primary', href: '#/log', text: 'Log Meal' })
    );
  } else if (!earlier) {
    card.append(h('p', { class: 'compare-first', text: 'Log a few more days to see how today compares.' }));
  }
  if (earlier || loggedToday) {
    card.append(h('div', { class: 'compare-answers' }, calorieAnswer(t, y, avg, earlier), weightAnswer(t, y, avg)));
    const meals = mealsTable(t, y, avg);
    if (meals) card.append(meals);
  }
  const trends = buildChartsCard({ title: 'Trends', entries, smoothing: true });
  return { title: 'Compare', root: h('div', { class: 'screen-stack two-col' }, card, trends.root), mounted: trends.draw };
}
