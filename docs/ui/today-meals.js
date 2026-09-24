// The day's calories on the Today screen: the total, and one row per meal.
// A tap on a row opens Log Meal at that meal. A meal removed here keeps an
// Undo button in its row for the rest of the visit (until it's put back or
// logged again), and the next screen opened offers Undo too, until it's
// used, dismissed or the user moves on from that screen. A value typed for
// a meal but not saved (it waits to be confirmed, or isn't a number) shows
// in its row, and a tap on the row opens it in Log Meal to settle.

import { core, h, MEAL_STEPS, mealLabel, today, notSavedReason, plural } from './dom.js';
import { failureText } from './problems.js';
import { toast, announce } from './feedback.js';
import { store } from './store.js';
import { logHash } from './router.js';
import { refreshCurrentScreen } from './render.js';
import { saveDateFor } from './day.js';
import { waitingDrafts, draftNumber } from './drafts.js';

/** @typedef {{ value: number, date: string, offered: boolean }} Removed a meal removed on Today: what it was, its day, and whether leaving Today has offered it back yet */

/**
 * Meals removed on Today this visit and not put back, by day and meal, so
 * Undo is still in the row when Today is opened again.
 * @type {Map<string, Map<string, Removed>>}
 */
const removedByDay = new Map();

/** @param {string} date */
function removedOn(date) {
  let removed = removedByDay.get(date);
  if (!removed) {
    removed = new Map();
    removedByDay.set(date, removed);
  }
  return removed;
}

/** "today", "yesterday" or "Tue, Sep 22" @param {string} date */
function dayWords(date) {
  const when = core.formatRelativeDate(date, today());
  return when === 'Today' || when === 'Yesterday' ? when.toLowerCase() : when;
}

/**
 * Puts a removed meal back from another screen, unless it has been logged
 * again since.
 * @param {string} key
 * @param {Removed} r
 */
async function putBackElsewhere(key, r) {
  try {
    const current = await store.getEntry(r.date);
    if (current && current.meals[key] !== null) {
      toast(`${mealLabel(key)} has been logged again since, so it was left as it is.`);
      return;
    }
    await store.updateEntry(r.date, { meals: { [key]: r.value } });
  } catch (err) {
    toast(`${mealLabel(key)} not put back. ${notSavedReason(failureText('Put back a meal', err))}`, { tone: 'error' });
    return;
  }
  removedOn(r.date).delete(key);
  toast(`${mealLabel(key)} put back for ${dayWords(r.date)}: ${core.formatCalories(r.value)}`);
  refreshCurrentScreen();
}

/** @typedef {Map<string, import('./drafts.js').Draft>} WaitingMeals values typed for a day's meals and not saved, by meal */

/**
 * The day's calorie total. A day with no meals shows just the sentence: no
 * number, which would read as a placeholder (a dash) or as a day of 0
 * calories. Values typed and waiting aren't in the total, and it says so.
 * @param {import('./today-weight.js').DayView} view
 * @param {boolean} isToday
 */
function dayTotal(view, isToday) {
  const totalNum = h('div', { class: 'total-num' });
  const totalLabel = h('div', { class: 'total-label' });
  const totalWaiting = h('div', { class: 'total-waiting', hidden: true });
  const el = h('div', { class: 'total-box' }, totalNum, totalLabel, totalWaiting);
  /** @param {WaitingMeals} waiting */
  function refresh(waiting) {
    const total = core.totalCalories(view.entry.meals);
    const when = isToday ? 'today' : core.formatDate(view.date, today());
    el.classList.toggle('is-empty', total === null);
    totalNum.hidden = total === null;
    totalNum.textContent = total === null ? '' : core.formatNumber(total);
    totalLabel.textContent = total === null ? `No meals logged ${isToday ? 'yet today' : `for ${when}`}` : `calories logged ${isToday ? 'today' : `on ${when}`}`;
    const numbers = [...waiting.values()].map(draftNumber);
    totalWaiting.hidden = waiting.size === 0;
    if (waiting.size === 0) totalWaiting.textContent = '';
    else if (numbers.every((n) => n !== null)) totalWaiting.textContent = `+ ${core.formatCalories(numbers.reduce((a, n) => a + (n || 0), 0))} not saved yet`;
    else totalWaiting.textContent = `+ ${plural(waiting.size, 'meal')} not saved yet`;
  }
  return { el, refresh };
}

/**
 * @param {import('./today-weight.js').DayView} view
 * @param {{ routeDate: string | null, isToday: boolean }} where routeDate: the day in the address (null for Today)
 * @returns {{ total: HTMLElement, list: HTMLElement, refresh: () => void, offerUndoAfterLeaving: () => void }}
 */
export function buildMealList(view, where) {
  const total = dayTotal(view, where.isToday);
  const list = h('ul', { class: 'meal-list', 'aria-label': 'Meals' });
  /** Meals removed from the day shown, not put back. */
  const removed = () => removedOn(view.date);

  /** @returns {WaitingMeals} */
  function waitingMeals() {
    const byMeal = new Map();
    for (const d of waitingDrafts({ [view.date]: view.entry }, view.date, { shown: true })) if (d.field !== 'weight') byMeal.set(d.field, d);
    return byMeal;
  }

  /** @param {string} key @param {string} selector */
  function focusInRow(key, selector) {
    const el = list.querySelector(`[data-meal="${key}"] ${selector}`);
    if (el instanceof HTMLElement) el.focus();
  }

  /** @param {string} key */
  async function removeMeal(key) {
    const previous = view.entry.meals[key];
    const date = saveDateFor(view);
    try {
      view.entry = await store.updateEntry(date, { meals: { [key]: null } });
    } catch (err) {
      toast(failureText('Remove a meal', err), { tone: 'error' });
      return;
    }
    if (typeof previous === 'number') removedOn(date).set(key, { value: previous, date, offered: false });
    refresh();
    focusInRow(key, '[data-undo]');
    announce(`${mealLabel(key)} removed. Undo is next to it.`);
  }

  /** @param {string} key @param {HTMLButtonElement} button */
  async function undoRemove(key, button) {
    const r = removed().get(key);
    if (r === undefined || button.disabled) return;
    const previous = r.value;
    button.disabled = true;
    try {
      view.entry = await store.updateEntry(view.date, { meals: { [key]: previous } });
    } catch (err) {
      button.disabled = false;
      toast(failureText('Put back a meal', err), { tone: 'error' });
      return;
    }
    removed().delete(key);
    refresh();
    focusInRow(key, 'a');
    announce(`${mealLabel(key)} restored: ${core.formatCalories(previous)}.`);
  }

  /** @param {{ key: string, label: string }} step @param {import('./drafts.js').Draft | undefined} waiting */
  function row(step, waiting) {
    const value = view.entry.meals[step.key];
    if (value !== null) removed().delete(step.key);
    const r = removed().get(step.key);
    return mealRow(step, value, r ? r.value : undefined, waiting, {
      href: logHash(where.routeDate, step.key),
      onRemove: () => removeMeal(step.key),
      onUndo: (button) => undoRemove(step.key, button),
    });
  }

  function refresh() {
    const waiting = waitingMeals();
    list.replaceChildren(...MEAL_STEPS.map((step) => row(step, waiting.get(step.key))));
    total.refresh(waiting);
  }
  refresh();

  // Today is being left: a meal removed since it was last left can be put
  // back from the next screen too, which might be where the tap was headed.
  function offerUndoAfterLeaving() {
    for (const [key, r] of removed()) {
      if (r.offered) continue;
      r.offered = true;
      toast(`${mealLabel(key)} removed from ${dayWords(r.date)} (${core.formatCalories(r.value)})`, {
        action: { label: 'Undo', onClick: () => putBackElsewhere(key, r) },
      });
    }
  }

  return { total: total.el, list, refresh, offerUndoAfterLeaving };
}

/**
 * What a row says about a value typed for its meal and not saved, and what
 * a tap on the row does with it.
 * @param {import('./drafts.js').Draft} d
 */
function waitingWords(d) {
  const n = draftNumber(d);
  return n !== null && d.ask
    ? { what: `${core.formatCalories(n)} not saved yet`, go: 'Confirm' }
    : { what: `“${d.text.trim().slice(0, 20)}” not saved yet`, go: 'Fix' };
}

/**
 * One meal's row. The whole row, name and value included, opens Log Meal
 * at this meal; a logged meal has a Remove button, and a meal just removed
 * an Undo button. A value typed and not saved shows under the name, and
 * the row then opens it to be confirmed or fixed.
 * @param {{ key: string, label: string }} step
 * @param {number | null} value
 * @param {number | undefined} removedValue what it was, when removed on this screen
 * @param {import('./drafts.js').Draft | undefined} waiting
 * @param {{ href: string, onRemove: () => void, onUndo: (button: HTMLButtonElement) => void }} actions
 */
function mealRow(step, value, removedValue, waiting, actions) {
  const logged = value !== null;
  const shown = logged
    ? h('span', { class: 'meal-value', text: core.formatCalories(value) })
    : waiting
      ? null
      : h('span', { class: 'meal-empty', text: removedValue !== undefined ? `Removed (was ${core.formatCalories(removedValue)})` : 'Not logged' });
  const words = waiting ? waitingWords(waiting) : null;
  const waitingLine = words ? h('span', { class: 'meal-waiting', text: words.what }) : null;
  const go = words ? words.go : logged ? 'Edit' : 'Add';
  const label = words
    ? `${go} ${step.label}${logged ? `, ${core.formatCalories(value)} saved` : ''}, ${words.what}`
    : logged
      ? `Edit ${step.label}, ${core.formatCalories(value)}`
      : `Add ${step.label}`;
  const link = h(
    'a',
    { class: 'meal-link', href: actions.href, 'aria-label': label },
    h('span', { class: 'meal-info' }, h('span', { class: 'meal-name', text: step.label }), shown, waitingLine),
    h('span', { class: `meal-go btn-text${logged || waiting ? '' : ' btn-quiet'}`, 'aria-hidden': 'true', text: go })
  );
  const buttons = h('div', { class: 'meal-actions' });
  if (removedValue !== undefined) {
    const undo = h('button', { type: 'button', class: 'btn-text', 'aria-label': `Undo removing ${step.label}`, 'data-undo': step.key, text: 'Undo' });
    undo.addEventListener('click', () => actions.onUndo(undo));
    buttons.append(undo);
  }
  if (logged) {
    const remove = h('button', { type: 'button', class: 'icon-btn icon-btn-danger', 'aria-label': `Remove ${step.label}`, 'data-remove': step.key });
    remove.append(h('span', { 'aria-hidden': 'true', text: '×' }));
    remove.addEventListener('click', actions.onRemove);
    buttons.append(remove);
  }
  return h('li', { class: `meal-row${waiting ? ' is-waiting' : ''}`, 'data-meal': step.key }, link, buttons.childElementCount ? buttons : null);
}
