// The Weight box on the Today screen: saves when you leave it (or press
// Enter), and says so under the box; keeps a value that can't be saved as
// a draft, and offers Undo after clearing.

import { core, h, uid } from './dom.js';
import { failureText } from './problems.js';
import { announce, createFieldStatus } from './feedback.js';
import { store } from './store.js';
import { render } from './render.js';
import { saveDateFor } from './day.js';
import { keepDraft, claimDraft } from './drafts.js';

/**
 * The day a screen is showing, shared by its parts: its date (which moves
 * to the new day after midnight on Today), what's stored for it, and
 * whether it has moved.
 * @typedef {{ date: string, entry: import('../core.js').Entry, rolledOver: boolean }} DayView
 */

/** @param {number | null} weight */
const weightText = (weight) => (weight === null ? '' : String(weight));

/**
 * @param {DayView} view
 * @returns {{ root: HTMLElement, flush: () => void, mounted: () => void, refresh: () => void }}
 */
export function buildWeightField(view) {
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
  /** @type {Promise<boolean> | null} */
  let saving = null;

  /** @param {number | null} value @param {number | null} previous @returns {Promise<boolean>} */
  async function save(value, previous) {
    const target = saveDateFor(view);
    status.set('pending', 'Saving…');
    try {
      view.entry = await store.updateEntry(target, { weight: value });
      if (value !== null) status.set('saved', 'Saved');
      else if (previous !== null) status.set('saved', 'Weight cleared', { label: 'Undo', onClick: () => putBack(previous) });
      else status.set('saved', 'Weight cleared');
      if (view.rolledOver) render();
      return true;
    } catch (err) {
      status.set('error', failureText('Save the weight', err), { label: 'Retry', onClick: () => commit() });
      return false;
    }
  }

  /** @returns {Promise<boolean>} */
  function commit() {
    const result = core.validateWeight(input.value);
    if (!result.ok) {
      status.set('error', result.error);
      return Promise.resolve(false);
    }
    if (result.value === view.entry.weight && !view.rolledOver) {
      if (status.el.classList.contains('is-error')) status.set(null);
      return Promise.resolve(true);
    }
    if (!saving) saving = save(result.value, view.entry.weight).finally(() => (saving = null));
    return saving;
  }

  // Undo after clearing: the weight that was there goes back in the box
  // and is saved again.
  /** @param {number} previous */
  async function putBack(previous) {
    input.value = weightText(previous);
    if (await commit()) announce(`Weight put back: ${core.formatWeight(previous)}.`);
  }

  // Saves what's in the box when the page is hidden or closed, exactly as
  // leaving the box would; a value that can't be saved is kept as a draft.
  function flush() {
    const text = input.value;
    const result = core.validateWeight(text);
    if (result.ok) {
      commit();
    } else {
      keepDraft({ field: 'weight', date: view.date, text, error: result.error });
      status.set('error', result.error);
    }
  }
  const draft = claimDraft('weight', view.date);
  if (draft) input.value = draft.text;

  input.addEventListener('change', () => commit());
  input.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    commit();
  });

  return {
    root: h('div', { class: 'field' }, h('label', { for: input.id, text: 'Weight (lbs)' }), input, status.el, hint),
    flush,
    mounted: () => {
      if (draft) status.set('error', `Not saved yet. ${draft.error}`);
    },
    refresh: () => {
      if (document.activeElement !== input) input.value = weightText(view.entry.weight);
    },
  };
}
