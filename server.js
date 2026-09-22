const express = require('express');
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const ENTRIES_FILE = path.join(DATA_DIR, 'entries.json');

const MEAL_KEYS = ['breakfast', 'snack1', 'lunch', 'snack2', 'dinner', 'snack3'];

function ensureDataFiles() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(ENTRIES_FILE)) fs.writeFileSync(ENTRIES_FILE, '{}');
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
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

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

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Kenna calorie tracker running at http://localhost:${PORT}`);
});
