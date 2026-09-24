// Log Meal: one calorie total per meal, picked with the meal buttons.

import { core, h, uid, MEAL_STEPS, mealLabel, today, blankEntry, errorText } from './dom.js';
import { toast, createFieldStatus } from './feedback.js';
import { store } from './store.js';
import { dayHash, logHash, replaceHashSilently, returnTo } from './router.js';
import { render } from './render.js';
import { saveDateFor } from './day.js';

/** @type {import('./render.js').ScreenBuilder} */
export async function buildLog(ctx) {
  const now = today();
  const date = ctx.route.date || now;
  const stored = await store.getEntry(date);
  const view = { date, entry: stored || blankEntry(date), rolledOver: false };
  const isToday = date === now;
  const firstOpen = MEAL_STEPS.find((m) => view.entry.meals[m.key] === null);
  let activeKey = ctx.route.meal || (firstOpen ? firstOpen.key : MEAL_STEPS[0].key);

  const input = h('input', { type: 'text', inputmode: 'numeric', autocomplete: 'off', id: uid('cal'), placeholder: 'e.g. 450' });
  const label = h('label', { for: input.id });
  const status = createFieldStatus(input);
  const runningTotal = h('p', { class: 'running-total', 'aria-live': 'polite' });
  /** @type {Map<string, HTMLButtonElement>} */
  const pills = new Map();

  function refreshPills() {
    for (const step of MEAL_STEPS) {
      const pill = pills.get(step.key);
      if (!pill) continue;
      const value = view.entry.meals[step.key];
      const active = step.key === activeKey;
      pill.className = `meal-pill${active ? ' active' : ''}${value !== null ? ' filled' : ''}`;
      pill.setAttribute('aria-pressed', active ? 'true' : 'false');
      const valueEl = pill.querySelector('.pill-value');
      if (valueEl) valueEl.textContent = value !== null ? core.formatNumber(value) : '';
      pill.setAttribute('aria-label', value !== null ? `${step.label}, ${core.formatCalories(value)}` : `${step.label}, not logged`);
    }
    const total = core.totalCalories(view.entry.meals);
    runningTotal.textContent = total === null ? 'No meals logged yet' : `Day total: ${core.formatCalories(total)}`;
  }

  function loadInput() {
    const v = view.entry.meals[activeKey];
    input.value = v === null ? '' : String(v);
    label.textContent = `${mealLabel(activeKey)} calories`;
  }

  // The value in the box belongs to the meal it was typed for; saving it
  // updates the pills and total in place (nothing the user might be about
  // to tap is replaced), so the next tap always lands.
  /** @type {{ key: string, value: number | null, promise: Promise<boolean> } | null} */
  let saving = null;
  /** @param {{ ok: true, value: number | null }} result */
  function needsSave(result) {
    return result.value !== view.entry.meals[activeKey] || view.rolledOver;
  }

  /** @returns {Promise<boolean>} */
  async function commit() {
    const key = activeKey;
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
    const promise = (async () => {
      const target = saveDateFor(view);
      status.set('pending', 'Saving…');
      try {
        view.entry = await store.updateEntry(target, { meals: { [key]: result.value } });
        if (view.rolledOver) {
          render();
          return true;
        }
        refreshPills();
        if (activeKey === key) status.set('saved', result.value === null ? `${mealLabel(key)} cleared` : `${mealLabel(key)} saved`);
        return true;
      } catch (err) {
        if (activeKey === key) status.set('error', errorText(err), () => commit());
        else toast(`${mealLabel(key)} not saved. ${errorText(err)}`, { tone: 'error' });
        return false;
      } finally {
        if (saving && saving.key === key && saving.value === result.value) saving = null;
      }
    })();
    saving = { key, value: result.value, promise };
    return promise;
  }

  /** @param {string} key */
  function select(key) {
    activeKey = key;
    status.set(null);
    loadInput();
    refreshPills();
    replaceHashSilently(logHash(ctx.route.date, key));
    input.focus();
  }

  /** @param {string} key */
  async function switchTo(key) {
    if (key === activeKey) {
      input.focus();
      return;
    }
    const result = core.validateCalories(input.value);
    if (result.ok && !needsSave(result)) {
      select(key); // nothing to save: switch within the same tap
      return;
    }
    if (await commit()) select(key);
  }

  const picker = h('div', { class: 'meal-picker', role: 'group', 'aria-label': 'Meal' });
  for (const step of MEAL_STEPS) {
    const pill = h(
      'button',
      { type: 'button', 'data-meal': step.key, onClick: () => switchTo(step.key) },
      h('span', { class: 'pill-label', text: step.label }),
      h('span', { class: 'pill-value', 'aria-hidden': 'true' })
    );
    pills.set(step.key, pill);
    picker.append(pill);
  }

  input.addEventListener('change', commit);
  input.addEventListener('keydown', async (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    if (!(await commit())) return;
    const idx = MEAL_STEPS.findIndex((m) => m.key === activeKey);
    const next = MEAL_STEPS.slice(idx + 1).find((m) => view.entry.meals[m.key] === null);
    if (next) select(next.key);
    else doneBtn.focus();
  });

  const doneBtn = h('button', {
    type: 'button',
    class: 'btn btn-primary',
    text: 'Done',
    onClick: async () => {
      if (!(await commit())) {
        input.focus();
        return;
      }
      const total = core.totalCalories(view.entry.meals);
      const when = core.formatRelativeDate(view.date, today());
      toast(total === null ? `Nothing logged for ${when}` : `Saved for ${when}: ${core.formatCalories(total)}`);
      returnTo(dayHash(ctx.route.date));
    },
  });

  loadInput();
  refreshPills();

  const root = h(
    'section',
    { class: 'card' },
    h('h2', { class: 'card-title', text: 'Log Meal' }),
    h('p', {
      class: 'card-sub',
      text: `For ${isToday ? `today, ${core.formatDate(date, now)}` : core.formatDate(date, now)}. Each meal saves as soon as you leave the box.`,
    }),
    picker,
    h('div', { class: 'field' }, label, input, status.el),
    runningTotal,
    doneBtn
  );
  return {
    root,
    mounted: () => {
      if (window.matchMedia && window.matchMedia('(hover: hover)').matches) input.focus({ preventScroll: true });
    },
    async refreshFromStorage() {
      view.entry = (await store.getEntry(view.date)) || blankEntry(view.date);
      if (document.activeElement !== input) loadInput();
      refreshPills();
    },
  };
}
