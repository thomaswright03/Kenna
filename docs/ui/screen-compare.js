// Compare: how today stands against your average day and yesterday. The
// top answers that in two sentences, calories and weight; each meal's
// numbers are one tap further down; then the 7-day trend charts.

import { core, h, MEAL_STEPS, today, mealLabel } from './dom.js';
import { store } from './store.js';
import { buildChartsCard } from './charts.js';

/** @typedef {Record<string, number | null>} Stats */
/** @typedef {ReturnType<typeof core.computeRecentAverages>} RecentAverages */

/** @param {number} n */
const cal = (n) => core.formatCalories(n);

/**
 * How weights are written in the weight answer: every weight in it, and
 * every difference between them, with the same number of decimals (see
 * core.weightFormatFor).
 * @typedef {ReturnType<typeof core.weightFormatFor>} WeightFormat
 */

/**
 * "500 cal more than", "the same as": today against a reference value.
 * Calories compare in whole calories; a weight difference is written with
 * the answer's decimals ("12.0 lbs", "0.4 lbs"), and one too small to show
 * that way is "less than 0.1 lbs" rather than "the same".
 * @param {number} diff
 * @param {WeightFormat | null} weights null for calories
 * @param {[string, string]} words above/below words, e.g. ['more than', 'less than']
 */
function difference(diff, weights, words) {
  const scale = weights ? 10 ** weights.decimals : 1;
  // Rounded the same way above and below (0.75 is 0.8 either way).
  const rounded = (Math.sign(diff) * Math.round(Math.abs(diff) * scale)) / scale;
  const direction = diff > 0 ? 'above' : 'below';
  if (rounded === 0) {
    // Weights are kept to two decimals, so anything smaller is the same.
    if (!weights || Math.abs(diff) < 0.005) return { amount: '', text: 'the same as', direction: 'same' };
    return { amount: `less than ${weights.format(1 / scale)}`, text: diff > 0 ? words[0] : words[1], direction };
  }
  const amount = weights ? weights.format(Math.abs(rounded)) : cal(Math.abs(rounded));
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
 * "**200 cal** more than" as sentence parts: the amount in bold, then words.
 * @param {ReturnType<typeof difference>} d
 * @param {string} rest what follows the words ("your average.")
 * @returns {Node[]}
 */
function differenceParts(d, rest) {
  const words = document.createTextNode(`${d.amount ? ' ' : ''}${d.text} ${rest}`);
  return d.amount ? [h('strong', { text: d.amount }), words] : [words];
}

/**
 * The same meals compared with the recent baseline, when there is one that
 * differs from all time and covers exactly the same meals; else null.
 * @param {Stats} t
 * @param {RecentAverages} recent
 * @param {ReturnType<typeof core.compareSameMeals>} same
 */
function recentSameMeals(t, recent, same) {
  if (!recent.olderMeals || !same) return null;
  const r = core.compareSameMeals(t, recent.averages);
  return r && r.meals.join() === same.meals.join() ? r : null;
}

/**
 * The calorie sentence once today and earlier days both have meals: today's
 * meals so far against your average for those same meals, over the last
 * 30 days and over all time (just "your average" while they're the same).
 * @param {Stats} t
 * @param {ReturnType<typeof core.compareSameMeals>} same
 * @param {ReturnType<typeof core.compareSameMeals>} sameRecent
 * @returns {Node[]}
 */
function sameMealsSentence(t, same, sameRecent) {
  if (!same) {
    return [document.createTextNode(`${cal(Number(t.total))} so far today. Today’s meals haven’t been logged on an earlier day, so there’s no average for them yet.`)];
  }
  const words = /** @type {[string, string]} */ (['more than', 'less than']);
  const d = difference(same.today - same.average, null, words);
  if (!sameRecent) return [document.createTextNode('So far today: '), ...differenceParts(d, `your average ${mealNames(same.meals)}.`)];
  const dr = difference(sameRecent.today - sameRecent.average, null, words);
  return [
    document.createTextNode('So far today: '),
    ...differenceParts(dr, `your average ${mealNames(same.meals)} over the last ${core.RECENT_DAYS} days, and `),
    ...differenceParts(d, 'all-time.'),
  ];
}

/**
 * The bars under the calorie sentence: today and the baselines the
 * sentence uses, so the gap between them is the sentence's number. Today's
 * bar covers exactly the meals the sentence compares ("Today, these
 * meals" when a meal logged today has no average yet, which the detail
 * line names). The average whole day and yesterday are in the detail line.
 * @param {NonNullable<ReturnType<typeof core.compareSameMeals>>} same
 * @param {ReturnType<typeof core.compareSameMeals>} sameRecent
 */
function calorieBarRows(same, sameRecent) {
  return calorieBars([
    { label: same.unmatched.length ? 'Today, these meals' : 'Today so far', value: same.today, today: true },
    sameRecent ? { label: `Usual, last ${core.RECENT_DAYS} days`, value: sameRecent.average } : null,
    { label: sameRecent ? 'Usual, all time' : 'Usual for these meals', value: same.average },
  ]);
}

/**
 * @param {Stats} t today
 * @param {Stats} y yesterday
 * @param {Stats} avg all-time averages (before today)
 * @param {RecentAverages} recent the last 30 days' averages
 * @param {boolean} earlier there's a day before today to compare with
 */
function calorieAnswer(t, y, avg, recent, earlier) {
  const details = [];
  const same = core.compareSameMeals(t, avg);
  const sameRecent = recentSameMeals(t, recent, same);
  const r = recent.averages.total;
  if (t.total !== null) details.push(`${cal(t.total)} so far`);
  if (avg.total !== null) details.push(recent.olderMeals && r !== null ? `average day ${cal(r)} (last ${core.RECENT_DAYS} days), ${cal(avg.total)} (all time)` : `average day ${cal(avg.total)}`);
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
    sentence = sameMealsSentence(t, same, sameRecent);
    if (same && same.unmatched.length) details.push(`${mealNames(same.unmatched)} not compared: not logged before today`);
  }
  const bars = t.total !== null && avg.total !== null && same ? calorieBarRows(same, sameRecent) : null;
  return answer({ id: 'calories', label: 'Calories', sentence, details, extra: bars });
}

/**
 * @param {Stats} t
 * @param {Stats} y
 * @param {Stats} avg
 * @param {RecentAverages} recent
 */
function weightAnswer(t, y, avg, recent) {
  const weights = core.weightFormatFor([t.weight, y.weight]);
  const lbs = weights.format;
  // The last 30 days' average, when it isn't simply the all-time one.
  const r = recent.olderWeight ? recent.averages.weight : null;
  const averages = r !== null && avg.weight !== null ? [`${core.RECENT_DAYS}-day average ${lbs(r)}`, `all-time average ${lbs(avg.weight)}`] : avg.weight !== null ? [`average ${lbs(avg.weight)}`] : [];
  /** @type {Node[]} */
  let sentence;
  const details = [...averages];
  if (t.weight === null) {
    sentence = [document.createTextNode('No weight logged yet today.')];
    if (y.weight !== null) details.push(`yesterday ${lbs(y.weight)}`);
  } else if (avg.weight === null) {
    sentence = [document.createTextNode(`${lbs(t.weight)} today.`)];
  } else {
    const d = difference(t.weight - avg.weight, weights, ['above', 'below']);
    sentence =
      r === null
        ? [document.createTextNode(`${lbs(t.weight)} today: `), ...differenceParts(d, 'your average.')]
        : [
            document.createTextNode(`${lbs(t.weight)} today: `),
            ...differenceParts(difference(t.weight - r, weights, ['above', 'below']), `your ${core.RECENT_DAYS}-day average and `),
            ...differenceParts(d, 'your all-time average.'),
          ];
    if (y.weight !== null) {
      const dy = difference(t.weight - y.weight, weights, ['up', 'down']);
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
  return h(
    'details',
    { class: 'compare-meals' },
    h('summary', { text: 'See each meal: today, yesterday, average' }),
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
  const recent = core.computeRecentAverages(entries, now);
  const earlier = Object.values(entries).some((e) => e.date < now && !core.isEntryEmpty(e));
  const loggedToday = !core.isEntryEmpty(entries[now]);

  const card = h(
    'section',
    { class: 'card' },
    h('h2', { class: 'card-title', text: 'Compare' }),
    h('p', {
      class: 'card-sub',
      text: `Today, ${core.formatDate(now, now)}, against your averages and yesterday. Averages leave out today and days with nothing logged${
        recent.olderWeight || recent.olderMeals ? `; the recent ones are of the ${core.RECENT_DAYS} days before today` : ''
      }.`,
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
    card.append(h('div', { class: 'compare-answers' }, calorieAnswer(t, y, avg, recent, earlier), weightAnswer(t, y, avg, recent)));
    const meals = mealsTable(t, y, avg);
    if (meals) card.append(meals);
  }
  const trends = buildChartsCard({ title: 'Trends', entries, smoothing: true });
  return { title: 'Compare', root: h('div', { class: 'screen-stack two-col' }, card, trends.root), mounted: trends.draw };
}
