// The storage the app uses: the browser (installable app) or the Kenna
// server's API. Screens only ever talk to this one object.

import { BACKEND } from './dom.js';
import { showBanner } from './feedback.js';

function createStore() {
  if (BACKEND === 'server') return window.KennaServerStore.createServerStore();
  /** @type {Storage | null} */
  let storage = null;
  try {
    storage = window.localStorage;
  } catch {
    storage = null;
  }
  return window.KennaLocalStore.createLocalStore({
    storage,
    indexedDB: window.indexedDB,
    navigator: window.navigator,
    window,
    onNotice: showBanner,
  });
}

export const store = createStore();
