const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const core = require('./docs/core.js');

const APP_DIR = path.join(__dirname, 'docs');

class ApiError extends Error {
  /** @param {number} status @param {string} message */
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// ---------------------------------------------------------------- data files
//
// Every write copies the previous file to a ".bak" sibling, then writes the
// new content to a temporary file and renames it into place, so a crash
// mid-write can never leave a half-written data file. If a data file is ever
// unreadable, it's restored from the ".bak" copy (keeping the damaged file
// aside); if that's impossible the request fails with a clear message and
// nothing is written, so the damaged file is never overwritten.

/**
 * A photo as photos.json stores it. Older versions wrote `uploadedAt`
 * instead of `createdAt`.
 * @typedef {{ id: string, date: string, filename: string, type?: string, createdAt?: string, uploadedAt?: string, thumbFilename?: string }} StoredPhoto
 */

/** @param {string} dataDir */
function createDataStore(dataDir) {
  const entriesFile = path.join(dataDir, 'entries.json');
  const photosFile = path.join(dataDir, 'photos.json');
  const photosDir = path.join(dataDir, 'photos');

  fs.mkdirSync(photosDir, { recursive: true });
  if (!fs.existsSync(entriesFile)) fs.writeFileSync(entriesFile, '{}');
  if (!fs.existsSync(photosFile)) fs.writeFileSync(photosFile, '[]');

  /** @param {unknown} v */
  const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

  /**
   * @param {string} file
   * @param {(value: unknown) => boolean} isValidShape
   * @returns {{ ok: true, value: any } | { ok: false }}
   */
  function parseFile(file, isValidShape) {
    try {
      const value = JSON.parse(fs.readFileSync(file, 'utf8'));
      return isValidShape(value) ? { ok: true, value } : { ok: false };
    } catch {
      return { ok: false };
    }
  }

  /**
   * @param {string} file
   * @param {(value: unknown) => boolean} isValidShape
   * @returns {any} the file's parsed JSON, which callers check
   */
  function readJson(file, isValidShape) {
    const primary = parseFile(file, isValidShape);
    if (primary.ok) return primary.value;
    const bakFile = `${file}.bak`;
    /** @type {ReturnType<typeof parseFile>} */
    const backup = fs.existsSync(bakFile) ? parseFile(bakFile, isValidShape) : { ok: false };
    if (backup.ok) {
      fs.copyFileSync(file, `${file}.damaged-${Date.now()}`);
      fs.copyFileSync(bakFile, file);
      console.warn(`${path.basename(file)} was unreadable; restored it from ${path.basename(bakFile)}.`);
      return backup.value;
    }
    throw new ApiError(
      500,
      `Kenna's data file (${path.basename(file)}) is damaged and there's no backup copy to restore it from. It has been left untouched so it can be repaired.`
    );
  }

  /** @param {string} file @param {unknown} data */
  function writeJson(file, data) {
    if (fs.existsSync(file)) fs.copyFileSync(file, `${file}.bak`);
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, file);
  }

  return {
    photosDir,
    /** @returns {Record<string, unknown>} */
    readEntries: () => readJson(entriesFile, isObject),
    /** @param {Record<string, unknown>} data */
    writeEntries: (data) => writeJson(entriesFile, data),
    /** @returns {StoredPhoto[]} */
    readPhotos: () => readJson(photosFile, Array.isArray),
    /** @param {StoredPhoto[]} data */
    writePhotos: (data) => writeJson(photosFile, data),
  };
}

// ---------------------------------------------------------------- validation

/** @param {unknown} date @returns {asserts date is string} */
function requireDate(date) {
  if (!core.isValidDateStr(date)) throw new ApiError(400, `"${String(date).slice(0, 40)}" isn't a real date. Use YYYY-MM-DD.`);
}

// The latest day the server accepts. The phone using the server may be in
// a time zone ahead of it, so that's tomorrow on the server's clock.
const latestDay = () => core.shiftDate(core.todayStr(), 1);

const FUTURE_PHOTO = "A photo can't be filed under a day that hasn't happened yet.";

/** @param {string} date @param {string} message */
function requireNotFuture(date, message) {
  if (core.isFutureDate(date, latestDay())) throw new ApiError(400, message);
}

// The same rules, and the same messages, as typing into the app.
/** @param {unknown} body the request's unvalidated JSON */
function validatePatch(body) {
  const checked = core.validatePatch(body);
  if (!checked.ok) throw new ApiError(400, checked.error);
  return checked.patch;
}

/** @param {import('./docs/core.js').Entry} entry */
function publicEntry(entry) {
  return { date: entry.date, weight: entry.weight, meals: entry.meals, totalCalories: core.totalCalories(entry.meals) };
}

// ---------------------------------------------------------------- app

const NOT_FOUND_PAGE = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>Page not found · Kenna</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 48px 16px; text-align: center; background: #f1f5f9; color: #0f172a; }
  a { color: #15803d; font-weight: 600; }
  @media (prefers-color-scheme: dark) { body { background: #0f172a; color: #f1f5f9; } a { color: #4ade80; } }
</style>
</head>
<body>
<h1>Page not found</h1>
<p>There's nothing at this address in Kenna.</p>
<p><a href="/">Open Kenna</a></p>
</body>
</html>
`;

/** @param {{ dataDir?: string }} [options] */
function createApp(options) {
  const opts = options || {};
  const dataDir = opts.dataDir || process.env.KENNA_DATA_DIR || path.join(__dirname, 'data');
  const store = createDataStore(dataDir);

  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '25mb' })); // photo uploads arrive as base64 JSON

  // The UI is the same app as the installable version in docs/; this one
  // file tells it to store data through this server's API.
  app.get('/backend.js', (req, res) => {
    res.type('application/javascript').set('Cache-Control', 'no-store').send("window.KENNA_BACKEND = 'server';\n");
  });
  app.use(express.static(APP_DIR));
  app.use('/photos', express.static(store.photosDir), (req, res) => {
    // A browser opening a photo that isn't there gets the same page as any
    // other missing address; the app's own requests get a short JSON error.
    if (String(req.headers.accept || '').includes('text/html')) res.status(404).type('html').send(NOT_FOUND_PAGE);
    else res.status(404).json({ error: 'That photo no longer exists.' });
  });

  // List every readable day, newest first. Unreadable days are skipped (and
  // left in the file untouched) instead of failing the whole list.
  app.get('/api/entries', (req, res) => {
    const { entries } = core.sanitizeEntries(store.readEntries());
    const list = Object.values(entries)
      .filter((e) => !core.isEntryEmpty(e))
      .sort((a, b) => (a.date < b.date ? 1 : -1))
      .map(publicEntry);
    res.json(list);
  });

  app.get('/api/entries/:date', (req, res) => {
    requireDate(req.params.date);
    const entry = core.normalizeEntry(req.params.date, store.readEntries()[req.params.date]) || core.applyPatch(req.params.date, null, {});
    res.json(publicEntry(entry));
  });

  // Change only the given fields of one day.
  app.patch('/api/entries/:date', (req, res) => {
    const { date } = req.params;
    requireDate(date);
    requireNotFuture(date, core.FUTURE_DAY);
    const patch = validatePatch(req.body);
    const entries = store.readEntries();
    const next = core.applyPatch(date, entries[date], patch);
    if (core.isEntryEmpty(next)) delete entries[date];
    else entries[date] = next;
    store.writeEntries(entries);
    res.json(publicEntry(next));
  });

  // Restore days from a backup file. Everything is checked first; if any
  // day is invalid, nothing is changed.
  app.post('/api/import', (req, res) => {
    const parsed = core.parseBackup({ entries: req.body && req.body.entries }, latestDay());
    if (!parsed.ok) throw new ApiError(400, parsed.error);
    const entries = store.readEntries();
    for (const date of Object.keys(parsed.entries)) entries[date] = parsed.entries[date];
    store.writeEntries(entries);
    res.json({ restored: parsed.dayCount, futureDays: parsed.futureDays });
  });

  // Progress photos are real files under data/photos/, with their date and
  // upload time in photos.json.
  // A photo can also have a small preview for the Photos screen
  // (thumbFilename), made by the app when the photo is added or first shown.
  /** @param {StoredPhoto} p */
  const photoRecord = (p) => ({
    id: p.id,
    date: p.date,
    createdAt: p.createdAt || p.uploadedAt,
    filename: p.filename,
    type: p.type || 'image/jpeg',
    ...(typeof p.thumbFilename === 'string' ? { thumbFilename: p.thumbFilename } : {}),
  });

  const MAX_THUMB_BYTES = 512 * 1024;

  // The image in a data: URL, checked to really be a photo.
  /** @param {unknown} dataUrl @param {number} [maxBytes] */
  function imageFromDataUrl(dataUrl, maxBytes) {
    const match = typeof dataUrl === 'string' && /^data:[^;,]*;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
    if (!match) throw new ApiError(400, "That file isn't a photo we can show.");
    const bytes = Buffer.from(match[1], 'base64');
    const type = core.sniffImageType(bytes);
    if (!type) throw new ApiError(400, "That file isn't a photo we can show.");
    if (maxBytes && bytes.length > maxBytes) throw new ApiError(400, 'That preview is too large.');
    return { bytes, type };
  }

  /** @param {unknown} dataUrl */
  function writeThumb(dataUrl) {
    const thumb = imageFromDataUrl(dataUrl, MAX_THUMB_BYTES);
    const filename = `${crypto.randomUUID()}.thumb.${core.IMAGE_EXTENSIONS[thumb.type]}`;
    fs.writeFileSync(path.join(store.photosDir, filename), thumb.bytes);
    return filename;
  }

  app.get('/api/photos', (req, res) => {
    const photos = store
      .readPhotos()
      .filter((p) => p && typeof p.filename === 'string' && core.isValidDateStr(p.date))
      .map(photoRecord)
      .sort((a, b) => (String(a.createdAt) < String(b.createdAt) ? 1 : -1));
    res.json(photos);
  });

  app.post('/api/photos', (req, res) => {
    const { date, dataUrl, createdAt, thumbDataUrl } = req.body || {};
    requireDate(date);
    requireNotFuture(date, FUTURE_PHOTO);
    if (createdAt !== undefined && (typeof createdAt !== 'string' || Number.isNaN(Date.parse(createdAt)))) {
      throw new ApiError(400, 'The photo upload time is not a valid time.');
    }
    const { bytes, type } = imageFromDataUrl(dataUrl);

    const photos = store.readPhotos();
    const when = createdAt || new Date().toISOString();
    const existing = photos.find((p) => (p.createdAt || p.uploadedAt) === when);
    if (existing) return res.json({ ...photoRecord(existing), duplicate: true });

    const id = crypto.randomUUID();
    const filename = `${id}.${core.IMAGE_EXTENSIONS[type]}`;
    // A preview that isn't usable is left out, not a reason to refuse the photo.
    let thumbFilename;
    if (thumbDataUrl !== undefined) {
      try {
        thumbFilename = writeThumb(thumbDataUrl);
      } catch {
        thumbFilename = undefined;
      }
    }
    fs.writeFileSync(path.join(store.photosDir, filename), bytes);
    const record = { id, date, filename, type, createdAt: when, ...(thumbFilename ? { thumbFilename } : {}) };
    photos.push(record);
    try {
      store.writePhotos(photos);
    } catch (err) {
      fs.rmSync(path.join(store.photosDir, filename), { force: true });
      if (thumbFilename) fs.rmSync(path.join(store.photosDir, thumbFilename), { force: true });
      throw err;
    }
    return res.json(photoRecord(record));
  });

  // Add (or replace) the preview of a photo added before previews existed.
  app.put('/api/photos/:id/thumb', (req, res) => {
    const photos = store.readPhotos();
    const photo = photos.find((p) => p && p.id === req.params.id);
    if (!photo) throw new ApiError(404, 'That photo no longer exists.');
    const thumbFilename = writeThumb(req.body && req.body.dataUrl);
    const previous = photo.thumbFilename;
    photo.thumbFilename = thumbFilename;
    store.writePhotos(photos);
    if (typeof previous === 'string' && previous !== thumbFilename) fs.rmSync(path.join(store.photosDir, path.basename(previous)), { force: true });
    res.json(photoRecord(photo));
  });

  // Move a photo to another day.
  app.patch('/api/photos/:id', (req, res) => {
    const date = req.body && req.body.date;
    requireDate(date);
    requireNotFuture(date, FUTURE_PHOTO);
    const photos = store.readPhotos();
    const photo = photos.find((p) => p && p.id === req.params.id);
    if (!photo) throw new ApiError(404, 'That photo no longer exists.');
    photo.date = date;
    store.writePhotos(photos);
    res.json(photoRecord(photo));
  });

  app.delete('/api/photos/:id', (req, res) => {
    const photos = store.readPhotos();
    const idx = photos.findIndex((p) => p && p.id === req.params.id);
    if (idx === -1) throw new ApiError(404, 'That photo no longer exists.');
    const [removed] = photos.splice(idx, 1);
    store.writePhotos(photos);
    fs.rmSync(path.join(store.photosDir, path.basename(removed.filename)), { force: true });
    if (typeof removed.thumbFilename === 'string') fs.rmSync(path.join(store.photosDir, path.basename(removed.thumbFilename)), { force: true });
    res.json({ ok: true });
  });

  app.use('/api', (req, res) => {
    res.status(404).json({ error: 'There is no such Kenna API endpoint.' });
  });

  // Any other address is a mistyped or old link: say so plainly and link
  // back to the app.
  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    return res.status(404).type('html').send(NOT_FOUND_PAGE);
  });

  // Every error becomes a short JSON message: no stack traces or file paths.
  // eslint-disable-next-line no-unused-vars
  app.use((/** @type {any} */ err, /** @type {express.Request} */ req, /** @type {express.Response} */ res, /** @type {express.NextFunction} */ next) => {
    let status = err.status || err.statusCode || 500;
    let message =
      err instanceof ApiError ? err.message : 'Something went wrong on the Kenna server. Try again, and if it keeps happening, restart the server.';
    if (err.type === 'entity.parse.failed') message = "The request wasn't valid JSON.";
    else if (err.type === 'entity.too.large') message = 'That upload is too large.';
    else if (status === 404 && !(err instanceof ApiError)) message = 'Not found.';
    if (status < 400 || status > 599) status = 500;
    if (status >= 500) console.error(err);
    res.status(status).json({ error: message });
  });

  return app;
}

/**
 * The addresses to open Kenna at, for the start-up message: this computer,
 * and when bound to every interface, its addresses on the local network
 * (what to type on a phone on the same Wi-Fi).
 * @param {string} host
 * @param {number} port
 * @param {NodeJS.Dict<import('os').NetworkInterfaceInfo[]>} [interfaces]
 */
function startupAddresses(host, port, interfaces) {
  const all = host === '0.0.0.0' || host === '::';
  const local = all || host === '127.0.0.1' || host === 'localhost' || host === '::1' ? [`http://localhost:${port}`] : [];
  if (!all) return local.length ? local : [`http://${host.includes(':') ? `[${host}]` : host}:${port}`];
  const network = [];
  for (const list of Object.values(interfaces || require('os').networkInterfaces())) {
    for (const info of list || []) {
      if (info.internal) continue;
      if (info.family === 'IPv4') network.push(`http://${info.address}:${port}`);
    }
  }
  return [...local, ...network];
}

if (require.main === module) {
  const PORT = Number(process.env.PORT) || 3000;
  const HOST = process.env.HOST || '0.0.0.0';
  createApp().listen(PORT, HOST, () => {
    const [here, ...network] = startupAddresses(HOST, PORT);
    console.log(`Kenna calorie tracker running at ${here}`);
    if (network.length) console.log(`On another device on the same network, open: ${network.join('  or  ')}`);
  });
}

module.exports = { createApp, startupAddresses };
