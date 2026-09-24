// A box's saved value changing while the box is open: in another Kenna
// window or tab, which shares this device's storage, or by an Undo on this
// one. Each box remembers the saved value what's in it started from.
//
// - A box nobody has typed a different number in simply shows the new
//   value, so leaving it, or hiding or closing the page, saves nothing.
// - A box with another number typed in it is never saved over the new
//   value without asking. It says so under the box at once (with a button
//   to take the new value); saving it asks which to keep; and a way out
//   that can't ask (the page hidden or closed, another screen opened) keeps
//   what was typed, unsaved, and asks when the box is next shown.

import { h, uid } from './dom.js';
import { openDialog } from './feedback.js';

/**
 * One box, as this needs it.
 * @typedef {object} Box
 * @property {() => string} name "Breakfast", "Weight"
 * @property {() => number | null} stored what's saved for it now
 * @property {() => import('../core/input.js').Validation} typed what's in the box
 * @property {(value: number | null) => void} show puts a saved value in the box (and redraws what depends on it)
 * @property {(value: number) => string} format "450 cal", "180.4 lbs"
 * @property {import('./feedback.js').StatusLine} status the line under the box
 * @property {() => void} focus
 * @property {() => boolean} [moved] the box's day moved on at midnight, so its saves go to a new day whatever the old one holds
 */

/** @typedef {'typed' | 'stored' | null} Choice null: the question was closed without an answer */

/**
 * Asks which value to keep: the one saved now, or the one typed.
 * @param {{ name: string, stored: number | null, typed: number | null, where: string, format: (value: number) => string }} q
 * @returns {Promise<Choice>}
 */
function askWhich(q) {
  const labelId = uid('dlg');
  const title = q.stored === null ? `${q.name} was cleared${q.where}` : `${q.name} was changed${q.where}`;
  const now = q.stored === null ? 'Nothing is saved for it now.' : `It's saved as ${q.format(q.stored)} now.`;
  const yours = q.typed === null ? 'You cleared it here.' : `You typed ${q.format(q.typed)} here.`;
  const keepBtn = h('button', { type: 'button', class: 'btn btn-secondary', text: q.stored === null ? 'Leave it empty' : `Keep ${q.format(q.stored)}` });
  const useBtn = h('button', { type: 'button', class: 'btn btn-primary', text: q.typed === null ? 'Clear it' : `Save ${q.format(q.typed)}` });
  const content = h(
    'div',
    { class: 'dialog-body' },
    h('h2', { id: labelId, class: 'dialog-title', text: title }),
    h('p', { class: 'dialog-text', text: `${now} ${yours} Which should be kept?` }),
    h('div', { class: 'dialog-actions' }, keepBtn, useBtn)
  );
  return new Promise((resolve) => {
    const close = openDialog({ labelId, content, initialFocus: keepBtn, onClose: (v) => resolve(v === 'typed' || v === 'stored' ? v : null) });
    keepBtn.addEventListener('click', () => close('stored'));
    useBtn.addEventListener('click', () => close('typed'));
  });
}

/**
 * Keeps track of the saved value a box started from.
 * @param {Box} box
 */
export function boxBase(box) {
  let base = box.stored();
  // Where the last change came from, for saying so: " in another window",
  // or nothing (an Undo here).
  let where = '';

  /** Something typed that isn't what's saved, and the saved value changed under it. */
  const changed = () => !(box.moved && box.moved()) && box.stored() !== base;

  /** "Breakfast was changed to 450 cal in another window." */
  function reason() {
    const stored = box.stored();
    return stored === null ? `${box.name()} was cleared${where}.` : `${box.name()} was changed to ${box.format(stored)}${where}.`;
  }

  function useStored() {
    base = box.stored();
    box.show(base);
    box.status.set(null);
  }

  /** Says under the box that what's typed isn't saved, and why. */
  function note() {
    const stored = box.stored();
    box.status.set('error', `Not saved yet. ${reason()}`, { label: stored === null ? 'Leave it empty' : `Use ${box.format(stored)}`, onClick: useStored });
  }

  /** The question open now. @type {Promise<Choice> | null} */
  let pending = null;
  /**
   * Asks which to keep. "typed": save it (the question is settled);
   * "stored": the box shows the saved value; null: nothing changes.
   * Every way of saving at the same moment shares the one question.
   * @param {number | null} typed
   * @returns {Promise<Choice>}
   */
  function ask(typed) {
    if (!pending) pending = answer(typed).finally(() => (pending = null));
    return pending;
  }
  /** @param {number | null} typed @returns {Promise<Choice>} */
  async function answer(typed) {
    const stored = box.stored();
    const choice = await askWhich({ name: box.name(), stored, typed, where, format: box.format });
    if (choice === 'typed') base = stored;
    else if (choice === 'stored') {
      useStored();
      box.status.set('saved', base === null ? `${box.name()} left empty` : `Kept ${box.format(base)}`);
    } else note();
    return choice;
  }

  return {
    /** The box now shows what's saved (a meal was picked, or its value saved). @param {number | null} [value] */
    reset(value) {
      base = value === undefined ? box.stored() : value;
    },
    /** The saved value a kept value was typed over (see drafts.js). */
    base: () => base,
    changed,
    reason,
    note,
    /**
     * The saved value may have changed (read again after a change made
     * elsewhere): the box follows it, or says it's in the way.
     * @param {boolean} elsewhere the change was made in another window or tab
     */
    refresh(elsewhere) {
      const stored = box.stored();
      if (stored === base || (box.moved && box.moved())) return;
      where = elsewhere ? ' in another window' : '';
      const typed = box.typed();
      if (typed.ok && typed.value === stored) {
        // What's typed is what's saved now: nothing is in the way.
        base = stored;
        if (box.status.el.classList.contains('is-error')) box.status.set(null);
      } else if (typed.ok && typed.value === base) {
        base = stored;
        box.show(stored);
        box.status.set('saved', stored === null ? `${box.name()} cleared${where}` : `${box.name()} changed to ${box.format(stored)}${where}`);
      } else {
        note();
      }
    },
    /**
     * Asks, then saves what's typed if that's the answer. True when the
     * box is settled: saved, or showing the saved value.
     * @param {number | null} typed
     * @param {() => boolean} stillHere false once the box shows something else (another meal, another screen)
     * @param {() => Promise<boolean>} save
     * @returns {Promise<boolean>}
     */
    async settle(typed, stillHere, save) {
      const choice = await ask(typed);
      if (!stillHere()) return false;
      if (choice === 'typed') return save();
      if (choice === 'stored') return true;
      box.focus();
      return false;
    },
  };
}

/** @typedef {ReturnType<typeof boxBase>} BoxBase */
