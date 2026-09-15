const MEAL_STEPS = [
  { key: 'breakfast', label: 'Breakfast' },
  { key: 'snack1', label: 'Snack 1' },
  { key: 'lunch', label: 'Lunch' },
  { key: 'snack2', label: 'Snack 2' },
  { key: 'dinner', label: 'Dinner' },
  { key: 'snack3', label: 'Snack 3' },
];

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

let foodsLibrary = [];
let mode = 'dashboard'; // 'dashboard' | 'log' | 'history' | 'compare'
let logMealKey = MEAL_STEPS[0].key;

const stepContainer = document.getElementById('stepContainer');
const historyBtn = document.getElementById('historyBtn');
const compareBtn = document.getElementById('compareBtn');
const titleBtn = document.getElementById('titleBtn');

function goDashboard() {
  mode = 'dashboard';
  updateNav();
  render();
}

function goHistory() {
  mode = mode === 'history' ? 'dashboard' : 'history';
  updateNav();
  render();
}

function goCompare() {
  mode = mode === 'compare' ? 'dashboard' : 'compare';
  updateNav();
  render();
}

function updateNav() {
  historyBtn.classList.toggle('active', mode === 'history');
  compareBtn.classList.toggle('active', mode === 'compare');
}

historyBtn.addEventListener('click', goHistory);
compareBtn.addEventListener('click', goCompare);
titleBtn.addEventListener('click', goDashboard);

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

async function persistEntry() {
  try {
    const res = await fetch('/api/entries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        date: state.date,
        weight: state.weight === '' ? null : Number(state.weight),
        meals: state.meals,
      }),
    });
    return res.ok;
  } catch (e) {
    return false;
  }
}

function rememberFood(name, calories) {
  const idx = foodsLibrary.findIndex((f) => f.name.toLowerCase() === name.toLowerCase());
  if (idx >= 0) foodsLibrary[idx] = { name, calories };
  else foodsLibrary.push({ name, calories });
  foodsLibrary.sort((a, b) => a.name.localeCompare(b.name));
}

function foodConsumedCalories(f) {
  return Math.round(((Number(f.calories) || 0) * (Number(f.percent) || 0)) / 100);
}

function formatFoodMeta(f) {
  return `${foodConsumedCalories(f)} cal · ${f.calories} cal/serving × ${f.percent}%`;
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
  stepContainer.innerHTML = '';

  if (mode === 'history') {
    renderHistory();
    return;
  }
  if (mode === 'compare') {
    renderCompare();
    return;
  }
  if (mode === 'log') {
    renderLogFood();
    return;
  }
  renderDashboard();
}

async function renderDashboard() {
  const todayCard = document.createElement('div');
  todayCard.className = 'card';

  const total = totalCaloriesForMeals(state.meals);

  todayCard.innerHTML = `
    <div class="step-title">Today's Log</div>
    <label for="dateInput">Date</label>
    <input type="date" id="dateInput" value="${state.date}">
    <label for="weightInput">Current Weight (lbs)</label>
    <input type="number" id="weightInput" inputmode="decimal" placeholder="e.g. 180" value="${state.weight}">
    <div class="total-box">
      <div class="num">${total}</div>
      <div class="label">calories logged for ${state.date}</div>
    </div>
    <div id="todayFoods"></div>
    <button class="btn btn-primary" id="logFoodBtn" type="button">Log Food</button>
  `;
  stepContainer.appendChild(todayCard);

  const dateInput = todayCard.querySelector('#dateInput');
  dateInput.addEventListener('change', async () => {
    state.date = dateInput.value;
    await loadEntryForDate(state.date);
    render();
  });

  const weightInput = todayCard.querySelector('#weightInput');
  weightInput.addEventListener('change', async () => {
    state.weight = weightInput.value;
    await persistEntry();
    render();
  });

  renderTodayFoods(todayCard.querySelector('#todayFoods'));

  todayCard.querySelector('#logFoodBtn').addEventListener('click', () => {
    mode = 'log';
    render();
  });

  const graphsCard = document.createElement('div');
  graphsCard.className = 'card';
  graphsCard.innerHTML = '<div class="step-title">Graphs</div>';
  stepContainer.appendChild(graphsCard);

  const graphRows = await fetchGraphRows();

  const caloriesWrap = document.createElement('div');
  caloriesWrap.className = 'graph-wrap';
  graphsCard.appendChild(caloriesWrap);
  buildLineChart(caloriesWrap, graphRows, {
    accessor: (r) => r.calories,
    color: CHART_COLORS.calories,
    title: 'Calories',
    subtitle: 'Total daily intake',
    unit: 'cal',
  });

  const weightWrap = document.createElement('div');
  weightWrap.className = 'graph-wrap';
  graphsCard.appendChild(weightWrap);
  buildLineChart(weightWrap, graphRows, {
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
  link.addEventListener('click', goHistory);
  note.appendChild(link);
  graphsCard.appendChild(note);
}

function renderTodayFoods(container) {
  container.innerHTML = '';
  MEAL_STEPS.forEach((m) => {
    const section = document.createElement('div');
    section.className = 'summary-meal';
    const h = document.createElement('h3');
    h.textContent = m.label;
    section.appendChild(h);

    const items = state.meals[m.key];

    if (items.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'meal-empty';
      const hint = document.createElement('span');
      hint.className = 'empty-hint';
      hint.textContent = 'No foods logged yet';
      const addBtn = document.createElement('button');
      addBtn.type = 'button';
      addBtn.className = 'meal-add-link';
      addBtn.textContent = '+ Add';
      addBtn.addEventListener('click', () => {
        logMealKey = m.key;
        mode = 'log';
        render();
      });
      empty.appendChild(hint);
      empty.appendChild(addBtn);
      section.appendChild(empty);
    } else {
      items.forEach((f, idx) => {
        const row = document.createElement('div');
        row.className = 'food-item';
        const info = document.createElement('div');
        const name = document.createElement('div');
        name.className = 'name';
        name.textContent = f.name;
        const meta = document.createElement('div');
        meta.className = 'meta';
        meta.textContent = formatFoodMeta(f);
        info.appendChild(name);
        info.appendChild(meta);

        const removeBtn = document.createElement('button');
        removeBtn.className = 'remove';
        removeBtn.type = 'button';
        removeBtn.textContent = '×';
        removeBtn.addEventListener('click', async () => {
          state.meals[m.key].splice(idx, 1);
          await persistEntry();
          render();
        });

        row.appendChild(info);
        row.appendChild(removeBtn);
        section.appendChild(row);
      });
    }

    container.appendChild(section);
  });
}

function renderLogFood() {
  const card = document.createElement('div');
  card.className = 'card';

  const heading = document.createElement('div');
  heading.className = 'step-title';
  heading.textContent = 'Log Food';
  card.appendChild(heading);

  const sub = document.createElement('p');
  sub.className = 'step-sub';
  sub.textContent = `Adding to ${state.date}`;
  card.appendChild(sub);

  const mealPicker = document.createElement('div');
  mealPicker.className = 'meal-picker';
  card.appendChild(mealPicker);

  const mealHeading = document.createElement('div');
  mealHeading.className = 'section-label';
  card.appendChild(mealHeading);

  const datalistOptions = foodsLibrary
    .map((f) => `<option value="${escapeHtml(f.name)}"></option>`)
    .join('');

  const formWrap = document.createElement('div');
  formWrap.innerHTML = `
    <label for="foodName">Food Name</label>
    <input type="text" id="foodName" list="foodOptions" placeholder="Start typing or pick a saved food" autocomplete="off">
    <datalist id="foodOptions">${datalistOptions}</datalist>
    <div class="row">
      <div>
        <label for="foodPercent">% Eaten / Servings</label>
        <input type="number" id="foodPercent" inputmode="numeric" min="0" value="100">
      </div>
      <div>
        <label for="foodCalories">Serving Size (cal)</label>
        <input type="number" id="foodCalories" inputmode="numeric" placeholder="e.g. 250">
      </div>
    </div>
    <p class="field-hint">100 = one serving &middot; 200 = two servings &middot; 50 = half a serving</p>
    <button class="btn btn-secondary" id="addFoodBtn" type="button">+ Add Food</button>
  `;
  card.appendChild(formWrap);

  const listEl = document.createElement('div');
  listEl.className = 'food-list';
  card.appendChild(listEl);

  const doneBtn = document.createElement('button');
  doneBtn.className = 'btn btn-primary';
  doneBtn.type = 'button';
  doneBtn.textContent = 'Done';
  doneBtn.addEventListener('click', goDashboard);
  card.appendChild(doneBtn);

  stepContainer.appendChild(card);

  function renderMealPicker() {
    mealPicker.innerHTML = '';
    MEAL_STEPS.forEach((m) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      let cls = 'meal-pill';
      if (m.key === logMealKey) cls += ' active';
      else if (state.meals[m.key].length > 0) cls += ' filled';
      btn.className = cls;
      btn.textContent = m.label;
      btn.addEventListener('click', () => {
        logMealKey = m.key;
        renderMealPicker();
        mealHeading.textContent = m.label;
        renderFoodList();
      });
      mealPicker.appendChild(btn);
    });
    mealHeading.textContent = MEAL_STEPS.find((m) => m.key === logMealKey).label;
  }

  function renderFoodList() {
    const items = state.meals[logMealKey];
    if (items.length === 0) {
      listEl.innerHTML = '<div class="empty-hint">No foods logged yet</div>';
      return;
    }
    listEl.innerHTML = '';
    items.forEach((f, idx) => {
      const row = document.createElement('div');
      row.className = 'food-item';
      const info = document.createElement('div');
      const name = document.createElement('div');
      name.className = 'name';
      name.textContent = f.name;
      const meta = document.createElement('div');
      meta.className = 'meta';
      meta.textContent = formatFoodMeta(f);
      info.appendChild(name);
      info.appendChild(meta);

      const removeBtn = document.createElement('button');
      removeBtn.className = 'remove';
      removeBtn.type = 'button';
      removeBtn.textContent = '×';
      removeBtn.addEventListener('click', async () => {
        state.meals[logMealKey].splice(idx, 1);
        await persistEntry();
        renderFoodList();
        renderMealPicker();
      });

      row.appendChild(info);
      row.appendChild(removeBtn);
      listEl.appendChild(row);
    });
  }

  const nameInput = formWrap.querySelector('#foodName');
  const percentInput = formWrap.querySelector('#foodPercent');
  const caloriesInput = formWrap.querySelector('#foodCalories');

  nameInput.addEventListener('input', () => {
    const match = foodsLibrary.find(
      (f) => f.name.toLowerCase() === nameInput.value.trim().toLowerCase()
    );
    if (match) caloriesInput.value = match.calories;
  });

  formWrap.querySelector('#addFoodBtn').addEventListener('click', async () => {
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
    state.meals[logMealKey].push({ name, calories, percent });
    rememberFood(name, calories);
    await persistEntry();
    nameInput.value = '';
    caloriesInput.value = '';
    percentInput.value = '100';
    nameInput.focus();
    renderFoodList();
    renderMealPicker();
  });

  renderMealPicker();
  renderFoodList();
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

function shiftDate(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  const pad = (n) => String(n).padStart(2, '0');
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
}

function mealCalories(items) {
  return items.reduce((sum, f) => sum + foodConsumedCalories(f), 0);
}

function computeDayStats(entry) {
  const stats = {
    weight: entry && entry.weight !== null && entry.weight !== undefined ? Number(entry.weight) : null,
    total: entry ? totalCaloriesForMeals(entry.meals) : null,
  };
  for (const m of MEAL_STEPS) {
    stats[m.key] = entry ? mealCalories(entry.meals[m.key]) : null;
  }
  return stats;
}

function computeAllTimeAverages(list, excludeDate) {
  const entries = list.filter((e) => e.date !== excludeDate);
  const result = { weight: null, total: null };
  for (const m of MEAL_STEPS) result[m.key] = null;
  if (entries.length === 0) return result;

  const weights = entries.map((e) => e.weight).filter((w) => w !== null && w !== undefined).map(Number);
  if (weights.length > 0) {
    result.weight = weights.reduce((a, b) => a + b, 0) / weights.length;
  }

  result.total = entries.reduce((sum, e) => sum + totalCaloriesForMeals(e.meals), 0) / entries.length;
  for (const m of MEAL_STEPS) {
    result[m.key] = entries.reduce((sum, e) => sum + mealCalories(e.meals[m.key]), 0) / entries.length;
  }
  return result;
}

function formatMetricValue(v, unit) {
  if (v === null || v === undefined) return null;
  return unit === 'lbs' ? Math.round(v * 10) / 10 : Math.round(v);
}

function renderDeltaLine(label, todayVal, compareVal, unit) {
  const line = document.createElement('div');
  line.className = 'compare-delta';
  if (todayVal === null || todayVal === undefined || compareVal === null || compareVal === undefined) {
    line.textContent = `${label}: no data`;
    return line;
  }
  const diff = todayVal - compareVal;
  const rounded = unit === 'lbs' ? Math.round(diff * 10) / 10 : Math.round(diff);
  const arrow = rounded > 0 ? '▲' : rounded < 0 ? '▼' : '—';
  const sign = rounded > 0 ? '+' : '';
  const compareDisplay = formatMetricValue(compareVal, unit);
  line.textContent = `${label}: ${arrow} ${sign}${rounded} ${unit} (was ${compareDisplay} ${unit})`;
  return line;
}

function renderCompareRow(container, metric, todayVal, yesterdayVal, avgVal) {
  const row = document.createElement('div');
  row.className = 'compare-row';

  const label = document.createElement('div');
  label.className = 'compare-label';
  label.textContent = metric.label;
  row.appendChild(label);

  const formattedToday = formatMetricValue(todayVal, metric.unit);
  const value = document.createElement('div');
  value.className = 'compare-value';
  value.textContent = formattedToday === null ? '—' : `${formattedToday} ${metric.unit}`;
  row.appendChild(value);

  const deltas = document.createElement('div');
  deltas.className = 'compare-deltas';
  deltas.appendChild(renderDeltaLine('vs Yesterday', todayVal, yesterdayVal, metric.unit));
  deltas.appendChild(renderDeltaLine('vs All-Time Avg', todayVal, avgVal, metric.unit));
  row.appendChild(deltas);

  container.appendChild(row);
}

async function renderCompare() {
  const card = document.createElement('div');
  card.className = 'card';
  card.innerHTML = '<div class="step-title">Compare</div><p class="step-sub">Loading…</p>';
  stepContainer.appendChild(card);

  const today = todayStr();
  const yesterday = shiftDate(today, -1);

  let list;
  try {
    const res = await fetch('/api/entries');
    list = await res.json();
  } catch (e) {
    card.innerHTML = '<div class="step-title">Compare</div><p class="empty-hint">Could not load comparison</p>';
    return;
  }

  const todayEntry = list.find((e) => e.date === today);
  const yesterdayEntry = list.find((e) => e.date === yesterday);

  card.innerHTML = `<div class="step-title">Compare</div><p class="step-sub">${today} vs yesterday and your all-time average</p>`;

  if (!todayEntry) {
    const empty = document.createElement('p');
    empty.className = 'empty-hint';
    empty.textContent = 'Nothing logged for today yet. Log a weight or food from the dashboard to see how today compares.';
    card.appendChild(empty);
    return;
  }

  const todayStats = computeDayStats(todayEntry);
  const yesterdayStats = computeDayStats(yesterdayEntry);
  const averages = computeAllTimeAverages(list, today);

  const metrics = [
    { key: 'weight', label: 'Weight', unit: 'lbs' },
    { key: 'total', label: 'Total Calories', unit: 'cal' },
    ...MEAL_STEPS.map((m) => ({ key: m.key, label: m.label, unit: 'cal' })),
  ];

  metrics.forEach((metric) => {
    renderCompareRow(card, metric, todayStats[metric.key], yesterdayStats[metric.key], averages[metric.key]);
  });
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

async function fetchGraphRows() {
  try {
    const res = await fetch('/api/entries');
    const list = await res.json();
    return list
      .map((e) => ({
        date: e.date,
        calories: e.totalCalories,
        weight: e.weight === null || e.weight === undefined ? null : Number(e.weight),
      }))
      .sort((a, b) => (a.date < b.date ? -1 : 1));
  } catch (e) {
    return [];
  }
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
