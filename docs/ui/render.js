// Draws the current route. Screens load their data first and only then
// replace the page, and a newer navigation discards an older one's late
// results.

import { h, byId, errorText } from './dom.js';
import { closeAllDialogs } from './feedback.js';
import { route, updateTabs } from './router.js';

/**
 * What a screen builder returns.
 * @typedef {object} View
 * @property {HTMLElement} root
 * @property {string} title names the screen in the browser tab and history
 * @property {() => void} [mounted] runs once the view is on the page
 * @property {() => Promise<void>} [refreshFromStorage] re-reads data changed elsewhere (another tab)
 * @property {() => void} [release] frees resources such as object URLs
 * @property {() => void} [flush] saves typed input now (the page is being hidden or closed)
 */

/**
 * Passed to each screen builder.
 * @typedef {object} ScreenContext
 * @property {import('./router.js').Route} route
 * @property {() => boolean} isCurrent false once a newer render has started
 * @property {(fn: () => void) => void} onRelease runs `fn` when the view is replaced
 */

/** @typedef {(ctx: ScreenContext) => Promise<View>} ScreenBuilder */

/** @type {Record<string, ScreenBuilder>} */
let builders = {};

/** @param {Record<string, ScreenBuilder>} screens */
export function registerScreens(screens) {
  builders = screens;
}

let renderSeq = 0;
/** @type {View | null} */
let currentView = null;

export const getCurrentView = () => currentView;

/**
 * Shows data changed elsewhere (another tab, or an Undo offered on another
 * screen) on the screen that's open: in place where the screen can, or by
 * drawing History or Compare again.
 */
export function refreshCurrentScreen() {
  if (currentView && currentView.refreshFromStorage) currentView.refreshFromStorage().catch(() => {});
  else if (route.screen === 'history' || route.screen === 'compare') render();
}

/** @param {{ focus?: boolean }} [options] */
export async function render(options) {
  const opts = options || {};
  const main = byId('main');
  const seq = (renderSeq += 1);
  const isCurrent = () => seq === renderSeq;
  closeAllDialogs();
  updateTabs();
  const stopLoading = startLoading(main);
  /** @type {(() => void)[]} */
  const releases = [];
  /** @type {ScreenContext} */
  const ctx = { route, isCurrent, onRelease: (fn) => releases.push(fn) };
  /** @type {View} */
  let view;
  try {
    view = await builders[route.screen](ctx);
  } catch (err) {
    view = errorView(err);
  }
  if (!isCurrent()) {
    releases.forEach((fn) => fn());
    return;
  }
  stopLoading();
  if (currentView && currentView.release) currentView.release();
  view.release = () => releases.forEach((fn) => fn());
  currentView = view;
  main.replaceChildren(view.root);
  document.title = `${view.title} · Kenna`;
  if (opts.focus) {
    const heading = main.querySelector('h2');
    if (heading) {
      heading.setAttribute('tabindex', '-1');
      heading.focus({ preventScroll: true });
    }
    window.scrollTo(0, 0);
  }
  if (view.mounted) view.mounted();
}

// While a screen loads, the screen being left can't be used (so nothing is
// typed into a screen that's about to disappear), and if loading takes
// more than a moment a "Loading…" indicator covers it.
const LOADING_DELAY_MS = 200;
/** @type {ReturnType<typeof setTimeout> | undefined} */
let loadingTimer;

/**
 * @param {HTMLElement} main
 * @returns {() => void} ends this loading state
 */
function startLoading(main) {
  const indicator = byId('loading');
  clearTimeout(loadingTimer);
  main.setAttribute('aria-busy', 'true');
  main.inert = true;
  loadingTimer = setTimeout(() => {
    main.classList.add('is-loading');
    indicator.hidden = false;
  }, LOADING_DELAY_MS);
  return () => {
    clearTimeout(loadingTimer);
    main.removeAttribute('aria-busy');
    main.inert = false;
    main.classList.remove('is-loading');
    indicator.hidden = true;
  };
}

/**
 * @param {unknown} err
 * @returns {View}
 */
function errorView(err) {
  const message = errorText(err, 'Nothing has been changed. Try again, and if it keeps happening, close Kenna completely and open it again.');
  return {
    title: "Couldn't load",
    root: h(
      'section',
      { class: 'card' },
      h('h2', { class: 'card-title', text: "Couldn't load this screen" }),
      h('p', { class: 'card-sub', role: 'alert', text: message }),
      h('button', { type: 'button', class: 'btn btn-primary', text: 'Try again', onClick: () => render() })
    ),
  };
}
