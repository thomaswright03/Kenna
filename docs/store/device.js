// What the storage asks of the browser and the device: whether it may
// write at all, whether it keeps Kenna's data under storage pressure, and
// word of changes made in another tab.
'use strict';

const { ENTRIES_KEY, RECENT_KEY } = require('./entries.js');

/** @param {Storage} storage */
function storageWorks(storage) {
  try {
    const testKey = '__kenna_storage_test__';
    storage.setItem(testKey, '1');
    storage.removeItem(testKey);
    return true;
  } catch {
    return false;
  }
}

/**
 * Asks the browser not to evict Kenna's data under storage pressure.
 * @param {Navigator | undefined} nav
 * @returns {Promise<boolean | null>} null when the browser can't say
 */
async function requestPersistence(nav) {
  if (!nav || !nav.storage || !nav.storage.persist) return null;
  try {
    if (await nav.storage.persisted()) return true;
    return await nav.storage.persist();
  } catch {
    return null;
  }
}

/** @param {Navigator | undefined} nav @returns {Promise<boolean | null>} */
async function persistenceStatus(nav) {
  if (!nav || !nav.storage || !nav.storage.persisted) return null;
  try {
    return await nav.storage.persisted();
  } catch {
    return null;
  }
}

/**
 * Calls `callback` when another tab changes the days.
 * @param {Window | undefined} win
 * @param {() => void} callback
 */
function onExternalChange(win, callback) {
  if (!win) return;
  win.addEventListener('storage', (event) => {
    if (event.key === ENTRIES_KEY || event.key === RECENT_KEY || event.key === null) callback();
  });
}

module.exports = { storageWorks, requestPersistence, persistenceStatus, onExternalChange };
