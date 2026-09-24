// Today's screens follow the calendar: if the app is left open (or resumed
// from the background) past midnight, it moves to the new day unless the
// user deliberately opened a specific date.

import { today } from './dom.js';
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
