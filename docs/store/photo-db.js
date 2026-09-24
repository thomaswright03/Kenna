// The two IndexedDB databases progress photos live in, and what a failure
// there tells the person.
//
// Each photo's image lives in the "kenna-photos" database, as every
// version of Kenna has stored it. A second database, "kenna-photo-index",
// holds what the Photos screen and backups need without reading any
// image: each photo's day, time added and type ("meta"), and a small
// preview image ("thumbs"). The index is derived data: it is brought up
// to date from the photos themselves whenever photos are listed
// (photos.js), so photos saved by older versions (or by an older copy of
// the app after a rollback) are picked up, and the photos database itself
// never changes shape.
'use strict';

const core = require('../core.js');

const PHOTOS_DB_NAME = 'kenna-photos';
const PHOTOS_STORE = 'photos';
const INDEX_DB_NAME = 'kenna-photo-index';
const META_STORE = 'meta';
const THUMBS_STORE = 'thumbs';

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
 * A progress photo's details. Listing photos never reads their images: the
 * image is read on its own when it's shown or backed up.
 * @typedef {object} Photo
 * @property {number | string} id
 * @property {string} date the day it's filed under (YYYY-MM-DD)
 * @property {string} createdAt when it was added (ISO time); also its identity in backups
 * @property {string} type
 */

/**
 * A stored photo record, as any version of Kenna wrote it: raw bytes plus
 * their type (Safari refuses to put a Blob into IndexedDB in some modes,
 * Private Browsing among them), or, from older versions, a Blob.
 * @typedef {{ id: number, date: string, createdAt: string, type?: string, bytes?: ArrayBuffer, blob?: Blob }} PhotoRecord
 * @typedef {{ id: number, date: string, createdAt: string, type: string, missing?: boolean }} PhotoMeta
 */

/**
 * The error to pass on for a failed photo operation: Kenna's own messages
 * as they are, anything else as the Kenna sentence for `kind`.
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

/**
 * Opens a database once, and again after another copy of the app (another
 * tab) has closed it to upgrade it.
 * @param {IDBFactory | undefined} idb
 * @param {string} name
 * @param {(db: IDBDatabase) => void} upgrade
 * @returns {() => Promise<IDBDatabase>}
 */
function databaseOpener(idb, name, upgrade) {
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

/**
 * Transactions on the photos database (its one store) and on the index
 * (both of its stores).
 * @param {IDBFactory | undefined} idb
 */
function photoDatabases(idb) {
  const openPhotos = databaseOpener(idb, PHOTOS_DB_NAME, (db) => {
    if (!db.objectStoreNames.contains(PHOTOS_STORE)) db.createObjectStore(PHOTOS_STORE, { keyPath: 'id', autoIncrement: true });
  });
  const openIndex = databaseOpener(idb, INDEX_DB_NAME, (db) => {
    if (!db.objectStoreNames.contains(META_STORE)) db.createObjectStore(META_STORE, { keyPath: 'id' });
    if (!db.objectStoreNames.contains(THUMBS_STORE)) db.createObjectStore(THUMBS_STORE, { keyPath: 'id' });
  });
  return {
    /** @template T @param {(s: IDBObjectStore) => IDBRequest<T> | null | void} fn @param {IDBTransactionMode} [mode] */
    photos: (fn, mode) => run(openPhotos, [PHOTOS_STORE], mode || 'readonly', (t) => fn(t.objectStore(PHOTOS_STORE))),
    /** @template T @param {(t: IDBTransaction) => IDBRequest<T> | null | void} fn @param {IDBTransactionMode} [mode] */
    index: (fn, mode) => run(openIndex, [META_STORE, THUMBS_STORE], mode || 'readonly', fn),
  };
}

/** @param {PhotoRecord} record @returns {PhotoMeta} */
function metaFrom(record) {
  const type = record.type || (record.blob && record.blob.type) || 'image/jpeg';
  const meta = { id: record.id, date: record.date, createdAt: String(record.createdAt), type };
  return record.bytes || record.blob ? meta : { ...meta, missing: true };
}

/** @param {PhotoMeta} m @returns {Photo} */
const toPhoto = (m) => ({ id: m.id, date: m.date, createdAt: m.createdAt, type: m.type });

/** @param {Blob} blob */
async function bytesOf(blob) {
  return { bytes: await blob.arrayBuffer(), type: blob.type || 'image/jpeg' };
}

/** @param {string} data @param {string} type */
function base64ToBlob(data, type) {
  const bin = atob(data);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
}

module.exports = { guardPhotos, photoDatabases, metaFrom, toPhoto, bytesOf, base64ToBlob, META_STORE, THUMBS_STORE };
