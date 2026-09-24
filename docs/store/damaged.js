// Stored data found damaged is kept aside (never overwritten by the next
// save) so it can be sent off for repair: at most the newest
// MAX_CORRUPT_COPIES copies, so repeated damage can't fill the browser's
// small storage allowance.
'use strict';

const { StorageWriteError } = require('./common.js');

const CORRUPT_KEY = 'kenna:entries:corrupt';
const MAX_CORRUPT_COPIES = 2;

/**
 * Data that was found damaged, kept so it can be sent off for repair.
 * @typedef {{ savedAt: string | null, text: string }} DamagedCopy savedAt is an ISO time (null when not known)
 */

class DamagedCopies {
  /** @param {Storage} storage */
  constructor(storage) {
    this.storage = storage;
  }

  // Keys holding damaged copies, oldest first. The first versions kept
  // one under CORRUPT_KEY itself (time unknown, so the oldest); later ones
  // add the time: CORRUPT_KEY:<ms>.
  /** @returns {{ key: string, time: number }[]} */
  keys() {
    /** @type {{ key: string, time: number }[]} */
    const found = [];
    try {
      for (let i = 0; i < this.storage.length; i += 1) {
        const key = this.storage.key(i);
        if (key === CORRUPT_KEY) found.push({ key, time: 0 });
        else if (key && key.startsWith(`${CORRUPT_KEY}:`)) found.push({ key, time: Number(key.slice(CORRUPT_KEY.length + 1)) || 0 });
      }
    } catch {
      // Storage can't be listed; nothing to report.
    }
    return found.sort((a, b) => a.time - b.time);
  }

  /**
   * Keeps the damaged text (unless the same text is already kept), and
   * only the newest copies.
   * @param {string} text
   */
  keep(text) {
    try {
      const kept = this.keys();
      if (kept.some((k) => this.storage.getItem(k.key) === text)) return;
      const time = Math.max(Date.now(), ...kept.map((k) => k.time + 1));
      this.storage.setItem(`${CORRUPT_KEY}:${time}`, text);
      const all = this.keys();
      for (const old of all.slice(0, Math.max(0, all.length - MAX_CORRUPT_COPIES))) this.storage.removeItem(old.key);
    } catch {
      // Nothing more we can do; the primary key is still left as it was.
    }
  }

  /** @returns {DamagedCopy[]} newest first */
  list() {
    /** @type {DamagedCopy[]} */
    const copies = [];
    for (const k of this.keys().reverse()) {
      const text = this.storage.getItem(k.key);
      if (text !== null) copies.push({ savedAt: k.time ? new Date(k.time).toISOString() : null, text });
    }
    return copies;
  }

  deleteAll() {
    try {
      for (const k of this.keys()) this.storage.removeItem(k.key);
    } catch (e) {
      throw new StorageWriteError("Kenna couldn't delete the damaged data. Close Kenna completely, open it again and try once more.", { cause: e });
    }
  }
}

module.exports = { DamagedCopies, CORRUPT_KEY, MAX_CORRUPT_COPIES };
