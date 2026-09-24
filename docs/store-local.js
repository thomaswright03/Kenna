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
 * @property {(entries: Record<string, Entry>) => Promise<number>} importEntries replaces the given days, first keeping the days it replaces so undoImport can put them back
 * @property {() => Promise<number>} undoImport puts the days the last import replaced back as they were (and removes days it added)
 * @property {() => Promise<Photo[]>} listPhotos every photo's details, newest first (no images)
 * @property {() => Promise<number>} countPhotos
 * @property {(photo: { date: string, blob: Blob, createdAt?: string, thumb?: Blob | null }) => Promise<Photo>} addPhoto
 * @property {(id: Photo['id']) => Promise<unknown>} deletePhoto
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
  // Damaged copies kept at most: the newest ones.
  const MAX_CORRUPT_COPIES = 2;
  const PHOTOS_DB_NAME = 'kenna-photos';
  const PHOTOS_STORE = 'photos';
  const INDEX_DB_NAME = 'kenna-photo-index';
  const META_STORE = 'meta';
  const THUMBS_STORE = 'thumbs';

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
    // Every write first copies the previous value to a ":backup" key. If the
    // stored value is ever unreadable, we restore from that copy instead of
    // treating the history as empty; if both are unreadable, the damaged text
    // is kept under ":corrupt" so the next save can't erase what's left.

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
          "Your saved data was damaged and couldn't be restored. Kenna is starting fresh, and has kept the damaged copy: Settings can download it to send off for repair. Import a backup file from Settings to get your history back.",
      });
      try {
        storage.setItem(ENTRIES_KEY, '{}');
      } catch {
        // Ignore: the next successful write replaces it anyway.
      }
      return {};
    }

    /** @param {Record<string, unknown>} obj */
    function writeRaw(obj) {
      try {
        const previous = storage.getItem(ENTRIES_KEY);
        if (previous !== null && parseObject(previous)) storage.setItem(BACKUP_KEY, previous);
        storage.setItem(ENTRIES_KEY, JSON.stringify(obj));
      } catch (e) {
        throw new StorageWriteError(
          core.isQuotaError(e)
            ? `Not saved. ${core.STORAGE_FULL}`
            : "Not saved: this browser is blocking storage (Private Browsing or another app's built-in browser). Open Kenna from Safari or your Home Screen instead.",
          { cause: e }
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

    /** @param {string} date */
    async function getEntry(date) {
      const raw = readRaw();
      return core.normalizeEntry(date, raw[date]);
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
      const raw = readRaw();
      const next = core.applyPatch(date, raw[date], checked.patch);
      if (core.isEntryEmpty(next)) delete raw[date];
      else raw[date] = next;
      writeRaw(raw);
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
      writeRaw(raw);
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
        if (!idb) return Promise.reject(new core.KennaError(PHOTO_ERRORS.off));
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

    /** Every photo's details, newest first, without reading any image. */
    async function listPhotos() {
      const metas = await syncIndex();
      return metas
        .filter((m) => !m.missing && core.isValidDateStr(m.date))
        .map(toPhoto)
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
    }

    /** @returns {Promise<number>} */
    async function countPhotos() {
      return Number(await photosTx((s) => s.count())) || 0;
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
        if (event.key === ENTRIES_KEY || event.key === null) callback();
      });
    }

    return {
      init,
      loadEntries,
      getEntry,
      updateEntry,
      importEntries,
      undoImport,
      damagedCopies,
      deleteDamagedCopies,
      // Every photo operation fails with a Kenna sentence, never the
      // browser's own error text.
      listPhotos: () => guardPhotos('list', listPhotos),
      countPhotos: () => guardPhotos('list', countPhotos),
      addPhoto: (photo) => guardPhotos('write', () => addPhoto(photo)),
      updatePhoto: (id, changes) => guardPhotos('write', () => updatePhoto(id, changes)),
      deletePhoto: (id) => guardPhotos('write', () => deletePhoto(id)),
      getPhotoBlob: (photo) => guardPhotos('read', () => getPhotoBlob(photo)),
      photoUrl: (photo, size) => guardPhotos('read', () => photoUrl(photo, size)),
      createPhotoImporter: () => guardPhotos('list', createPhotoImporter),
      requestPersistence,
      persistenceStatus,
      onExternalChange,
    };
  }

  return Object.freeze({ createLocalStore, ENTRIES_KEY, BACKUP_KEY, CORRUPT_KEY, UNDO_IMPORT_KEY, MAX_CORRUPT_COPIES, StorageWriteError });
});
