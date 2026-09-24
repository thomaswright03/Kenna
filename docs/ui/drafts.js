// Typed-but-unsaved input that can't be saved because it isn't valid, or
// that is far from the user's usual and waits for them to say whether to
// keep it. A screen left with such a value in the Weight or a Calories box
// holds it here until its box is shown again (in this visit or the next),
// which puts it back with the reason it wasn't saved (and asks again).
// Meanwhile Today shows a meal's waiting value in its row and History marks
// the day, so what was typed never quietly reads as "Not logged". If the
// page is hidden or closed while a box holds such a value, it is kept here
// too, and the next visit treats it the same way. Other valid values are
// simply saved.

import { core, prefs, mealLabel, notSavedReason } from './dom.js';
import { showBanner } from './feedback.js';

/**
 * @typedef {{ field: string, date: string, text: string, error: string, ask?: boolean, base?: number | null }} Draft
 *   field is 'weight' or a meal key; ask: a valid value kept until the user
 *   answers whether to save it: one far from the usual (see unusual.js), or
 *   one typed over a value changed elsewhere since (see
 *   changed-elsewhere.js), in which case base is the saved value it was
 *   typed over
 */

// Stored as a list of drafts. Versions before this one stored a single
// draft object under the same key, which is still read.
const KEY = 'unsavedInput';

/** Values held for a box that isn't shown, one per field and day. @type {Draft[]} */
let held = [];
/** The value in the box shown as the page was hidden (it's still there if the page comes back). @type {Draft | null} */
let inBox = null;
/** Drafts from the last visit that no screen has shown yet, by field and day. @type {Set<string>} */
const unseen = new Set();

/**
 * The drafts this window has read, kept or handed to a box, by field and
 * day: what's stored for them is this window's to keep or drop. Any other
 * stored draft was kept by another Kenna window or tab on this device (one
 * closed with a value in its box, say), and is left for the next visit.
 * @type {Set<string>}
 */
const mine = new Set();

/** @param {{ field: string, date: string }} d */
const idOf = (d) => `${d.field}@${d.date}`;

/** The drafts stored now (by any window). @returns {Draft[]} */
function storedDrafts() {
  const text = prefs.get(KEY, null);
  if (!text) return [];
  try {
    const parsed = JSON.parse(text);
    return (Array.isArray(parsed) ? parsed : [parsed]).map(readDraft).filter((d) => d !== null);
  } catch {
    return [];
  }
}

function persist() {
  const box = inBox;
  const own = box ? [...held.filter((d) => idOf(d) !== idOf(box)), box] : held;
  const others = storedDrafts().filter((d) => !mine.has(idOf(d)));
  const all = [...others, ...own];
  if (all.length === 0) prefs.remove(KEY);
  else prefs.set(KEY, JSON.stringify(all));
}

/** @param {Draft} draft */
function hold(draft) {
  mine.add(idOf(draft));
  held = [...held.filter((d) => idOf(d) !== idOf(draft)), draft];
}

/** @param {unknown} d @returns {Draft | null} */
function readDraft(d) {
  if (!d || typeof d !== 'object') return null;
  const o = /** @type {Record<string, unknown>} */ (d);
  if (typeof o.field !== 'string' || typeof o.date !== 'string' || !core.isValidDateStr(o.date) || typeof o.text !== 'string' || typeof o.error !== 'string') return null;
  /** @type {Draft} */
  const draft = { field: o.field, date: o.date, text: o.text, error: o.error, ask: o.ask === true };
  if (o.base === null || (typeof o.base === 'number' && Number.isFinite(o.base))) draft.base = o.base;
  return draft;
}

/**
 * The page is being hidden with this value in its box: kept in case the
 * page is closed, and dropped if it comes back (the box still has it).
 * @param {Draft} draft error: why it wasn't saved (a failed save's message, or what's wrong with it)
 */
export function keepDraft(draft) {
  mine.add(idOf(draft));
  inBox = { ...draft, error: notSavedReason(draft.error) };
  persist();
}

/**
 * A screen was left with a value that can't be saved: it goes back in its
 * box the next time that box is shown, in this visit or the next.
 * @param {Draft} draft
 */
export function holdDraft(draft) {
  hold({ ...draft, error: notSavedReason(draft.error) });
  inBox = null;
  persist();
}

/** The page is back, with the value still in its box: only held values stay kept. */
export function dropStoredDraft() {
  inBox = null;
  persist();
}

/** Reads the drafts left by the previous visit, if any (once, at start). */
export function loadDraftFromLastVisit() {
  held = [];
  inBox = null;
  unseen.clear();
  for (const d of storedDrafts()) {
    hold(d);
    unseen.add(idOf(d));
  }
  persist();
}

/**
 * Hands the draft to the screen showing that field and day.
 * @param {string} field
 * @param {string} date
 * @returns {Draft | null}
 */
export function claimDraft(field, date) {
  const d = held.find((x) => x.field === field && x.date === date);
  if (!d) return null;
  held = held.filter((x) => x !== d);
  unseen.delete(idOf(d));
  persist();
  return d;
}

/**
 * A value was saved for this field and day, so nothing typed for it earlier
 * is waiting any more.
 * @param {string} field
 * @param {string} date
 */
export function settleDraft(field, date) {
  const before = held.length;
  held = held.filter((d) => d.field !== field || d.date !== date);
  unseen.delete(`${field}@${date}`);
  if (held.length !== before) persist();
}

/** @returns {string | null} the meal key of a draft waiting for `date`'s Log screen */
export function draftMealFor(/** @type {string} */ date) {
  const d = held.find((x) => x.field !== 'weight' && x.date === date);
  return d ? d.field : null;
}

/**
 * The number a waiting value stands for, or null when what was typed isn't
 * a number that could be saved.
 * @param {Draft} d
 * @returns {number | null}
 */
export function draftNumber(d) {
  const result = d.field === 'weight' ? core.validateWeight(d.text) : core.validateCalories(d.text);
  return result.ok ? result.value : null;
}

/**
 * Values waiting for a day (or, without one, for every day), for showing
 * where that day appears. A value that has since been saved as it is (in
 * another tab, say) isn't waiting any more.
 * @param {Record<string, import('../core.js').Entry>} entries every stored day
 * @param {string} [date]
 * @param {{ shown?: boolean }} [how] shown: the screen shows them, so they needn't be explained in a banner
 * @returns {Draft[]}
 */
export function waitingDrafts(entries, date, how) {
  for (const d of held) {
    const entry = entries[d.date];
    const stored = entry ? (d.field === 'weight' ? entry.weight : entry.meals[d.field]) : null;
    const n = draftNumber(d);
    if (n !== null && n === stored) settleDraft(d.field, d.date);
  }
  const list = held.filter((d) => date === undefined || d.date === date);
  if (how && how.shown) for (const d of list) unseen.delete(idOf(d));
  return list;
}

/** "Breakfast" or "Weight" @param {string} field */
export const fieldLabel = (field) => (field === 'weight' ? 'Weight' : mealLabel(field));

/**
 * If the first screen shown neither took nor showed a draft from the last
 * visit, explain it in a banner. It stays waiting where its day is shown.
 */
export function reportUnclaimedDraft() {
  for (const d of held) {
    if (!unseen.has(idOf(d))) continue;
    const what = d.field === 'weight' ? 'weight' : `${mealLabel(d.field)} calories`;
    showBanner({
      tone: 'warning',
      message: `The ${what} you typed for ${core.formatRelativeDate(d.date)} (“${d.text.slice(0, 20)}”) wasn't saved. ${d.error}`,
    });
  }
  unseen.clear();
}
