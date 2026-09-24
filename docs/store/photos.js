// Progress photos: adding, listing, filing under another day, deleting
// (with a chance to bring one back) and showing them, over the databases
// in photo-db.js.
'use strict';

const core = require('../core.js');
const { writeError } = require('./common.js');
const { guardPhotos, photoDatabases, metaFrom, toPhoto, bytesOf, base64ToBlob, META_STORE, THUMBS_STORE } = require('./photo-db.js');

/**
 * @typedef {import('../core.js').BackupPhoto} BackupPhoto
 * @typedef {import('./photo-db.js').Photo} Photo
 * @typedef {import('./photo-db.js').PhotoRecord} PhotoRecord
 * @typedef {import('./photo-db.js').PhotoMeta} PhotoMeta
 */

/**
 * Makes a small preview of a photo, or null when this browser can't draw it.
 * @typedef {(photo: Blob) => Promise<Blob | null>} MakeThumbnail
 */

// Photos deleted but not yet erased, so that Undo can bring them back:
// their ids, in localStorage. Older versions don't know this key and
// still show them, so a rollback never loses one.
const HIDDEN_PHOTOS_KEY = 'kenna:photos:hidden';

/** @param {string | undefined} date */
function checkPhotoDate(date) {
  if (!core.isValidDateStr(date)) throw new core.InputError('Pick a valid day for this photo.');
  if (core.isFutureDate(date)) throw new core.InputError(core.FUTURE_PHOTO);
}

class PhotoStore {
  /**
   * @param {Storage} storage where the hidden photos are noted
   * @param {IDBFactory | undefined} idb
   * @param {MakeThumbnail | undefined} makeThumbnail
   */
  constructor(storage, idb, makeThumbnail) {
    this.storage = storage;
    this.db = photoDatabases(idb);
    this.makeThumbnail = makeThumbnail;
    // Previews are made one at a time, so opening a screen full of photos
    // saved before previews existed never decodes many full images at once.
    /** @type {Promise<unknown>} */
    this.thumbQueue = Promise.resolve();
  }

  /** @param {number} id @returns {Promise<PhotoRecord | undefined>} */
  getRecord(id) {
    return this.db.photos((s) => /** @type {IDBRequest<PhotoRecord | undefined>} */ (s.get(id)));
  }

  // Brings the index in line with the photos database: adds photos it
  // doesn't know yet (reading them one at a time) and drops entries for
  // photos that are gone. Only keys are compared, so when nothing has
  // changed no image is read.
  async syncIndex() {
    const keys = /** @type {number[]} */ (await this.db.photos((s) => s.getAllKeys()));
    const metas = /** @type {PhotoMeta[]} */ (await this.db.index((t) => t.objectStore(META_STORE).getAll()));
    const known = new Map(metas.map((m) => [m.id, m]));
    const present = new Set(keys);
    const stale = metas.filter((m) => !present.has(m.id)).map((m) => m.id);
    if (stale.length) {
      await this.db.index((t) => {
        for (const id of stale) {
          t.objectStore(META_STORE).delete(id);
          t.objectStore(THUMBS_STORE).delete(id);
        }
      }, 'readwrite');
      for (const id of stale) known.delete(id);
    }
    for (const id of keys) {
      if (known.has(id)) continue;
      const record = await this.getRecord(id);
      if (!record) continue;
      const meta = metaFrom(record);
      await this.db.index((t) => t.objectStore(META_STORE).put(meta), 'readwrite');
      known.set(id, meta);
    }
    return Array.from(known.values());
  }

  /** @returns {Set<number>} the ids of photos deleted but not yet erased */
  hidden() {
    try {
      const ids = JSON.parse(this.storage.getItem(HIDDEN_PHOTOS_KEY) || '[]');
      return new Set(Array.isArray(ids) ? ids.filter((id) => typeof id === 'number') : []);
    } catch {
      return new Set();
    }
  }

  /** @param {Set<number>} ids */
  writeHidden(ids) {
    if (ids.size) this.storage.setItem(HIDDEN_PHOTOS_KEY, JSON.stringify([...ids]));
    else this.storage.removeItem(HIDDEN_PHOTOS_KEY);
  }

  /** Every photo's details, newest first, without reading any image. @returns {Promise<Photo[]>} */
  async list() {
    const metas = await this.syncIndex();
    const hidden = this.hidden();
    return metas
      .filter((m) => !m.missing && !hidden.has(m.id) && core.isValidDateStr(m.date))
      .map(toPhoto)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
  }

  /** @returns {Promise<number>} */
  async count() {
    const hidden = this.hidden();
    const keys = /** @type {number[]} */ (await this.db.photos((s) => s.getAllKeys()));
    return keys.filter((id) => !hidden.has(id)).length;
  }

  /** @param {{ date: string, blob: Blob, createdAt?: string, thumb?: Blob | null }} photo */
  async add(photo) {
    checkPhotoDate(photo.date);
    const { bytes, type } = await bytesOf(photo.blob);
    const record = { date: photo.date, bytes, type, createdAt: photo.createdAt || new Date().toISOString() };
    const id = Number(await this.db.photos((s) => s.add(record), 'readwrite'));
    const meta = metaFrom({ ...record, id });
    const thumb = photo.thumb ? { id, ...(await bytesOf(photo.thumb)) } : null;
    try {
      await this.db.index((t) => {
        t.objectStore(META_STORE).put(meta);
        if (thumb) t.objectStore(THUMBS_STORE).put(thumb);
      }, 'readwrite');
    } catch {
      // The photo is saved; the next listing adds it to the index.
    }
    return toPhoto(meta);
  }

  /** @param {Photo['id']} id @param {{ date: string }} changes */
  async update(id, changes) {
    const date = changes && changes.date;
    checkPhotoDate(date);
    /** @type {PhotoRecord | null} */
    let updated = null;
    await this.db.photos((s) => {
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
    await this.db.index((t) => t.objectStore(META_STORE).put(meta), 'readwrite').catch(() => undefined);
    return toPhoto(meta);
  }

  /** Erases a photo now. @param {Photo['id']} id */
  async erase(id) {
    await this.db.photos((s) => s.delete(id), 'readwrite');
    await this.db
      .index((t) => {
        t.objectStore(META_STORE).delete(id);
        t.objectStore(THUMBS_STORE).delete(id);
      }, 'readwrite')
      .catch(() => undefined);
  }

  // Deleting from the photo viewer hides the photo first (it's left out
  // of every listing, count and backup), so Undo can bring it back as it
  // was, with its day and the time it was added. It's erased once that
  // chance has passed (eraseHidden), or at the next start.
  /** @param {Photo['id']} id */
  async hide(id) {
    const ids = this.hidden();
    ids.add(Number(id));
    try {
      this.writeHidden(ids);
    } catch {
      // No room to note it: erased now instead, without Undo.
      await this.erase(id);
      return false;
    }
    return true;
  }

  /** @param {Photo['id']} id */
  async unhide(id) {
    if (!(await this.getRecord(Number(id)))) throw new core.KennaError('That photo has already been deleted for good.');
    const ids = this.hidden();
    ids.delete(Number(id));
    try {
      this.writeHidden(ids);
    } catch (e) {
      throw writeError(e, 'The photo wasn’t brought back.');
    }
  }

  /** @param {Photo['id'][]} [only] */
  async eraseHidden(only) {
    const hidden = this.hidden();
    const ids = only ? only.map(Number).filter((id) => hidden.has(id)) : [...hidden];
    for (const id of ids) {
      await this.erase(id);
      const left = this.hidden();
      left.delete(id);
      this.writeHidden(left);
    }
  }

  /** @param {Photo} photo @returns {Promise<Blob>} the full image, read on its own */
  async blob(photo) {
    const record = await this.getRecord(Number(photo.id));
    if (!record || !(record.bytes || record.blob)) throw new core.KennaError(`A photo from ${core.formatDate(photo.date)} is missing its image.`);
    if (record.blob) return record.blob;
    return new Blob([/** @type {ArrayBuffer} */ (record.bytes)], { type: record.type || photo.type });
  }

  /**
   * The photo's small preview, made (and kept) the first time it's asked
   * for when there isn't one yet. Falls back to the full image when no
   * preview can be made (a format this browser can't draw).
   * @param {Photo} photo
   * @returns {Promise<Blob>}
   */
  async thumbBlob(photo) {
    const id = Number(photo.id);
    /** @type {{ id: number, bytes?: ArrayBuffer, type?: string, none?: boolean } | undefined} */
    const stored = await this.db.index((t) => t.objectStore(THUMBS_STORE).get(id)).catch(() => undefined);
    if (stored && stored.bytes) return new Blob([stored.bytes], { type: stored.type || 'image/jpeg' });
    const make = this.makeThumbnail;
    if ((stored && stored.none) || !make) return this.blob(photo);
    const job = this.thumbQueue.then(async () => {
      const full = await this.blob(photo);
      const thumb = await make(full).catch(() => null);
      const entry = thumb ? { id, ...(await bytesOf(thumb)) } : { id, none: true };
      await this.db.index((t) => t.objectStore(THUMBS_STORE).put(entry), 'readwrite').catch(() => undefined);
      return thumb || full;
    });
    this.thumbQueue = job.catch(() => undefined);
    return job;
  }

  /**
   * An address for showing the photo: its small preview ('thumb') or the
   * whole image ('full'). Call `release` once it's no longer shown.
   * @param {Photo} photo
   * @param {'thumb' | 'full'} size
   */
  async url(photo, size) {
    const blob = size === 'thumb' ? await this.thumbBlob(photo) : await this.blob(photo);
    const url = URL.createObjectURL(blob);
    return { url, release: () => URL.revokeObjectURL(url) };
  }

  // Adds backup photos ({ date, createdAt, type, data: base64 }) one at a
  // time, skipping any already here (matched by the time each was first
  // added), so importing the same backup twice never duplicates anything.
  // Only the index is read to find those, never an image.
  async importer() {
    const seen = new Set((await this.list()).map(core.photoKey));
    return {
      /** @param {BackupPhoto} p @returns {Promise<Photo | null>} */
      add: (p) =>
        guardPhotos('write', async () => {
          const key = core.photoKey(p);
          if (seen.has(key)) return null;
          const added = await this.add({ date: p.date, createdAt: p.createdAt, blob: base64ToBlob(p.data, p.type) });
          seen.add(key);
          return added;
        }),
    };
  }
}

module.exports = { PhotoStore, HIDDEN_PHOTOS_KEY };
