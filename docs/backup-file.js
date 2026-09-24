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
 * @typedef {{ date: string, createdAt: string }} PhotoStamp a backup photo's day and upload time (no image)
 */

'use strict';

const core = require('./core.js');

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
 * @typedef {'start' | 'key-or-end' | 'key-required' | 'key' | 'colon' | 'value-start' | 'value' | 'item-or-end' | 'item-start' | 'item' | 'after-value' | 'done'} ScanState
 *   key, value and item: capturing that text, which may run over many pieces
 */

/**
 * An incremental reader for a JSON object whose `streamKeys` hold large
 * arrays: each element of those arrays is handed back separately as its
 * JSON text; every other top-level value is collected whole. Text is fed
 * in pieces cut anywhere (push), then end() checks the object was whole.
 */
class Scanner {
  /** @param {string[]} streamKeys */
  constructor(streamKeys) {
    this.streamKeys = streamKeys;
    /** @type {ScanState} */
    this.state = 'start';
    // The text captured so far, from pieces before this one.
    /** @type {string[]} */
    this.pieces = [];
    // The name of the value being read.
    this.key = '';
    // How deep inside brackets the capture is, whether it's inside a
    // string, and whether the last piece ended on a backslash there.
    this.depth = 0;
    this.inString = false;
    this.escape = false;
    /** @type {Record<string, string>} */
    this.values = {};
    /** @type {Set<string>} */
    this.streamed = new Set();
    // The piece being read, where its capture starts (-1: none), and the
    // stream items it completed.
    this.chunk = '';
    this.captureStart = -1;
    /** @type {{ key: string, text: string }[]} */
    this.items = [];
  }

  capturing() {
    return this.state === 'key' || this.state === 'value' || this.state === 'item';
  }

  /** @param {string} message @returns {never} */
  fail(message) {
    throw new BackupFormatError(message);
  }

  /**
   * Feeds the next piece of text; returns the stream items it completed.
   * @param {string} chunk
   * @returns {{ key: string, text: string }[]}
   */
  push(chunk) {
    this.chunk = chunk;
    this.items = [];
    this.captureStart = this.capturing() ? 0 : -1;
    let i = 0;
    if (this.escape && this.capturing()) {
      this.escape = false;
      i = 1;
    }
    while (i < chunk.length) {
      if (!this.capturing()) i = this.between(i);
      else if (this.inString) i = this.inStringText(i);
      else i = this.inCapture(i);
    }
    if (this.captureStart !== -1 && this.capturing()) this.pieces.push(chunk.slice(this.captureStart));
    const items = this.items;
    this.items = [];
    this.chunk = '';
    return items;
  }

  /** The text captured, up to `end` in this piece. @param {number} end */
  takeCapture(end) {
    const text = this.pieces.join('') + this.chunk.slice(this.captureStart, end);
    this.pieces = [];
    this.captureStart = -1;
    return text;
  }

  /**
   * Starts capturing at `i`: a name (a string), a value or an item.
   * @param {'key' | 'value' | 'item'} state
   * @param {number} i
   */
  startCapture(state, i) {
    this.state = state;
    this.depth = 0;
    this.inString = state === 'key';
    this.captureStart = i;
  }

  /**
   * One character outside any capture: the object's own punctuation.
   * @param {number} i
   * @returns {number} where to go on from
   */
  between(i) {
    const ch = this.chunk[i];
    const { state } = this;
    if (WHITESPACE.includes(ch) || (state === 'start' && ch === '﻿')) return i + 1;
    if (state === 'start') {
      if (ch !== '{') this.fail('not an object');
      this.state = 'key-or-end';
    } else if (state === 'key-or-end' || state === 'key-required') {
      if (ch === '}' && state === 'key-or-end') this.state = 'done';
      else if (ch === '"') this.startCapture('key', i);
      else this.fail('expected a name');
    } else if (state === 'colon') {
      if (ch !== ':') this.fail('expected ":"');
      this.state = 'value-start';
    } else if (state === 'value-start') {
      if (ch === '[' && this.streamKeys.includes(this.key)) {
        this.streamed.add(this.key);
        this.state = 'item-or-end';
      } else {
        // The value starts here: read again, capturing.
        this.startCapture('value', i);
        return i;
      }
    } else if (state === 'item-or-end' || state === 'item-start') {
      if (ch === ']' && state === 'item-or-end') this.state = 'after-value';
      else if (ch === ']' || ch === ',') this.fail('empty item');
      else {
        this.startCapture('item', i);
        return i;
      }
    } else if (state === 'after-value') {
      if (ch === ',') this.state = 'key-required';
      else if (ch === '}') this.state = 'done';
      else this.fail('expected "," or "}"');
    } else {
      this.fail('text after the end');
    }
    return i + 1;
  }

  /**
   * Inside a string being captured: goes on to its closing quote, which
   * ends a name.
   * @param {number} i
   * @returns {number}
   */
  inStringText(i) {
    const n = this.chunk.length;
    IN_STRING_STOP.lastIndex = i;
    const m = IN_STRING_STOP.exec(this.chunk);
    if (!m) return n;
    if (m[0] === '\\') {
      if (m.index + 1 < n) return m.index + 2;
      this.escape = true;
      return n;
    }
    this.inString = false;
    const next = m.index + 1;
    if (this.state === 'key') {
      try {
        this.key = JSON.parse(this.takeCapture(next));
      } catch {
        this.fail('bad name');
      }
      this.state = 'colon';
    }
    return next;
  }

  /**
   * Inside a value or item being captured, outside strings: goes on to the
   * next bracket, comma or quote. A comma or closing bracket at the top of
   * the capture ends it.
   * @param {number} i
   * @returns {number}
   */
  inCapture(i) {
    STRUCTURE.lastIndex = i;
    const m = STRUCTURE.exec(this.chunk);
    if (!m) return this.chunk.length;
    const c = m[0];
    const at = m.index;
    if (c === '"') this.inString = true;
    else if (c === '{' || c === '[') this.depth += 1;
    else if ((c === '}' || c === ']') && this.depth > 0) this.depth -= 1;
    else if (!(c === ',' && this.depth > 0)) this.endCapture(c, at);
    return at + 1;
  }

  /**
   * Ends the value or item captured, at the comma or closing bracket `c`.
   * @param {string} c
   * @param {number} at
   */
  endCapture(c, at) {
    const text = this.takeCapture(at);
    if (this.state === 'value') {
      if (c === ']') this.fail('unexpected "]"');
      this.values[this.key] = text;
      this.state = c === ',' ? 'key-required' : 'done';
    } else {
      if (c === '}') this.fail('unexpected "}"');
      this.items.push({ key: this.key, text });
      this.state = c === ',' ? 'item-start' : 'after-value';
    }
  }

  end() {
    if (this.state !== 'done') this.fail('the file ends too early');
    return { values: this.values, streamed: this.streamed };
  }
}

/**
 * A scanner for a JSON object whose `streamKeys` hold large arrays (see
 * Scanner).
 * @param {string[]} streamKeys
 * @returns {{ push: (chunk: string) => { key: string, text: string }[], end: () => { values: Record<string, string>, streamed: Set<string> } }}
 */
function createScanner(streamKeys) {
  const scanner = new Scanner(streamKeys);
  return { push: (chunk) => scanner.push(chunk), end: () => scanner.end() };
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
 * Nothing is changed; importing is a second pass (forEachBackupPhoto).
 * Days and photos that can't be restored are listed in `skipped` (see
 * core.backupRefusal); the file is refused only when nothing in it can be.
 * @param {Blob} blob
 * `photoStamps` tells what restoring would add (see core.comparePhotos).
 * @param {{ onProgress?: (photosChecked: number) => void, latestDay?: string }} [options] days after
 *   `latestDay` are left out and counted (see core.checkBackupDays)
 * @returns {Promise<{ ok: true, entries: Record<string, Entry>, dayCount: number, photoCount: number, photoStamps: PhotoStamp[], futureDays: number, skipped: string[] } | { ok: false, error: string }>}
 */
async function checkBackup(blob, options) {
  const onProgress = options && options.onProgress;
  /** @type {string[]} */
  const photoProblems = [];
  /** @type {PhotoStamp[]} */
  const photoStamps = [];
  let scanned;
  try {
    scanned = await scanBackup(blob, (text, n) => {
      const result = parsePhoto(text, n);
      if (result.ok) photoStamps.push({ date: result.photo.date, createdAt: result.photo.createdAt });
      else photoProblems.push(result.error);
      if (onProgress && n % 25 === 0) onProgress(n);
    });
  } catch (err) {
    if (err instanceof BackupFormatError) return { ok: false, error: core.UNREADABLE_BACKUP };
    throw err;
  }
  const { top, photosIsArray } = scanned;
  /** @type {string[]} */
  const skipped = [];
  const days = core.checkBackupDays(top, skipped, options && options.latestDay);
  if (!days.ok) return days;
  skipped.push(...photoProblems);
  if (top.photos !== undefined && !photosIsArray) skipped.push('The photos section is not in the expected format.');
  const dayCount = Object.keys(days.entries).length;
  const photoCount = photoStamps.length;
  const refused = core.backupRefusal(skipped, dayCount + photoCount);
  if (refused) return { ok: false, error: refused };
  return { ok: true, entries: days.entries, dayCount, photoCount, photoStamps, futureDays: days.futureDays, skipped };
}

/**
 * Hands each readable photo of an already-checked backup file to `add`,
 * one at a time. Photos the check listed as skipped are passed over.
 * @param {Blob} blob
 * @param {(photo: BackupPhoto, n: number) => Promise<void>} add
 */
async function forEachBackupPhoto(blob, add) {
  await scanBackup(blob, async (text, n) => {
    const result = parsePhoto(text, n);
    if (result.ok) await add(result.photo, n);
  });
}

module.exports = Object.freeze({ createBackupWriter, createScanner, checkBackup, forEachBackupPhoto, BackupFormatError, CHUNK_BYTES });
