// Writing and reading backup files a piece at a time. A year of daily
// progress photos makes a backup of well over 100 MB, which a phone browser
// can't safely hold as one string or parse in one go. So:
//  - writing builds the file from one small Blob per photo, never one string;
//  - reading goes through the file in 1 MB slices, handing over one photo at
//    a time, so only a single photo is in memory at once.
// The file format is plain JSON (see core.js), so any backup, including
// older and hand-formatted ones, reads the same way.

/**
 * @typedef {import('./core.js').Entry} Entry
 * @typedef {import('./core.js').BackupPhoto} BackupPhoto
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./core.js'));
  else /** @type {any} */ (root).KennaBackupFile = factory(/** @type {any} */ (root).KennaCore);
})(typeof self !== 'undefined' ? self : this, function (/** @type {typeof import('./core.js')} */ core) {
  'use strict';

  const CHUNK_BYTES = 1024 * 1024;

  // ------------------------------------------------------------ writing

  /**
   * Starts a backup file. Add photos one at a time, then call finish().
   * @param {Record<string, Entry>} entries
   * @param {string} exportedAt ISO time
   */
  function createBackupWriter(entries, exportedAt) {
    /** @type {BlobPart[]} */
    const parts = [
      `{"app":"kenna","version":${core.BACKUP_VERSION},"exportedAt":${JSON.stringify(exportedAt)},"entries":${JSON.stringify(entries)},"photos":[`,
    ];
    let count = 0;
    return {
      /** @param {BackupPhoto} photo */
      addPhoto(photo) {
        const json = JSON.stringify({ date: photo.date, createdAt: photo.createdAt, type: photo.type, data: photo.data });
        // Each photo becomes its own Blob, so its text can be let go of.
        parts.push(new Blob([count > 0 ? `,${json}` : json]));
        count += 1;
      },
      finish() {
        parts.push(']}');
        return new Blob(parts, { type: 'application/json' });
      },
    };
  }

  // ------------------------------------------------------------ scanning

  class BackupFormatError extends Error {}

  const WHITESPACE = ' \t\n\r';
  const IN_STRING_STOP = /["\\]/g;
  const STRUCTURE = /["{}[\],]/g;

  /**
   * An incremental reader for a JSON object whose `streamKeys` hold large
   * arrays: each element of those arrays is handed back separately as its
   * JSON text; every other top-level value is collected whole.
   * @param {string[]} streamKeys
   */
  function createScanner(streamKeys) {
    /** @type {'start' | 'key-or-end' | 'key-required' | 'key' | 'colon' | 'value-start' | 'value' | 'item-or-end' | 'item-start' | 'item' | 'after-value' | 'done'} */
    let state = 'start';
    /** @type {string[]} */
    let pieces = [];
    let key = '';
    let depth = 0;
    let inString = false;
    let escape = false;
    /** @type {Record<string, string>} */
    const values = {};
    /** @type {Set<string>} */
    const streamed = new Set();

    /** @param {string} message */
    const fail = (message) => {
      throw new BackupFormatError(message);
    };

    /**
     * Feeds the next piece of text; returns the stream items it completed.
     * @param {string} chunk
     * @returns {{ key: string, text: string }[]}
     */
    function push(chunk) {
      /** @type {{ key: string, text: string }[]} */
      const items = [];
      const n = chunk.length;
      let i = 0;
      const capturing = () => state === 'key' || state === 'value' || state === 'item';
      let captureStart = capturing() ? 0 : -1;
      if (escape && capturing()) {
        escape = false;
        i = 1;
      }

      /** @param {number} end */
      const takeCapture = (end) => {
        const text = pieces.join('') + chunk.slice(captureStart, end);
        pieces = [];
        captureStart = -1;
        return text;
      };

      while (i < n) {
        const ch = chunk[i];
        if (!capturing()) {
          if (WHITESPACE.includes(ch) || (state === 'start' && ch === '\uFEFF')) {
            i += 1;
            continue;
          }
          if (state === 'start') {
            if (ch !== '{') fail('not an object');
            state = 'key-or-end';
            i += 1;
          } else if (state === 'key-or-end' || state === 'key-required') {
            if (ch === '}' && state === 'key-or-end') {
              state = 'done';
              i += 1;
            } else if (ch === '"') {
              state = 'key';
              inString = true;
              captureStart = i;
              i += 1;
            } else fail('expected a name');
          } else if (state === 'colon') {
            if (ch !== ':') fail('expected ":"');
            state = 'value-start';
            i += 1;
          } else if (state === 'value-start') {
            if (ch === '[' && streamKeys.includes(key)) {
              streamed.add(key);
              state = 'item-or-end';
              i += 1;
            } else {
              state = 'value';
              depth = 0;
              inString = false;
              captureStart = i;
            }
          } else if (state === 'item-or-end' || state === 'item-start') {
            if (ch === ']' && state === 'item-or-end') {
              state = 'after-value';
              i += 1;
            } else if (ch === ']' || ch === ',') {
              fail('empty item');
            } else {
              state = 'item';
              depth = 0;
              inString = false;
              captureStart = i;
            }
          } else if (state === 'after-value') {
            if (ch === ',') state = 'key-required';
            else if (ch === '}') state = 'done';
            else fail('expected "," or "}"');
            i += 1;
          } else {
            fail('text after the end');
          }
          continue;
        }

        // Capturing a key, a value or an array item.
        if (inString) {
          IN_STRING_STOP.lastIndex = i;
          const m = IN_STRING_STOP.exec(chunk);
          if (!m) {
            i = n;
            break;
          }
          if (m[0] === '\\') {
            if (m.index + 1 >= n) {
              escape = true;
              i = n;
              break;
            }
            i = m.index + 2;
            continue;
          }
          inString = false;
          i = m.index + 1;
          if (state === 'key') {
            try {
              key = JSON.parse(takeCapture(i));
            } catch {
              fail('bad name');
            }
            state = 'colon';
          }
          continue;
        }

        STRUCTURE.lastIndex = i;
        const m = STRUCTURE.exec(chunk);
        if (!m) {
          i = n;
          break;
        }
        const c = m[0];
        const at = m.index;
        if (c === '"') {
          inString = true;
          i = at + 1;
        } else if (c === '{' || c === '[') {
          depth += 1;
          i = at + 1;
        } else if ((c === '}' || c === ']') && depth > 0) {
          depth -= 1;
          i = at + 1;
        } else if (c === ',' && depth > 0) {
          i = at + 1;
        } else {
          // A comma or closing bracket at the top of this value ends it.
          const text = takeCapture(at);
          if (state === 'value') {
            if (c === ']') fail('unexpected "]"');
            values[key] = text;
            state = c === ',' ? 'key-required' : 'done';
          } else {
            if (c === '}') fail('unexpected "}"');
            items.push({ key, text });
            state = c === ',' ? 'item-start' : 'after-value';
          }
          i = at + 1;
        }
      }
      if (captureStart !== -1 && capturing()) pieces.push(chunk.slice(captureStart));
      return items;
    }

    function end() {
      if (state !== 'done') fail('the file ends too early');
      return { values, streamed };
    }

    return { push, end };
  }

  /**
   * Reads a Blob as text in 1 MB slices (never all at once), calling
   * `onText` for each and waiting for it before reading on.
   * @param {Blob} blob
   * @param {(text: string) => Promise<void> | void} onText
   */
  async function readInSlices(blob, onText) {
    const decoder = new TextDecoder('utf-8');
    for (let offset = 0; offset < blob.size; offset += CHUNK_BYTES) {
      const buffer = await blob.slice(offset, offset + CHUNK_BYTES).arrayBuffer();
      await onText(decoder.decode(buffer, { stream: offset + CHUNK_BYTES < blob.size }));
    }
    const rest = decoder.decode();
    if (rest) await onText(rest);
  }

  /**
   * Goes through a backup file, calling `onPhoto` with each photo's JSON text
   * (and its number, from 1) and waiting for it before reading on. Returns the
   * file's other top-level values, parsed.
   * @param {Blob} blob
   * @param {(text: string, n: number) => Promise<void> | void} onPhoto
   * @returns {Promise<{ top: Record<string, unknown>, photosIsArray: boolean }>}
   */
  async function scanBackup(blob, onPhoto) {
    const scanner = createScanner(['photos']);
    let n = 0;
    await readInSlices(blob, async (text) => {
      for (const item of scanner.push(text)) {
        n += 1;
        await onPhoto(item.text, n);
      }
    });
    const { values, streamed } = scanner.end();
    /** @type {Record<string, unknown>} */
    const top = {};
    for (const k of Object.keys(values)) {
      try {
        top[k] = JSON.parse(values[k]);
      } catch {
        throw new BackupFormatError(`bad value for ${k}`);
      }
    }
    return { top, photosIsArray: streamed.has('photos') };
  }

  /**
   * @param {string} text
   * @param {number} n
   * @returns {{ ok: true, photo: BackupPhoto } | { ok: false, error: string }}
   */
  function parsePhoto(text, n) {
    let value;
    try {
      value = JSON.parse(text);
    } catch {
      return { ok: false, error: `Photo ${n} isn't in the expected format.` };
    }
    return core.checkBackupPhoto(value, n);
  }

  /**
   * Checks a whole backup file without keeping its photos in memory.
   * Nothing is changed; importing is a second pass (importBackupPhotos).
   * @param {Blob} blob
   * @param {(photosChecked: number) => void} [onProgress]
   * @returns {Promise<{ ok: true, entries: Record<string, Entry>, dayCount: number, photoCount: number } | { ok: false, error: string }>}
   */
  async function checkBackup(blob, onProgress) {
    /** @type {string[]} */
    const problems = [];
    let photoCount = 0;
    let scanned;
    try {
      scanned = await scanBackup(blob, (text, n) => {
        const result = parsePhoto(text, n);
        if (result.ok) photoCount += 1;
        else problems.push(result.error);
        if (onProgress && n % 25 === 0) onProgress(n);
      });
    } catch (err) {
      if (err instanceof BackupFormatError) return { ok: false, error: core.UNREADABLE_BACKUP };
      throw err;
    }
    const { top, photosIsArray } = scanned;
    const days = core.checkBackupDays(top, problems);
    if (!days.ok) return days;
    if (top.photos !== undefined && !photosIsArray) problems.push('The photos section is not in the expected format.');
    if (problems.length > 0) return { ok: false, error: core.backupProblemsMessage(problems) };
    return { ok: true, entries: days.entries, dayCount: Object.keys(days.entries).length, photoCount };
  }

  /**
   * Hands each photo of an already-checked backup file to `add`, one at a
   * time.
   * @param {Blob} blob
   * @param {(photo: BackupPhoto, n: number) => Promise<void>} add
   */
  async function forEachBackupPhoto(blob, add) {
    await scanBackup(blob, async (text, n) => {
      const result = parsePhoto(text, n);
      if (!result.ok) throw new Error(result.error);
      await add(result.photo, n);
    });
  }

  return Object.freeze({ createBackupWriter, createScanner, checkBackup, forEachBackupPhoto, BackupFormatError, CHUNK_BYTES });
});
