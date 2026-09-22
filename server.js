const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, 'data');
const ENTRIES_FILE = path.join(DATA_DIR, 'entries.json');
const PHOTOS_DIR = path.join(DATA_DIR, 'photos');
const PHOTOS_FILE = path.join(DATA_DIR, 'photos.json');

const MEAL_KEYS = ['breakfast', 'snack1', 'lunch', 'snack2', 'dinner', 'snack3'];

function ensureDataFiles() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(ENTRIES_FILE)) fs.writeFileSync(ENTRIES_FILE, '{}');
  if (!fs.existsSync(PHOTOS_DIR)) fs.mkdirSync(PHOTOS_DIR, { recursive: true });
  if (!fs.existsSync(PHOTOS_FILE)) fs.writeFileSync(PHOTOS_FILE, '[]');
}

// Every write keeps the previous file content in a ".bak" sibling first. If
// the primary file is ever found corrupted, readJson recovers from that
// one-generation-behind backup instead of throwing — a thrown error inside a
// synchronous route handler already fails safe (no write happens), but the
// backup lets the app keep working instead of returning 500s until someone
// fixes the file by hand.
function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    const bakFile = `${file}.bak`;
    if (fs.existsSync(bakFile)) {
      const recovered = JSON.parse(fs.readFileSync(bakFile, 'utf8'));
      fs.writeFileSync(file, JSON.stringify(recovered, null, 2));
      return recovered;
    }
    throw e;
  }
}

function writeJson(file, data) {
  if (fs.existsSync(file)) {
    fs.copyFileSync(file, `${file}.bak`);
  }
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function emptyEntry(date) {
  const meals = {};
  for (const key of MEAL_KEYS) meals[key] = null;
  return { date, weight: null, meals };
}

// A meal's value is a single calorie total (number) or null if not logged.
// Older data logged individual foods per meal as an array; normalizing here
// means old entry files keep working (as a summed total) without a
// migration step.
function normalizeMealValue(raw) {
  if (raw === null || raw === undefined || raw === '') return null;
  if (Array.isArray(raw)) {
    if (raw.length === 0) return null;
    const total = raw.reduce((sum, f) => sum + ((Number(f.calories) || 0) * (Number(f.percent) || 0)) / 100, 0);
    return Math.round(total);
  }
  const num = Number(raw);
  return Number.isNaN(num) ? null : Math.round(num);
}

function totalCaloriesForMeals(meals) {
  let total = 0;
  for (const key of MEAL_KEYS) {
    const v = normalizeMealValue(meals[key]);
    if (v !== null) total += v;
  }
  return Math.round(total);
}

function isValidDate(str) {
  return typeof str === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(str);
}

ensureDataFiles();

const app = express();
app.use(express.json({ limit: '20mb' })); // photo uploads arrive as base64 JSON
app.use(express.static(path.join(__dirname, 'public')));
app.use('/photos', express.static(PHOTOS_DIR));

// List every logged date with a quick summary, newest first.
app.get('/api/entries', (req, res) => {
  const entries = readJson(ENTRIES_FILE);
  const list = Object.values(entries)
    .map((entry) => {
      const meals = {};
      for (const key of MEAL_KEYS) meals[key] = normalizeMealValue(entry.meals[key]);
      return { date: entry.date, weight: entry.weight, totalCalories: totalCaloriesForMeals(entry.meals), meals };
    })
    .sort((a, b) => (a.date < b.date ? 1 : -1));
  res.json(list);
});

app.get('/api/entries/:date', (req, res) => {
  const { date } = req.params;
  if (!isValidDate(date)) return res.status(400).json({ error: 'Invalid date' });
  const entries = readJson(ENTRIES_FILE);
  const entry = entries[date] || emptyEntry(date);
  const meals = {};
  for (const key of MEAL_KEYS) meals[key] = normalizeMealValue(entry.meals[key]);
  res.json({ date: entry.date, weight: entry.weight, meals });
});

app.post('/api/entries', (req, res) => {
  const { date, weight, meals } = req.body || {};
  if (!isValidDate(date)) return res.status(400).json({ error: 'Invalid date' });
  if (!meals || typeof meals !== 'object') return res.status(400).json({ error: 'Invalid meals' });

  const entry = emptyEntry(date);
  entry.weight = weight === '' || weight === undefined || weight === null ? null : Number(weight);
  for (const key of MEAL_KEYS) entry.meals[key] = normalizeMealValue(meals[key]);

  const entries = readJson(ENTRIES_FILE);
  entries[date] = entry;
  writeJson(ENTRIES_FILE, entries);

  res.json(entry);
});

// Progress photos live as real files under data/photos/, with metadata (date,
// filename, upload time) in photos.json — durable the same way entries.json
// is, including the .bak self-healing from readJson/writeJson above.

app.get('/api/photos', (req, res) => {
  const photos = readJson(PHOTOS_FILE);
  res.json([...photos].sort((a, b) => (a.uploadedAt < b.uploadedAt ? 1 : -1)));
});

app.post('/api/photos', (req, res) => {
  const { date, dataUrl } = req.body || {};
  if (!isValidDate(date)) return res.status(400).json({ error: 'Invalid date' });
  // Usually "data:image/heic;base64,..." from the client's downscale step,
  // but its fallback path (when the browser can't decode/re-encode a format
  // in canvas, which can happen with HEIC photos from an iPhone library) reads
  // the original file as-is, which can carry an empty or generic MIME type —
  // so the MIME segment here is optional and defaults to a plain ".jpg".
  const match = typeof dataUrl === 'string' && dataUrl.match(/^data:(?:([\w.+-]+)\/([\w.+-]+))?;base64,([A-Za-z0-9+/=]+)$/);
  if (!match) return res.status(400).json({ error: 'Invalid image data' });

  const [, type, subtype, base64] = match;
  const looksLikeImage = type === 'image' && /^[a-z0-9]+$/i.test(subtype);
  const ext = looksLikeImage ? (subtype === 'jpeg' ? 'jpg' : subtype) : 'jpg';
  const id = crypto.randomUUID();
  const filename = `${id}.${ext}`;
  fs.writeFileSync(path.join(PHOTOS_DIR, filename), Buffer.from(base64, 'base64'));

  const photos = readJson(PHOTOS_FILE);
  const record = { id, date, filename, uploadedAt: new Date().toISOString() };
  photos.push(record);
  writeJson(PHOTOS_FILE, photos);

  res.json(record);
});

app.delete('/api/photos/:id', (req, res) => {
  const photos = readJson(PHOTOS_FILE);
  const idx = photos.findIndex((p) => p.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  const [removed] = photos.splice(idx, 1);
  writeJson(PHOTOS_FILE, photos);
  const filePath = path.join(PHOTOS_DIR, removed.filename);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  res.json({ ok: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Kenna calorie tracker running at http://localhost:${PORT}`);
});
