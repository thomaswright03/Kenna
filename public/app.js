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
  for (const m of MEAL_STEPS) meals[m.key] = null;
  return meals;
}

const state = {
  date: todayStr(),
  weight: '',
  meals: emptyMeals(),
};

let mode = 'dashboard'; // 'dashboard' | 'log' | 'confirmLog' | 'history' | 'compare'
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

async function loadEntryForDate(date) {
  try {
    const res = await fetch(`/api/entries/${date}`);
    const entry = await res.json();
    state.weight = entry.weight === null || entry.weight === undefined ? '' : entry.weight;
    state.meals = emptyMeals();
    for (const m of MEAL_STEPS) {
      const v = entry.meals && entry.meals[m.key];
      state.meals[m.key] = v === undefined ? null : v;
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

function totalCaloriesForMeals(meals) {
  let total = 0;
  for (const m of MEAL_STEPS) {
    const v = meals[m.key];
    if (v !== null && v !== undefined) total += Number(v) || 0;
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
    renderLogMeal();
    return;
  }
  if (mode === 'confirmLog') {
    renderConfirmLog();
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
    <div id="todayMeals"></div>
    <button class="btn btn-primary" id="logMealBtn" type="button">Log Meal</button>
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

  renderTodayMeals(todayCard.querySelector('#todayMeals'));

  todayCard.querySelector('#logMealBtn').addEventListener('click', () => {
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

function renderTodayMeals(container) {
  container.innerHTML = '';
  MEAL_STEPS.forEach((m) => {
    const section = document.createElement('div');
    section.className = 'summary-meal';
    const h = document.createElement('h3');
    h.textContent = m.label;
    section.appendChild(h);

    const row = document.createElement('div');
    row.className = 'meal-empty';
    const value = state.meals[m.key];

    if (value === null || value === undefined) {
      const hint = document.createElement('span');
      hint.className = 'empty-hint';
      hint.textContent = 'Not logged yet';
      const addBtn = document.createElement('button');
      addBtn.type = 'button';
      addBtn.className = 'meal-add-link';
      addBtn.textContent = '+ Add';
      addBtn.addEventListener('click', () => {
        logMealKey = m.key;
        mode = 'log';
        render();
      });
      row.appendChild(hint);
      row.appendChild(addBtn);
    } else {
      const valSpan = document.createElement('span');
      valSpan.className = 'meal-total-value';
      valSpan.textContent = `${value} cal`;

      const actions = document.createElement('div');
      actions.className = 'meal-total-actions';

      const editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.className = 'meal-add-link';
      editBtn.textContent = 'Edit';
      editBtn.addEventListener('click', () => {
        logMealKey = m.key;
        mode = 'log';
        render();
      });

      const removeBtn = document.createElement('button');
      removeBtn.className = 'remove';
      removeBtn.type = 'button';
      removeBtn.textContent = '×';
      removeBtn.addEventListener('click', async () => {
        state.meals[m.key] = null;
        await persistEntry();
        render();
      });

      actions.appendChild(editBtn);
      actions.appendChild(removeBtn);
      row.appendChild(valSpan);
      row.appendChild(actions);
    }

    section.appendChild(row);
    container.appendChild(section);
  });
}

function renderLogMeal() {
  const card = document.createElement('div');
  card.className = 'card';

  const heading = document.createElement('div');
  heading.className = 'step-title';
  heading.textContent = 'Log Meal';
  card.appendChild(heading);

  const sub = document.createElement('p');
  sub.className = 'step-sub';
  sub.textContent = `For ${state.date}`;
  card.appendChild(sub);

  const mealPicker = document.createElement('div');
  mealPicker.className = 'meal-picker';
  card.appendChild(mealPicker);

  const mealHeading = document.createElement('div');
  mealHeading.className = 'section-label';
  card.appendChild(mealHeading);

  const formWrap = document.createElement('div');
  formWrap.innerHTML = `
    <label for="mealCalories">Total Calories</label>
    <input type="number" id="mealCalories" inputmode="numeric" placeholder="e.g. 450">
  `;
  card.appendChild(formWrap);

  const doneHint = document.createElement('p');
  doneHint.className = 'field-hint';
  doneHint.textContent = 'Log at least one meal or snack before you can finish.';
  card.appendChild(doneHint);

  const doneBtn = document.createElement('button');
  doneBtn.className = 'btn btn-primary';
  doneBtn.type = 'button';
  doneBtn.textContent = 'Done';
  doneBtn.addEventListener('click', () => {
    mode = 'confirmLog';
    render();
  });
  card.appendChild(doneBtn);

  stepContainer.appendChild(card);

  const caloriesInput = formWrap.querySelector('#mealCalories');

  function updateDoneState() {
    const hasAnyMeal = MEAL_STEPS.some((m) => state.meals[m.key] !== null && state.meals[m.key] !== undefined);
    doneBtn.disabled = !hasAnyMeal;
    doneHint.style.display = hasAnyMeal ? 'none' : 'block';
  }

  function loadInputForMeal() {
    const v = state.meals[logMealKey];
    caloriesInput.value = v === null || v === undefined ? '' : v;
  }

  function renderMealPicker() {
    mealPicker.innerHTML = '';
    MEAL_STEPS.forEach((m) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      let cls = 'meal-pill';
      if (m.key === logMealKey) cls += ' active';
      else if (state.meals[m.key] !== null && state.meals[m.key] !== undefined) cls += ' filled';
      btn.className = cls;
      btn.textContent = m.label;
      btn.addEventListener('click', async () => {
        await saveCurrentMeal();
        logMealKey = m.key;
        renderMealPicker();
        mealHeading.textContent = m.label;
        loadInputForMeal();
        updateDoneState();
        caloriesInput.focus();
      });
      mealPicker.appendChild(btn);
    });
    mealHeading.textContent = MEAL_STEPS.find((m) => m.key === logMealKey).label;
  }

  async function saveCurrentMeal() {
    const raw = caloriesInput.value;
    if (raw === '') {
      state.meals[logMealKey] = null;
    } else {
      const num = Number(raw);
      if (Number.isNaN(num)) return;
      state.meals[logMealKey] = Math.round(num);
    }
    await persistEntry();
  }

  caloriesInput.addEventListener('change', async () => {
    await saveCurrentMeal();
    renderMealPicker();
    updateDoneState();
  });

  renderMealPicker();
  loadInputForMeal();
  updateDoneState();
}

function renderConfirmMealSummary(container) {
  const loggedMeals = MEAL_STEPS.filter((m) => state.meals[m.key] !== null && state.meals[m.key] !== undefined);
  if (loggedMeals.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'empty-hint';
    empty.textContent = 'Nothing logged yet';
    container.appendChild(empty);
    return;
  }
  loggedMeals.forEach((m) => {
    const row = document.createElement('div');
    row.className = 'food-item';
    const info = document.createElement('div');
    const name = document.createElement('div');
    name.className = 'name';
    name.textContent = m.label;
    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.textContent = `${state.meals[m.key]} cal`;
    info.appendChild(name);
    info.appendChild(meta);
    row.appendChild(info);
    container.appendChild(row);
  });
}

function renderConfirmLog() {
  const card = document.createElement('div');
  card.className = 'card';

  const heading = document.createElement('div');
  heading.className = 'step-title';
  heading.textContent = 'Confirm';
  card.appendChild(heading);

  const total = totalCaloriesForMeals(state.meals);
  const sub = document.createElement('p');
  sub.className = 'step-sub';
  sub.textContent = `This is what's logged for ${state.date} — ${total} total calories.`;
  card.appendChild(sub);

  renderConfirmMealSummary(card);

  const keepBtn = document.createElement('button');
  keepBtn.className = 'btn btn-secondary';
  keepBtn.type = 'button';
  keepBtn.textContent = 'Keep Editing';
  keepBtn.addEventListener('click', () => {
    mode = 'log';
    render();
  });
  card.appendChild(keepBtn);

  const confirmBtn = document.createElement('button');
  confirmBtn.className = 'btn btn-primary';
  confirmBtn.type = 'button';
  confirmBtn.textContent = 'Confirm';
  confirmBtn.addEventListener('click', goDashboard);
  card.appendChild(confirmBtn);

  stepContainer.appendChild(card);
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
      stepContainer.appendChild(buildBackupCard());
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

  stepContainer.appendChild(buildBackupCard());
}

async function exportBackup() {
  const res = await fetch('/api/entries');
  const list = await res.json();
  const entries = {};
  list.forEach((e) => {
    entries[e.date] = { date: e.date, weight: e.weight, meals: e.meals };
  });
  const payload = { exportedAt: new Date().toISOString(), entries };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `kenna-backup-${todayStr()}.json`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function importBackupFile(file) {
  const reader = new FileReader();
  reader.onload = async () => {
    let payload;
    try {
      payload = JSON.parse(reader.result);
    } catch (e) {
      alert('That file could not be read as a Kenna backup.');
      return;
    }

    const importedEntries = payload.entries && typeof payload.entries === 'object' ? payload.entries : {};
    const dates = Object.keys(importedEntries);

    for (const date of dates) {
      const entry = importedEntries[date];
      await fetch('/api/entries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date, weight: entry.weight, meals: entry.meals }),
      });
    }

    alert(`Restored ${dates.length} day(s) from backup.`);
    await loadEntryForDate(state.date);
    render();
  };
  reader.readAsText(file);
}

function buildBackupCard() {
  const card = document.createElement('div');
  card.className = 'card';

  const title = document.createElement('div');
  title.className = 'step-title';
  title.textContent = 'Backup';
  card.appendChild(title);

  const sub = document.createElement('p');
  sub.className = 'step-sub';
  sub.textContent =
    'Your data lives in a file on whatever computer is running the server. Export a backup file now and then so you always have an off-device copy.';
  card.appendChild(sub);

  const exportBtn = document.createElement('button');
  exportBtn.className = 'btn btn-secondary';
  exportBtn.type = 'button';
  exportBtn.textContent = 'Export Backup';
  exportBtn.addEventListener('click', exportBackup);
  card.appendChild(exportBtn);

  const importLabel = document.createElement('label');
  importLabel.className = 'btn btn-secondary import-label';
  importLabel.textContent = 'Import Backup';
  const importInput = document.createElement('input');
  importInput.type = 'file';
  importInput.accept = 'application/json';
  importInput.className = 'import-input';
  importInput.addEventListener('change', () => {
    if (importInput.files && importInput.files[0]) {
      importBackupFile(importInput.files[0]);
      importInput.value = '';
    }
  });
  importLabel.appendChild(importInput);
  card.appendChild(importLabel);

  return card;
}

function shiftDate(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  const pad = (n) => String(n).padStart(2, '0');
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
}

function computeDayStats(entry) {
  const stats = {
    weight: entry && entry.weight !== null && entry.weight !== undefined ? Number(entry.weight) : null,
    total: entry ? totalCaloriesForMeals(entry.meals) : null,
  };
  for (const m of MEAL_STEPS) {
    const v = entry ? entry.meals[m.key] : null;
    stats[m.key] = v === undefined || v === null ? null : Number(v);
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
    const vals = entries.map((e) => e.meals[m.key]).filter((v) => v !== null && v !== undefined).map(Number);
    if (vals.length > 0) {
      result[m.key] = vals.reduce((a, b) => a + b, 0) / vals.length;
    }
  }
  return result;
}

function formatMetricValue(v, unit) {
  if (v === null || v === undefined) return null;
  return unit === 'lbs' ? Math.round(v * 10) / 10 : Math.round(v);
}

function formatDeltaPhrase(label, todayVal, compareVal, unit) {
  const diff = todayVal - compareVal;
  const rounded = unit === 'lbs' ? Math.round(diff * 10) / 10 : Math.round(diff);
  const arrow = rounded > 0 ? '▲' : rounded < 0 ? '▼' : '—';
  const sign = rounded > 0 ? '+' : '';
  return `${arrow} ${sign}${rounded} ${label}`;
}

function buildCompareCaption(todayVal, yesterdayVal, avgVal, unit) {
  const parts = [];
  if (todayVal !== null && yesterdayVal !== null && yesterdayVal !== undefined) {
    parts.push(formatDeltaPhrase('vs yesterday', todayVal, yesterdayVal, unit));
  }
  if (todayVal !== null && avgVal !== null && avgVal !== undefined) {
    parts.push(formatDeltaPhrase('vs avg', todayVal, avgVal, unit));
  }
  const p = document.createElement('p');
  p.className = 'compare-caption';
  p.textContent = parts.length > 0 ? parts.join(' · ') : 'Not enough history to compare yet';
  return p;
}

// Bars grow from a single zero baseline (never truncated), so the visible
// bar length always honestly reflects magnitude — a metric like weight that
// barely moves day to day will produce near-equal bars, which is correct;
// the direct labels and caption carry the precise numbers regardless.
function buildCompareBarRow(catLabel, value, unit, maxVal, isToday) {
  const row = document.createElement('div');
  row.className = 'compare-bar-row' + (isToday ? ' compare-bar-row-today' : '');

  const cat = document.createElement('div');
  cat.className = 'compare-bar-cat';
  cat.textContent = catLabel;
  row.appendChild(cat);

  if (value === null || value === undefined) {
    const track = document.createElement('div');
    track.className = 'compare-bar-track compare-bar-empty';
    row.appendChild(track);
    const val = document.createElement('div');
    val.className = 'compare-bar-value compare-bar-value-empty';
    val.textContent = 'No data';
    row.appendChild(val);
    return row;
  }

  const track = document.createElement('div');
  track.className = 'compare-bar-track';
  const bar = document.createElement('div');
  bar.className = 'compare-bar' + (isToday ? ' compare-bar-today' : ' compare-bar-muted');
  const pct = maxVal > 0 ? Math.max((value / maxVal) * 100, value > 0 ? 3 : 0) : 0;
  bar.style.width = `${pct}%`;
  track.appendChild(bar);
  row.appendChild(track);

  const val = document.createElement('div');
  val.className = 'compare-bar-value';
  val.textContent = `${formatMetricValue(value, unit)} ${unit}`;
  row.appendChild(val);

  return row;
}

function renderCompareMetric(container, metric, todayVal, yesterdayVal, avgVal) {
  const wrap = document.createElement('div');
  wrap.className = 'compare-metric';

  const label = document.createElement('div');
  label.className = 'compare-metric-label';
  label.textContent = metric.label;
  wrap.appendChild(label);

  const bars = document.createElement('div');
  bars.className = 'compare-bars';

  const values = [todayVal, yesterdayVal, avgVal].filter((v) => v !== null && v !== undefined);
  const maxVal = values.length > 0 ? Math.max(...values, 0) : 0;

  bars.appendChild(buildCompareBarRow('Today', todayVal, metric.unit, maxVal, true));
  bars.appendChild(buildCompareBarRow('Yesterday', yesterdayVal, metric.unit, maxVal, false));
  bars.appendChild(buildCompareBarRow('All-Time Avg', avgVal, metric.unit, maxVal, false));

  wrap.appendChild(bars);
  wrap.appendChild(buildCompareCaption(todayVal, yesterdayVal, avgVal, metric.unit));

  container.appendChild(wrap);
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
    empty.textContent = 'Nothing logged for today yet. Log a weight or meal from the dashboard to see how today compares.';
    card.appendChild(empty);
    buildTrendsCard(stepContainer, list);
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
    renderCompareMetric(card, metric, todayStats[metric.key], yesterdayStats[metric.key], averages[metric.key]);
  });

  buildTrendsCard(stepContainer, list);
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

function toGraphRows(list) {
  return list
    .map((e) => ({
      date: e.date,
      calories: e.totalCalories,
      weight: e.weight === null || e.weight === undefined ? null : Number(e.weight),
    }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
}

async function fetchGraphRows() {
  try {
    const res = await fetch('/api/entries');
    const list = await res.json();
    return toGraphRows(list);
  } catch (e) {
    return [];
  }
}

function buildTrendsCard(parent, list) {
  const card = document.createElement('div');
  card.className = 'card';
  card.innerHTML = '<div class="step-title">Trends</div>';
  parent.appendChild(card); // attach before building charts so clientWidth-based sizing works

  const rows = toGraphRows(list);

  const caloriesWrap = document.createElement('div');
  caloriesWrap.className = 'graph-wrap';
  card.appendChild(caloriesWrap);
  buildLineChart(caloriesWrap, rows, {
    accessor: (r) => r.calories,
    color: CHART_COLORS.calories,
    title: 'Calories',
    subtitle: 'Daily total intake over time',
    unit: 'cal',
  });

  const weightWrap = document.createElement('div');
  weightWrap.className = 'graph-wrap';
  card.appendChild(weightWrap);
  buildLineChart(weightWrap, rows, {
    accessor: (r) => r.weight,
    color: CHART_COLORS.weight,
    title: 'Weight',
    subtitle: 'Weight over time',
    unit: 'lbs',
  });
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

  const ticks = niceTicks(Math.min(...values), Math.max(...values), 5);
  const yMin = ticks[0];
  const yMax = ticks[ticks.length - 1];

  const leftPad = 52;
  const rightPad = 24;
  const topPad = 24;
  const plotHeight = 260;
  const xAxisHeight = 32;

  // Fit point spacing to the space actually available so a handful of days
  // stretches to fill the card instead of forcing a scroll to see the most
  // recent (rightmost) point — but still cap it, and still fall back to a
  // comfortable minimum (with horizontal scroll) once there are many days.
  const minSpacing = 56;
  const maxSpacing = 110;
  const availableWidth = container.clientWidth || 320;
  const fitSpacing = rows.length > 1 ? (availableWidth - leftPad - rightPad - 20) / (rows.length - 1) : maxSpacing;
  const pointSpacing = rows.length > 1 ? Math.max(minSpacing, Math.min(maxSpacing, fitSpacing)) : maxSpacing;
  const width = Math.max(availableWidth, leftPad + rightPad + (rows.length - 1) * pointSpacing + 20);
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
      svgEl('circle', { class: 'end-dot', cx: xFor(i), cy: yFor(v), r: 5, fill: color, stroke: CHART_SURFACE_RING })
    );
  });

  rows.forEach((r, i) => {
    const v = accessor(r);
    if (v === null || v === undefined || Number.isNaN(v)) return;
    svg.appendChild(
      svgEl('circle', { class: 'hit-target', cx: xFor(i), cy: yFor(v), r: 18, 'data-idx': i, tabindex: 0 })
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
      y: Math.max(cy - 14, topPad + 14),
      'text-anchor': 'end',
      fill: color,
    });
    endLabel.textContent = `${formatMetricValue(v, unit).toLocaleString()} ${unit}`;
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
  const hoverDot = svgEl('circle', { class: 'hover-dot', r: 7, fill: color, stroke: CHART_SURFACE_RING, visibility: 'hidden' });
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
    valueEl.textContent = `${formatMetricValue(v, unit).toLocaleString()} ${unit}`;
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

(async function init() {
  await loadEntryForDate(state.date);
  render();
})();
