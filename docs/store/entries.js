// The days, in localStorage.
//
// Every day is kept under ENTRIES_KEY, as every version of Kenna has
// stored it, and every save writes the whole history there (ten years of
// days is well under a megabyte), with an automatic copy under BACKUP_KEY.
// If the stored days are ever unreadable, we restore from that copy
// instead of treating the history as empty; if both are unreadable, the
// damaged text is kept (damaged.js) so the next save can't erase what's
// left.
//
// An earlier version wrote a save's changed days under RECENT_KEY instead
// ({ base, hash, days: { date: day or null for removed } }, with its own
// copy), folding them into ENTRIES_KEY later. Such changes, if any are
// left, are folded in the first time the days are read. `base` and `hash`
// are the length and a hash of the ENTRIES_KEY text they were made on top
// of, so they're applied only on top of exactly that text: changes left
// before a version that knew nothing of them saved newer days are never
// applied over those; they're kept as a damaged copy instead. (The first
// of those versions wrote `base` alone; its changes are matched by length.)
'use strict';

const core = require('../core.js');
const { StorageWriteError, isPlainObject, parseObject, writeError } = require('./common.js');

/**
 * @typedef {import('../core.js').Entry} Entry
 * @typedef {import('../core.js').EntryPatch} EntryPatch
 * @typedef {import('./damaged.js').DamagedCopies} DamagedCopies
 * @typedef {(notice: { tone: 'warning' | 'error', message: string }) => void} OnNotice
 */

const ENTRIES_KEY = 'kenna:entries';
const BACKUP_KEY = `${ENTRIES_KEY}:backup`;
const UNDO_IMPORT_KEY = `${ENTRIES_KEY}:before-import`;
const RECENT_KEY = `${ENTRIES_KEY}:recent`;
const RECENT_BACKUP_KEY = `${RECENT_KEY}:backup`;

const NOTICES = {
  restored:
    'Your saved data was damaged, so Kenna restored it from its automatic copy. The last change before that may be missing. Please check recent days.',
  lost: "Your saved data was damaged and couldn't be restored. Kenna is starting fresh, and has kept the damaged copy: Settings can download it to send off for repair. Import a backup file from Settings to get your history back.",
  recentRestored: 'Your latest changes were damaged, so Kenna restored them from its automatic copy. The very last change may be missing. Please check recent days.',
  recentLost:
    "Your latest changes were damaged and couldn't be restored; your other days are safe. Kenna has kept the damaged copy: Settings can download it. Please check recent days.",
  setAside:
    'Kenna found changes left by a different version of the app that no longer match your saved days, so it set them aside: Settings can download them. Please check recent days.',
};

/**
 * Every day as stored (ENTRIES_KEY), and its text (null when there is
 * none); recovered: it was just restored from its copy.
 * @typedef {{ raw: Record<string, unknown>, text: string | null, recovered: boolean }} Snapshot
 */

/**
 * Days an earlier version changed and hadn't folded in yet.
 * @typedef {{ base: number, hash?: string, days: Record<string, unknown> }} Recent
 *   hash is missing only from changes the first of those versions wrote
 */

/**
 * A hash of the whole text (53 bits, cyrb53), which recent changes were
 * stamped with, so they can tell whether the history under them is still
 * exactly the one they were made on.
 * @param {string} text
 */
function textHash(text) {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/**
 * @param {string | null} text
 * @returns {Recent | null}
 */
function parseRecent(text) {
  const value = text === null ? null : parseObject(text);
  if (!value || typeof value.base !== 'number' || !isPlainObject(value.days)) return null;
  if (value.hash !== undefined && typeof value.hash !== 'string') return null;
  return typeof value.hash === 'string' ? { base: value.base, hash: value.hash, days: value.days } : { base: value.base, days: value.days };
}

/**
 * Whether recent changes were made on top of exactly this ENTRIES_KEY text
 * (length 0 and hash '' stood for none).
 * @param {Recent} recent
 * @param {string | null} text
 */
function madeOn(recent, text) {
  const length = text === null ? 0 : text.length;
  return recent.base === length && (recent.hash === undefined || recent.hash === (text === null ? '' : textHash(text)));
}

/**
 * @param {Record<string, unknown>} snapshot
 * @param {Record<string, unknown>} changes
 */
function withChanges(snapshot, changes) {
  const raw = { ...snapshot };
  for (const date of Object.keys(changes)) {
    if (changes[date] === null) delete raw[date];
    else raw[date] = changes[date];
  }
  return raw;
}

class DayStore {
  /**
   * @param {Storage} storage
   * @param {OnNotice} onNotice
   * @param {DamagedCopies} damaged
   */
  constructor(storage, onNotice, damaged) {
    this.storage = storage;
    this.onNotice = onNotice;
    this.damaged = damaged;
    // The ENTRIES_KEY text and its days, kept while that text is
    // unchanged, so a save doesn't read the whole history again. Never
    // changed in place.
    /** @type {{ text: string | null, raw: Record<string, unknown> }} */
    this.parsed = { text: null, raw: {} };
  }

  /** Every day as stored (ENTRIES_KEY), recovering from damage. @returns {Snapshot} */
  readSnapshot() {
    const text = this.storage.getItem(ENTRIES_KEY);
    if (text === null) return { raw: {}, text: null, recovered: false };
    if (text === this.parsed.text) return { raw: this.parsed.raw, text, recovered: false };
    const parsed = parseObject(text);
    if (parsed) {
      this.parsed = { text, raw: parsed };
      return { raw: parsed, text, recovered: false };
    }
    this.damaged.keep(text);
    return this.recoverSnapshot();
  }

  /**
   * The days from their automatic copy, when ENTRIES_KEY is damaged; or
   * none at all when that is damaged too.
   * @returns {Snapshot}
   */
  recoverSnapshot() {
    const backupText = this.storage.getItem(BACKUP_KEY);
    const recovered = backupText === null ? null : parseObject(backupText);
    const text = recovered && backupText !== null ? backupText : '{}';
    try {
      this.storage.setItem(ENTRIES_KEY, text);
    } catch {
      // The recovered copy is still used for this session (or the next
      // successful write replaces the damaged text anyway).
    }
    this.onNotice(recovered ? { tone: 'warning', message: NOTICES.restored } : { tone: 'error', message: NOTICES.lost });
    return { raw: recovered || {}, text, recovered: true };
  }

  /**
   * Folds changes an earlier version left under RECENT_KEY into the days,
   * when they were made on top of exactly these days (or the days were
   * just recovered from their copy, which the changes are newer than);
   * otherwise, or when they're damaged beyond their own copy, they're kept
   * aside. Either way RECENT_KEY is gone afterwards.
   * @param {Snapshot} snapshot
   * @returns {Record<string, unknown>} every day
   */
  foldRecent(snapshot) {
    const text = /** @type {string} */ (this.storage.getItem(RECENT_KEY));
    let recent = parseRecent(text);
    if (!recent) {
      this.damaged.keep(text);
      recent = parseRecent(this.storage.getItem(RECENT_BACKUP_KEY));
      this.onNotice({ tone: 'warning', message: recent ? NOTICES.recentRestored : NOTICES.recentLost });
    }
    if (recent && !snapshot.recovered && !madeOn(recent, snapshot.text)) {
      this.damaged.keep(text);
      this.onNotice({ tone: 'warning', message: NOTICES.setAside });
      recent = null;
    }
    if (!recent || Object.keys(recent.days).length === 0) {
      this.dropRecent();
      return snapshot.raw;
    }
    const raw = withChanges(snapshot.raw, recent.days);
    try {
      this.writeRaw(raw);
    } catch {
      // The changes stay where they are, and are folded in next time.
    }
    return raw;
  }

  restoreCopy() {
    try {
      const days = this.storage.getItem(ENTRIES_KEY);
      if (days === null) this.storage.removeItem(BACKUP_KEY);
      else this.storage.setItem(BACKUP_KEY, days);
    } catch {
      // The copy is newer than the days until the next save; both are readable.
    }
  }

  dropRecent() {
    try {
      this.storage.removeItem(RECENT_KEY);
      this.storage.removeItem(RECENT_BACKUP_KEY);
    } catch {
      // Nothing more to do.
    }
  }

  /** Every day. */
  readRaw() {
    const snapshot = this.readSnapshot();
    return this.storage.getItem(RECENT_KEY) === null ? snapshot.raw : this.foldRecent(snapshot);
  }

  /**
   * Writes every day, and its automatic copy.
   * @param {Record<string, unknown>} obj never changed in place afterwards
   * @param {string} [what] how a failure starts ("Nothing was restored.")
   */
  writeRaw(obj, what) {
    const text = JSON.stringify(obj);
    let copied = false;
    try {
      this.storage.setItem(BACKUP_KEY, text);
      copied = true;
      this.storage.setItem(ENTRIES_KEY, text);
    } catch (e) {
      // The copy goes back to matching the days, which weren't changed.
      if (copied) this.restoreCopy();
      throw writeError(e, what);
    }
    this.parsed = { text, raw: obj };
    this.dropRecent();
  }

  loadEntries() {
    return core.sanitizeEntries(this.readRaw()).entries;
  }

  /** @param {string} date */
  getEntry(date) {
    return core.normalizeEntry(date, this.readRaw()[date]);
  }

  // Applies only the fields in `patch` to the stored day, so edits made
  // elsewhere (another tab) to other fields are kept. Malformed days that
  // can't be displayed are left in storage untouched rather than dropped.
  /** @param {string} date @param {EntryPatch} patch */
  updateEntry(date, patch) {
    if (!core.isValidDateStr(date)) throw new core.InputError('Not saved: pick a valid date first.');
    if (core.isFutureDate(date)) throw new core.InputError(`Not saved. ${core.FUTURE_DAY}`);
    const checked = core.validatePatch(patch);
    if (!checked.ok) throw checked.fault ? new core.KennaError(checked.error) : new core.InputError(checked.error);
    const raw = this.readRaw();
    const next = core.applyPatch(date, raw[date], checked.patch);
    this.writeRaw(withChanges(raw, { [date]: core.isEntryEmpty(next) ? null : next }));
    return next;
  }

  // Before a backup's days replace the stored ones, the days they replace
  // are kept (exactly as stored; null for a day that wasn't there), so the
  // restore can be undone. If that copy can't be written, nothing is
  // restored.
  /** @param {Record<string, Entry>} entries */
  importEntries(entries) {
    const raw = this.readRaw();
    /** @type {Record<string, unknown>} */
    const before = {};
    for (const date of Object.keys(entries)) before[date] = Object.prototype.hasOwnProperty.call(raw, date) ? raw[date] : null;
    try {
      this.storage.setItem(UNDO_IMPORT_KEY, JSON.stringify({ at: new Date().toISOString(), days: before }));
    } catch (e) {
      throw new StorageWriteError(core.isQuotaError(e) ? `Nothing was restored. ${core.STORAGE_FULL}` : 'Nothing was restored: this browser is blocking storage.', {
        cause: e,
      });
    }
    this.writeRaw(withChanges(raw, entries), 'Nothing was restored.');
    return Object.keys(entries).length;
  }

  undoImport() {
    const text = this.storage.getItem(UNDO_IMPORT_KEY);
    const saved = text === null ? null : parseObject(text);
    if (!saved || !isPlainObject(saved.days)) throw new core.KennaError('There is no restore to undo.');
    this.writeRaw(withChanges(this.readRaw(), saved.days));
    this.storage.removeItem(UNDO_IMPORT_KEY);
    return Object.keys(saved.days).length;
  }
}

module.exports = { DayStore, ENTRIES_KEY, BACKUP_KEY, UNDO_IMPORT_KEY, RECENT_KEY, RECENT_BACKUP_KEY, textHash };
