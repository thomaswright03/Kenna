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

  // How long to wait for the server before saying it isn't responding.
  const REQUEST_TIMEOUT_MS = 10000;
  // Photo uploads and downloads carry much more data.
  const PHOTO_TIMEOUT_MS = 60000;
  const NOT_RESPONDING = "The Kenna server isn't responding. Check it's running, then try again.";

  /**
   * @param {{ fetch?: typeof fetch, base?: string, timeoutMs?: number }} [options]
   * @returns {import('./store-local.js').KennaStore}
   */
  function createServerStore(options) {
    const opts = options || {};
    /** @type {typeof fetch} */
    const fetchFn = opts.fetch || ((input, init) => fetch(input, init));
    const base = opts.base || '';
    const timeoutMs = opts.timeoutMs || REQUEST_TIMEOUT_MS;

    /**
     * Fetches with a time limit, so a server that accepts the connection but
     * never answers can't leave the app waiting forever.
     * @param {string} url
     * @param {RequestInit} init
     * @param {number} timeoutMs
     */
    async function fetchWithTimeout(url, init, timeoutMs) {
      const controller = typeof AbortController === 'function' ? new AbortController() : null;
      const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : undefined;
      try {
        return await fetchFn(url, { ...init, signal: controller ? controller.signal : undefined });
      } catch (err) {
        if (controller && controller.signal.aborted) throw new Error(NOT_RESPONDING);
        throw new Error("Couldn't reach the Kenna server. Check that it's running, then try again.", { cause: err });
      } finally {
        clearTimeout(timer);
      }
    }

    /**
     * @param {string} method
     * @param {string} path
     * @param {unknown} [body]
     * @param {{ timeoutMs?: number }} [options]
     * @returns {Promise<any>}
     */
    async function request(method, path, body, options) {
      const res = await fetchWithTimeout(
        base + path,
        {
          method,
          headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
          body: body === undefined ? undefined : JSON.stringify(body),
          // A day's save is tiny; keepalive lets it finish even if the page
          // is closed right after (a reload, or the phone discarding the app).
          keepalive: method === 'PATCH',
        },
        (options && options.timeoutMs) || timeoutMs
      );
      let data = null;
      try {
        data = await res.json();
      } catch {
        data = null;
      }
      if (!res.ok) {
        if (data && typeof data.error === 'string') throw new Error(data.error);
        throw new Error(
          res.status >= 500
            ? 'The Kenna server ran into a problem. Try again, and if it keeps happening, restart the server.'
            : "The Kenna server didn't accept that. Reload the page and try again."
        );
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
      return request('POST', '/api/photos', { date: photo.date, createdAt: photo.createdAt, dataUrl }, { timeoutMs: PHOTO_TIMEOUT_MS });
    }

    /** @param {{ date: string, blob: Blob, createdAt?: string }} photo */
    function addPhoto(photo) {
      return serial(async () => toPhoto(await postPhoto(photo)));
    }

    /** @param {Photo['id']} id @param {{ date: string }} changes */
    function updatePhoto(id, changes) {
      return serial(async () => toPhoto(await request('PATCH', `/api/photos/${encodeURIComponent(id)}`, { date: changes.date })));
    }

    /** @param {Photo['id']} id */
    function deletePhoto(id) {
      return serial(() => request('DELETE', `/api/photos/${encodeURIComponent(id)}`));
    }

    /** @param {Photo} photo */
    async function getPhotoBlob(photo) {
      const res = await fetchWithTimeout(base + photo.url, {}, PHOTO_TIMEOUT_MS);
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
      updatePhoto,
      deletePhoto,
      getPhotoBlob,
      photoSrc,
      importPhotos,
      requestPersistence: async () => null,
      persistenceStatus: async () => null,
      onExternalChange: () => {},
    };
  }

  return { createServerStore, REQUEST_TIMEOUT_MS, NOT_RESPONDING };
});
