// Errors Kenna shows to the person using it.
//
// A KennaError's message was written for the person using Kenna: it says
// what failed, whether anything already saved is affected, and what to
// do. Any other error's message comes from the browser or a library
// ("Internal error opening backing store…") and is never shown; the
// screen shows a Kenna sentence for that situation instead.
'use strict';

class KennaError extends Error {
  /** @param {string} message @param {{ cause?: unknown }} [options] */
  constructor(message, options) {
    super(message, options);
    this.name = 'KennaError';
  }
}

// The browser refused a write because the storage it allows is full.
/** @param {unknown} err */
function isQuotaError(err) {
  if (!err || typeof err !== 'object') return false;
  const e = /** @type {{ name?: unknown, code?: unknown }} */ (err);
  return e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED' || e.code === 22;
}

const STORAGE_FULL =
  "There's no room left for Kenna's data on this device. Everything saved before is safe. Export a backup (Settings), then delete some old progress photos or free up space on the phone, and try again.";

module.exports = {
  KennaError,
  isQuotaError,
  STORAGE_FULL,
};
