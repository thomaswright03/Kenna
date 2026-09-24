// Log Meal: one calorie total per meal, picked with the meal buttons.

import { core, h, uid, MEAL_STEPS, mealLabel, today, blankEntry } from './dom.js';
import { toast, createFieldStatus } from './feedback.js';
import { store } from './store.js';
import { dayHash, logHash, replaceHashSilently, returnTo } from './router.js';
import { render } from './render.js';
import { farBackGate } from './day.js';
import { claimDraft, draftMealFor, waitingDrafts } from './drafts.js';
import { unusualGuard } from './unusual.js';
import { mealSaver, mealExits } from './log-saving.js';

/** @typedef {import('./log-saving.js').LogState} LogState */

const HOW_IT_SAVES = 'Each meal saves as soon as you leave its box, pick another meal or leave this screen; saved meals show a ✓.';

/**
 * The meal buttons. Each shows a ✓ and its calories once saved, for as long
 * as the screen is open, and "Not saved" while a value typed for it earlier
 * waits to be confirmed or fixed (picking it brings the value back).
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
    const waiting = new Set(waitingDrafts({ [state.date]: state.entry }, state.date).map((d) => d.field));
    for (const step of MEAL_STEPS) {
      const pill = /** @type {HTMLButtonElement} */ (pills.get(step.key));
      const value = state.entry.meals[step.key];
      const active = step.key === state.activeKey;
      const unsaved = !active && waiting.has(step.key);
      pill.className = `meal-pill${active ? ' active' : ''}${value !== null ? ' filled' : ''}${unsaved ? ' waiting' : ''}`;
      pill.setAttribute('aria-pressed', active ? 'true' : 'false');
      const valueEl = pill.querySelector('.pill-value');
      if (valueEl) valueEl.textContent = unsaved ? 'Not saved' : value !== null ? `✓ ${core.formatNumber(value)}` : '';
      const saved = value !== null ? `${core.formatCalories(value)}, saved` : 'not logged';
      pill.setAttribute('aria-label', unsaved ? `${step.label}, ${saved}, a value typed earlier not saved yet` : `${step.label}, ${saved}`);
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

/**
 * A value typed earlier and not saved, back in the box: says why, and asks
 * about it again if it waits for an answer.
 * @param {import('./drafts.js').Draft} d
 * @param {import('./feedback.js').StatusLine} status
 * @param {{ commit: () => Promise<boolean> }} saver
 */
function showDraft(d, status, saver) {
  if (d.ask) saver.commit();
  else status.set('error', `Not saved yet. ${d.error}`);
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
  const guard = unusualGuard((field, value) => core.unusualValue(entries, state.date, field, value, today()));
  const saver = mealSaver(state, input, status, refresh, guard);
  const exits = mealExits(state, input, status, saver);
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
    // A value typed for this meal earlier and not saved comes back in the
    // box, and is asked about again if it waits for an answer.
    const waiting = claimDraft(key, state.date);
    if (waiting) input.value = waiting.text;
    refresh();
    replaceHashSilently(logHash(ctx.route.date, key));
    input.focus();
    if (waiting) showDraft(waiting, status, saver);
  }
  // Nothing to save: switch within the same tap. Otherwise save first.
  /** @param {string} key */
  async function switchTo(key) {
    if (key === state.activeKey) input.focus();
    else if (saver.settled() || (await saver.commit())) select(key);
  }
  const doneBtn = doneButton(state, saver.commit, input, ctx.route.date, exits.closedWithSave);
  input.addEventListener('change', () => saver.commit({ left: true }));
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
  root.append(picker.el, h('div', { class: 'field' }, label, input, status.el), runningTotal, doneBtn);
  return {
    title: date === now ? 'Log Meal' : `Log Meal, ${core.formatDate(date, now)}`,
    root,
    mounted: () => {
      // A number kept to be asked about is asked about now (the question
      // takes the focus).
      if (draft) showDraft(draft, status, saver);
      if (!(draft && draft.ask) && window.matchMedia && window.matchMedia('(hover: hover)').matches) input.focus({ preventScroll: true });
    },
    flush: exits.flush,
    leave: () => exits.leave(logHash(ctx.route.date, state.activeKey)),
    async refreshFromStorage() {
      state.entry = (await store.getEntry(state.date)) || blankEntry(state.date);
      if (document.activeElement !== input) loadInput();
      refresh();
    },
  };
}
