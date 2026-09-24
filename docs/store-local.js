// Browser storage for the installable app: days live in localStorage,
// progress photos in IndexedDB (photos are far bigger than localStorage's
// quota allows). Every method returns a Promise, so the screens are written
// the same way whether a call finishes at once (days) or later (photos).

/**
 * @typedef {import('./core.js').Entry} Entry
 * @typedef {import('./core.js').EntryPatch} EntryPatch
 * @typedef {import('./core.js').BackupPhoto} BackupPhoto
 */

/**
 * A progress photo's details. Listing photos never reads their images: the
 * image is read on its own when it's shown or backed up.
 * @typedef {object} Photo
 * @property {number | string} id
 * @property {string} date the day it's filed under (YYYY-MM-DD)
 * @property {string} createdAt when it was added (ISO time); also its identity in backups
 * @property {string} type
 */

/**
 * Data that was found damaged, kept so it can be sent off for repair.
 * @typedef {{ savedAt: string | null, text: string }} DamagedCopy savedAt is an ISO time (null when not known)
 */

/**
 * Makes a small preview of a photo, or null when this browser can't draw it.
 * @typedef {(photo: Blob) => Promise<Blob | null>} MakeThumbnail
 */

/**
 * The storage interface the screens use.
 * @typedef {object} KennaStore
 * @property {() => Promise<{ ok: boolean, reason?: string }>} init
 * @property {() => Promise<Record<string, Entry>>} loadEntries
 * @property {(date: string) => Promise<Entry | null>} getEntry
 * @property {(date: string, patch: EntryPatch) => Promise<Entry>} updateEntry
 * @property {() => Promise<boolean>} settle folds the days saved since into the stored history (done when the app is put away); true when anything was written
 * @property {(entries: Record<string, Entry>) => Promise<number>} importEntries replaces the given days, first keeping the days it replaces so undoImport can put them back
 * @property {() => Promise<number>} undoImport puts the days the last import replaced back as they were (and removes days it added)
 * @property {() => Promise<Photo[]>} listPhotos every photo's details, newest first (no images)
 * @property {() => Promise<number>} countPhotos
 * @property {(photo: { date: string, blob: Blob, createdAt?: string, thumb?: Blob | null }) => Promise<Photo>} addPhoto
 * @property {(id: Photo['id']) => Promise<unknown>} deletePhoto erases a photo now
 * @property {(id: Photo['id']) => Promise<boolean>} hidePhoto deletes a photo so that it can still be brought back (unhidePhoto) until deleteHiddenPhotos; false when it couldn't be kept that way and was erased at once
 * @property {(id: Photo['id']) => Promise<void>} unhidePhoto brings back a photo hidePhoto deleted, as it was
 * @property {(ids?: Photo['id'][]) => Promise<void>} deleteHiddenPhotos erases the photos hidePhoto deleted (only `ids`, when given)
 * @property {(id: Photo['id'], changes: { date: string }) => Promise<Photo>} updatePhoto changes the day a photo is filed under
 * @property {(photo: Photo) => Promise<Blob>} getPhotoBlob the full image
 * @property {(photo: Photo, size: 'thumb' | 'full') => Promise<{ url: string, release: () => void }>} photoUrl an address to show the preview or full image
 * @property {() => Promise<{ add: (photo: BackupPhoto) => Promise<Photo | null> }>} createPhotoImporter adds backup photos one at a time; `add` resolves null for a photo that's already here
 * @property {() => Promise<DamagedCopy[]>} damagedCopies copies of stored data that were found damaged, newest first
 * @property {() => Promise<void>} deleteDamagedCopies
 * @property {() => Promise<boolean | null>} requestPersistence
 * @property {() => Promise<boolean | null>} persistenceStatus
 * @property {(callback: () => void) => void} onExternalChange
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./core.js'));
  else /** @type {any} */ (root).KennaLocalStore = factory(/** @type {any} */ (root).KennaCore);
})(typeof self !== 'undefined' ? self : this, function (/** @type {typeof import('./core.js')} */ core) {
  'use strict';

  const ENTRIES_KEY = 'kenna:entries';
  const BACKUP_KEY = `${ENTRIES_KEY}:backup`;
  const CORRUPT_KEY = `${ENTRIES_KEY}:corrupt`;
  const UNDO_IMPORT_KEY = `${ENTRIES_KEY}:before-import`;
  const RECENT_KEY = `${ENTRIES_KEY}:recent`;
  const RECENT_BACKUP_KEY = `${RECENT_KEY}:backup`;
  // Days changed since they were last folded into ENTRIES_KEY, at most:
  // past this many, the next save folds them in.
  const MAX_RECENT_DAYS = 40;
  // Damaged copies kept at most: the newest ones.
  const MAX_CORRUPT_COPIES = 2;
  const PHOTOS_DB_NAME = 'kenna-photos';
  const PHOTOS_STORE = 'photos';
  const INDEX_DB_NAME = 'kenna-photo-index';
  const META_STORE = 'meta';
  const THUMBS_STORE = 'thumbs';
  // Photos deleted but not yet erased, so that Undo can bring them back:
  // their ids, in localStorage. Older versions don't know this key and
  // still show them, so a rollback never loses one.
  const HIDDEN_PHOTOS_KEY = 'kenna:photos:hidden';

  class StorageWriteError extends core.KennaError {}

  // What the Photos screen, the viewer and backups say when the photo
  // storage fails; the browser's own error text is never shown.
  const PHOTO_ERRORS = {
    list: "Kenna couldn't open its photo storage on this device. Nothing has been deleted, and your days and meals aren't affected. Close Kenna completely, open it again and come back to Photos; if it keeps happening, restart the phone.",
    read: "Kenna couldn't read this photo from its storage. Nothing has been deleted. Close Kenna completely, open it again and try once more.",
    write: "Kenna couldn't write to its photo storage. Your other photos and your days are safe. Close Kenna completely, open it again and try once more.",
    full: "There's no room left for Kenna's photos on this device. Your other photos and your days are safe. Delete some old progress photos or free up space on the phone, then try again.",
    off: "This browser has turned off the storage Kenna keeps photos in (Private Browsing does this). Your days and meals still save. Open Kenna from your Home Screen or a normal Safari tab to use photos.",
  };

  /**
   * The error to pass on for a failed photo operation: Kenna's own
   * messages as they are, anything else as the Kenna sentence for `kind`.
   * @param {unknown} err
   * @param {'list' | 'read' | 'write'} kind
   */
  function photoError(err, kind) {
    if (err instanceof core.KennaError) return err;
    return new core.KennaError(core.isQuotaError(err) ? PHOTO_ERRORS.full : PHOTO_ERRORS[kind], { cause: err });
  }

  /**
   * @template T
   * @param {'list' | 'read' | 'write'} kind
   * @param {() => Promise<T>} fn
   * @returns {Promise<T>}
   */
  async function guardPhotos(kind, fn) {
    try {
      return await fn();
    } catch (err) {
      throw photoError(err, kind);
    }
  }

  // Stands in when the browser refuses access to localStorage altogether.
  function blockedStorage() {
    const fail = () => {
      throw new core.KennaError('Storage is blocked in this browser.');
    };
    return /** @type {Storage} */ (/** @type {unknown} */ ({ getItem: fail, setItem: fail, removeItem: fail, key: fail, length: 0 }));
  }

  /**
   * @param {{ storage: Storage | null, indexedDB?: IDBFactory, navigator?: Navigator, window?: Window, onNotice?: (notice: { tone: 'warning' | 'error', message: string }) => void, makeThumbnail?: MakeThumbnail }} options
   * @returns {KennaStore}
   */
  function createLocalStore(options) {
    const opts = options;
    /** @type {Storage} */
    const storage = opts.storage || blockedStorage();
    const idb = opts.indexedDB;
    const nav = opts.navigator;
    const win = opts.window;
    const onNotice = opts.onNotice || function () {};
    const makeThumbnail = opts.makeThumbnail;

    // ------------------------------------------------------------ entries
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
    // under ":corrupt" so the next save can't erase what's left.

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

    // Keys holding damaged copies, oldest first. The first versions kept
    // one under CORRUPT_KEY itself (time unknown, so the oldest); later ones
    // add the time: CORRUPT_KEY:<ms>.
    /** @returns {{ key: string, time: number }[]} */
    function corruptKeys() {
      /** @type {{ key: string, time: number }[]} */
      const found = [];
      try {
        for (let i = 0; i < storage.length; i += 1) {
          const key = storage.key(i);
          if (key === CORRUPT_KEY) found.push({ key, time: 0 });
          else if (key && key.startsWith(`${CORRUPT_KEY}:`)) found.push({ key, time: Number(key.slice(CORRUPT_KEY.length + 1)) || 0 });
        }
      } catch {
        // Storage can't be listed; nothing to report.
      }
      return found.sort((a, b) => a.time - b.time);
    }

    // Keeps the damaged text (unless the same text is already kept), and
    // only the newest MAX_CORRUPT_COPIES copies, so repeated damage can't
    // fill the browser's small storage allowance.
    /** @param {string} text */
    function keepCorruptCopy(text) {
      try {
        const kept = corruptKeys();
        if (kept.some((k) => storage.getItem(k.key) === text)) return;
        const time = Math.max(Date.now(), ...kept.map((k) => k.time + 1));
        storage.setItem(`${CORRUPT_KEY}:${time}`, text);
        const all = corruptKeys();
        for (const old of all.slice(0, Math.max(0, all.length - MAX_CORRUPT_COPIES))) storage.removeItem(old.key);
      } catch {
        // Nothing more we can do; the primary key is still left as it was.
      }
    }

    /** @returns {Promise<DamagedCopy[]>} */
    async function damagedCopies() {
      /** @type {DamagedCopy[]} */
      const copies = [];
      for (const k of corruptKeys().reverse()) {
        const text = storage.getItem(k.key);
        if (text !== null) copies.push({ savedAt: k.time ? new Date(k.time).toISOString() : null, text });
      }
      return copies;
    }

    async function deleteDamagedCopies() {
      try {
        for (const k of corruptKeys()) storage.removeItem(k.key);
      } catch (e) {
        throw new StorageWriteError("Kenna couldn't delete the damaged data. Close Kenna completely, open it again and try once more.", { cause: e });
      }
    }

    // The parsed ENTRIES_KEY text and its hash, kept while that text is
    // unchanged, so a save doesn't read the whole history again. Never
    // changed in place.
    /** @type {{ text: string | null, raw: Record<string, unknown>, hash: string }} */
    let parsedSnapshot = { text: null, raw: {}, hash: '' };

    /** @param {string} text @param {Record<string, unknown>} raw */
    function remember(text, raw) {
      parsedSnapshot = { text, raw, hash: textHash(text) };
      return parsedSnapshot;
    }

    /**
     * @typedef {{ raw: Record<string, unknown>, length: number, hash: string, recovered: boolean }} Snapshot
     *   length and hash: of the ENTRIES_KEY text (0 and '' when there is none), which recent changes are stamped with
     */

    /**
     * Every day as last folded in (ENTRIES_KEY), recovering from damage.
     * @returns {Snapshot}
     */
    function readSnapshot() {
      const text = storage.getItem(ENTRIES_KEY);
      if (text === null) return { raw: {}, length: 0, hash: '', recovered: false };
      if (text === parsedSnapshot.text) return { raw: parsedSnapshot.raw, length: text.length, hash: parsedSnapshot.hash, recovered: false };
      const parsed = parseObject(text);
      if (parsed) return { raw: parsed, length: text.length, hash: remember(text, parsed).hash, recovered: false };

      keepCorruptCopy(text);
      const backupText = storage.getItem(BACKUP_KEY);
      const recovered = backupText === null ? null : parseObject(backupText);
      if (recovered && backupText !== null) {
        try {
          storage.setItem(ENTRIES_KEY, backupText);
        } catch {
          // The recovered copy is still used for this session.
        }
        onNotice({
          tone: 'warning',
          message:
            'Your saved data was damaged, so Kenna restored it from its automatic copy. The last change before that may be missing. Please check recent days.',
        });
        return { raw: recovered, length: backupText.length, hash: textHash(backupText), recovered: true };
      }
      onNotice({
        tone: 'error',
        message:
          "Your saved data was damaged and couldn't be restored. Kenna is starting fresh, and has kept the damaged copy: Settings can download it to send off for repair. Import a backup file from Settings to get your history back.",
      });
      try {
        storage.setItem(ENTRIES_KEY, '{}');
      } catch {
        // Ignore: the next successful write replaces it anyway.
      }
      return { raw: {}, length: 2, hash: textHash('{}'), recovered: true };
    }

    /**
     * A hash of the whole text (53 bits, cyrb53), so recent changes can
     * tell whether the history under them is still exactly the one they
     * were made on.
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
     * @typedef {{ base: number, hash?: string, days: Record<string, unknown> }} Recent
     *   hash is missing only from changes the first versions of this wrote
     */

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
     * The days changed since the last fold (RECENT_KEY), recovering from
     * damage, stamped for `snapshot`; empty when there are none.
     * @param {Snapshot} snapshot
     * @returns {Recent}
     */
    function readRecent(snapshot) {
      const text = storage.getItem(RECENT_KEY);
      const empty = { base: snapshot.length, hash: snapshot.hash, days: {} };
      if (text === null) return empty;
      let recent = parseRecent(text);
      if (!recent) {
        keepCorruptCopy(text);
        recent = parseRecent(storage.getItem(RECENT_BACKUP_KEY));
        onNotice(
          recent
            ? { tone: 'warning', message: 'Your latest changes were damaged, so Kenna restored them from its automatic copy. The very last change may be missing. Please check recent days.' }
            : { tone: 'warning', message: "Your latest changes were damaged and couldn't be restored; your other days are safe. Kenna has kept the damaged copy: Settings can download it. Please check recent days." }
        );
        if (!recent) {
          dropRecent();
          return empty;
        }
      }
      // Changes made on top of other days than these (a version that knew
      // nothing of them saved since) are kept aside, never applied. After
      // recovering the days from their copy, the changes are newer still.
      if (!snapshot.recovered && !madeOn(recent, snapshot)) {
        keepCorruptCopy(text);
        dropRecent();
        onNotice({
          tone: 'warning',
          message: 'Kenna found changes left by a different version of the app that no longer match your saved days, so it set them aside: Settings can download them. Please check recent days.',
        });
        return empty;
      }
      return recent;
    }

    function dropRecent() {
      try {
        storage.removeItem(RECENT_KEY);
        storage.removeItem(RECENT_BACKUP_KEY);
      } catch {
        // Nothing more to do.
      }
    }

    /** @param {unknown} e @param {string} [what] */
    function writeError(e, what) {
      return new StorageWriteError(
        core.isQuotaError(e)
          ? `${what || 'Not saved.'} ${core.STORAGE_FULL}`
          : "Not saved: this browser is blocking storage (Private Browsing or another app's built-in browser). Open Kenna from Safari or your Home Screen instead.",
        { cause: e }
      );
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
     * The stored days and the changes since, read once. Days just
     * recovered from their copy get the changes folded in straight away,
     * since those were made on top of the days that were damaged.
     */
    function readState() {
      const snapshot = readSnapshot();
      const recent = readRecent(snapshot);
      if (!snapshot.recovered || Object.keys(recent.days).length === 0) return { snapshot, recent };
      const raw = withChanges(snapshot.raw, recent.days);
      try {
        writeRaw(raw);
        const folded = { raw: parsedSnapshot.raw, length: String(parsedSnapshot.text).length, hash: parsedSnapshot.hash, recovered: false };
        return { snapshot: folded, recent: { base: folded.length, hash: folded.hash, days: {} } };
      } catch {
        // The changes stay where they are, now on top of the recovered days.
        try {
          writeRecent({ base: snapshot.length, hash: snapshot.hash, days: recent.days });
        } catch {
          // Read again next time, the same way.
        }
        return { snapshot, recent };
      }
    }

    /** Every day, with the recent changes applied. */
    function readRaw() {
      const { snapshot, recent } = readState();
      return withChanges(snapshot.raw, recent.days);
    }

    /**
     * Writes every day (and its automatic copy) and clears the recent
     * changes, which it includes.
     * @param {Record<string, unknown>} obj
     * @param {string} [what] how a failure starts ("Nothing was restored.")
     */
    function writeRaw(obj, what) {
      const text = JSON.stringify(obj);
      try {
        storage.setItem(BACKUP_KEY, text);
        storage.setItem(ENTRIES_KEY, text);
      } catch (e) {
        throw writeError(e, what);
      }
      remember(text, /** @type {Record<string, unknown>} */ (JSON.parse(text)));
      dropRecent();
    }

    /** @param {Recent} recent */
    function writeRecent(recent) {
      try {
        const previous = storage.getItem(RECENT_KEY);
        if (previous !== null && parseRecent(previous)) storage.setItem(RECENT_BACKUP_KEY, previous);
        storage.setItem(RECENT_KEY, JSON.stringify(recent));
      } catch (e) {
        throw writeError(e);
      }
    }

    // Folds the recent changes into ENTRIES_KEY. Nothing is written when
    // there are none. A fold that fails (storage full) leaves the changes
    // where they are.
    function settle() {
      try {
        if (storage.getItem(RECENT_KEY) === null) return false;
        const { snapshot, recent } = readState();
        if (Object.keys(recent.days).length === 0) return false;
        writeRaw(withChanges(snapshot.raw, recent.days));
        return true;
      } catch {
        return false;
      }
    }

    function storageWorks() {
      try {
        const testKey = '__kenna_storage_test__';
        storage.setItem(testKey, '1');
        storage.removeItem(testKey);
        return true;
      } catch {
        return false;
      }
    }

    async function loadEntries() {
      return core.sanitizeEntries(readRaw()).entries;
    }

    /**
     * One day as stored, without reading every day. Undefined when there
     * is none (or it was removed).
     * @param {{ snapshot: { raw: Record<string, unknown> }, recent: { days: Record<string, unknown> } }} state from readState
     * @param {string} date
     */
    function storedDay(state, date) {
      const { days } = state.recent;
      if (Object.prototype.hasOwnProperty.call(days, date)) return days[date] === null ? undefined : days[date];
      return state.snapshot.raw[date];
    }

    /** @param {string} date */
    async function getEntry(date) {
      return core.normalizeEntry(date, storedDay(readState(), date));
    }

    // Applies only the fields in `patch` to the stored day, so edits made
    // elsewhere (another tab) to other fields are kept. Malformed days that
    // can't be displayed are left in storage untouched rather than dropped.
    /** @param {string} date @param {EntryPatch} patch */
    async function updateEntry(date, patch) {
      if (!core.isValidDateStr(date)) throw new core.InputError('Not saved: pick a valid date first.');
      if (core.isFutureDate(date)) throw new core.InputError(`Not saved. ${core.FUTURE_DAY}`);
      const checked = core.validatePatch(patch);
      if (!checked.ok) throw checked.fault ? new core.KennaError(checked.error) : new core.InputError(checked.error);
      const state = readState();
      const next = core.applyPatch(date, storedDay(state, date), checked.patch);
      // Only this day is written, with the others changed since the last
      // fold: the cost of a save doesn't grow with the years logged.
      const days = { ...state.recent.days, [date]: core.isEntryEmpty(next) ? null : next };
      writeRecent({ base: state.snapshot.length, hash: state.snapshot.hash, days });
      if (Object.keys(days).length > MAX_RECENT_DAYS) settle();
      return next;
    }

    // Before a backup's days replace the stored ones, the days they replace
    // are kept (exactly as stored; null for a day that wasn't there), so the
    // restore can be undone. If that copy can't be written, nothing is
    // restored.
    /** @param {Record<string, Entry>} entries */
    async function importEntries(entries) {
      const raw = readRaw();
      /** @type {Record<string, unknown>} */
      const before = {};
      for (const date of Object.keys(entries)) before[date] = Object.prototype.hasOwnProperty.call(raw, date) ? raw[date] : null;
      try {
        storage.setItem(UNDO_IMPORT_KEY, JSON.stringify({ at: new Date().toISOString(), days: before }));
      } catch (e) {
        throw new StorageWriteError(
          core.isQuotaError(e) ? `Nothing was restored. ${core.STORAGE_FULL}` : 'Nothing was restored: this browser is blocking storage.',
          { cause: e }
        );
      }
      for (const date of Object.keys(entries)) raw[date] = entries[date];
      writeRaw(raw, 'Nothing was restored.');
      return Object.keys(entries).length;
    }

    async function undoImport() {
      const text = storage.getItem(UNDO_IMPORT_KEY);
      const saved = text === null ? null : parseObject(text);
      if (!saved || !isPlainObject(saved.days)) throw new core.KennaError('There is no restore to undo.');
      const raw = readRaw();
      const days = saved.days;
      for (const date of Object.keys(days)) {
        if (days[date] === null) delete raw[date];
        else raw[date] = days[date];
      }
      writeRaw(raw);
      storage.removeItem(UNDO_IMPORT_KEY);
      return Object.keys(days).length;
    }

    // ------------------------------------------------------------ photos
    //
    // Each photo's image lives in the "kenna-photos" database, as every
    // version of Kenna has stored it. A second database, "kenna-photo-index",
    // holds what the Photos screen and backups need without reading any
    // image: each photo's day, time added and type ("meta"), and a small
    // preview image ("thumbs"). The index is derived data: it is brought
    // up to date from the photos themselves whenever photos are listed, so
    // photos saved by older versions (or by an older copy of the app after
    // a rollback) are picked up, and the photos database itself never
    // changes shape.

    /**
     * @param {string} name
     * @param {(db: IDBDatabase) => void} upgrade
     * @returns {() => Promise<IDBDatabase>}
     */
    function opener(name, upgrade) {
      /** @type {Promise<IDBDatabase> | null} */
      let promise = null;
      return function open() {
        if (!idb) {
          // Named, so the problem log can say what it was.
          const missing = Object.assign(new Error('This browser has no IndexedDB.'), { name: 'PhotoStorageUnavailable' });
          return Promise.reject(new core.KennaError(PHOTO_ERRORS.off, { cause: missing }));
        }
        const factory = idb;
        if (!promise) {
          promise = new Promise((/** @type {(db: IDBDatabase) => void} */ resolve, reject) => {
            const req = factory.open(name, 1);
            req.onupgradeneeded = () => upgrade(req.result);
            req.onsuccess = () => {
              const db = req.result;
              // Let a newer copy of the app (another tab) upgrade it.
              db.onversionchange = () => {
                db.close();
                promise = null;
              };
              resolve(db);
            };
            req.onerror = () => reject(req.error);
          }).catch((err) => {
            promise = null;
            throw err;
          });
        }
        return promise;
      };
    }

    const openPhotosDB = opener(PHOTOS_DB_NAME, (db) => {
      if (!db.objectStoreNames.contains(PHOTOS_STORE)) db.createObjectStore(PHOTOS_STORE, { keyPath: 'id', autoIncrement: true });
    });
    const openIndexDB = opener(INDEX_DB_NAME, (db) => {
      if (!db.objectStoreNames.contains(META_STORE)) db.createObjectStore(META_STORE, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(THUMBS_STORE)) db.createObjectStore(THUMBS_STORE, { keyPath: 'id' });
    });

    /**
     * Runs `fn` in one transaction and, once the transaction has completed,
     * resolves with the result of the request it returned (if any).
     * @template T
     * @param {() => Promise<IDBDatabase>} open
     * @param {string[]} stores
     * @param {IDBTransactionMode} mode
     * @param {(t: IDBTransaction) => IDBRequest<T> | null | void} fn
     * @returns {Promise<T>}
     */
    function run(open, stores, mode, fn) {
      return open().then(
        (db) =>
          new Promise((resolve, reject) => {
            const t = db.transaction(stores, mode);
            const result = fn(t);
            t.oncomplete = () => resolve(result ? result.result : /** @type {T} */ (/** @type {unknown} */ (undefined)));
            t.onerror = () => reject(t.error);
            t.onabort = () => reject(t.error || new Error('The photo storage transaction was aborted.'));
          })
      );
    }

    /** @template T @param {(s: IDBObjectStore) => IDBRequest<T> | null | void} fn @param {IDBTransactionMode} [mode] */
    const photosTx = (fn, mode) => run(openPhotosDB, [PHOTOS_STORE], mode || 'readonly', (t) => fn(t.objectStore(PHOTOS_STORE)));
    /** @template T @param {(t: IDBTransaction) => IDBRequest<T> | null | void} fn @param {IDBTransactionMode} [mode] */
    const indexTx = (fn, mode) => run(openIndexDB, [META_STORE, THUMBS_STORE], mode || 'readonly', fn);

    /**
     * A stored photo record, as any version of Kenna wrote it: raw bytes plus
     * their type (Safari refuses to put a Blob into IndexedDB in some modes,
     * Private Browsing among them), or, from older versions, a Blob.
     * @typedef {{ id: number, date: string, createdAt: string, type?: string, bytes?: ArrayBuffer, blob?: Blob }} PhotoRecord
     * @typedef {{ id: number, date: string, createdAt: string, type: string, missing?: boolean }} PhotoMeta
     */

    /** @param {PhotoRecord} record @returns {PhotoMeta} */
    function metaFrom(record) {
      const type = record.type || (record.blob && record.blob.type) || 'image/jpeg';
      const meta = { id: record.id, date: record.date, createdAt: String(record.createdAt), type };
      return record.bytes || record.blob ? meta : { ...meta, missing: true };
    }

    /** @param {PhotoMeta} m @returns {Photo} */
    const toPhoto = (m) => ({ id: m.id, date: m.date, createdAt: m.createdAt, type: m.type });

    /** @param {number} id @returns {Promise<PhotoRecord | undefined>} */
    const getRecord = (id) => photosTx((s) => /** @type {IDBRequest<PhotoRecord | undefined>} */ (s.get(id)));

    // Brings the index in line with the photos database: adds photos it
    // doesn't know yet (reading them one at a time) and drops entries for
    // photos that are gone. Only keys are compared, so when nothing has
    // changed no image is read.
    async function syncIndex() {
      const keys = /** @type {number[]} */ (await photosTx((s) => s.getAllKeys()));
      const metas = /** @type {PhotoMeta[]} */ (await indexTx((t) => t.objectStore(META_STORE).getAll()));
      const known = new Map(metas.map((m) => [m.id, m]));
      const present = new Set(keys);
      const stale = metas.filter((m) => !present.has(m.id)).map((m) => m.id);
      if (stale.length) {
        await indexTx((t) => {
          for (const id of stale) {
            t.objectStore(META_STORE).delete(id);
            t.objectStore(THUMBS_STORE).delete(id);
          }
        }, 'readwrite');
        for (const id of stale) known.delete(id);
      }
      for (const id of keys) {
        if (known.has(id)) continue;
        const record = await getRecord(id);
        if (!record) continue;
        const meta = metaFrom(record);
        await indexTx((t) => t.objectStore(META_STORE).put(meta), 'readwrite');
        known.set(id, meta);
      }
      return Array.from(known.values());
    }

    /** @returns {Set<number>} the ids of photos deleted but not yet erased */
    function hiddenPhotos() {
      try {
        const ids = JSON.parse(storage.getItem(HIDDEN_PHOTOS_KEY) || '[]');
        return new Set(Array.isArray(ids) ? ids.filter((id) => typeof id === 'number') : []);
      } catch {
        return new Set();
      }
    }

    /** @param {Set<number>} ids */
    function writeHiddenPhotos(ids) {
      if (ids.size) storage.setItem(HIDDEN_PHOTOS_KEY, JSON.stringify([...ids]));
      else storage.removeItem(HIDDEN_PHOTOS_KEY);
    }

    /** Every photo's details, newest first, without reading any image. */
    async function listPhotos() {
      const metas = await syncIndex();
      const hidden = hiddenPhotos();
      return metas
        .filter((m) => !m.missing && !hidden.has(m.id) && core.isValidDateStr(m.date))
        .map(toPhoto)
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
    }

    /** @returns {Promise<number>} */
    async function countPhotos() {
      const hidden = hiddenPhotos();
      const keys = /** @type {number[]} */ (await photosTx((s) => s.getAllKeys()));
      return keys.filter((id) => !hidden.has(id)).length;
    }

    /** @param {Blob} blob */
    async function bytesOf(blob) {
      return { bytes: await blob.arrayBuffer(), type: blob.type || 'image/jpeg' };
    }

    /** @param {{ date: string, blob: Blob, createdAt?: string, thumb?: Blob | null }} photo */
    async function addPhoto(photo) {
      if (!core.isValidDateStr(photo.date)) throw new core.InputError('Pick a valid day for this photo.');
      if (core.isFutureDate(photo.date)) throw new core.InputError(core.FUTURE_PHOTO);
      const { bytes, type } = await bytesOf(photo.blob);
      const record = { date: photo.date, bytes, type, createdAt: photo.createdAt || new Date().toISOString() };
      const id = Number(await photosTx((s) => s.add(record), 'readwrite'));
      const meta = metaFrom({ ...record, id });
      const thumb = photo.thumb ? { id, ...(await bytesOf(photo.thumb)) } : null;
      try {
        await indexTx((t) => {
          t.objectStore(META_STORE).put(meta);
          if (thumb) t.objectStore(THUMBS_STORE).put(thumb);
        }, 'readwrite');
      } catch {
        // The photo is saved; the next listing adds it to the index.
      }
      return toPhoto(meta);
    }

    /** @param {Photo['id']} id @param {{ date: string }} changes */
    async function updatePhoto(id, changes) {
      const date = changes && changes.date;
      if (!core.isValidDateStr(date)) throw new core.InputError('Pick a valid day for this photo.');
      if (core.isFutureDate(date)) throw new core.InputError(core.FUTURE_PHOTO);
      /** @type {PhotoRecord | null} */
      let updated = null;
      await photosTx((s) => {
        const req = /** @type {IDBRequest<PhotoRecord | undefined>} */ (s.get(id));
        req.onsuccess = () => {
          if (!req.result) return;
          updated = { ...req.result, date };
          s.put(updated);
        };
        return null;
      }, 'readwrite');
      if (!updated) throw new core.KennaError('That photo no longer exists.');
      const meta = metaFrom(updated);
      await indexTx((t) => t.objectStore(META_STORE).put(meta), 'readwrite').catch(() => undefined);
      return toPhoto(meta);
    }

    /** @param {Photo['id']} id */
    async function deletePhoto(id) {
      await photosTx((s) => s.delete(id), 'readwrite');
      await indexTx((t) => {
        t.objectStore(META_STORE).delete(id);
        t.objectStore(THUMBS_STORE).delete(id);
      }, 'readwrite').catch(() => undefined);
    }

    // Deleting from the photo viewer hides the photo first (it's left out
    // of every listing, count and backup), so Undo can bring it back as it
    // was, with its day and the time it was added. It's erased once that
    // chance has passed (deleteHiddenPhotos), or at the next start.
    /** @param {Photo['id']} id */
    async function hidePhoto(id) {
      const ids = hiddenPhotos();
      ids.add(Number(id));
      try {
        writeHiddenPhotos(ids);
      } catch {
        // No room to note it: erased now instead, without Undo.
        await deletePhoto(id);
        return false;
      }
      return true;
    }

    /** @param {Photo['id']} id */
    async function unhidePhoto(id) {
      if (!(await getRecord(Number(id)))) throw new core.KennaError('That photo has already been deleted for good.');
      const ids = hiddenPhotos();
      ids.delete(Number(id));
      try {
        writeHiddenPhotos(ids);
      } catch (e) {
        throw writeError(e, 'The photo wasn’t brought back.');
      }
    }

    /** @param {Photo['id'][]} [only] */
    async function deleteHiddenPhotos(only) {
      const hidden = hiddenPhotos();
      const ids = only ? only.map(Number).filter((id) => hidden.has(id)) : [...hidden];
      for (const id of ids) {
        await deletePhoto(id);
        const left = hiddenPhotos();
        left.delete(id);
        writeHiddenPhotos(left);
      }
    }

    /** @param {Photo} photo @returns {Promise<Blob>} the full image, read on its own */
    async function getPhotoBlob(photo) {
      const record = await getRecord(Number(photo.id));
      if (!record || !(record.bytes || record.blob)) throw new core.KennaError(`A photo from ${core.formatDate(photo.date)} is missing its image.`);
      if (record.blob) return record.blob;
      return new Blob([/** @type {ArrayBuffer} */ (record.bytes)], { type: record.type || photo.type });
    }

    // Previews are made one at a time, so opening a screen full of photos
    // saved before previews existed never decodes many full images at once.
    /** @type {Promise<unknown>} */
    let thumbQueue = Promise.resolve();

    /**
     * The photo's small preview, made (and kept) the first time it's asked
     * for when there isn't one yet. Falls back to the full image when no
     * preview can be made (a format this browser can't draw).
     * @param {Photo} photo
     * @returns {Promise<Blob>}
     */
    async function thumbBlob(photo) {
      const id = Number(photo.id);
      /** @type {{ id: number, bytes?: ArrayBuffer, type?: string, none?: boolean } | undefined} */
      const stored = await indexTx((t) => t.objectStore(THUMBS_STORE).get(id)).catch(() => undefined);
      if (stored && stored.bytes) return new Blob([stored.bytes], { type: stored.type || 'image/jpeg' });
      if (stored && stored.none) return getPhotoBlob(photo);
      if (!makeThumbnail) return getPhotoBlob(photo);
      const make = makeThumbnail;
      const job = thumbQueue.then(async () => {
        const full = await getPhotoBlob(photo);
        const thumb = await make(full).catch(() => null);
        const entry = thumb ? { id, ...(await bytesOf(thumb)) } : { id, none: true };
        await indexTx((t) => t.objectStore(THUMBS_STORE).put(entry), 'readwrite').catch(() => undefined);
        return thumb || full;
      });
      thumbQueue = job.catch(() => undefined);
      return job;
    }

    /**
     * An address for showing the photo: its small preview ('thumb') or the
     * whole image ('full'). Call `release` once it's no longer shown.
     * @param {Photo} photo
     * @param {'thumb' | 'full'} size
     */
    async function photoUrl(photo, size) {
      const blob = size === 'thumb' ? await thumbBlob(photo) : await getPhotoBlob(photo);
      const url = URL.createObjectURL(blob);
      return { url, release: () => URL.revokeObjectURL(url) };
    }

    /** @param {string} data @param {string} type */
    function base64ToBlob(data, type) {
      const bin = atob(data);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
      return new Blob([bytes], { type });
    }

    // Adds backup photos ({ date, createdAt, type, data: base64 }) one at a
    // time, skipping any already here (matched by the time each was first
    // added), so importing the same backup twice never duplicates anything.
    // Only the index is read to find those, never an image.
    async function createPhotoImporter() {
      const seen = new Set((await listPhotos()).map(core.photoKey));
      return {
        /** @param {BackupPhoto} p */
        add: (p) =>
          guardPhotos('write', async () => {
            const key = core.photoKey(p);
            if (seen.has(key)) return null;
            const added = await addPhoto({ date: p.date, createdAt: p.createdAt, blob: base64ToBlob(p.data, p.type) });
            seen.add(key);
            return added;
          }),
      };
    }

    // ------------------------------------------------------------ device

    async function init() {
      if (!storageWorks()) return { ok: false, reason: 'blocked' };
      readRaw(); // surfaces any recovery notice straight away
      settle();
      // Photos deleted in an earlier visit, whose Undo has gone with it.
      if (hiddenPhotos().size) guardPhotos('write', () => deleteHiddenPhotos()).catch(() => undefined);
      return { ok: true };
    }

    // Asks the browser not to evict Kenna's data under storage pressure.
    async function requestPersistence() {
      if (!nav || !nav.storage || !nav.storage.persist) return null;
      try {
        if (await nav.storage.persisted()) return true;
        return await nav.storage.persist();
      } catch {
        return null;
      }
    }

    async function persistenceStatus() {
      if (!nav || !nav.storage || !nav.storage.persisted) return null;
      try {
        return await nav.storage.persisted();
      } catch {
        return null;
      }
    }

    /** @param {() => void} callback */
    function onExternalChange(callback) {
      if (!win) return;
      win.addEventListener('storage', (event) => {
        if (event.key === ENTRIES_KEY || event.key === RECENT_KEY || event.key === null) callback();
      });
    }

    return {
      init,
      loadEntries,
      getEntry,
      updateEntry,
      importEntries,
      undoImport,
      settle: async () => settle(),
      damagedCopies,
      deleteDamagedCopies,
      // Every photo operation fails with a Kenna sentence, never the
      // browser's own error text.
      listPhotos: () => guardPhotos('list', listPhotos),
      countPhotos: () => guardPhotos('list', countPhotos),
      addPhoto: (photo) => guardPhotos('write', () => addPhoto(photo)),
      updatePhoto: (id, changes) => guardPhotos('write', () => updatePhoto(id, changes)),
      deletePhoto: (id) => guardPhotos('write', () => deletePhoto(id)),
      hidePhoto: (id) => guardPhotos('write', () => hidePhoto(id)),
      unhidePhoto: (id) => guardPhotos('write', () => unhidePhoto(id)),
      deleteHiddenPhotos: (ids) => guardPhotos('write', () => deleteHiddenPhotos(ids)),
      getPhotoBlob: (photo) => guardPhotos('read', () => getPhotoBlob(photo)),
      photoUrl: (photo, size) => guardPhotos('read', () => photoUrl(photo, size)),
      createPhotoImporter: () => guardPhotos('list', createPhotoImporter),
      requestPersistence,
      persistenceStatus,
      onExternalChange,
    };
  }

  return Object.freeze({ createLocalStore, HIDDEN_PHOTOS_KEY, ENTRIES_KEY, BACKUP_KEY, RECENT_KEY, RECENT_BACKUP_KEY, MAX_RECENT_DAYS, CORRUPT_KEY, UNDO_IMPORT_KEY, MAX_CORRUPT_COPIES, StorageWriteError });
});
