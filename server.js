const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const core = require('./docs/core.js');

const APP_DIR = path.join(__dirname, 'docs');

class ApiError extends Error {
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

function createDataStore(dataDir) {
  const entriesFile = path.join(dataDir, 'entries.json');
  const photosFile = path.join(dataDir, 'photos.json');
  const photosDir = path.join(dataDir, 'photos');

  fs.mkdirSync(photosDir, { recursive: true });
  if (!fs.existsSync(entriesFile)) fs.writeFileSync(entriesFile, '{}');
  if (!fs.existsSync(photosFile)) fs.writeFileSync(photosFile, '[]');

  const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

  function parseFile(file, isValidShape) {
    try {
      const value = JSON.parse(fs.readFileSync(file, 'utf8'));
      return isValidShape(value) ? { ok: true, value } : { ok: false };
    } catch {
      return { ok: false };
    }
  }

  function readJson(file, isValidShape) {
    const primary = parseFile(file, isValidShape);
    if (primary.ok) return primary.value;
    const bakFile = `${file}.bak`;
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

  function writeJson(file, data) {
    if (fs.existsSync(file)) fs.copyFileSync(file, `${file}.bak`);
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, file);
  }

  return {
    photosDir,
    readEntries: () => readJson(entriesFile, isObject),
    writeEntries: (data) => writeJson(entriesFile, data),
    readPhotos: () => readJson(photosFile, Array.isArray),
    writePhotos: (data) => writeJson(photosFile, data),
  };
}

// ---------------------------------------------------------------- validation

function requireDate(date) {
  if (!core.isValidDateStr(date)) throw new ApiError(400, `"${String(date).slice(0, 40)}" isn't a real date. Use YYYY-MM-DD.`);
}

// The server may be in a different time zone from the phone using it, so a
// day is "in the future" only once it's after tomorrow on the server's clock.
function requireNotFuture(date, what) {
  if (core.isFutureDate(date, core.shiftDate(core.todayStr(), 1))) {
    throw new ApiError(400, `${what} can't be dated ${core.formatDate(date)}: that day hasn't happened yet.`);
  }
}

function validatePatch(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ApiError(400, 'Send the fields to change as a JSON object.');
  /** @type {import('./docs/core.js').EntryPatch} */
  const patch = {};
  for (const key of Object.keys(body)) {
    if (key !== 'weight' && key !== 'meals') throw new ApiError(400, `Unknown field "${key}".`);
  }
  if (Object.prototype.hasOwnProperty.call(body, 'weight')) {
    const w = body.weight;
    if (w !== null && !(typeof w === 'number' && w >= core.LIMITS.weightMin && w <= core.LIMITS.weightMax)) {
      throw new ApiError(400, `Weight must be between ${core.LIMITS.weightMin} and ${core.LIMITS.weightMax} lbs.`);
    }
    patch.weight = w;
  }
  if (body.meals !== undefined) {
    if (!body.meals || typeof body.meals !== 'object' || Array.isArray(body.meals)) throw new ApiError(400, 'Meals must be an object.');
    /** @type {Record<string, number | null>} */
    const meals = {};
    patch.meals = meals;
    for (const key of Object.keys(body.meals)) {
      const step = core.MEAL_STEPS.find((m) => m.key === key);
      if (!step) throw new ApiError(400, `Unknown meal "${key}".`);
      const v = body.meals[key];
      if (v !== null && !(Number.isInteger(v) && v >= core.LIMITS.caloriesMin && v <= core.LIMITS.caloriesMax)) {
        throw new ApiError(400, `${step.label} must be a whole number of calories from 0 to ${core.LIMITS.caloriesMax}.`);
      }
      meals[key] = v;
    }
  }
  return patch;
}

function publicEntry(entry) {
  return { date: entry.date, weight: entry.weight, meals: entry.meals, totalCalories: core.totalCalories(entry.meals) };
}

// ---------------------------------------------------------------- app

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
  app.use('/photos', express.static(store.photosDir, { fallthrough: false }));

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
    const parsed = core.parseBackup({ entries: req.body && req.body.entries });
    if (!parsed.ok) throw new ApiError(400, parsed.error);
    const entries = store.readEntries();
    for (const date of Object.keys(parsed.entries)) entries[date] = parsed.entries[date];
    store.writeEntries(entries);
    res.json({ restored: parsed.dayCount });
  });

  // Progress photos are real files under data/photos/, with their date and
  // upload time in photos.json.
  const photoRecord = (p) => ({
    id: p.id,
    date: p.date,
    createdAt: p.createdAt || p.uploadedAt,
    filename: p.filename,
    type: p.type || 'image/jpeg',
  });

  app.get('/api/photos', (req, res) => {
    const photos = store
      .readPhotos()
      .filter((p) => p && typeof p.filename === 'string' && core.isValidDateStr(p.date))
      .map(photoRecord)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    res.json(photos);
  });

  app.post('/api/photos', (req, res) => {
    const { date, dataUrl, createdAt } = req.body || {};
    requireDate(date);
    if (createdAt !== undefined && (typeof createdAt !== 'string' || Number.isNaN(Date.parse(createdAt)))) {
      throw new ApiError(400, 'The photo upload time is not a valid time.');
    }
    const match = typeof dataUrl === 'string' && /^data:[^;,]*;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
    if (!match) throw new ApiError(400, "That file isn't a photo we can show.");
    const bytes = Buffer.from(match[1], 'base64');
    const type = core.sniffImageType(bytes);
    if (!type) throw new ApiError(400, "That file isn't a photo we can show.");

    const photos = store.readPhotos();
    const when = createdAt || new Date().toISOString();
    const existing = photos.find((p) => (p.createdAt || p.uploadedAt) === when);
    if (existing) return res.json({ ...photoRecord(existing), duplicate: true });

    const id = crypto.randomUUID();
    const filename = `${id}.${core.IMAGE_EXTENSIONS[type]}`;
    fs.writeFileSync(path.join(store.photosDir, filename), bytes);
    const record = { id, date, filename, type, createdAt: when };
    photos.push(record);
    try {
      store.writePhotos(photos);
    } catch (err) {
      fs.rmSync(path.join(store.photosDir, filename), { force: true });
      throw err;
    }
    return res.json(photoRecord(record));
  });

  // Move a photo to another day.
  app.patch('/api/photos/:id', (req, res) => {
    const date = req.body && req.body.date;
    requireDate(date);
    requireNotFuture(date, 'A photo');
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
    res.json({ ok: true });
  });

  app.use('/api', (req, res) => {
    res.status(404).json({ error: 'There is no such Kenna API endpoint.' });
  });

  // Every error becomes a short JSON message: no stack traces or file paths.
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    let status = err.status || err.statusCode || 500;
    let message = err instanceof ApiError ? err.message : 'Something went wrong on the Kenna server. Please try again.';
    if (err.type === 'entity.parse.failed') message = "The request wasn't valid JSON.";
    else if (err.type === 'entity.too.large') message = 'That upload is too large.';
    else if (status === 404 && !(err instanceof ApiError)) message = 'Not found.';
    if (status < 400 || status > 599) status = 500;
    if (status >= 500) console.error(err);
    res.status(status).json({ error: message });
  });

  return app;
}

if (require.main === module) {
  const PORT = Number(process.env.PORT) || 3000;
  const HOST = process.env.HOST || '0.0.0.0';
  createApp().listen(PORT, HOST, () => {
    console.log(`Kenna calorie tracker running at http://localhost:${PORT}`);
  });
}

module.exports = { createApp };
