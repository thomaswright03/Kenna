// Today's screens follow the calendar: if the app is left open (or resumed
// from the background) past midnight, it moves to the new day unless the
// user deliberately opened a specific date.

import { core, h, uid, today } from './dom.js';
import { route } from './router.js';

let knownToday = today();

/**
 * Notes a change of calendar day.
 * @returns {boolean} true when the day has changed since last checked
 */
export function dayHasChanged() {
  const now = today();
  if (now === knownToday) return false;
  knownToday = now;
  return true;
}

/**
 * The date a save should go to right now. Checked immediately before every
 * save, so a meal logged after midnight lands on the new day.
 * @param {{ date: string, rolledOver: boolean }} view
 */
export function saveDateFor(view) {
  const now = today();
  if (now !== knownToday) knownToday = now;
  if (!route.date && view.date !== now) {
    view.date = now;
    view.rolledOver = true;
  }
  return view.date;
}

// Days confirmed this session as really meant, though far back.
/** @type {Set<string>} */
const confirmedFarBack = new Set();

/**
 * For a day long before anything logged (probably a mistyped year), a note
 * that asks before anything can be logged there; null for any other day.
 * @param {string} date
 * @param {Record<string, import('../core.js').Entry>} entries
 * @param {() => void} onConfirm runs once the user says it's the day they meant
 * @returns {HTMLElement | null}
 */
export function farBackGate(date, entries, onConfirm) {
  const now = today();
  if (confirmedFarBack.has(date)) return null;
  const logged = Object.values(entries)
    .filter((e) => !core.isEntryEmpty(e))
    .map((e) => e.date)
    .sort();
  if (!core.isFarBack(date, now, logged.length ? logged[0] : null)) return null;
  const years = core.yearsBetween(date, now);
  const when = `${core.formatDate(date, now)} is ${years} year${years === 1 ? '' : 's'} ago`;
  const titleId = uid('far-back');
  const confirmBtn = h('button', { type: 'button', class: 'btn btn-secondary', text: `Log ${date.slice(0, 4)}` });
  confirmBtn.addEventListener('click', () => {
    confirmedFarBack.add(date);
    onConfirm();
  });
  return h(
    'div',
    { class: 'far-back', role: 'group', 'aria-labelledby': titleId, 'data-far-back': '' },
    h('p', { class: 'notice-title', id: titleId, text: `Log a day in ${date.slice(0, 4)}?` }),
    h('p', {
      class: 'notice-text',
      text: `${when}${logged.length ? ', long before anything else you’ve logged' : ''}. Check the year: nothing can be logged here until you confirm it’s the day you meant.`,
    }),
    h('div', { class: 'notice-actions' }, h('a', { class: 'btn btn-primary', href: '#/', text: 'Back to today' }), confirmBtn)
  );
}
