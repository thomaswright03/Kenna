// Leaving a screen while a box holds something typed. Every way out (an
// on-screen Back button, a tab, the phone's Back gesture) follows the same
// rule as leaving the box: a value that can be saved is saved, and a
// message on the next screen says so, with Undo; a value that can't be
// saved is kept for when that box is shown again, and the message says why.

import { core, mealLabel, today } from './dom.js';
import { toast } from './feedback.js';
import { store } from './store.js';
import { navigate } from './router.js';
import { refreshCurrentScreen } from './render.js';
import { holdDraft } from './drafts.js';
import { failureText } from './problems.js';

/**
 * What a box holds: the weight, or one meal's calories.
 * @typedef {'weight' | string} Field
 */

/** @param {Field} field */
const fieldName = (field) => (field === 'weight' ? 'Weight' : mealLabel(field));

/** @param {Field} field @param {number} value */
const valueText = (field, value) => (field === 'weight' ? core.formatWeight(value) : core.formatCalories(value));

/** " for yesterday", " for Tue, Sep 22", or nothing for today. @param {string} date */
function forDay(date) {
  const when = core.formatRelativeDate(date, today());
  if (when === 'Today') return '';
  return ` for ${when === 'Yesterday' ? 'yesterday' : when}`;
}

/** @param {import('../core.js').Entry | null} entry @param {Field} field */
function storedValue(entry, field) {
  if (!entry) return null;
  return field === 'weight' ? entry.weight : entry.meals[field];
}

/** @param {Field} field @param {number | null} value @returns {import('../core.js').EntryPatch} */
function patchFor(field, value) {
  return field === 'weight' ? { weight: value } : { meals: { [field]: value } };
}

/**
 * Puts back what the box held before it was saved on the way out, unless
 * it has been changed again since.
 * @param {{ field: Field, date: string, saved: number | null, previous: number | null }} s
 */
async function undoSave(s) {
  const name = fieldName(s.field);
  try {
    const current = await store.getEntry(s.date);
    if (storedValue(current, s.field) !== s.saved) {
      toast(`${name} has been changed again since, so it was left as it is.`);
      return;
    }
    await store.updateEntry(s.date, patchFor(s.field, s.previous));
  } catch (err) {
    toast(`${name} not put back. ${failureText('Undo a save', err)}`, { tone: 'error' });
    return;
  }
  toast(s.previous === null ? `${name}${forDay(s.date)} is empty again` : `${name}${forDay(s.date)} is back to ${valueText(s.field, s.previous)}`);
  refreshCurrentScreen();
}

/**
 * Says, on the screen being opened, what was saved on the way out.
 * @param {{ field: Field, date: string, saved: number | null, previous: number | null }} s
 */
export function sayLeftSaved(s) {
  const name = fieldName(s.field);
  const what = s.saved === null ? `${name} cleared` : `${name} saved: ${valueText(s.field, s.saved)}`;
  toast(`${what}${forDay(s.date)}`, { action: { label: 'Undo', onClick: () => undoSave(s) } });
}

/**
 * Keeps a value that can't be saved for when its box is shown again, and
 * says so, with a way straight back to it.
 * @param {{ field: Field, date: string, text: string, error: string }} draft
 * @param {string} backHash the address of the screen with that box
 */
export function keepLeftUnsaved(draft, backHash) {
  holdDraft(draft);
  const typed = draft.text.trim().slice(0, 20);
  toast(`${fieldName(draft.field)} not saved (“${typed}”). ${draft.error}`, { action: { label: 'Fix it', onClick: () => navigate(backHash) } });
}
