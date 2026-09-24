// Browser storage for the installable app: days live in localStorage,
// progress photos in IndexedDB (photos are far bigger than localStorage's
// quota allows). Every method returns a Promise, so the screens are written
// the same way whether a call finishes at once (days) or later (photos).
// Node gets it with require('./docs/store-local.js') and the page as
// window.KennaLocalStore (npm run build bundles it into build/data.js).
// Each part has its own module in store/:
//
//   store/entries.js    the days, in localStorage
//   store/damaged.js    stored data found damaged, kept aside
//   store/photos.js     progress photos
//   store/photo-db.js   the IndexedDB databases they live in
//   store/device.js     persistence, and changes made in another tab
//   store/common.js     reading stored JSON, and write errors

/**
 * @typedef {import('./core.js').Entry} Entry
 * @typedef {import('./core.js').EntryPatch} EntryPatch
 * @typedef {import('./core.js').BackupPhoto} BackupPhoto
 * @typedef {import('./store/photo-db.js').Photo} Photo
 * @typedef {import('./store/photos.js').MakeThumbnail} MakeThumbnail
 * @typedef {import('./store/damaged.js').DamagedCopy} DamagedCopy
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

'use strict';

const { StorageWriteError, blockedStorage } = require('./store/common.js');
const { DamagedCopies, CORRUPT_KEY, MAX_CORRUPT_COPIES } = require('./store/damaged.js');
const { DayStore, ENTRIES_KEY, BACKUP_KEY, UNDO_IMPORT_KEY, RECENT_KEY, RECENT_BACKUP_KEY, MAX_RECENT_DAYS } = require('./store/entries.js');
const { PhotoStore, HIDDEN_PHOTOS_KEY } = require('./store/photos.js');
const { guardPhotos } = require('./store/photo-db.js');
const device = require('./store/device.js');

/**
 * The days' part of the interface. Each call returns a Promise, whose
 * failure is the error thrown.
 * @param {DayStore} days
 * @param {DamagedCopies} damaged
 */
function dayMethods(days, damaged) {
  return {
    loadEntries: async () => days.loadEntries(),
    /** @param {string} date */
    getEntry: async (date) => days.getEntry(date),
    /** @param {string} date @param {EntryPatch} patch */
    updateEntry: async (date, patch) => days.updateEntry(date, patch),
    /** @param {Record<string, Entry>} entries */
    importEntries: async (entries) => days.importEntries(entries),
    undoImport: async () => days.undoImport(),
    settle: async () => days.settle(),
    damagedCopies: async () => damaged.list(),
    deleteDamagedCopies: async () => damaged.deleteAll(),
  };
}

/**
 * The photos' part of the interface. Every photo operation fails with a
 * Kenna sentence, never the browser's own error text.
 * @param {PhotoStore} photos
 */
function photoMethods(photos) {
  return {
    listPhotos: () => guardPhotos('list', () => photos.list()),
    countPhotos: () => guardPhotos('list', () => photos.count()),
    /** @param {{ date: string, blob: Blob, createdAt?: string, thumb?: Blob | null }} photo */
    addPhoto: (photo) => guardPhotos('write', () => photos.add(photo)),
    /** @param {Photo['id']} id @param {{ date: string }} changes */
    updatePhoto: (id, changes) => guardPhotos('write', () => photos.update(id, changes)),
    /** @param {Photo['id']} id */
    deletePhoto: (id) => guardPhotos('write', () => photos.erase(id)),
    /** @param {Photo['id']} id */
    hidePhoto: (id) => guardPhotos('write', () => photos.hide(id)),
    /** @param {Photo['id']} id */
    unhidePhoto: (id) => guardPhotos('write', () => photos.unhide(id)),
    /** @param {Photo['id'][]} [ids] */
    deleteHiddenPhotos: (ids) => guardPhotos('write', () => photos.eraseHidden(ids)),
    /** @param {Photo} photo */
    getPhotoBlob: (photo) => guardPhotos('read', () => photos.blob(photo)),
    /** @param {Photo} photo @param {'thumb' | 'full'} size */
    photoUrl: (photo, size) => guardPhotos('read', () => photos.url(photo, size)),
    createPhotoImporter: () => guardPhotos('list', () => photos.importer()),
  };
}

/**
 * @param {{ storage: Storage | null, indexedDB?: IDBFactory, navigator?: Navigator, window?: Window, onNotice?: (notice: { tone: 'warning' | 'error', message: string }) => void, makeThumbnail?: MakeThumbnail }} options
 * @returns {KennaStore}
 */
function createLocalStore(options) {
  /** @type {Storage} */
  const storage = options.storage || blockedStorage();
  const damaged = new DamagedCopies(storage);
  const days = new DayStore(storage, options.onNotice || function () {}, damaged);
  const photos = new PhotoStore(storage, options.indexedDB, options.makeThumbnail);
  const nav = options.navigator;

  async function init() {
    if (!device.storageWorks(storage)) return { ok: false, reason: 'blocked' };
    days.readRaw(); // surfaces any recovery notice straight away
    days.settle();
    // Photos deleted in an earlier visit, whose Undo has gone with it.
    if (photos.hidden().size) guardPhotos('write', () => photos.eraseHidden()).catch(() => undefined);
    return { ok: true };
  }

  return {
    init,
    ...dayMethods(days, damaged),
    ...photoMethods(photos),
    requestPersistence: () => device.requestPersistence(nav),
    persistenceStatus: () => device.persistenceStatus(nav),
    onExternalChange: (callback) => device.onExternalChange(options.window, callback),
  };
}

module.exports = Object.freeze({
  createLocalStore,
  HIDDEN_PHOTOS_KEY,
  ENTRIES_KEY,
  BACKUP_KEY,
  RECENT_KEY,
  RECENT_BACKUP_KEY,
  MAX_RECENT_DAYS,
  CORRUPT_KEY,
  UNDO_IMPORT_KEY,
  MAX_CORRUPT_COPIES,
  StorageWriteError,
});
