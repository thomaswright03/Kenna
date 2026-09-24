// Today (or a past day): date, weight, the day's calories per meal, and the
// Calories and Weight charts.

import { core, h, uid, MEAL_STEPS, mealLabel, today, blankEntry, errorText, visibleEntries } from './dom.js';
import { toast, announce, createFieldStatus } from './feedback.js';
import { store } from './store.js';
import { dayHash, logHash, navigate } from './router.js';
import { render } from './render.js';
import { saveDateFor, farBackGate } from './day.js';
import { buildChartsCard } from './charts.js';
import { buildBackupReminder } from './backup-reminder.js';
import { buildInstallNote } from './install-note.js';
import { keepDraft, claimDraft } from './drafts.js';

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
  // Saves what's in the box when the page is hidden or closed, exactly as
  // leaving the box would; a value that can't be saved is kept as a draft.
  function flush() {
    const text = weightInput.value;
    const result = core.validateWeight(text);
    if (result.ok) {
      commitWeight();
    } else {
      keepDraft({ field: 'weight', date: view.date, text, error: result.error });
      weightStatus.set('error', result.error);
    }
  }
  const draft = claimDraft('weight', date);
  if (draft) weightInput.value = draft.text;

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

  // A meal removed here can be put back from its own row (no time limit,
  // nothing covering the screen) until the user leaves this screen.
  /** @type {Map<string, number>} */
  const removed = new Map();

  /** @param {string} key @param {string} selector */
  function focusInRow(key, selector) {
    const el = mealsList.querySelector(`[data-meal="${key}"] ${selector}`);
    if (el instanceof HTMLElement) el.focus();
  }

  /** @param {string} key */
  async function removeMeal(key) {
    const previous = view.entry.meals[key];
    try {
      view.entry = await store.updateEntry(saveDateFor(view), { meals: { [key]: null } });
    } catch (err) {
      toast(errorText(err), { tone: 'error' });
      return;
    }
    if (typeof previous === 'number') removed.set(key, previous);
    refreshMeals();
    focusInRow(key, '[data-undo]');
    announce(`${mealLabel(key)} removed. Undo is next to it.`);
  }

  /** @param {string} key @param {HTMLButtonElement} button */
  async function undoRemove(key, button) {
    const previous = removed.get(key);
    if (previous === undefined || button.disabled) return;
    button.disabled = true;
    try {
      view.entry = await store.updateEntry(view.date, { meals: { [key]: previous } });
    } catch (err) {
      button.disabled = false;
      toast(errorText(err), { tone: 'error' });
      return;
    }
    removed.delete(key);
    refreshMeals();
    focusInRow(key, 'a');
    announce(`${mealLabel(key)} restored: ${core.formatCalories(previous)}.`);
  }

  /** @param {{ key: string, label: string }} step */
  function mealRow(step) {
    const value = view.entry.meals[step.key];
    const logged = value !== null;
    if (logged) removed.delete(step.key);
    const removedValue = removed.get(step.key);
    const href = logHash(ctx.route.date, step.key);
    const actions = h('div', { class: 'meal-actions' });
    if (removedValue !== undefined) {
      const undo = h('button', {
        type: 'button',
        class: 'btn-text',
        'aria-label': `Undo removing ${step.label}`,
        'data-undo': step.key,
        text: 'Undo',
        onClick: () => undoRemove(step.key, undo),
      });
      actions.append(undo);
    }
    actions.append(
      h('a', {
        class: `btn-text${logged ? '' : ' btn-quiet'}`,
        href,
        'aria-label': `${logged ? 'Edit' : 'Add'} ${step.label}`,
        text: logged ? 'Edit' : 'Add',
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
            onClick: () => removeMeal(step.key),
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
        logged
          ? h('span', { class: 'meal-value', text: core.formatCalories(value) })
          : h('span', { class: 'meal-empty', text: removedValue !== undefined ? `Removed (was ${core.formatCalories(removedValue)})` : 'Not logged' })
      ),
      actions
    );
  }

  function refreshMeals() {
    mealsList.replaceChildren(...MEAL_STEPS.map(mealRow));
    refreshTotal();
  }
  refreshMeals();

  const logBtn = h('a', { class: 'btn btn-primary', href: logHash(ctx.route.date, null), text: 'Log Meal' });

  const dateField = h(
    'div',
    { class: 'field' },
    h('label', { for: dateInput.id, text: 'Day to view or edit' }),
    dateInput,
    dateStatus.el
  );
  // A day long before anything logged asks first; until then only the
  // day picker is offered, to fix a mistyped year.
  const gate = farBackGate(date, allEntries, () => render());
  const todayCard = gate
    ? h('section', { class: 'card' }, heading, sub, gate, dateField)
    : h(
        'section',
        { class: 'card' },
        heading,
        sub,
        pastNote,
        h(
          'div',
          { class: 'field-row' },
          dateField,
          h('div', { class: 'field' }, h('label', { for: weightInput.id, text: 'Weight (lbs)' }), weightInput, weightStatus.el)
        ),
        h('div', { class: 'total-box' }, totalNum, totalLabel),
        logBtn,
        mealsList
      );

  const charts = buildChartsCard({
    title: 'Graphs',
    entries: allEntries,
    smoothing: false,
    footer: h('p', { class: 'card-foot' }, h('a', { class: 'btn-text', href: '#/history', text: 'See exact numbers in History' })),
  });

  const hasData = visibleEntries(allEntries).length > 0 || (await store.countPhotos().catch(() => 0)) > 0;
  const reminder = buildBackupReminder(hasData);
  const installNote = buildInstallNote(hasData);

  return {
    title: isToday ? 'Today' : core.formatDate(date, now),
    root: h('div', { class: 'screen-stack two-col' }, installNote ? installNote.root : null, reminder ? reminder.root : null, todayCard, charts.root),
    mounted: () => {
      charts.draw();
      if (installNote) installNote.mounted();
      else if (reminder) reminder.mounted();
      if (draft) weightStatus.set('error', `Not saved yet. ${draft.error}`);
    },
    flush: gate ? undefined : flush,
    async refreshFromStorage() {
      const entry = (await store.getEntry(view.date)) || blankEntry(view.date);
      view.entry = entry;
      if (document.activeElement !== weightInput) weightInput.value = entry.weight === null ? '' : String(entry.weight);
      refreshMeals();
    },
  };
}

