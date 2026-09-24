// The day's calories on the Today screen: the total, and one row per meal.
// A tap on a row opens Log Meal at that meal; a meal removed here keeps an
// Undo button in its row until the screen is left.

import { core, h, MEAL_STEPS, mealLabel, today, errorText } from './dom.js';
import { toast, announce } from './feedback.js';
import { store } from './store.js';
import { logHash } from './router.js';
import { saveDateFor } from './day.js';

/**
 * @param {import('./today-weight.js').DayView} view
 * @param {{ routeDate: string | null, isToday: boolean }} where routeDate: the day in the address (null for Today)
 * @returns {{ total: HTMLElement, list: HTMLElement, refresh: () => void }}
 */
export function buildMealList(view, where) {
  const totalNum = h('div', { class: 'total-num' });
  const totalLabel = h('div', { class: 'total-label' });
  const list = h('ul', { class: 'meal-list', 'aria-label': 'Meals' });
  /** Meals removed on this screen, with what they were. @type {Map<string, number>} */
  const removed = new Map();

  function refreshTotal() {
    const total = core.totalCalories(view.entry.meals);
    totalNum.textContent = total === null ? '—' : core.formatNumber(total);
    const when = where.isToday ? 'today' : core.formatDate(view.date, today());
    totalLabel.textContent =
      total === null ? `No meals logged ${where.isToday ? 'yet today' : `for ${when}`}` : `calories logged ${where.isToday ? 'today' : `on ${when}`}`;
  }

  /** @param {string} key @param {string} selector */
  function focusInRow(key, selector) {
    const el = list.querySelector(`[data-meal="${key}"] ${selector}`);
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
    refresh();
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
    refresh();
    focusInRow(key, 'a');
    announce(`${mealLabel(key)} restored: ${core.formatCalories(previous)}.`);
  }

  /** @param {{ key: string, label: string }} step */
  function row(step) {
    const value = view.entry.meals[step.key];
    if (value !== null) removed.delete(step.key);
    return mealRow(step, value, removed.get(step.key), {
      href: logHash(where.routeDate, step.key),
      onRemove: () => removeMeal(step.key),
      onUndo: (button) => undoRemove(step.key, button),
    });
  }

  function refresh() {
    list.replaceChildren(...MEAL_STEPS.map(row));
    refreshTotal();
  }
  refresh();

  return { total: h('div', { class: 'total-box' }, totalNum, totalLabel), list, refresh };
}

/**
 * One meal's row. The whole row, name and value included, opens Log Meal
 * at this meal; a logged meal has a Remove button, and a meal just removed
 * an Undo button.
 * @param {{ key: string, label: string }} step
 * @param {number | null} value
 * @param {number | undefined} removedValue what it was, when removed on this screen
 * @param {{ href: string, onRemove: () => void, onUndo: (button: HTMLButtonElement) => void }} actions
 */
function mealRow(step, value, removedValue, actions) {
  const logged = value !== null;
  const shown = logged
    ? h('span', { class: 'meal-value', text: core.formatCalories(value) })
    : h('span', { class: 'meal-empty', text: removedValue !== undefined ? `Removed (was ${core.formatCalories(removedValue)})` : 'Not logged' });
  const link = h(
    'a',
    { class: 'meal-link', href: actions.href, 'aria-label': logged ? `Edit ${step.label}, ${core.formatCalories(value)}` : `Add ${step.label}` },
    h('span', { class: 'meal-info' }, h('span', { class: 'meal-name', text: step.label }), shown),
    h('span', { class: `meal-go btn-text${logged ? '' : ' btn-quiet'}`, 'aria-hidden': 'true', text: logged ? 'Edit' : 'Add' })
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
  return h('li', { class: 'meal-row', 'data-meal': step.key }, link, buttons.childElementCount ? buttons : null);
}
