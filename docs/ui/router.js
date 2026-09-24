// Each screen has its own address, so Back moves between screens inside the
// app and a refresh stays put:
//   #/                 today          #/day/2026-09-21        a past day
//   #/log[/meal]       log today      #/day/2026-09-21/log    log a past day
//   #/history  #/compare  #/photos  #/settings

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
 * @param {string} hash
 * @returns {Route}
 */
function parseRoute(hash) {
  const parts = String(hash || '')
    .replace(/^#\/?/, '')
    .split('/')
    .filter(Boolean);
  /** @param {string | undefined} k */
  const mealKey = (k) => (k && core.MEAL_KEYS.includes(k) ? k : null);
  if (parts.length === 0) return { screen: 'today', date: null };
  if (parts[0] === 'log') return { screen: 'log', date: null, meal: mealKey(parts[1]) };
  if (parts[0] === 'day' && core.isValidDateStr(parts[1])) {
    if (core.isFutureDate(parts[1], today())) return { screen: 'today', date: null, future: true };
    if (parts[2] === 'log') return { screen: 'log', date: parts[1], meal: mealKey(parts[3]) };
    return { screen: 'today', date: parts[1] };
  }
  if (parts[0] === 'day' && parts.length > 1) return { screen: 'today', date: null, notShown: notADay(parts[1]) };
  const screen = SCREENS.find((s) => s === parts[0]);
  if (screen) return { screen, date: null };
  return { screen: 'today', date: null, notShown: NOWHERE };
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
