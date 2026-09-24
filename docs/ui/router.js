// Each screen has its own address, so Back moves between screens inside the
// app and a refresh stays put:
//   #/                 today          #/day/2026-09-21        a past day
//   #/log[/meal]       log today      #/day/2026-09-21/log[/meal]  log a past day
//   #/history  #/compare  #/photos  #/settings
// Any other address, or one with a part added that means nothing, leads
// nowhere: Today (or the day it names) is shown, with a message saying so.

import { core, today } from './dom.js';
import { toast, clearToastsOnNavigation } from './feedback.js';

/**
 * @typedef {'today' | 'log' | 'history' | 'compare' | 'photos' | 'settings'} ScreenName
 * @typedef {{ screen: ScreenName, date: string | null, meal?: string | null, future?: boolean, notShown?: string }} Route
 *   future: the address named a day after today; notShown: why the address
 *   it came from led nowhere (a date that doesn't exist, or no date at all)
 */

const NO_SUCH_DATE = "That date doesn't exist, so Today is shown.";
const OUT_OF_RANGE = 'Kenna opens days from 1900 to 2999, so Today is shown.';
const NOWHERE = "That address doesn't lead anywhere, so Today is shown.";

/**
 * Why a day's address isn't a day: a date that doesn't exist (Feb 30), a
 * year Kenna doesn't keep, or something that isn't a date at all.
 * @param {string} text
 */
function notADay(text) {
  const parts = /^(\d{4})-\d{2}-\d{2}$/.exec(text);
  if (!parts) return NOWHERE;
  const year = Number(parts[1]);
  return year < 1900 || year > 2999 ? OUT_OF_RANGE : NO_SUCH_DATE;
}

/** @type {ScreenName[]} */
const SCREENS = ['history', 'compare', 'photos', 'settings'];

/**
 * An address with a day in it that leads nowhere as a whole (a mistyped
 * word after the day, or a day where a meal belongs, as in
 * #/log/2026-09-20): that day is shown, and the message says so. It is
 * never swapped for today, which would log that day's meals against today.
 * @param {string} date a valid date
 * @returns {Route}
 */
function strayDay(date) {
  const now = today();
  if (core.isFutureDate(date, now)) return { screen: 'today', date: null, future: true };
  const shown = date === now ? 'Today' : core.formatDate(date, now);
  return { screen: 'today', date, notShown: `That address doesn't lead anywhere, so ${shown} is shown.` };
}

/**
 * Every part of an address must mean something: one that doesn't
 * (#/history/foo, #/log/brunch) leads nowhere, and says so.
 * @param {string} hash
 * @returns {Route}
 */
function parseRoute(hash) {
  const parts = String(hash || '')
    .replace(/^#\/?/, '')
    .split('/')
    .filter(Boolean);
  /** @type {Route} */
  const nowhere = { screen: 'today', date: null, notShown: NOWHERE };
  /** A meal's address after "log": nothing (the first meal not logged) or one meal. @param {string[]} rest */
  const logMeal = (rest) => (rest.length === 0 ? null : rest.length === 1 && core.MEAL_KEYS.includes(rest[0]) ? rest[0] : undefined);
  if (parts.length === 0) return { screen: 'today', date: null };
  if (parts[0] === 'log') {
    const meal = logMeal(parts.slice(1));
    if (meal !== undefined) return { screen: 'log', date: null, meal };
    return core.isValidDateStr(parts[1]) ? strayDay(parts[1]) : nowhere;
  }
  if (parts[0] === 'day' && core.isValidDateStr(parts[1])) {
    const date = parts[1];
    if (core.isFutureDate(date, today())) return { screen: 'today', date: null, future: true };
    if (parts.length === 2) return { screen: 'today', date };
    const meal = parts[2] === 'log' ? logMeal(parts.slice(3)) : undefined;
    return meal === undefined ? strayDay(date) : { screen: 'log', date, meal };
  }
  if (parts[0] === 'day' && parts.length > 1) return { screen: 'today', date: null, notShown: notADay(parts[1]) };
  const screen = SCREENS.find((s) => s === parts[0]);
  if (screen && parts.length === 1) return { screen, date: null };
  return nowhere;
}

/** @param {string | null} date */
export function dayHash(date) {
  return !date || date === today() ? '#/' : `#/day/${date}`;
}

/** @param {string | null} date @param {string | null | undefined} meal */
export function logHash(date, meal) {
  const base = date ? `#/day/${date}/log` : '#/log';
  return meal ? `${base}/${meal}` : base;
}

/** @param {Route} r */
function routeHash(r) {
  if (r.screen === 'today') return r.date ? `#/day/${r.date}` : '#/';
  if (r.screen === 'log') return logHash(r.date, r.meal);
  return `#/${r.screen}`;
}

const currentHash = () => routeHash(parseRoute(window.location.hash));

/**
 * An address that doesn't lead anywhere valid (mistyped, an old bookmark,
 * a day in the future) is replaced by the address of what's
 * actually shown, without adding a history entry, so refreshing or
 * bookmarking doesn't bring the bad address back.
 * @param {Route} r the route parsed from the current address
 */
function settleAddress(r) {
  const canonical = routeHash(r);
  const actual = window.location.hash || '#/';
  if (actual !== canonical && !(canonical === '#/' && (actual === '#' || actual === '#/'))) {
    window.history.replaceState(window.history.state, '', canonical);
  }
  if (r.future) toast(core.FUTURE_DAY);
  else if (r.notShown) toast(r.notShown);
}

/** The screen being shown. */
export let route = parseRoute(window.location.hash);

/** Addresses visited inside the app, oldest first. */
const visited = [currentHash()];
let replacing = false;

/** @type {(options?: { focus?: boolean }) => unknown} */
let renderFn = () => undefined;

/**
 * Starts following address changes; `render` draws the current route.
 * @param {(options?: { focus?: boolean }) => unknown} render
 */
export function startRouter(render) {
  renderFn = render;
  visited.length = 0;
  visited.push(currentHash());
  route = parseRoute(window.location.hash);
  settleAddress(route);
  window.addEventListener('hashchange', onHashChange);
}

function onHashChange() {
  clearToastsOnNavigation();
  settleAddress(parseRoute(window.location.hash));
  const hash = currentHash();
  if (replacing) {
    replacing = false;
    visited[visited.length - 1] = hash;
  } else if (visited.length >= 2 && visited[visited.length - 2] === hash) {
    visited.pop();
  } else {
    visited.push(hash);
  }
  route = parseRoute(hash);
  renderFn({ focus: true });
}

/** @param {string} hash */
export function navigate(hash) {
  if (currentHash() === hash) renderFn({ focus: true });
  else window.location.hash = hash;
}

/**
 * Returns to `hash`: steps back if that's where the user came from (so Back
 * doesn't bounce into the screen just left), otherwise replaces.
 * @param {string} hash
 */
export function returnTo(hash) {
  if (visited.length >= 2 && visited[visited.length - 2] === hash) {
    window.history.back();
  } else if (currentHash() !== hash) {
    replacing = true;
    window.location.replace(hash);
  }
}

/**
 * Changes the address without a new history entry or a re-render.
 * @param {string} hash
 */
export function replaceHashSilently(hash) {
  window.history.replaceState(window.history.state, '', hash);
  visited[visited.length - 1] = hash;
  route = parseRoute(hash);
}

export function updateTabs() {
  const active = route.screen === 'log' ? 'today' : route.screen;
  document.querySelectorAll('[data-tab]').forEach((tab) => {
    if (tab instanceof HTMLElement && tab.dataset.tab === active) tab.setAttribute('aria-current', 'page');
    else tab.removeAttribute('aria-current');
  });
}
