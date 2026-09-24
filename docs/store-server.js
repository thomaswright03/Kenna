// Server storage for the Node/Express version: the same interface as
// store-local.js, backed by the /api endpoints in server.js. Every request
// checks for failure and rejects with a plain-language message, so the UI
// can say "not saved" instead of pretending.

/**
 * @typedef {import('./store-local.js').Photo} Photo
 * @typedef {import('./core.js').Entry} Entry
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./core.js'));
  else /** @type {any} */ (root).KennaServerStore = factory(/** @type {any} */ (root).KennaCore);
})(typeof self !== 'undefined' ? self : this, function (/** @type {typeof import('./core.js')} */ core) {
  'use strict';

  /**
   * @param {{ fetch?: typeof fetch, base?: string }} [options]
   * @returns {import('./store-local.js').KennaStore}
   */
  function createServerStore(options) {
    const opts = options || {};
    /** @type {typeof fetch} */
    const fetchFn = opts.fetch || ((input, init) => fetch(input, init));
    const base = opts.base || '';

    /**
     * @param {string} method
     * @param {string} path
     * @param {unknown} [body]
     * @returns {Promise<any>}
     */
    async function request(method, path, body) {
      let res;
      try {
        res = await fetchFn(base + path, {
          method,
          headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
      } catch {
        throw new Error("Couldn't reach the Kenna server. Check that it's running, then try again.");
      }
      let data = null;
      try {
        data = await res.json();
      } catch {
        data = null;
      }
      if (!res.ok) {
        const message = data && typeof data.error === 'string' ? data.error : `The Kenna server had a problem (${res.status}).`;
        throw new Error(message);
      }
      return data;
    }

    // Writes go one at a time, in order, so a slow save can never land after
    // (and undo) a later one.
    /** @type {Promise<unknown>} */
    let queue = Promise.resolve();
    /**
     * @template T
     * @param {() => Promise<T>} fn
     * @returns {Promise<T>}
     */
    function serial(fn) {
      const run = queue.then(fn, fn);
      queue = run.catch(() => {});
      return run;
    }

    async function loadEntries() {
      const list = await request('GET', '/api/entries');
      /** @type {Record<string, Entry>} */
      const entries = {};
      for (const item of Array.isArray(list) ? list : []) {
        const entry = core.normalizeEntry(item && item.date, item);
        if (entry) entries[entry.date] = entry;
      }
      return entries;
    }

    async function getEntry(date) {
      const item = await request('GET', `/api/entries/${encodeURIComponent(date)}`);
      const entry = core.normalizeEntry(date, item);
      return entry && !core.isEntryEmpty(entry) ? entry : null;
    }

    /** @param {string} date @param {import('./core.js').EntryPatch} patch */
    function updateEntry(date, patch) {
      return serial(async () => {
        const item = await request('PATCH', `/api/entries/${encodeURIComponent(date)}`, patch);
        const entry = core.normalizeEntry(date, item);
        if (!entry) throw new Error('The Kenna server sent back something unexpected. Reload the page and check this day.');
        return entry;
      });
    }

    /** @param {Record<string, Entry>} entries @returns {Promise<number>} */
    function importEntries(entries) {
      return serial(async () => {
        const result = await request('POST', '/api/import', { entries });
        return Number(result && result.restored) || 0;
      });
    }

    /** @param {any} p @returns {Photo} */
    function toPhoto(p) {
      return { id: p.id, date: p.date, createdAt: p.createdAt, type: p.type || 'image/jpeg', url: `/photos/${encodeURIComponent(p.filename)}` };
    }

    async function listPhotos() {
      const list = await request('GET', '/api/photos');
      return (Array.isArray(list) ? list : []).map(toPhoto);
    }

    async function countPhotos() {
      return (await listPhotos()).length;
    }

    /** @param {Blob} blob @returns {Promise<string>} */
    function blobToDataUrl(blob) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
      });
    }

    /** @param {{ date: string, createdAt?: string, blob?: Blob, type?: string, data?: string }} photo */
    async function postPhoto(photo) {
      const dataUrl = photo.data ? `data:${photo.type};base64,${photo.data}` : await blobToDataUrl(photo.blob || new Blob());
      return request('POST', '/api/photos', { date: photo.date, createdAt: photo.createdAt, dataUrl });
    }

    /** @param {{ date: string, blob: Blob, createdAt?: string }} photo */
    function addPhoto(photo) {
      return serial(async () => toPhoto(await postPhoto(photo)));
    }

    /** @param {Photo['id']} id */
    function deletePhoto(id) {
      return serial(() => request('DELETE', `/api/photos/${encodeURIComponent(id)}`));
    }

    /** @param {Photo} photo */
    async function getPhotoBlob(photo) {
      let res;
      try {
        res = await fetchFn(base + photo.url);
      } catch {
        throw new Error("Couldn't reach the Kenna server to read a photo.");
      }
      if (!res.ok) throw new Error(`A photo from ${core.formatDate(photo.date)} couldn't be read from the server.`);
      return res.blob();
    }

    /** @param {Photo} photo */
    function photoSrc(photo) {
      return { url: base + photo.url, release: () => {} };
    }

    /**
     * @param {import('./core.js').BackupPhoto[]} photos
     * @param {(done: number, total: number) => void} [onProgress]
     */
    function importPhotos(photos, onProgress) {
      return serial(async () => {
        let added = 0;
        let skipped = 0;
        for (let i = 0; i < photos.length; i += 1) {
          const result = await postPhoto(photos[i]);
          if (result && result.duplicate) skipped += 1;
          else added += 1;
          if (onProgress) onProgress(i + 1, photos.length);
        }
        return { added, skipped };
      });
    }

    return {
      kind: /** @type {const} */ ('server'),
      init: async () => ({ ok: true }),
      loadEntries,
      getEntry,
      updateEntry,
      importEntries,
      listPhotos,
      countPhotos,
      addPhoto,
      deletePhoto,
      getPhotoBlob,
      photoSrc,
      importPhotos,
      requestPersistence: async () => null,
      persistenceStatus: async () => null,
      onExternalChange: () => {},
    };
  }

  return { createServerStore };
});
