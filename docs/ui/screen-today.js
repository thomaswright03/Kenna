// Today (or a past day): date, weight, the day's calories per meal, and the
// Calories and Weight charts.

import { core, h, uid, MEAL_STEPS, mealLabel, today, blankEntry, errorText } from './dom.js';
import { toast, createFieldStatus } from './feedback.js';
import { store } from './store.js';
import { dayHash, logHash, navigate } from './router.js';
import { render } from './render.js';
import { saveDateFor } from './day.js';
import { buildChartsCard } from './charts.js';

/** @type {import('./render.js').ScreenBuilder} */
export async function buildToday(ctx) {
  const now = today();
  const date = ctx.route.date || now;
  const [storedEntry, allEntries] = await Promise.all([store.getEntry(date), store.loadEntries()]);
  const view = { date, entry: storedEntry || blankEntry(date), rolledOver: false };
  const isToday = date === now;

  const heading = h('h2', { class: 'card-title', text: isToday ? 'Today' : core.formatDate(date, now) });
  const sub = h('p', { class: 'card-sub', text: isToday ? core.formatDate(date, now) : 'Past day' });
  const pastNote = !isToday
    ? h(
        'div',
        { class: 'inline-note' },
        h('span', { text: `You're viewing ${core.formatRelativeDate(date, now)}.` }),
        h('a', { class: 'btn-text', href: '#/', text: 'Back to today' })
      )
    : null;

  // Date
  const dateInput = h('input', { type: 'date', id: uid('date'), value: date, max: now, required: true });
  const dateStatus = createFieldStatus(dateInput);
  dateInput.addEventListener('change', () => {
    const picked = dateInput.value;
    if (!core.isValidDateStr(picked)) {
      dateInput.value = date;
      dateStatus.set('error', 'Pick a date to view.');
      return;
    }
    if (picked > today()) {
      dateInput.value = date;
      dateStatus.set('error', "You can't log a day that hasn't happened yet.");
      return;
    }
    if (picked === date) return;
    navigate(dayHash(picked));
  });
  dateInput.addEventListener('blur', () => {
    if (!dateInput.value) dateInput.value = date;
  });

  // Weight
  const weightInput = h('input', {
    type: 'text',
    inputmode: 'decimal',
    autocomplete: 'off',
    id: uid('weight'),
    placeholder: 'e.g. 180.4',
    value: view.entry.weight === null ? '' : String(view.entry.weight),
  });
  const weightStatus = createFieldStatus(weightInput);
  /** @type {Promise<boolean> | null} */
  let weightSaving = null;

  /** @returns {Promise<boolean>} */
  async function commitWeight() {
    const result = core.validateWeight(weightInput.value);
    if (!result.ok) {
      weightStatus.set('error', result.error);
      return false;
    }
    if (result.value === view.entry.weight && !view.rolledOver) {
      if (weightStatus.el.classList.contains('is-error')) weightStatus.set(null);
      return true;
    }
    if (weightSaving) return weightSaving;
    weightSaving = (async () => {
      const target = saveDateFor(view);
      weightStatus.set('pending', 'Saving…');
      try {
        view.entry = await store.updateEntry(target, { weight: result.value });
        weightStatus.set('saved', result.value === null ? 'Weight cleared' : 'Saved');
        if (view.rolledOver) render();
        return true;
      } catch (err) {
        weightStatus.set('error', errorText(err), () => commitWeight());
        return false;
      } finally {
        weightSaving = null;
      }
    })();
    return weightSaving;
  }
  weightInput.addEventListener('change', commitWeight);
  weightInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitWeight();
    }
  });

  // Calories total + meals
  const totalNum = h('div', { class: 'total-num' });
  const totalLabel = h('div', { class: 'total-label' });
  const mealsList = h('ul', { class: 'meal-list', 'aria-label': 'Meals' });

  function refreshTotal() {
    const total = core.totalCalories(view.entry.meals);
    totalNum.textContent = total === null ? '—' : core.formatNumber(total);
    const when = isToday ? 'today' : core.formatDate(date, today());
    totalLabel.textContent =
      total === null ? `No meals logged ${isToday ? 'yet today' : `for ${when}`}` : `calories logged ${isToday ? 'today' : `on ${when}`}`;
  }

  /** @param {string} key @param {boolean} [focusAfter] */
  async function removeMeal(key, focusAfter) {
    const previous = view.entry.meals[key];
    try {
      view.entry = await store.updateEntry(saveDateFor(view), { meals: { [key]: null } });
    } catch (err) {
      toast(errorText(err), { tone: 'error' });
      return;
    }
    refreshMeals(key, focusAfter);
    toast(`${mealLabel(key)} removed`, {
      action: {
        label: 'Undo',
        onClick: async () => {
          try {
            view.entry = await store.updateEntry(view.date, { meals: { [key]: previous } });
            refreshMeals();
            toast(`${mealLabel(key)} restored`);
          } catch (err) {
            toast(errorText(err), { tone: 'error' });
          }
        },
      },
    });
  }

  /** @param {{ key: string, label: string }} step */
  function mealRow(step) {
    const value = view.entry.meals[step.key];
    const logged = value !== null;
    const href = logHash(ctx.route.date, step.key);
    const actions = h('div', { class: 'meal-actions' });
    actions.append(
      h('a', {
        class: 'btn-text',
        href,
        'aria-label': `${logged ? 'Edit' : 'Add'} ${step.label}`,
        text: logged ? 'Edit' : '+ Add',
      })
    );
    if (logged) {
      actions.append(
        h(
          'button',
          {
            type: 'button',
            class: 'icon-btn icon-btn-danger',
            'aria-label': `Remove ${step.label}`,
            'data-remove': step.key,
            onClick: () => removeMeal(step.key, true),
          },
          h('span', { 'aria-hidden': 'true', text: '×' })
        )
      );
    }
    return h(
      'li',
      { class: 'meal-row', 'data-meal': step.key },
      h(
        'div',
        { class: 'meal-info' },
        h('span', { class: 'meal-name', text: step.label }),
        logged ? h('span', { class: 'meal-value', text: core.formatCalories(value) }) : h('span', { class: 'meal-empty', text: 'Not logged' })
      ),
      actions
    );
  }

  /** @param {string} [changedKey] @param {boolean} [focusAfter] */
  function refreshMeals(changedKey, focusAfter) {
    mealsList.replaceChildren(...MEAL_STEPS.map(mealRow));
    refreshTotal();
    if (focusAfter && changedKey) {
      const link = mealsList.querySelector(`[data-meal="${changedKey}"] a`);
      if (link instanceof HTMLElement) link.focus();
    }
  }
  refreshMeals();

  const logBtn = h('a', { class: 'btn btn-primary', href: logHash(ctx.route.date, null), text: 'Log Meal' });

  const todayCard = h(
    'section',
    { class: 'card' },
    heading,
    sub,
    pastNote,
    h(
      'div',
      { class: 'field-row' },
      h('div', { class: 'field' }, h('label', { for: dateInput.id, text: 'Date' }), dateInput, dateStatus.el),
      h('div', { class: 'field' }, h('label', { for: weightInput.id, text: 'Weight (lbs)' }), weightInput, weightStatus.el)
    ),
    h('div', { class: 'total-box' }, totalNum, totalLabel),
    mealsList,
    logBtn
  );

  const charts = buildChartsCard({
    title: 'Graphs',
    entries: allEntries,
    smoothing: false,
    footer: h('p', { class: 'card-foot' }, h('a', { class: 'btn-text', href: '#/history', text: 'See exact numbers in History' })),
  });

  return {
    root: h('div', { class: 'screen-stack' }, todayCard, charts.root),
    mounted: charts.draw,
    async refreshFromStorage() {
      const entry = (await store.getEntry(view.date)) || blankEntry(view.date);
      view.entry = entry;
      if (document.activeElement !== weightInput) weightInput.value = entry.weight === null ? '' : String(entry.weight);
      refreshMeals();
    },
  };
}

