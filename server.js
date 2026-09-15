const express = require('express');
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const ENTRIES_FILE = path.join(DATA_DIR, 'entries.json');
const FOODS_FILE = path.join(DATA_DIR, 'foods.json');

const MEAL_KEYS = ['breakfast', 'snack1', 'lunch', 'snack2', 'dinner', 'snack3'];

function ensureDataFiles() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(ENTRIES_FILE)) fs.writeFileSync(ENTRIES_FILE, '{}');
  if (!fs.existsSync(FOODS_FILE)) fs.writeFileSync(FOODS_FILE, '[]');
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function emptyEntry(date) {
  const meals = {};
  for (const key of MEAL_KEYS) meals[key] = [];
  return { date, weight: null, meals };
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
      const totalCalories = MEAL_KEYS.reduce((sum, key) => {
        const foods = entry.meals[key] || [];
        return sum + foods.reduce((s, f) => s + (f.calories * f.percent) / 100, 0);
      }, 0);
      return { date: entry.date, weight: entry.weight, totalCalories: Math.round(totalCalories), meals: entry.meals };
    })
    .sort((a, b) => (a.date < b.date ? 1 : -1));
  res.json(list);
});

app.get('/api/entries/:date', (req, res) => {
  const { date } = req.params;
  if (!isValidDate(date)) return res.status(400).json({ error: 'Invalid date' });
  const entries = readJson(ENTRIES_FILE);
  res.json(entries[date] || emptyEntry(date));
});

app.post('/api/entries', (req, res) => {
  const { date, weight, meals } = req.body || {};
  if (!isValidDate(date)) return res.status(400).json({ error: 'Invalid date' });
  if (!meals || typeof meals !== 'object') return res.status(400).json({ error: 'Invalid meals' });

  const entry = emptyEntry(date);
  entry.weight = weight === '' || weight === undefined || weight === null ? null : Number(weight);

  const foods = readJson(FOODS_FILE);
  const foodMap = new Map(foods.map((f) => [f.name.toLowerCase(), f]));

  for (const key of MEAL_KEYS) {
    const items = Array.isArray(meals[key]) ? meals[key] : [];
    entry.meals[key] = items
      .filter((item) => item && item.name && item.name.trim())
      .map((item) => {
        const name = item.name.trim();
        const calories = Number(item.calories) || 0;
        const percent = item.percent === '' || item.percent === undefined ? 100 : Number(item.percent);
        foodMap.set(name.toLowerCase(), { name, calories });
        return { name, calories, percent };
      });
  }

  const entries = readJson(ENTRIES_FILE);
  entries[date] = entry;
  writeJson(ENTRIES_FILE, entries);
  writeJson(FOODS_FILE, Array.from(foodMap.values()).sort((a, b) => a.name.localeCompare(b.name)));

  res.json(entry);
});

app.get('/api/foods', (req, res) => {
  res.json(readJson(FOODS_FILE));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Kenna calorie tracker running at http://localhost:${PORT}`);
});
