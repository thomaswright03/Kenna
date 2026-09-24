// Typed-but-unsaved input that can't be saved because it isn't valid. If
// the page is hidden or closed while the Weight or a Calories box holds
// such a value, it is kept here, and the next visit puts it back in its box
// with the reason it wasn't saved (or, on another screen, says so in a
// banner). The same goes for leaving the screen with such a value in the
// box. Valid values are simply saved instead.

import { core, prefs, mealLabel, notSavedReason } from './dom.js';
import { showBanner } from './feedback.js';

/** @typedef {{ field: string, date: string, text: string, error: string }} Draft field is 'weight' or a meal key */

const KEY = 'unsavedInput';

/** @type {Draft | null} */
let pending = null;

/** @param {Draft} draft error: why it wasn't saved (a failed save's message, or what's wrong with it) */
export function keepDraft(draft) {
  prefs.set(KEY, JSON.stringify({ ...draft, error: notSavedReason(draft.error) }));
}

/**
 * A screen was left with a value that can't be saved: it goes back in its
 * box the next time that box is shown, in this visit or the next.
 * @param {Draft} draft
 */
export function holdDraft(draft) {
  pending = { ...draft, error: notSavedReason(draft.error) };
  keepDraft(pending);
}

/**
 * The page is back, with the value still in its box: nothing to restore,
 * except a value held from a screen left earlier.
 */
export function dropStoredDraft() {
  if (pending) keepDraft(pending);
  else prefs.remove(KEY);
}

/** Reads the draft left by the previous visit, if any (once, at start). */
export function loadDraftFromLastVisit() {
  const text = prefs.get(KEY, null);
  prefs.remove(KEY);
  if (!text) return;
  try {
    const d = JSON.parse(text);
    if (d && typeof d.field === 'string' && core.isValidDateStr(d.date) && typeof d.text === 'string' && typeof d.error === 'string') {
      pending = { field: d.field, date: d.date, text: d.text, error: d.error };
    }
  } catch {
    pending = null;
  }
}

/**
 * Hands the draft to the screen showing that field and day.
 * @param {string} field
 * @param {string} date
 * @returns {Draft | null}
 */
export function claimDraft(field, date) {
  if (!pending || pending.field !== field || pending.date !== date) return null;
  const d = pending;
  pending = null;
  prefs.remove(KEY);
  return d;
}

/** @returns {string | null} the meal key of a draft waiting for `date`'s Log screen */
export function draftMealFor(/** @type {string} */ date) {
  return pending && pending.field !== 'weight' && pending.date === date ? pending.field : null;
}

/** If the first screen shown didn't take the draft, explain it in a banner. */
export function reportUnclaimedDraft() {
  if (!pending) return;
  const d = pending;
  pending = null;
  const what = d.field === 'weight' ? 'weight' : `${mealLabel(d.field)} calories`;
  showBanner({
    tone: 'warning',
    message: `The ${what} you typed for ${core.formatRelativeDate(d.date)} (“${d.text.slice(0, 20)}”) wasn't saved. ${d.error}`,
  });
}
