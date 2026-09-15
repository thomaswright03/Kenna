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
let mode = 'wizard'; // 'wizard' | 'history' | 'graphs' | 'saved'

const stepContainer = document.getElementById('stepContainer');
const progressEl = document.getElementById('progress');
const historyBtn = document.getElementById('historyBtn');
const graphsBtn = document.getElementById('graphsBtn');
const titleBtn = document.getElementById('titleBtn');

function setMode(next) {
  mode = mode === next ? 'wizard' : next;
  updateNav();
  render();
}

function updateNav() {
  historyBtn.classList.toggle('active', mode === 'history');
  graphsBtn.classList.toggle('active', mode === 'graphs');
}

historyBtn.addEventListener('click', () => setMode('history'));
graphsBtn.addEventListener('click', () => setMode('graphs'));
titleBtn.addEventListener('click', () => {
  mode = 'wizard';
  updateNav();
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
  if (mode === 'graphs') {
    renderGraphs();
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

const SVG_NS = 'http://www.w3.org/2000/svg';
const CHART_SURFACE_RING = '#1e293b'; // matches --card
const CHART_COLORS = { calories: '#22c55e', weight: '#3987e5' };

function svgEl(tag, attrs) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const key in attrs) el.setAttribute(key, attrs[key]);
  return el;
}

function niceNum(range, round) {
  const exponent = Math.floor(Math.log10(range));
  const fraction = range / Math.pow(10, exponent);
  let niceFraction;
  if (round) {
    if (fraction < 1.5) niceFraction = 1;
    else if (fraction < 3) niceFraction = 2;
    else if (fraction < 7) niceFraction = 5;
    else niceFraction = 10;
  } else if (fraction <= 1) niceFraction = 1;
  else if (fraction <= 2) niceFraction = 2;
  else if (fraction <= 5) niceFraction = 5;
  else niceFraction = 10;
  return niceFraction * Math.pow(10, exponent);
}

function niceTicks(min, max, tickCount) {
  if (min === max) {
    min -= 1;
    max += 1;
  }
  const range = niceNum(max - min, false) || 1;
  const step = niceNum(range / (tickCount - 1), true) || 1;
  const niceMin = Math.floor(min / step) * step;
  const niceMax = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = niceMin; v <= niceMax + step / 2; v += step) ticks.push(Math.round(v));
  return ticks;
}

function formatShortDate(dateStr) {
  const parts = dateStr.split('-');
  return `${Number(parts[1])}/${Number(parts[2])}`;
}

async function renderGraphs() {
  const card = document.createElement('div');
  card.className = 'card';
  card.innerHTML = '<div class="step-title">Graphs</div><p class="step-sub">Loading…</p>';
  stepContainer.appendChild(card);

  let rows;
  try {
    const res = await fetch('/api/entries');
    const list = await res.json();
    rows = list
      .map((e) => ({ date: e.date, calories: e.totalCalories, weight: e.weight === null || e.weight === undefined ? null : Number(e.weight) }))
      .sort((a, b) => (a.date < b.date ? -1 : 1));
  } catch (e) {
    card.innerHTML = '<div class="step-title">Graphs</div><p class="empty-hint">Could not load graphs</p>';
    return;
  }

  if (rows.length === 0) {
    card.innerHTML = '<div class="step-title">Graphs</div><p class="empty-hint">No days logged yet</p>';
    return;
  }

  card.innerHTML = '<div class="step-title">Graphs</div>';

  const caloriesWrap = document.createElement('div');
  caloriesWrap.className = 'graph-wrap';
  card.appendChild(caloriesWrap);
  buildLineChart(caloriesWrap, rows, {
    accessor: (r) => r.calories,
    color: CHART_COLORS.calories,
    title: 'Calories',
    subtitle: 'Total daily intake',
    unit: 'cal',
  });

  const weightWrap = document.createElement('div');
  weightWrap.className = 'graph-wrap';
  card.appendChild(weightWrap);
  buildLineChart(weightWrap, rows, {
    accessor: (r) => r.weight,
    color: CHART_COLORS.weight,
    title: 'Weight',
    subtitle: 'Logged each day',
    unit: 'lbs',
  });

  const note = document.createElement('p');
  note.className = 'graphs-note';
  note.appendChild(document.createTextNode('Exact numbers: '));
  const link = document.createElement('button');
  link.type = 'button';
  link.textContent = 'view History';
  link.addEventListener('click', () => setMode('history'));
  note.appendChild(link);
  card.appendChild(note);
}

function buildLineChart(container, rows, opts) {
  const { accessor, color, title, subtitle, unit } = opts;
  const values = rows.map(accessor).filter((v) => v !== null && v !== undefined && !Number.isNaN(v));

  const heading = document.createElement('div');
  heading.className = 'graph-title';
  heading.textContent = title;
  container.appendChild(heading);

  const sub = document.createElement('p');
  sub.className = 'graph-sub';
  sub.textContent = subtitle;
  container.appendChild(sub);

  if (values.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'empty-hint';
    empty.textContent = 'No data yet';
    container.appendChild(empty);
    return;
  }

  const ticks = niceTicks(Math.min(...values), Math.max(...values), 4);
  const yMin = ticks[0];
  const yMax = ticks[ticks.length - 1];

  const leftPad = 44;
  const rightPad = 20;
  const topPad = 16;
  const plotHeight = 120;
  const xAxisHeight = 22;
  const pointSpacing = rows.length > 1 ? Math.max(40, Math.min(64, 320 / (rows.length - 1))) : 60;
  const width = Math.max(260, leftPad + rightPad + (rows.length - 1) * pointSpacing + 20);
  const height = topPad + plotHeight + xAxisHeight;

  const xFor = (i) => leftPad + i * pointSpacing;
  const yFor = (v) => topPad + plotHeight - ((v - yMin) / (yMax - yMin || 1)) * plotHeight;

  const scroll = document.createElement('div');
  scroll.className = 'graph-scroll';
  container.appendChild(scroll);

  const svg = svgEl('svg', { class: 'chart-svg', width, height, viewBox: `0 0 ${width} ${height}` });
  scroll.appendChild(svg);

  for (const t of ticks) {
    const y = yFor(t);
    svg.appendChild(svgEl('line', { class: 'gridline', x1: leftPad, x2: width - rightPad, y1: y, y2: y }));
    const label = svgEl('text', { class: 'axis-label', x: leftPad - 8, y: y + 3, 'text-anchor': 'end' });
    label.textContent = t.toLocaleString();
    svg.appendChild(label);
  }

  rows.forEach((r, i) => {
    const label = svgEl('text', { class: 'x-label', x: xFor(i), y: height - 6, 'text-anchor': 'middle' });
    label.textContent = formatShortDate(r.date);
    svg.appendChild(label);
  });

  const segments = [];
  let current = [];
  rows.forEach((r, i) => {
    const v = accessor(r);
    if (v === null || v === undefined || Number.isNaN(v)) {
      if (current.length) segments.push(current);
      current = [];
    } else {
      current.push({ i, v });
    }
  });
  if (current.length) segments.push(current);

  for (const seg of segments) {
    if (seg.length > 1) {
      const areaPoints = [
        `${xFor(seg[0].i)},${topPad + plotHeight}`,
        ...seg.map((p) => `${xFor(p.i)},${yFor(p.v)}`),
        `${xFor(seg[seg.length - 1].i)},${topPad + plotHeight}`,
      ].join(' ');
      svg.appendChild(svgEl('polygon', { class: 'area-fill', points: areaPoints, fill: color }));
    }
    const linePoints = seg.map((p) => `${xFor(p.i)},${yFor(p.v)}`).join(' ');
    svg.appendChild(svgEl('polyline', { class: 'line-path', points: linePoints, stroke: color }));
  }

  // Every known value gets its own marker dot, so an isolated point
  // (gaps on both sides) still renders instead of vanishing with no line.
  rows.forEach((r, i) => {
    const v = accessor(r);
    if (v === null || v === undefined || Number.isNaN(v)) return;
    svg.appendChild(
      svgEl('circle', { class: 'end-dot', cx: xFor(i), cy: yFor(v), r: 4, fill: color, stroke: CHART_SURFACE_RING })
    );
  });

  rows.forEach((r, i) => {
    const v = accessor(r);
    if (v === null || v === undefined || Number.isNaN(v)) return;
    svg.appendChild(
      svgEl('circle', { class: 'hit-target', cx: xFor(i), cy: yFor(v), r: 14, 'data-idx': i, tabindex: 0 })
    );
  });

  for (let i = rows.length - 1; i >= 0; i -= 1) {
    const v = accessor(rows[i]);
    if (v === null || v === undefined || Number.isNaN(v)) continue;
    const cx = xFor(i);
    const cy = yFor(v);
    const endLabel = svgEl('text', {
      class: 'end-label',
      x: Math.min(cx, width - rightPad - 4),
      y: Math.max(cy - 10, topPad + 10),
      'text-anchor': 'end',
      fill: color,
    });
    endLabel.textContent = `${Math.round(v).toLocaleString()} ${unit}`;
    svg.appendChild(endLabel);
    break;
  }

  const crosshair = svgEl('line', {
    class: 'crosshair',
    x1: 0,
    x2: 0,
    y1: topPad,
    y2: topPad + plotHeight,
    visibility: 'hidden',
  });
  svg.appendChild(crosshair);
  const hoverDot = svgEl('circle', { class: 'hover-dot', r: 5, fill: color, stroke: CHART_SURFACE_RING, visibility: 'hidden' });
  svg.appendChild(hoverDot);

  const tooltip = document.createElement('div');
  tooltip.className = 'graph-tooltip';
  container.appendChild(tooltip);

  function showAt(index) {
    const row = rows[index];
    const v = accessor(row);
    if (v === null || v === undefined || Number.isNaN(v)) {
      hideTooltip();
      return;
    }
    const cx = xFor(index);
    const cy = yFor(v);
    crosshair.setAttribute('x1', cx);
    crosshair.setAttribute('x2', cx);
    crosshair.setAttribute('visibility', 'visible');
    hoverDot.setAttribute('cx', cx);
    hoverDot.setAttribute('cy', cy);
    hoverDot.setAttribute('visibility', 'visible');

    tooltip.innerHTML = '';
    const valueEl = document.createElement('div');
    valueEl.className = 'tt-value';
    valueEl.textContent = `${Math.round(v).toLocaleString()} ${unit}`;
    const dateEl = document.createElement('div');
    dateEl.className = 'tt-date';
    dateEl.textContent = row.date;
    tooltip.appendChild(valueEl);
    tooltip.appendChild(dateEl);
    tooltip.style.left = `${cx}px`;
    tooltip.style.top = `${cy}px`;
    tooltip.classList.add('visible');
  }

  function hideTooltip() {
    crosshair.setAttribute('visibility', 'hidden');
    hoverDot.setAttribute('visibility', 'hidden');
    tooltip.classList.remove('visible');
  }

  function nearestIndex(clientX) {
    const rect = svg.getBoundingClientRect();
    const x = ((clientX - rect.left) / rect.width) * width;
    return Math.max(0, Math.min(rows.length - 1, Math.round((x - leftPad) / pointSpacing)));
  }

  svg.addEventListener('pointermove', (e) => showAt(nearestIndex(e.clientX)));
  svg.addEventListener('pointerdown', (e) => showAt(nearestIndex(e.clientX)));
  svg.addEventListener('pointerleave', hideTooltip);
  svg.querySelectorAll('.hit-target').forEach((dot) => {
    dot.addEventListener('focus', () => showAt(Number(dot.dataset.idx)));
  });
  svg.addEventListener('focusout', hideTooltip);
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
