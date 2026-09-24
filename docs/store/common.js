// What the parts of the storage (store-local.js) share: reading stored
// JSON safely, and the errors a failed write turns into.
'use strict';

const core = require('../core.js');

class StorageWriteError extends core.KennaError {}

/** @param {unknown} v @returns {v is Record<string, unknown>} */
function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** @param {string} text @returns {Record<string, unknown> | null} */
function parseObject(text) {
  try {
    const value = JSON.parse(text);
    return isPlainObject(value) ? value : null;
  } catch {
    return null;
  }
}

/**
 * The error for a write the browser refused: full, or storage blocked.
 * @param {unknown} e
 * @param {string} [what] how the message starts ("Nothing was restored.")
 */
function writeError(e, what) {
  return new StorageWriteError(
    core.isQuotaError(e)
      ? `${what || 'Not saved.'} ${core.STORAGE_FULL}`
      : "Not saved: this browser is blocking storage (Private Browsing or another app's built-in browser). Open Kenna from Safari or your Home Screen instead.",
    { cause: e }
  );
}

// Stands in when the browser refuses access to localStorage altogether.
function blockedStorage() {
  const fail = () => {
    throw new core.KennaError('Storage is blocked in this browser.');
  };
  return /** @type {Storage} */ (/** @type {unknown} */ ({ getItem: fail, setItem: fail, removeItem: fail, key: fail, length: 0 }));
}

module.exports = { StorageWriteError, isPlainObject, parseObject, writeError, blockedStorage };
