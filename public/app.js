const MEAL_STEPS = [
  { key: 'breakfast', label: 'Breakfast' },
  { key: 'snack1', label: 'Snack #1' },
  { key: 'lunch', label: 'Lunch' },
  { key: 'snack2', label: 'Snack #2' },
  { key: 'dinner', label: 'Dinner' },
  { key: 'snack3', label: 'Snack #3' },
];

const STEP_ORDER = ['weight', ...MEAL_STEPS.map((m) => m.key), 'review'];

const STEP_LABELS = {
  weight: 'Weight',
  breakfast: 'Breakfast',
  snack1: 'Snack 1',
  lunch: 'Lunch',
  snack2: 'Snack 2',
  dinner: 'Dinner',
  snack3: 'Snack 3',
  review: 'Review',
};

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

async function fetchFoods() {
  try {
    const res = await fetch('/api/foods');
    foodsLibrary = await res.json();
  } catch (e) {
    foodsLibrary = [];
  }
}

async function loadEntryForDate(date) {
  try {
    const res = await fetch(`/api/entries/${date}`);
    const entry = await res.json();
    state.weight = entry.weight === null || entry.weight === undefined ? '' : entry.weight;
    state.meals = emptyMeals();
    for (const m of MEAL_STEPS) {
      state.meals[m.key] = (entry.meals && entry.meals[m.key]) || [];
    }
  } catch (e) {
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
    let cls = 'tab';
    if (i === stepIndex) cls += ' active';
    else if (hasDataForStep(key)) cls += ' filled';
    return `<button class="${cls}" data-idx="${i}" type="button">${STEP_LABELS[key]}</button>`;
  }).join('');
  progressEl.querySelectorAll('.tab').forEach((btn) => {
    btn.addEventListener('click', () => goToStep(Number(btn.dataset.idx)));
  });
  const activeTab = progressEl.querySelector('.tab.active');
  if (activeTab) activeTab.scrollIntoView({ inline: 'center', block: 'nearest' });
}

function hasDataForStep(key) {
  if (key === 'weight') return state.weight !== '';
  if (key === 'review') return false;
  return state.meals[key].length > 0;
}

function totalCaloriesForMeals(meals) {
  let total = 0;
  for (const m of MEAL_STEPS) {
    for (const f of meals[m.key]) {
      total += (Number(f.calories) || 0) * (Number(f.percent) || 0) / 100;
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

function goToStep(index) {
  stepIndex = index;
  render();
  window.scrollTo(0, 0);
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

  const weightInput = card.querySelector('#weightInput');
  weightInput.addEventListener('input', () => {
    state.weight = weightInput.value;
  });

  const dateInput = card.querySelector('#dateInput');
  dateInput.addEventListener('change', async () => {
    state.date = dateInput.value;
    await loadEntryForDate(state.date);
    render();
  });

  card.querySelector('#nextBtn').addEventListener('click', goNext);
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

async function saveDay() {
  const payload = {
    date: state.date,
    weight: state.weight === '' ? null : Number(state.weight),
    meals: state.meals,
  };
  const res = await fetch('/api/entries', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (res.ok) {
    await fetchFoods();
    mode = 'saved';
    render();
  } else {
    alert('Could not save. Please try again.');
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
  card.querySelector('#newDayBtn').addEventListener('click', async () => {
    state.date = todayStr();
    state.weight = '';
    state.meals = emptyMeals();
    stepIndex = 0;
    mode = 'wizard';
    await loadEntryForDate(state.date);
    render();
  });
}

async function renderHistory() {
  const card = document.createElement('div');
  card.className = 'card';
  card.innerHTML = '<div class="step-title">History</div><p class="step-sub">Loading…</p>';
  stepContainer.appendChild(card);

  try {
    const res = await fetch('/api/entries');
    const list = await res.json();
    if (list.length === 0) {
      card.innerHTML = '<div class="step-title">History</div><p class="empty-hint">No days logged yet</p>';
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
  } catch (e) {
    card.innerHTML = '<div class="step-title">History</div><p class="empty-hint">Could not load history</p>';
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

(async function init() {
  await fetchFoods();
  await loadEntryForDate(state.date);
  render();
})();
