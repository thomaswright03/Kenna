// Browser storage for the installable app: days live in localStorage,
// progress photos in IndexedDB (photos are far bigger than localStorage's
// quota allows). Every method returns a Promise so the UI treats this store
// and the server store (store-server.js) identically.

/**
 * @typedef {import('./core.js').Entry} Entry
 * @typedef {import('./core.js').EntryPatch} EntryPatch
 * @typedef {import('./core.js').BackupPhoto} BackupPhoto
 */

/**
 * A progress photo. Browser storage keeps the image itself (`blob`); the
 * server store gives its address (`url`).
 * @typedef {object} Photo
 * @property {number | string} id
 * @property {string} date the day it's filed under (YYYY-MM-DD)
 * @property {string} createdAt when it was added (ISO time); also its identity in backups
 * @property {string} type
 * @property {Blob} [blob]
 * @property {string} [url]
 */

/**
 * The storage interface both stores implement.
 * @typedef {object} KennaStore
 * @property {'local' | 'server'} kind
 * @property {() => Promise<{ ok: boolean, reason?: string }>} init
 * @property {() => Promise<Record<string, Entry>>} loadEntries
 * @property {(date: string) => Promise<Entry | null>} getEntry
 * @property {(date: string, patch: EntryPatch) => Promise<Entry>} updateEntry
 * @property {(entries: Record<string, Entry>) => Promise<number>} importEntries
 * @property {() => Promise<Photo[]>} listPhotos
 * @property {() => Promise<number>} countPhotos
 * @property {(photo: { date: string, blob: Blob, createdAt?: string }) => Promise<Photo>} addPhoto
 * @property {(id: Photo['id']) => Promise<unknown>} deletePhoto
 * @property {(id: Photo['id'], changes: { date: string }) => Promise<Photo>} updatePhoto changes the day a photo is filed under
 * @property {(photo: Photo) => Promise<Blob>} getPhotoBlob
 * @property {(photo: Photo) => { url: string, release: () => void }} photoSrc
 * @property {(photos: BackupPhoto[], onProgress?: (done: number, total: number) => void) => Promise<{ added: number, skipped: number }>} importPhotos
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
  const PHOTOS_DB_NAME = 'kenna-photos';
  const PHOTOS_STORE = 'photos';

  class StorageWriteError extends Error {}

  // Stands in when the browser refuses access to localStorage altogether.
  function blockedStorage() {
    const fail = () => {
      throw new Error('Storage is blocked in this browser.');
    };
    return /** @type {Storage} */ (/** @type {unknown} */ ({ getItem: fail, setItem: fail, removeItem: fail }));
  }

  /**
   * @param {{ storage: Storage | null, indexedDB?: IDBFactory, navigator?: Navigator, window?: Window, onNotice?: (notice: { tone: 'warning' | 'error', message: string }) => void }} options
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

    // ------------------------------------------------------------ entries
    //
    // Every write first copies the previous value to a ":backup" key. If the
    // stored value is ever unreadable, we restore from that copy instead of
    // treating the history as empty; if both are unreadable, the damaged text
    // is kept under ":corrupt" so the next save can't erase what's left.

    function isPlainObject(v) {
      return v !== null && typeof v === 'object' && !Array.isArray(v);
    }

    function parseObject(text) {
      try {
        const value = JSON.parse(text);
        return isPlainObject(value) ? value : null;
      } catch {
        return null;
      }
    }

    function keepCorruptCopy(text) {
      try {
        const kept = storage.getItem(CORRUPT_KEY);
        if (kept === null) storage.setItem(CORRUPT_KEY, text);
        else if (kept !== text) storage.setItem(`${CORRUPT_KEY}:${Date.now()}`, text);
      } catch {
        // Nothing more we can do; the primary key is still left as it was.
      }
    }

    function readRaw() {
      const text = storage.getItem(ENTRIES_KEY);
      if (text === null) return {};
      const parsed = parseObject(text);
      if (parsed) return parsed;

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
        return recovered;
      }
      onNotice({
        tone: 'error',
        message:
          "Your saved data was damaged and couldn't be restored. The damaged copy has been kept, and Kenna is starting fresh. Import a backup file from Settings to get your history back.",
      });
      try {
        storage.setItem(ENTRIES_KEY, '{}');
      } catch {
        // Ignore: the next successful write replaces it anyway.
      }
      return {};
    }

    function writeRaw(obj) {
      try {
        const previous = storage.getItem(ENTRIES_KEY);
        if (previous !== null && parseObject(previous)) storage.setItem(BACKUP_KEY, previous);
        storage.setItem(ENTRIES_KEY, JSON.stringify(obj));
      } catch (e) {
        const err = /** @type {{ name?: string, code?: number } | null} */ (e);
        const full = err !== null && (err.name === 'QuotaExceededError' || err.code === 22);
        throw new StorageWriteError(
          full
            ? "Not saved: this browser's storage for Kenna is full."
            : "Not saved: this browser is blocking storage (Private Browsing or another app's built-in browser). Open Kenna from Safari or your Home Screen instead."
        );
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

    async function getEntry(date) {
      const raw = readRaw();
      return core.normalizeEntry(date, raw[date]);
    }

    // Applies only the fields in `patch` to the stored day, so edits made
    // elsewhere (another tab) to other fields are kept. Malformed days that
    // can't be displayed are left in storage untouched rather than dropped.
    async function updateEntry(date, patch) {
      if (!core.isValidDateStr(date)) throw new Error('Not saved: pick a valid date first.');
      const raw = readRaw();
      const next = core.applyPatch(date, raw[date], patch);
      if (core.isEntryEmpty(next)) delete raw[date];
      else raw[date] = next;
      writeRaw(raw);
      return next;
    }

    async function importEntries(entries) {
      const raw = readRaw();
      let count = 0;
      for (const date of Object.keys(entries)) {
        raw[date] = entries[date];
        count += 1;
      }
      writeRaw(raw);
      return count;
    }

    // ------------------------------------------------------------ photos

    let dbPromise = null;
    function openDB() {
      if (!idb) return Promise.reject(new Error('Photos need IndexedDB, which this browser has turned off.'));
      if (!dbPromise) {
        dbPromise = new Promise((resolve, reject) => {
          const req = idb.open(PHOTOS_DB_NAME, 1);
          req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(PHOTOS_STORE)) {
              db.createObjectStore(PHOTOS_STORE, { keyPath: 'id', autoIncrement: true });
            }
          };
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        }).catch((err) => {
          dbPromise = null;
          throw err;
        });
      }
      return dbPromise;
    }

    function tx(mode, fn) {
      return openDB().then(
        (db) =>
          new Promise((resolve, reject) => {
            const t = db.transaction(PHOTOS_STORE, mode);
            const result = fn(t.objectStore(PHOTOS_STORE));
            t.oncomplete = () => resolve(result && 'result' in result ? result.result : result);
            t.onerror = () => reject(t.error);
            t.onabort = () => reject(t.error || new Error('Photo storage was interrupted.'));
          })
      );
    }

    function toPhoto(record) {
      return {
        id: record.id,
        date: record.date,
        createdAt: record.createdAt,
        type: (record.blob && record.blob.type) || 'image/jpeg',
        blob: record.blob,
      };
    }

    async function listPhotos() {
      const records = await tx('readonly', (s) => s.getAll());
      return (records || [])
        .filter((r) => r && r.blob && core.isValidDateStr(r.date))
        .map(toPhoto)
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
    }

    /** @returns {Promise<number>} */
    async function countPhotos() {
      return Number(await tx('readonly', (s) => s.count())) || 0;
    }

    async function addPhoto(photo) {
      const record = { date: photo.date, blob: photo.blob, createdAt: photo.createdAt || new Date().toISOString() };
      const id = await tx('readwrite', (s) => s.add(record));
      return toPhoto({ ...record, id });
    }

    /** @param {Photo['id']} id @param {{ date: string }} changes */
    async function updatePhoto(id, changes) {
      const date = changes && changes.date;
      if (!core.isValidDateStr(date)) throw new Error('Pick a valid day for this photo.');
      if (core.isFutureDate(date)) throw new Error("A photo can't be filed under a day that hasn't happened yet.");
      /** @type {any} */
      let updated = null;
      await tx('readwrite', (s) => {
        const req = s.get(id);
        req.onsuccess = () => {
          if (!req.result) return;
          updated = { ...req.result, date };
          s.put(updated);
        };
        return null;
      });
      if (!updated) throw new Error('That photo no longer exists.');
      return toPhoto(updated);
    }

    async function deletePhoto(id) {
      await tx('readwrite', (s) => s.delete(id));
    }

    /** @param {Photo} photo */
    async function getPhotoBlob(photo) {
      if (!photo.blob) throw new Error(`A photo from ${core.formatDate(photo.date)} is missing its image.`);
      return photo.blob;
    }

    /** @param {Photo} photo */
    function photoSrc(photo) {
      const url = URL.createObjectURL(photo.blob || new Blob());
      return { url, release: () => URL.revokeObjectURL(url) };
    }

    function base64ToBlob(data, type) {
      const bin = atob(data);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
      return new Blob([bytes], { type });
    }

    // Adds backup photos ({ date, createdAt, type, data: base64 }) that
    // aren't already here (matched by the time each was first added), so
    // importing the same backup twice never duplicates anything.
    async function importPhotos(photos, onProgress) {
      const existing = await listPhotos();
      const seen = new Set(existing.map(core.photoKey));
      let added = 0;
      let skipped = 0;
      for (let i = 0; i < photos.length; i += 1) {
        const p = photos[i];
        const key = core.photoKey(p);
        if (seen.has(key)) {
          skipped += 1;
        } else {
          await addPhoto({ date: p.date, createdAt: p.createdAt, blob: base64ToBlob(p.data, p.type) });
          seen.add(key);
          added += 1;
        }
        if (onProgress) onProgress(i + 1, photos.length);
      }
      return { added, skipped };
    }

    // ------------------------------------------------------------ device

    async function init() {
      if (!storageWorks()) return { ok: false, reason: 'blocked' };
      readRaw(); // surfaces any recovery notice straight away
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

    function onExternalChange(callback) {
      if (!win) return;
      win.addEventListener('storage', (event) => {
        if (event.key === ENTRIES_KEY || event.key === null) callback();
      });
    }

    return {
      kind: /** @type {const} */ ('local'),
      init,
      loadEntries,
      getEntry,
      updateEntry,
      importEntries,
      listPhotos,
      countPhotos,
      addPhoto,
      updatePhoto,
      deletePhoto,
      getPhotoBlob,
      photoSrc,
      importPhotos,
      requestPersistence,
      persistenceStatus,
      onExternalChange,
    };
  }

  return { createLocalStore, ENTRIES_KEY, BACKUP_KEY, CORRUPT_KEY, StorageWriteError };
});
