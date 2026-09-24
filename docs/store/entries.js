// The days, in localStorage.
//
// Every day is kept under ENTRIES_KEY, as every version of Kenna has
// stored it. So that a save doesn't rewrite years of history, a save
// writes only the days changed since then, under RECENT_KEY
// ({ base, hash, days: { date: day or null for removed } }); they're
// folded into ENTRIES_KEY when the app is put away or closed (settle),
// when it starts, when an import rewrites the days anyway, and once
// more than MAX_RECENT_DAYS have piled up. `base` and `hash` are the
// length and a hash of the ENTRIES_KEY text the changes were made on
// top of, so they're applied only on top of exactly that text: changes
// left by a version that knew nothing of them (after a rollback) are
// never applied over newer days, even of the same length; they're kept
// as a damaged copy instead. (The first versions of this wrote `base`
// alone; their changes are matched by length.)
//
// Each key has an automatic copy (":backup"). If a stored value is
// ever unreadable, we restore from that copy instead of treating the
// history as empty; if both are unreadable, the damaged text is kept
// (damaged.js) so the next save can't erase what's left.
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
// Days changed since they were last folded into ENTRIES_KEY, at most:
// past this many, the next save folds them in.
const MAX_RECENT_DAYS = 40;

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
 * Every day as last folded in (ENTRIES_KEY). length and hash are of its
 * text (0 and '' when there is none), which recent changes are stamped
 * with; recovered: it was just restored from its copy.
 * @typedef {{ raw: Record<string, unknown>, length: number, hash: string, recovered: boolean }} Snapshot
 */

/**
 * The days changed since the last fold.
 * @typedef {{ base: number, hash?: string, days: Record<string, unknown> }} Recent
 *   hash is missing only from changes the first versions of this wrote
 */

/**
 * A hash of the whole text (53 bits, cyrb53), so recent changes can tell
 * whether the history under them is still exactly the one they were made
 * on.
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

/** Whether recent changes were made on top of exactly `snapshot`. @param {Recent} recent @param {Snapshot} snapshot */
function madeOn(recent, snapshot) {
  return recent.base === snapshot.length && (recent.hash === undefined || recent.hash === snapshot.hash);
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

/**
 * One day as stored, without reading every day. Undefined when there is
 * none (or it was removed).
 * @param {{ snapshot: { raw: Record<string, unknown> }, recent: { days: Record<string, unknown> } }} state
 * @param {string} date
 */
function storedDay(state, date) {
  const { days } = state.recent;
  if (Object.prototype.hasOwnProperty.call(days, date)) return days[date] === null ? undefined : days[date];
  return state.snapshot.raw[date];
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
    // The parsed ENTRIES_KEY text and its hash, kept while that text is
    // unchanged, so a save doesn't read the whole history again. Never
    // changed in place.
    /** @type {{ text: string | null, raw: Record<string, unknown>, hash: string }} */
    this.parsed = { text: null, raw: {}, hash: '' };
  }

  /** @param {string} text @param {Record<string, unknown>} raw */
  remember(text, raw) {
    this.parsed = { text, raw, hash: textHash(text) };
    return this.parsed;
  }

  /** Every day as last folded in (ENTRIES_KEY), recovering from damage. @returns {Snapshot} */
  readSnapshot() {
    const text = this.storage.getItem(ENTRIES_KEY);
    if (text === null) return { raw: {}, length: 0, hash: '', recovered: false };
    if (text === this.parsed.text) return { raw: this.parsed.raw, length: text.length, hash: this.parsed.hash, recovered: false };
    const parsed = parseObject(text);
    if (parsed) return { raw: parsed, length: text.length, hash: this.remember(text, parsed).hash, recovered: false };
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
    return { raw: recovered || {}, length: text.length, hash: textHash(text), recovered: true };
  }

  /**
   * The days changed since the last fold (RECENT_KEY), recovering from
   * damage, stamped for `snapshot`; empty when there are none.
   * @param {Snapshot} snapshot
   * @returns {Recent}
   */
  readRecent(snapshot) {
    const text = this.storage.getItem(RECENT_KEY);
    const empty = { base: snapshot.length, hash: snapshot.hash, days: {} };
    if (text === null) return empty;
    let recent = parseRecent(text);
    if (!recent) {
      this.damaged.keep(text);
      recent = parseRecent(this.storage.getItem(RECENT_BACKUP_KEY));
      this.onNotice({ tone: 'warning', message: recent ? NOTICES.recentRestored : NOTICES.recentLost });
      if (!recent) {
        this.dropRecent();
        return empty;
      }
    }
    // Changes made on top of other days than these (a version that knew
    // nothing of them saved since) are kept aside, never applied. After
    // recovering the days from their copy, the changes are newer still.
    if (!snapshot.recovered && !madeOn(recent, snapshot)) {
      this.damaged.keep(text);
      this.dropRecent();
      this.onNotice({ tone: 'warning', message: NOTICES.setAside });
      return empty;
    }
    return recent;
  }

  dropRecent() {
    try {
      this.storage.removeItem(RECENT_KEY);
      this.storage.removeItem(RECENT_BACKUP_KEY);
    } catch {
      // Nothing more to do.
    }
  }

  /**
   * The stored days and the changes since, read once. Days just
   * recovered from their copy get the changes folded in straight away,
   * since those were made on top of the days that were damaged.
   * @returns {{ snapshot: Snapshot, recent: Recent }}
   */
  readState() {
    const snapshot = this.readSnapshot();
    const recent = this.readRecent(snapshot);
    if (!snapshot.recovered || Object.keys(recent.days).length === 0) return { snapshot, recent };
    try {
      this.writeRaw(withChanges(snapshot.raw, recent.days));
      const { raw, text, hash } = this.parsed;
      const folded = { raw, length: String(text).length, hash, recovered: false };
      return { snapshot: folded, recent: { base: folded.length, hash, days: {} } };
    } catch {
      // The changes stay where they are, now on top of the recovered days.
      try {
        this.writeRecent({ base: snapshot.length, hash: snapshot.hash, days: recent.days });
      } catch {
        // Read again next time, the same way.
      }
      return { snapshot, recent };
    }
  }

  /** Every day, with the recent changes applied. */
  readRaw() {
    const { snapshot, recent } = this.readState();
    return withChanges(snapshot.raw, recent.days);
  }

  /**
   * Writes every day (and its automatic copy) and clears the recent
   * changes, which it includes.
   * @param {Record<string, unknown>} obj
   * @param {string} [what] how a failure starts ("Nothing was restored.")
   */
  writeRaw(obj, what) {
    const text = JSON.stringify(obj);
    try {
      this.storage.setItem(BACKUP_KEY, text);
      this.storage.setItem(ENTRIES_KEY, text);
    } catch (e) {
      throw writeError(e, what);
    }
    this.remember(text, /** @type {Record<string, unknown>} */ (JSON.parse(text)));
    this.dropRecent();
  }

  /** @param {Recent} recent */
  writeRecent(recent) {
    try {
      const previous = this.storage.getItem(RECENT_KEY);
      if (previous !== null && parseRecent(previous)) this.storage.setItem(RECENT_BACKUP_KEY, previous);
      this.storage.setItem(RECENT_KEY, JSON.stringify(recent));
    } catch (e) {
      throw writeError(e);
    }
  }

  // Folds the recent changes into ENTRIES_KEY. Nothing is written when
  // there are none. A fold that fails (storage full) leaves the changes
  // where they are.
  settle() {
    try {
      if (this.storage.getItem(RECENT_KEY) === null) return false;
      const { snapshot, recent } = this.readState();
      if (Object.keys(recent.days).length === 0) return false;
      this.writeRaw(withChanges(snapshot.raw, recent.days));
      return true;
    } catch {
      return false;
    }
  }

  loadEntries() {
    return core.sanitizeEntries(this.readRaw()).entries;
  }

  /** @param {string} date */
  getEntry(date) {
    return core.normalizeEntry(date, storedDay(this.readState(), date));
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
    const state = this.readState();
    const next = core.applyPatch(date, storedDay(state, date), checked.patch);
    // Only this day is written, with the others changed since the last
    // fold: the cost of a save doesn't grow with the years logged.
    const days = { ...state.recent.days, [date]: core.isEntryEmpty(next) ? null : next };
    this.writeRecent({ base: state.snapshot.length, hash: state.snapshot.hash, days });
    if (Object.keys(days).length > MAX_RECENT_DAYS) this.settle();
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

module.exports = { DayStore, ENTRIES_KEY, BACKUP_KEY, UNDO_IMPORT_KEY, RECENT_KEY, RECENT_BACKUP_KEY, MAX_RECENT_DAYS };
