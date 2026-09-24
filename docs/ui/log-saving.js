// Saving the Log Meal box: the value is saved for the meal it was typed
// for, and every way out of the screen (leaving it, the page being hidden
// or closed) saves it first. A number far above the meal's usual size is
// asked about before it's saved (see unusual.js).

import { core, mealLabel, notSavedReason, errorText } from './dom.js';
import { failureText } from './problems.js';
import { toast } from './feedback.js';
import { store } from './store.js';
import { render } from './render.js';
import { saveDateFor } from './day.js';
import { keepDraft, settleDraft } from './drafts.js';
import { sayLeftSaved, keepLeftUnsaved } from './leaving.js';
import { afterTap } from './unusual.js';

/**
 * What the screen is working on: the day (see today-weight.js) and the
 * meal whose box is shown.
 * @typedef {import('./today-weight.js').DayView & { activeKey: string }} LogState
 */

/**
 * What the screen's saving and its ways out share: the last save (while
 * its "saved" message shows under the box), why the last save failed,
 * whether the screen is being left (a save finishing after that doesn't
 * draw this screen again) and whether Save and close was used (it says
 * what was saved itself).
 * @typedef {{ lastSave: { key: string, date: string, saved: number | null, previous: number | null } | null, failure: string, left: boolean, closed: boolean }} SaveTrack
 */

/**
 * Saving the box's value for the meal it was typed for. Saving updates the
 * buttons and total in place (nothing the user might be about to tap is
 * replaced), so the next tap always lands. A meal far above its usual size
 * is asked about first (see unusual.js).
 * @param {LogState} state
 * @param {HTMLInputElement} input
 * @param {import('./feedback.js').StatusLine} status
 * @param {() => void} onSaved
 * @param {import('./unusual.js').UnusualGuard} guard
 */
export function mealSaver(state, input, status, onSaved, guard) {
  /** @type {{ key: string, value: number | null, promise: Promise<boolean> } | null} */
  let saving = null;
  /** @type {SaveTrack} */
  const track = { lastSave: null, failure: '', left: false, closed: false };
  /** @param {{ value: number | null }} result */
  const needsSave = (result) => result.value !== state.entry.meals[state.activeKey] || state.rolledOver;
  // The save that last failed (day, meal and number), which is noted in
  // the problem log. Leaving the box doesn't try it again (Retry is under
  // the box), and it failing again as the screen is left isn't noted
  // again; Retry is, since the user asked for it.
  let failed = '';

  /** @param {string} key @param {number | null} value @param {boolean} retry the user asked for it again (Retry) */
  async function save(key, value, retry) {
    const target = saveDateFor(state);
    const previous = state.entry.meals[key];
    status.set('pending', 'Saving…');
    try {
      state.entry = await store.updateEntry(target, { meals: { [key]: value } });
      settleDraft(key, target);
      failed = '';
      track.lastSave = { key, date: target, saved: value, previous };
      if (state.rolledOver) {
        if (!track.left) render();
        return true;
      }
      onSaved();
      if (state.activeKey === key) status.set('saved', value === null ? `${mealLabel(key)} cleared` : `${mealLabel(key)} saved`);
      return true;
    } catch (err) {
      const attempt = `${target} ${key} ${value}`;
      track.failure = retry || attempt !== failed ? failureText('Save a meal', err) : errorText(err);
      failed = attempt;
      if (state.activeKey === key) status.set('error', track.failure, { label: 'Retry', onClick: () => commit({ retry: true }) });
      else toast(`${mealLabel(key)} not saved. ${notSavedReason(track.failure)}`, { tone: 'error' });
      return false;
    } finally {
      if (saving && saving.key === key && saving.value === value) saving = null;
    }
  }

  /**
   * @param {{ left?: boolean, retry?: boolean }} [how] left: the box was
   *   left (its change event), so a number to ask about waits for the tap
   *   that left it; retry: Retry was pressed
   * @returns {Promise<boolean>}
   */
  async function commit(how) {
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
    if (how && how.left && failed === `${state.date} ${key} ${result.value}`) return false;
    const unusual = guard.question(key, result.value);
    if (unusual && result.value !== null) return how && how.left ? askSoon(key) : askFirst(key, result.value, unusual);
    const promise = save(key, result.value, !!(how && how.retry));
    saving = { key, value: result.value, promise };
    return promise;
  }

  /**
   * Keep it saves the meal; Change it leaves the number in the box, not saved.
   * @param {string} key
   * @param {number} value
   * @param {import('./unusual.js').Unusual} unusual
   */
  async function askFirst(key, value, unusual) {
    if (await guard.ask(key, value, unusual)) return commit();
    if (state.activeKey === key) {
      notKept(key, value, unusual);
      input.focus();
    }
    return false;
  }

  /**
   * Asks once the tap that left the box has been handled, unless it left
   * the screen or moved on to another meal.
   * @param {string} key
   * @returns {Promise<boolean>}
   */
  function askSoon(key) {
    return new Promise((resolve) => afterTap(() => resolve(track.left || state.activeKey !== key ? false : commit())));
  }

  /**
   * Says under the box why it isn't saved, with Keep it.
   * @param {string} key
   * @param {number} value
   * @param {import('./unusual.js').Unusual} unusual
   */
  function notKept(key, value, unusual) {
    status.set('error', `Not saved yet. ${unusual.reason}`, {
      label: 'Keep it',
      onClick: () => {
        guard.keep(key, value);
        if (state.activeKey === key) commit();
      },
    });
  }

  /**
   * What to ask before saving `result` for the meal shown, or null (also
   * when it needn't be saved).
   * @param {{ value: number | null }} result
   */
  const question = (result) => (needsSave(result) ? guard.question(state.activeKey, result.value) : null);

  /** True when what's in the box is already saved (or empty and nothing was). */
  const settled = () => {
    const result = core.validateCalories(input.value);
    return result.ok && !needsSave(result);
  };
  return { commit, settled, needsSave, question, notKept, track };
}

/**
 * The ways out of the screen: leaving it, and the page being hidden or
 * closed, each save what's in the box first.
 * @param {LogState} state
 * @param {HTMLInputElement} input
 * @param {import('./feedback.js').StatusLine} status
 * @param {ReturnType<typeof mealSaver>} saver
 */
export function mealExits(state, input, status, saver) {
  const { track } = saver;
  /**
   * The screen is being left. A valid number in the box is saved (or the
   * save already under way is waited for) and the next screen says so; so
   * is a save whose "saved" message was still showing, since that message
   * goes with this screen. An invalid one, or one whose save fails, is
   * kept for next time.
   * @param {string} backHash this screen's address, for coming back to fix it
   * @returns {Promise<void> | undefined}
   */
  function leave(backHash) {
    if (track.left) return;
    track.left = true;
    const key = state.activeKey;
    const text = input.value;
    const result = core.validateCalories(text);
    if (!result.ok) {
      keepLeftUnsaved({ field: key, date: state.date, text, error: result.error }, backHash);
      return;
    }
    if (track.closed) return;
    const last = track.lastSave;
    if (!saver.needsSave(result)) {
      if (last && last.key === key && status.el.classList.contains('is-saved')) sayLeftSaved({ field: key, ...last });
      return;
    }
    // A number waiting to be asked about can't be asked about on the way
    // out: it's kept, and asked about when the box is next shown.
    const unusual = saver.question(result);
    if (unusual) {
      keepLeftUnsaved({ field: key, date: state.date, text, error: unusual.reason, ask: true }, backHash);
      return;
    }
    return saver.commit().then((ok) => {
      const saved = track.lastSave;
      if (ok && saved && saved.key === key) sayLeftSaved({ field: key, ...saved });
      else if (!ok) keepLeftUnsaved({ field: key, date: state.date, text, error: track.failure }, backHash);
    });
  }

  // Saves what's in the box when the page is hidden or closed, exactly as
  // leaving the box would; a value that can't be saved, or whose save
  // fails, is kept as a draft.
  function flush() {
    if (track.left) return;
    const key = state.activeKey;
    const text = input.value;
    const result = core.validateCalories(text);
    const unusual = result.ok ? saver.question(result) : null;
    if (unusual && result.ok && result.value !== null) {
      keepDraft({ field: key, date: state.date, text, error: unusual.reason, ask: true });
      saver.notKept(key, result.value, unusual);
      return;
    }
    if (result.ok) {
      saver.commit().then((ok) => {
        if (!ok) keepDraft({ field: key, date: state.date, text, error: track.failure });
      });
      return;
    }
    keepDraft({ field: key, date: state.date, text, error: result.error });
    status.set('error', result.error);
  }

  const closedWithSave = () => {
    track.closed = true;
  };
  return { leave, flush, closedWithSave };
}
