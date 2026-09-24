// Log Meal: one calorie total per meal, picked with the meal buttons.

import { core, h, uid, MEAL_STEPS, mealLabel, today, blankEntry } from './dom.js';
import { failureText } from './problems.js';
import { toast, createFieldStatus } from './feedback.js';
import { store } from './store.js';
import { dayHash, logHash, replaceHashSilently, returnTo } from './router.js';
import { render } from './render.js';
import { saveDateFor, farBackGate } from './day.js';
import { keepDraft, claimDraft, draftMealFor } from './drafts.js';
import { sayLeftSaved, keepLeftUnsaved } from './leaving.js';

/**
 * What the screen is working on: the day (see today-weight.js) and the
 * meal whose box is shown.
 * @typedef {import('./today-weight.js').DayView & { activeKey: string }} LogState
 */

const HOW_IT_SAVES = 'Each meal saves as soon as you leave its box, pick another meal or leave this screen; saved meals show a ✓.';

/**
 * The meal buttons. Each shows a ✓ and its calories once saved, for as long
 * as the screen is open.
 * @param {(key: string) => void} onPick
 */
function mealPicker(onPick) {
  const el = h('div', { class: 'meal-picker', role: 'group', 'aria-label': 'Meal' });
  /** @type {Map<string, HTMLButtonElement>} */
  const pills = new Map();
  for (const step of MEAL_STEPS) {
    const pill = h(
      'button',
      { type: 'button', 'data-meal': step.key, onClick: () => onPick(step.key) },
      h('span', { class: 'pill-label', text: step.label }),
      h('span', { class: 'pill-value', 'aria-hidden': 'true' })
    );
    pills.set(step.key, pill);
    el.append(pill);
  }
  /** @param {LogState} state */
  function refresh(state) {
    for (const step of MEAL_STEPS) {
      const pill = /** @type {HTMLButtonElement} */ (pills.get(step.key));
      const value = state.entry.meals[step.key];
      const active = step.key === state.activeKey;
      pill.className = `meal-pill${active ? ' active' : ''}${value !== null ? ' filled' : ''}`;
      pill.setAttribute('aria-pressed', active ? 'true' : 'false');
      const valueEl = pill.querySelector('.pill-value');
      if (valueEl) valueEl.textContent = value !== null ? `✓ ${core.formatNumber(value)}` : '';
      pill.setAttribute('aria-label', value !== null ? `${step.label}, ${core.formatCalories(value)}, saved` : `${step.label}, not logged`);
    }
  }
  return { el, refresh };
}

/**
 * The day total, which follows what's typed, marked as not saved until it is.
 * @param {HTMLElement} el
 * @param {LogState} state
 * @param {string} typedText
 */
function showRunningTotal(el, state, typedText) {
  const typed = core.validateCalories(typedText);
  const unsaved = typed.ok && typed.value !== state.entry.meals[state.activeKey];
  const meals = unsaved ? { ...state.entry.meals, [state.activeKey]: typed.value } : state.entry.meals;
  const total = core.totalCalories(meals);
  el.replaceChildren(total === null ? 'No meals logged yet' : `Day total: ${core.formatCalories(total)}`);
  if (unsaved) el.append(h('span', { class: 'running-note', text: ` · ${mealLabel(state.activeKey)} not saved yet` }));
}

/**
 * Saving the box's value for the meal it was typed for. Saving updates the
 * buttons and total in place (nothing the user might be about to tap is
 * replaced), so the next tap always lands.
 * @param {LogState} state
 * @param {HTMLInputElement} input
 * @param {import('./feedback.js').StatusLine} status
 * @param {() => void} onSaved
 */
function mealSaver(state, input, status, onSaved) {
  /** @type {{ key: string, value: number | null, promise: Promise<boolean> } | null} */
  let saving = null;
  // The last save, while its "saved" message shows under the box.
  /** @type {{ key: string, date: string, saved: number | null, previous: number | null } | null} */
  let lastSave = null;
  // Set once the screen is being left: a save finishing after that doesn't
  // draw this screen again.
  let left = false;
  // Set by Save and close, which says what was saved itself.
  let closed = false;
  /** @param {{ value: number | null }} result */
  const needsSave = (result) => result.value !== state.entry.meals[state.activeKey] || state.rolledOver;

  /** @param {string} key @param {number | null} value */
  async function save(key, value) {
    const target = saveDateFor(state);
    const previous = state.entry.meals[key];
    status.set('pending', 'Saving…');
    try {
      state.entry = await store.updateEntry(target, { meals: { [key]: value } });
      lastSave = { key, date: target, saved: value, previous };
      if (state.rolledOver) {
        if (!left) render();
        return true;
      }
      onSaved();
      if (state.activeKey === key) status.set('saved', value === null ? `${mealLabel(key)} cleared` : `${mealLabel(key)} saved`);
      return true;
    } catch (err) {
      if (state.activeKey === key) status.set('error', failureText('Save a meal', err), { label: 'Retry', onClick: () => commit() });
      else toast(`${mealLabel(key)} not saved. ${failureText('Save a meal', err)}`, { tone: 'error' });
      return false;
    } finally {
      if (saving && saving.key === key && saving.value === value) saving = null;
    }
  }

  /** @returns {Promise<boolean>} */
  async function commit() {
    const key = state.activeKey;
    const result = core.validateCalories(input.value);
    if (!result.ok) {
      status.set('error', result.error);
      return false;
    }
    if (!needsSave(result)) {
      if (status.el.classList.contains('is-error')) status.set(null);
      return true;
    }
    if (saving && saving.key === key && saving.value === result.value) return saving.promise;
    const promise = save(key, result.value);
    saving = { key, value: result.value, promise };
    return promise;
  }

  /** True when what's in the box is already saved (or empty and nothing was). */
  const settled = () => {
    const result = core.validateCalories(input.value);
    return result.ok && !needsSave(result);
  };
  /**
   * The screen is being left. A valid number in the box is saved (or the
   * save already under way is waited for) and the next screen says so; so
   * is a save whose "saved" message was still showing, since that message
   * goes with this screen. An invalid one is kept for next time.
   * @param {string} backHash this screen's address, for coming back to fix it
   */
  function leave(backHash) {
    if (left) return;
    left = true;
    const key = state.activeKey;
    const result = core.validateCalories(input.value);
    if (!result.ok) {
      keepLeftUnsaved({ field: key, date: state.date, text: input.value, error: result.error }, backHash);
      return;
    }
    if (closed) return;
    if (!needsSave(result)) {
      if (lastSave && lastSave.key === key && status.el.classList.contains('is-saved')) sayLeftSaved({ field: key, ...lastSave });
      return;
    }
    commit().then((ok) => {
      if (ok && lastSave && lastSave.key === key) sayLeftSaved({ field: key, ...lastSave });
    });
  }

  // Saves what's in the box when the page is hidden or closed, exactly as
  // leaving the box would; a value that can't be saved is kept as a draft.
  function flush() {
    if (left) return;
    const result = core.validateCalories(input.value);
    if (result.ok) return void commit();
    keepDraft({ field: state.activeKey, date: state.date, text: input.value, error: result.error });
    status.set('error', result.error);
  }

  const closedWithSave = () => {
    closed = true;
  };
  return { commit, settled, leave, flush, closedWithSave };
}

/**
 * Save and close: saves what's in the box, returns to the day and says
 * what was saved. One tap finishes; further taps while it's saving do
 * nothing.
 * @param {LogState} state
 * @param {() => Promise<boolean>} commit
 * @param {HTMLInputElement} input
 * @param {string | null} routeDate
 * @param {() => void} onClose runs as it returns to the day, having said what was saved
 */
function doneButton(state, commit, input, routeDate, onClose) {
  const btn = h('button', { type: 'button', class: 'btn btn-primary', text: 'Save and close' });
  btn.addEventListener('click', async () => {
    if (btn.disabled) return;
    btn.disabled = true;
    btn.setAttribute('aria-busy', 'true');
    if (!(await commit())) {
      btn.disabled = false;
      btn.removeAttribute('aria-busy');
      input.focus();
      return;
    }
    const total = core.totalCalories(state.entry.meals);
    const when = core.formatRelativeDate(state.date, today());
    toast(total === null ? `Nothing logged for ${when}` : `Saved for ${when}: ${core.formatCalories(total)}`, { keepOnNavigate: true });
    onClose();
    returnTo(dayHash(routeDate));
  });
  return btn;
}

/**
 * Back to the day. Like every other way out, it saves what's in the box on
 * the way (see mealSaver's leave), and the day's screen says so.
 * @param {LogState} state
 * @param {string | null} routeDate
 */
function backButton(state, routeDate) {
  const now = today();
  const when = core.formatRelativeDate(state.date, now);
  const label = `Back to ${when === 'Today' || when === 'Yesterday' ? when : core.formatMonthDay(state.date, state.date.slice(0, 4) !== now.slice(0, 4))}`;
  return h('button', { type: 'button', class: 'btn btn-secondary', text: label, 'data-log-back': '', onClick: () => returnTo(dayHash(routeDate)) });
}

/**
 * Enter saves the meal and moves to the next one not logged yet, or to
 * Save and close after the last.
 * @param {LogState} state
 * @param {() => Promise<boolean>} commit
 * @param {(key: string) => void} select
 * @param {HTMLElement} doneBtn
 */
async function saveAndMoveOn(state, commit, select, doneBtn) {
  if (!(await commit())) return;
  const idx = MEAL_STEPS.findIndex((m) => m.key === state.activeKey);
  const next = MEAL_STEPS.slice(idx + 1).find((m) => state.entry.meals[m.key] === null);
  if (next) select(next.key);
  else doneBtn.focus();
}

/**
 * Keys in the calories box: Enter saves and moves on; Escape puts back
 * what's saved, as if nothing had been typed.
 * @param {HTMLInputElement} input
 * @param {{ enter: () => void, escape: () => boolean }} on escape: true when it put something back
 */
function boxKeys(input, on) {
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && on.escape()) {
      e.preventDefault();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      on.enter();
    }
  });
}

/** @type {import('./render.js').ScreenBuilder} */
export async function buildLog(ctx) {
  const now = today();
  const date = ctx.route.date || now;
  const [stored, entries] = await Promise.all([store.getEntry(date), store.loadEntries()]);
  const gate = farBackGate(date, entries, () => render());
  if (gate) {
    return { title: `Log Meal, ${core.formatDate(date, now)}`, root: h('section', { class: 'card' }, h('h2', { class: 'card-title', text: 'Log Meal' }), gate) };
  }
  const entry = stored || blankEntry(date);
  const firstOpen = MEAL_STEPS.find((m) => entry.meals[m.key] === null);
  /** @type {LogState} */
  const state = { date, entry, rolledOver: false, activeKey: ctx.route.meal || draftMealFor(date) || (firstOpen ? firstOpen : MEAL_STEPS[0]).key };
  const draft = claimDraft(state.activeKey, date);

  const input = h('input', { type: 'text', inputmode: 'numeric', autocomplete: 'off', id: uid('cal'), placeholder: 'e.g. 450' });
  const label = h('label', { for: input.id });
  const status = createFieldStatus(input);
  const runningTotal = h('p', { class: 'running-total' });
  const picker = mealPicker((key) => switchTo(key));
  const refresh = () => {
    picker.refresh(state);
    showRunningTotal(runningTotal, state, input.value);
  };
  const saver = mealSaver(state, input, status, refresh);
  const loadInput = () => {
    const v = state.entry.meals[state.activeKey];
    input.value = v === null ? '' : String(v);
    label.textContent = `${mealLabel(state.activeKey)} calories`;
  };

  /** @param {string} key */
  function select(key) {
    state.activeKey = key;
    status.set(null);
    loadInput();
    refresh();
    replaceHashSilently(logHash(ctx.route.date, key));
    input.focus();
  }
  // Nothing to save: switch within the same tap. Otherwise save first.
  /** @param {string} key */
  async function switchTo(key) {
    if (key === state.activeKey) input.focus();
    else if (saver.settled() || (await saver.commit())) select(key);
  }
  const doneBtn = doneButton(state, saver.commit, input, ctx.route.date, saver.closedWithSave);
  input.addEventListener('change', saver.commit);
  input.addEventListener('input', () => showRunningTotal(runningTotal, state, input.value));
  boxKeys(input, {
    enter: () => saveAndMoveOn(state, saver.commit, select, doneBtn),
    escape: () => {
      if (saver.settled()) return false;
      select(state.activeKey);
      return true;
    },
  });
  loadInput();
  if (draft) input.value = draft.text;
  refresh();

  const forDay = date === now ? `today, ${core.formatDate(date, now)}` : core.formatDate(date, now);
  const root = h('section', { class: 'card' }, h('h2', { class: 'card-title', text: 'Log Meal' }), h('p', { class: 'card-sub', text: `For ${forDay}. ${HOW_IT_SAVES}` }));
  const backBtn = backButton(state, ctx.route.date);
  root.append(picker.el, h('div', { class: 'field' }, label, input, status.el), runningTotal, h('div', { class: 'log-actions' }, backBtn, doneBtn));
  return {
    title: date === now ? 'Log Meal' : `Log Meal, ${core.formatDate(date, now)}`,
    root,
    mounted: () => {
      if (draft) status.set('error', `Not saved yet. ${draft.error}`);
      if (window.matchMedia && window.matchMedia('(hover: hover)').matches) input.focus({ preventScroll: true });
    },
    flush: saver.flush,
    leave: () => saver.leave(logHash(ctx.route.date, state.activeKey)),
    async refreshFromStorage() {
      state.entry = (await store.getEntry(state.date)) || blankEntry(state.date);
      if (document.activeElement !== input) loadInput();
      refresh();
    },
  };
}
