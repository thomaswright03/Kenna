// The Weight box on the Today screen: saves when you leave it (or press
// Enter), and says so under the box; keeps a value that can't be saved as
// a draft, and offers Undo after clearing.

import { core, h, uid, today, errorText } from './dom.js';
import { failureText } from './problems.js';
import { announce, createFieldStatus } from './feedback.js';
import { store } from './store.js';
import { render } from './render.js';
import { saveDateFor } from './day.js';
import { keepDraft, claimDraft, settleDraft } from './drafts.js';
import { sayLeftSaved, keepLeftUnsaved } from './leaving.js';
import { unusualGuard, afterTap } from './unusual.js';

/**
 * The day a screen is showing, shared by its parts: its date (which moves
 * to the new day after midnight on Today), what's stored for it, and
 * whether it has moved.
 * @typedef {{ date: string, entry: import('../core.js').Entry, rolledOver: boolean }} DayView
 */

/** @param {number | null} weight */
const weightText = (weight) => (weight === null ? '' : String(weight));

/**
 * What the Weight box's saving and its ways out share: the last save
 * (while its message shows under the box), why the last save failed, and
 * whether the screen is being left.
 * @typedef {{ lastSave: { date: string, saved: number | null, previous: number | null } | null, failure: string, left: boolean }} WeightTrack
 */

/**
 * Saving what's in the Weight box: when it's left or Enter is pressed,
 * when the page is hidden, and when the screen is left (weightExits). A
 * weight far from the nearest other day's is asked about first (see
 * unusual.js).
 * @param {DayView} view
 * @param {HTMLInputElement} input
 * @param {import('./feedback.js').StatusLine} status
 * @param {import('./unusual.js').UnusualGuard} guard
 */
function weightSaver(view, input, status, guard) {
  /** @type {Promise<boolean> | null} */
  let saving = null;
  /** @type {WeightTrack} */
  const track = { lastSave: null, failure: '', left: false };
  // The save that last failed (day and weight), which is noted in the
  // problem log. Leaving the box doesn't try it again (Retry is under the
  // box), and it failing again as the screen is left isn't noted again;
  // Retry is, since the user asked for it.
  let failed = '';

  /**
   * @param {number | null} value
   * @param {number | null} previous
   * @param {boolean} retry the user asked for it again (Retry)
   * @returns {Promise<boolean>}
   */
  async function save(value, previous, retry) {
    const target = saveDateFor(view);
    status.set('pending', 'Saving…');
    try {
      view.entry = await store.updateEntry(target, { weight: value });
      settleDraft('weight', target);
      failed = '';
      track.lastSave = { date: target, saved: value, previous };
      if (value !== null) status.set('saved', 'Saved');
      else if (previous !== null) status.set('saved', 'Weight cleared', { label: 'Undo', onClick: () => putBack(previous) });
      else status.set('saved', 'Weight cleared');
      if (view.rolledOver && !track.left) render();
      return true;
    } catch (err) {
      const attempt = `${target} ${value}`;
      track.failure = retry || attempt !== failed ? failureText('Save the weight', err) : errorText(err);
      failed = attempt;
      status.set('error', track.failure, { label: 'Retry', onClick: () => commit({ retry: true }) });
      return false;
    }
  }

  /** @param {{ value: number | null }} result */
  const isSaved = (result) => result.value === view.entry.weight && !view.rolledOver;
  /** What to ask before saving `result`, or null. @param {{ value: number | null }} result */
  const question = (result) => (isSaved(result) ? null : guard.question('weight', result.value));

  /**
   * @param {{ left?: boolean, retry?: boolean }} [how] left: the box was
   *   left (its change event), so a weight to ask about waits for the tap
   *   that left it; retry: Retry was pressed
   * @returns {Promise<boolean>}
   */
  function commit(how) {
    const result = core.validateWeight(input.value);
    if (!result.ok) {
      status.set('error', result.error);
      return Promise.resolve(false);
    }
    if (isSaved(result)) {
      if (status.el.classList.contains('is-error')) status.set(null);
      return Promise.resolve(true);
    }
    if (saving) return saving;
    if (how && how.left && failed === `${view.date} ${result.value}`) return Promise.resolve(false);
    const unusual = question(result);
    if (unusual && result.value !== null) return how && how.left ? askSoon() : askFirst(result.value, unusual);
    saving = save(result.value, view.entry.weight, !!(how && how.retry)).finally(() => (saving = null));
    return saving;
  }

  /**
   * Keep it saves the weight; Change it leaves it in the box, not saved.
   * @param {number} value
   * @param {import('./unusual.js').Unusual} unusual
   */
  async function askFirst(value, unusual) {
    // The weight now in the box passes the rules, so an error about an
    // earlier one no longer describes it (see log-saving.js).
    if (status.el.classList.contains('is-error')) status.set(null);
    if (await guard.ask('weight', value, unusual)) return commit();
    notKept(value, unusual);
    input.focus();
    return false;
  }

  /** Asks once the tap that left the box has been handled, unless it left the screen. */
  function askSoon() {
    return new Promise((/** @type {(ok: boolean | Promise<boolean>) => void} */ resolve) => afterTap(() => resolve(track.left ? false : commit())));
  }

  /**
   * Says under the box why it isn't saved, with Keep it.
   * @param {number} value
   * @param {import('./unusual.js').Unusual} unusual
   */
  function notKept(value, unusual) {
    status.set('error', `Not saved yet. ${unusual.reason}`, {
      label: 'Keep it',
      onClick: () => {
        guard.keep('weight', value);
        commit();
      },
    });
  }

  // Undo after clearing: the weight that was there goes back in the box
  // and is saved again.
  /** @param {number} previous */
  async function putBack(previous) {
    input.value = weightText(previous);
    if (await commit()) announce(`Weight put back: ${core.formatWeight(previous)}.`);
  }

  return { commit, isSaved, question, notKept, track };
}

/**
 * The ways out: the page being hidden or closed, and the screen being
 * left. Neither can wait for an answer about a weight far from the usual,
 * so such a weight is kept and asked about when the box is next shown.
 * @param {DayView} view
 * @param {HTMLInputElement} input
 * @param {import('./feedback.js').StatusLine} status
 * @param {ReturnType<typeof weightSaver>} saver
 */
function weightExits(view, input, status, saver) {
  const { track } = saver;
  // Saves what's in the box when the page is hidden or closed, exactly as
  // leaving the box would; a value that can't be saved, or whose save
  // fails, is kept as a draft.
  function flush() {
    if (track.left) return;
    const text = input.value;
    const result = core.validateWeight(text);
    const unusual = result.ok ? saver.question(result) : null;
    if (unusual && result.ok && result.value !== null) {
      keepDraft({ field: 'weight', date: view.date, text, error: unusual.reason, ask: true });
      saver.notKept(result.value, unusual);
    } else if (result.ok) {
      saver.commit().then((ok) => {
        if (!ok) keepDraft({ field: 'weight', date: view.date, text, error: track.failure });
      });
    } else {
      keepDraft({ field: 'weight', date: view.date, text, error: result.error });
      status.set('error', result.error);
    }
  }

  // Leaving Today (for another screen or another day) saves what's in the
  // box, as leaving the box does, and the next screen says so, as it does
  // for a save whose "Saved" was still showing; a value that can't be
  // saved, or whose save fails, is kept for when this day is shown again.
  /** @param {string} backHash @returns {Promise<void> | undefined} */
  function leave(backHash) {
    if (track.left) return;
    track.left = true;
    const text = input.value;
    const result = core.validateWeight(text);
    if (!result.ok) {
      keepLeftUnsaved({ field: 'weight', date: view.date, text, error: result.error }, backHash);
      return;
    }
    const unusual = saver.question(result);
    if (unusual) {
      keepLeftUnsaved({ field: 'weight', date: view.date, text, error: unusual.reason, ask: true }, backHash);
      return;
    }
    if (saver.isSaved(result)) {
      if (track.lastSave && status.el.classList.contains('is-saved')) sayLeftSaved({ field: 'weight', ...track.lastSave });
      return;
    }
    return saver.commit().then((ok) => {
      if (ok && track.lastSave) sayLeftSaved({ field: 'weight', ...track.lastSave });
      else if (!ok) keepLeftUnsaved({ field: 'weight', date: view.date, text, error: track.failure }, backHash);
    });
  }

  return { flush, leave };
}

/**
 * @param {DayView} view
 * @param {Record<string, import('../core.js').Entry>} entries every stored day, for noticing a weight far from the others
 * @returns {{ root: HTMLElement, flush: () => void, leave: (backHash: string) => Promise<void> | undefined, mounted: () => void, refresh: () => void }}
 */
export function buildWeightField(view, entries) {
  const input = h('input', {
    type: 'text',
    inputmode: 'decimal',
    autocomplete: 'off',
    id: uid('weight'),
    placeholder: 'e.g. 180.4',
    value: weightText(view.entry.weight),
  });
  const status = createFieldStatus(input);
  // How it saves, said before anything is typed; a status (Saving…, Saved,
  // an error) shows in its place while there is one.
  const hint = h('p', { class: 'field-hint', id: uid('weight-hint'), text: 'Saves when you leave the box' });
  input.setAttribute('aria-describedby', `${status.el.id} ${hint.id}`);
  const guard = unusualGuard((field, value) => core.unusualValue(entries, view.date, field, value, today()));
  const saver = weightSaver(view, input, status, guard);
  const exits = weightExits(view, input, status, saver);

  const draft = claimDraft('weight', view.date);
  if (draft) input.value = draft.text;

  input.addEventListener('change', () => saver.commit({ left: true }));
  input.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    saver.commit();
  });

  return {
    root: h('div', { class: 'field' }, h('label', { for: input.id, text: 'Weight (lbs)' }), input, status.el, hint),
    flush: exits.flush,
    leave: exits.leave,
    mounted: () => {
      if (!draft) return;
      // A weight kept to be asked about is asked about now (Change it then
      // says why it isn't saved); any other says why it wasn't saved.
      if (draft.ask) saver.commit();
      else status.set('error', `Not saved yet. ${draft.error}`);
    },
    refresh: () => {
      if (document.activeElement !== input) input.value = weightText(view.entry.weight);
    },
  };
}
