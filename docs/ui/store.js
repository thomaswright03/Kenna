// The app's storage: days in localStorage, photos in IndexedDB, all on the
// device. Screens only ever talk to this one object.

import { showBanner } from './feedback.js';
import { recordProblem } from './problems.js';
import { makeThumbnail } from './photo-image.js';

function createStore() {
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
    // Damaged saved days, found and dealt with while reading them.
    onNotice: (notice) => {
      recordProblem('Read saved days', { name: notice.tone === 'warning' ? 'DamagedDataRestoredFromCopy' : 'DamagedDataNotRestored' }, { where: null });
      showBanner(notice);
    },
    makeThumbnail,
  });
}

export const store = createStore();
