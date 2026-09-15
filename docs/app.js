const MEAL_STEPS = [
  { key: 'breakfast', label: 'Breakfast' },
  { key: 'snack1', label: 'Snack #1' },
  { key: 'lunch', label: 'Lunch' },
  { key: 'snack2', label: 'Snack #2' },
  { key: 'dinner', label: 'Dinner' },
  { key: 'snack3', label: 'Snack #3' },
];

const STEP_ORDER = ['weight', ...MEAL_STEPS.map((m) => m.key), 'review'];

const ENTRIES_KEY = 'kenna:entries';
const FOODS_KEY = 'kenna:foods';

function todayStr() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function emptyMeals() {
  const meals = {};
  for (const m of MEAL_STEPS) meals[m.key] = [];
  return meals;
}

// --- Storage (all data lives in this browser's localStorage) ---

function loadEntries() {
  try {
    return JSON.parse(localStorage.getItem(ENTRIES_KEY)) || {};
  } catch (e) {
    return {};
  }
}

function saveEntries(entries) {
  try {
    localStorage.setItem(ENTRIES_KEY, JSON.stringify(entries));
    return true;
  } catch (e) {
    return false;
  }
}

function loadFoods() {
  try {
    return JSON.parse(localStorage.getItem(FOODS_KEY)) || [];
  } catch (e) {
    return [];
  }
}

function saveFoods(foods) {
  try {
    localStorage.setItem(FOODS_KEY, JSON.stringify(foods));
  } catch (e) {
    // Non-fatal: food suggestions just won't persist this time.
  }
}

// --- App state ---

const state = {
  date: todayStr(),
  weight: '',
  meals: emptyMeals(),
};

let stepIndex = 0;
let foodsLibrary = [];
let mode = 'wizard'; // 'wizard' | 'history' | 'saved'

const stepContainer = document.getElementById('stepContainer');
const progressEl = document.getElementById('progress');
const historyBtn = document.getElementById('historyBtn');

historyBtn.addEventListener('click', () => {
  mode = mode === 'history' ? 'wizard' : 'history';
  historyBtn.textContent = mode === 'history' ? 'Back' : 'History';
  render();
});

function loadEntryForDate(date) {
  const entries = loadEntries();
  const entry = entries[date];
  if (entry) {
    state.weight = entry.weight === null || entry.weight === undefined ? '' : entry.weight;
    state.meals = emptyMeals();
    for (const m of MEAL_STEPS) {
      state.meals[m.key] = entry.meals[m.key] || [];
    }
  } else {
    state.weight = '';
    state.meals = emptyMeals();
  }
}

function renderProgress() {
  if (mode !== 'wizard') {
    progressEl.innerHTML = '';
    return;
  }
  progressEl.innerHTML = STEP_ORDER.map((key, i) => {
    let cls = 'dot';
    if (i < stepIndex) cls += ' done';
    if (i === stepIndex) cls += ' active';
    return `<div class="${cls}"></div>`;
  }).join('');
}

function totalCaloriesForMeals(meals) {
  let total = 0;
  for (const m of MEAL_STEPS) {
    for (const f of meals[m.key]) {
      total += ((Number(f.calories) || 0) * (Number(f.percent) || 0)) / 100;
    }
  }
  return Math.round(total);
}

function render() {
  renderProgress();
  stepContainer.innerHTML = '';

  if (mode === 'history') {
    renderHistory();
    return;
  }
  if (mode === 'saved') {
    renderSaved();
    return;
  }

  const key = STEP_ORDER[stepIndex];
  if (key === 'weight') renderWeightStep();
  else if (key === 'review') renderReviewStep();
  else renderMealStep(MEAL_STEPS.find((m) => m.key === key));
}

function goNext() {
  if (stepIndex < STEP_ORDER.length - 1) {
    stepIndex += 1;
    render();
    window.scrollTo(0, 0);
  }
}

function goBack() {
  if (stepIndex > 0) {
    stepIndex -= 1;
    render();
    window.scrollTo(0, 0);
  }
}

function renderWeightStep() {
  const card = document.createElement('div');
  card.className = 'card';
  card.innerHTML = `
    <div class="step-title">Today's Log</div>
    <p class="step-sub">Start by confirming the date and your current weight.</p>
    <label for="dateInput">Date</label>
    <input type="date" id="dateInput" value="${state.date}">
    <label for="weightInput">Current Weight (lbs)</label>
    <input type="number" id="weightInput" inputmode="decimal" placeholder="e.g. 180" value="${state.weight}">
    <button class="btn btn-primary" id="nextBtn" type="button">Next: Breakfast</button>
  `;
  stepContainer.appendChild(card);

  const dateInput = card.querySelector('#dateInput');
  dateInput.addEventListener('change', () => {
    state.date = dateInput.value;
    loadEntryForDate(state.date);
    render();
  });

  card.querySelector('#nextBtn').addEventListener('click', () => {
    state.weight = card.querySelector('#weightInput').value;
    goNext();
  });
}

function renderMealStep(mealDef) {
  const card = document.createElement('div');
  card.className = 'card';

  const datalistOptions = foodsLibrary
    .map((f) => `<option value="${escapeHtml(f.name)}"></option>`)
    .join('');

  card.innerHTML = `
    <div class="step-title">${mealDef.label}</div>
    <p class="step-sub">Log each food or drink, then continue when you're done.</p>

    <label for="foodName">Food Name</label>
    <input type="text" id="foodName" list="foodOptions" placeholder="Start typing or pick a saved food" autocomplete="off">
    <datalist id="foodOptions">${datalistOptions}</datalist>

    <div class="row">
      <div>
        <label for="foodPercent">% Eaten</label>
        <input type="number" id="foodPercent" inputmode="numeric" min="0" max="100" value="100">
      </div>
      <div>
        <label for="foodCalories">Calories</label>
        <input type="number" id="foodCalories" inputmode="numeric" placeholder="e.g. 250">
      </div>
    </div>

    <button class="btn btn-secondary" id="addFoodBtn" type="button">+ Add Food</button>

    <div class="food-list" id="foodList"></div>

    <div class="btn-row">
      <button class="btn btn-secondary" id="backBtn" type="button">Back</button>
      <button class="btn btn-primary" id="nextBtn" type="button">Next</button>
    </div>
  `;
  stepContainer.appendChild(card);

  const nameInput = card.querySelector('#foodName');
  const percentInput = card.querySelector('#foodPercent');
  const caloriesInput = card.querySelector('#foodCalories');
  const listEl = card.querySelector('#foodList');

  function renderList() {
    const items = state.meals[mealDef.key];
    if (items.length === 0) {
      listEl.innerHTML = '<div class="empty-hint">No foods logged yet</div>';
      return;
    }
    listEl.innerHTML = items
      .map(
        (f, i) => `
      <div class="food-item">
        <div>
          <div class="name">${escapeHtml(f.name)}</div>
          <div class="meta">${f.calories} cal &middot; ${f.percent}% eaten</div>
        </div>
        <button class="remove" data-idx="${i}" type="button">&times;</button>
      </div>`
      )
      .join('');
    listEl.querySelectorAll('.remove').forEach((btn) => {
      btn.addEventListener('click', () => {
        const idx = Number(btn.dataset.idx);
        state.meals[mealDef.key].splice(idx, 1);
        renderList();
      });
    });
  }

  nameInput.addEventListener('input', () => {
    const match = foodsLibrary.find(
      (f) => f.name.toLowerCase() === nameInput.value.trim().toLowerCase()
    );
    if (match) caloriesInput.value = match.calories;
  });

  card.querySelector('#addFoodBtn').addEventListener('click', () => {
    const name = nameInput.value.trim();
    const calories = Number(caloriesInput.value);
    const percent = percentInput.value === '' ? 100 : Number(percentInput.value);
    if (!name) {
      nameInput.focus();
      return;
    }
    if (Number.isNaN(calories) || caloriesInput.value === '') {
      caloriesInput.focus();
      return;
    }
    state.meals[mealDef.key].push({ name, calories, percent });
    if (!foodsLibrary.some((f) => f.name.toLowerCase() === name.toLowerCase())) {
      foodsLibrary.push({ name, calories });
    }
    nameInput.value = '';
    caloriesInput.value = '';
    percentInput.value = '100';
    nameInput.focus();
    renderList();
  });

  card.querySelector('#backBtn').addEventListener('click', goBack);
  card.querySelector('#nextBtn').addEventListener('click', goNext);

  renderList();
}

function renderReviewStep() {
  const card = document.createElement('div');
  card.className = 'card';

  const total = totalCaloriesForMeals(state.meals);

  const mealSummaries = MEAL_STEPS.map((m) => {
    const items = state.meals[m.key];
    if (items.length === 0) return '';
    const rows = items
      .map(
        (f) => `
      <div class="food-item">
        <div>
          <div class="name">${escapeHtml(f.name)}</div>
          <div class="meta">${f.calories} cal &middot; ${f.percent}% eaten</div>
        </div>
      </div>`
      )
      .join('');
    return `<div class="summary-meal"><h3>${m.label}</h3>${rows}</div>`;
  }).join('');

  card.innerHTML = `
    <div class="step-title">Review &amp; Save</div>
    <p class="step-sub">${state.date} &middot; Weight: ${state.weight || '—'} lbs</p>
    <div class="total-box">
      <div class="num">${total}</div>
      <div class="label">total calories today</div>
    </div>
    ${mealSummaries || '<p class="empty-hint">No foods logged</p>'}
    <div class="btn-row">
      <button class="btn btn-secondary" id="backBtn" type="button">Back</button>
      <button class="btn btn-primary" id="saveBtn" type="button">Save Day</button>
    </div>
  `;
  stepContainer.appendChild(card);

  card.querySelector('#backBtn').addEventListener('click', goBack);
  card.querySelector('#saveBtn').addEventListener('click', saveDay);
}

function saveDay() {
  const entries = loadEntries();
  entries[state.date] = {
    date: state.date,
    weight: state.weight === '' ? null : Number(state.weight),
    meals: state.meals,
  };

  const foods = loadFoods();
  const foodMap = new Map(foods.map((f) => [f.name.toLowerCase(), f]));
  for (const m of MEAL_STEPS) {
    for (const f of state.meals[m.key]) {
      foodMap.set(f.name.toLowerCase(), { name: f.name, calories: f.calories });
    }
  }

  const ok = saveEntries(entries);
  saveFoods(Array.from(foodMap.values()).sort((a, b) => a.name.localeCompare(b.name)));

  if (ok) {
    foodsLibrary = loadFoods();
    mode = 'saved';
    render();
  } else {
    alert('Could not save — your browser storage may be full or restricted (e.g. Private Browsing).');
  }
}

function renderSaved() {
  const card = document.createElement('div');
  card.className = 'card saved-banner';
  const total = totalCaloriesForMeals(state.meals);
  card.innerHTML = `
    <div class="check">✅</div>
    <div class="step-title">Saved for ${state.date}</div>
    <p class="step-sub">${total} total calories logged.</p>
    <button class="btn btn-primary" id="newDayBtn" type="button">Log Another Day</button>
  `;
  stepContainer.appendChild(card);
  card.querySelector('#newDayBtn').addEventListener('click', () => {
    state.date = todayStr();
    state.weight = '';
    state.meals = emptyMeals();
    stepIndex = 0;
    mode = 'wizard';
    loadEntryForDate(state.date);
    render();
  });
}

function renderHistory() {
  const card = document.createElement('div');
  card.className = 'card';

  const entries = loadEntries();
  const list = Object.values(entries)
    .map((entry) => ({
      date: entry.date,
      weight: entry.weight,
      totalCalories: totalCaloriesForMeals(entry.meals),
    }))
    .sort((a, b) => (a.date < b.date ? 1 : -1));

  if (list.length === 0) {
    card.innerHTML = '<div class="step-title">History</div><p class="empty-hint">No days logged yet</p>';
    stepContainer.appendChild(card);
    return;
  }

  card.innerHTML =
    '<div class="step-title">History</div>' +
    list
      .map(
        (e) => `
      <div class="history-item">
        <div class="date">${e.date}</div>
        <div class="stats">${e.totalCalories} cal${e.weight ? ' &middot; ' + e.weight + ' lbs' : ''}</div>
      </div>`
      )
      .join('');
  stepContainer.appendChild(card);
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

(function init() {
  foodsLibrary = loadFoods();
  loadEntryForDate(state.date);
  render();
})();
