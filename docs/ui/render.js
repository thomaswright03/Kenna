// Draws the current route. Screens load their data first and only then
// replace the page, and a newer navigation discards an older one's late
// results.

import { h, byId } from './dom.js';
import { closeAllDialogs } from './feedback.js';
import { route, updateTabs } from './router.js';

/**
 * What a screen builder returns.
 * @typedef {object} View
 * @property {HTMLElement} root
 * @property {() => void} [mounted] runs once the view is on the page
 * @property {() => Promise<void>} [refreshFromStorage] re-reads data changed elsewhere (another tab)
 * @property {() => void} [release] frees resources such as object URLs
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

/** @param {{ focus?: boolean }} [options] */
export async function render(options) {
  const opts = options || {};
  const main = byId('main');
  const seq = (renderSeq += 1);
  const isCurrent = () => seq === renderSeq;
  closeAllDialogs();
  updateTabs();
  main.setAttribute('aria-busy', 'true');
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
  if (currentView && currentView.release) currentView.release();
  view.release = () => releases.forEach((fn) => fn());
  currentView = view;
  main.replaceChildren(view.root);
  main.removeAttribute('aria-busy');
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

/**
 * @param {unknown} err
 * @returns {View}
 */
function errorView(err) {
  const message = err instanceof Error && err.message ? err.message : 'Something went wrong.';
  return {
    root: h(
      'section',
      { class: 'card' },
      h('h2', { class: 'card-title', text: "Couldn't load this screen" }),
      h('p', { class: 'card-sub', role: 'alert', text: message }),
      h('button', { type: 'button', class: 'btn btn-primary', text: 'Try again', onClick: () => render() })
    ),
  };
}
