// Kenna core: the data rules shared by the phone app, the server app and the
// server API. Pure functions only (no DOM, no storage), so the same file runs
// in the browser (as window.KennaCore) and in Node (via require).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.KennaCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const MEAL_STEPS = [
    { key: 'breakfast', label: 'Breakfast' },
    { key: 'snack1', label: 'Snack 1' },
    { key: 'lunch', label: 'Lunch' },
    { key: 'snack2', label: 'Snack 2' },
    { key: 'dinner', label: 'Dinner' },
    { key: 'snack3', label: 'Snack 3' },
  ];
  const MEAL_KEYS = MEAL_STEPS.map((m) => m.key);

  const LIMITS = {
    caloriesMin: 0,
    caloriesMax: 10000,
    weightMin: 50,
    weightMax: 1000,
  };

  const LOCALE = 'en-US';
  const DAY_MS = 24 * 60 * 60 * 1000;

  // ---------------------------------------------------------------- dates
  //
  // Dates are plain "YYYY-MM-DD" strings in the user's local calendar. Date
  // arithmetic goes through UTC so daylight-saving changes can never make a
  // "day" 23 or 25 hours long and skip or repeat a date.

  const pad = (n) => String(n).padStart(2, '0');

  function localDateStr(d) {
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  function todayStr(now) {
    return localDateStr(now || new Date());
  }

  function parseDateStr(str) {
    if (typeof str !== 'string') return null;
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str);
    if (!m) return null;
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const d = Number(m[3]);
    if (y < 1900 || y > 2999 || mo < 1 || mo > 12 || d < 1) return null;
    const utc = new Date(Date.UTC(y, mo - 1, d));
    if (utc.getUTCMonth() !== mo - 1 || utc.getUTCDate() !== d) return null;
    return { y, m: mo, d };
  }

  function isValidDateStr(str) {
    return parseDateStr(str) !== null;
  }

  function dayNumber(str) {
    const p = parseDateStr(str);
    if (!p) return NaN;
    return Date.UTC(p.y, p.m - 1, p.d) / DAY_MS;
  }

  function dateFromDayNumber(n) {
    const d = new Date(n * DAY_MS);
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  }

  function shiftDate(str, days) {
    return dateFromDayNumber(dayNumber(str) + days);
  }

  function daysBetween(a, b) {
    return dayNumber(b) - dayNumber(a);
  }

  const shortDayFmt = new Intl.DateTimeFormat(LOCALE, { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
  const shortDayYearFmt = new Intl.DateTimeFormat(LOCALE, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
  const monthDayFmt = new Intl.DateTimeFormat(LOCALE, { month: 'short', day: 'numeric', timeZone: 'UTC' });
  const monthDayYearFmt = new Intl.DateTimeFormat(LOCALE, { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

  function utcDate(str) {
    return new Date(dayNumber(str) * DAY_MS);
  }

  // "Thu, Sep 24" (with the year when it isn't the current one).
  function formatDate(str, today) {
    if (!isValidDateStr(str)) return 'Unknown date';
    const ref = today || todayStr();
    const sameYear = str.slice(0, 4) === ref.slice(0, 4);
    return (sameYear ? shortDayFmt : shortDayYearFmt).format(utcDate(str));
  }

  // "Today", "Yesterday" or "Thu, Sep 24".
  function formatRelativeDate(str, today) {
    const ref = today || todayStr();
    if (str === ref) return 'Today';
    if (str === shiftDate(ref, -1)) return 'Yesterday';
    return formatDate(str, ref);
  }

  // "Sep 24" — for chart axes, where space is tight.
  function formatMonthDay(str, withYear) {
    if (!isValidDateStr(str)) return '';
    return (withYear ? monthDayYearFmt : monthDayFmt).format(utcDate(str));
  }

  // ---------------------------------------------------------------- numbers

  const numberFormats = {};
  function formatNumber(value, maxDecimals) {
    const digits = maxDecimals || 0;
    if (!numberFormats[digits]) {
      numberFormats[digits] = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: digits, minimumFractionDigits: 0 });
    }
    return numberFormats[digits].format(value);
  }

  function formatCalories(value) {
    return `${formatNumber(Math.round(value))} cal`;
  }

  function formatWeight(value) {
    return `${formatNumber(value, 1)} lbs`;
  }

  // ---------------------------------------------------------------- entries

  function emptyMeals() {
    const meals = {};
    for (const key of MEAL_KEYS) meals[key] = null;
    return meals;
  }

  // A meal's value is a single calorie total (number) or null if not logged.
  // Older versions logged individual foods per meal as an array; those are
  // read as their summed total, so old history keeps working unchanged.
  function normalizeMealValue(raw) {
    if (raw === null || raw === undefined || raw === '') return null;
    if (Array.isArray(raw)) {
      if (raw.length === 0) return null;
      const total = raw.reduce(
        (sum, f) => sum + ((Number(f && f.calories) || 0) * (Number(f && f.percent) || 0)) / 100,
        0
      );
      return Math.round(total);
    }
    if (typeof raw === 'object' || typeof raw === 'boolean') return null;
    const num = Number(raw);
    return Number.isFinite(num) ? Math.round(num) : null;
  }

  function normalizeWeight(raw) {
    if (raw === null || raw === undefined || raw === '' || typeof raw === 'boolean') return null;
    const num = Number(raw);
    return Number.isFinite(num) ? num : null;
  }

  // Turns one stored entry into the clean shape the app works with, or null
  // when it can't be read at all. Tolerant on purpose: stored data may come
  // from any older version of the app.
  function normalizeEntry(date, raw) {
    if (!isValidDateStr(date)) return null;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const meals = emptyMeals();
    const rawMeals = raw.meals && typeof raw.meals === 'object' && !Array.isArray(raw.meals) ? raw.meals : {};
    for (const key of MEAL_KEYS) meals[key] = normalizeMealValue(rawMeals[key]);
    return { date, weight: normalizeWeight(raw.weight), meals };
  }

  // Reads a whole stored entries object, keeping every readable day and
  // counting (not throwing on) the ones that can't be read.
  function sanitizeEntries(raw) {
    const entries = {};
    let skipped = 0;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { entries, skipped };
    for (const key of Object.keys(raw)) {
      const entry = normalizeEntry(key, raw[key]);
      if (entry) entries[key] = entry;
      else skipped += 1;
    }
    return { entries, skipped };
  }

  function hasMeals(meals) {
    if (!meals) return false;
    return MEAL_KEYS.some((k) => normalizeMealValue(meals[k]) !== null);
  }

  function isEntryEmpty(entry) {
    return !entry || (entry.weight === null && !hasMeals(entry.meals));
  }

  // The day's calorie total, or null when no meal has been logged. A day
  // with only a weight is "no calorie data", never "0 calories".
  function totalCalories(meals) {
    if (!hasMeals(meals)) return null;
    let total = 0;
    for (const key of MEAL_KEYS) {
      const v = normalizeMealValue(meals[key]);
      if (v !== null) total += v;
    }
    return total;
  }

  // Applies a partial update ({ weight?, meals?: { key: value } }) to an
  // entry. Only the fields in the patch change, so two screens or tabs
  // editing different meals of the same day never overwrite each other.
  function applyPatch(date, existing, patch) {
    const base = existing ? normalizeEntry(date, existing) : null;
    const next = base || { date, weight: null, meals: emptyMeals() };
    if (patch && Object.prototype.hasOwnProperty.call(patch, 'weight')) next.weight = normalizeWeight(patch.weight);
    if (patch && patch.meals && typeof patch.meals === 'object') {
      for (const key of MEAL_KEYS) {
        if (Object.prototype.hasOwnProperty.call(patch.meals, key)) next.meals[key] = normalizeMealValue(patch.meals[key]);
      }
    }
    return next;
  }

  function computeDayStats(entry) {
    const stats = { weight: null, total: null };
    for (const key of MEAL_KEYS) stats[key] = null;
    if (!entry) return stats;
    stats.weight = normalizeWeight(entry.weight);
    stats.total = totalCalories(entry.meals);
    for (const key of MEAL_KEYS) stats[key] = normalizeMealValue(entry.meals && entry.meals[key]);
    return stats;
  }

  const mean = (vals) => (vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null);

  // All-time averages, excluding one day (today) so today is compared with a
  // typical day rather than diluting its own baseline. Weight averages every
  // day with a weight; calories average only days with at least one meal; a
  // meal averages only the days that meal was logged.
  function computeAllTimeAverages(entries, excludeDate) {
    const list = (Array.isArray(entries) ? entries : Object.values(entries || {})).filter(
      (e) => e && e.date !== excludeDate
    );
    const result = { weight: null, total: null };
    result.weight = mean(list.map((e) => normalizeWeight(e.weight)).filter((w) => w !== null));
    result.total = mean(list.map((e) => totalCalories(e.meals)).filter((t) => t !== null));
    for (const key of MEAL_KEYS) {
      result[key] = mean(list.map((e) => normalizeMealValue(e.meals && e.meals[key])).filter((v) => v !== null));
    }
    return result;
  }

  // One row per logged day, oldest first; calories is null on days without
  // meals so charts show a gap there instead of a drop to zero.
  function buildDailyRows(entries) {
    return Object.values(entries || {})
      .filter((e) => e && isValidDateStr(e.date))
      .map((e) => ({ date: e.date, calories: totalCalories(e.meals), weight: normalizeWeight(e.weight) }))
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  }

  function seriesFromRows(rows, field) {
    return rows.filter((r) => r[field] !== null && r[field] !== undefined).map((r) => ({ date: r.date, value: r[field] }));
  }

  // Trailing rolling average: for each logged day, the mean of the values
  // logged in the `windowDays` calendar days ending on it.
  function rollingAverage(points, windowDays) {
    const days = windowDays || 7;
    const out = [];
    let start = 0;
    let sum = 0;
    for (let i = 0; i < points.length; i += 1) {
      sum += points[i].value;
      const n = dayNumber(points[i].date);
      while (dayNumber(points[start].date) <= n - days) {
        sum -= points[start].value;
        start += 1;
      }
      out.push({ date: points[i].date, value: sum / (i - start + 1), count: i - start + 1 });
    }
    return out;
  }

  // ---------------------------------------------------------------- input

  // Validates what the user typed. Returns { ok, value } or { ok: false, error }.
  function validateCalories(raw) {
    const text = String(raw === null || raw === undefined ? '' : raw).trim();
    if (text === '') return { ok: true, value: null };
    if (!/^\d+$/.test(text)) return { ok: false, error: 'Enter calories as a whole number, like 450.' };
    const value = Number(text);
    if (value > LIMITS.caloriesMax) {
      return { ok: false, error: `That's over ${formatNumber(LIMITS.caloriesMax)} calories for one meal. Check the number.` };
    }
    return { ok: true, value };
  }

  function validateWeight(raw) {
    const text = String(raw === null || raw === undefined ? '' : raw).trim();
    if (text === '') return { ok: true, value: null };
    const message = `Enter a weight between ${LIMITS.weightMin} and ${formatNumber(LIMITS.weightMax)} lbs.`;
    if (!/^\d{1,4}(\.\d{1,2})?$/.test(text)) return { ok: false, error: message };
    const value = Number(text);
    if (value < LIMITS.weightMin || value > LIMITS.weightMax) return { ok: false, error: message };
    return { ok: true, value };
  }

  function isCaloriesInRange(v) {
    return typeof v === 'number' && Number.isFinite(v) && v >= LIMITS.caloriesMin && v <= LIMITS.caloriesMax;
  }

  function isWeightInRange(v) {
    return typeof v === 'number' && Number.isFinite(v) && v >= LIMITS.weightMin && v <= LIMITS.weightMax;
  }

  // Checks one incoming entry (from an API call or a backup file) strictly.
  // Returns { ok, entry } or { ok: false, error } naming the problem.
  function validateIncomingEntry(date, raw) {
    if (!isValidDateStr(date)) return { ok: false, error: `"${String(date).slice(0, 40)}" isn't a real date.` };
    const when = formatDate(date, date);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return { ok: false, error: `The entry for ${when} isn't in the expected format.` };
    }
    if (raw.date !== undefined && raw.date !== date) {
      return { ok: false, error: `The entry for ${when} is labelled with a different date.` };
    }
    if (!raw.meals || typeof raw.meals !== 'object' || Array.isArray(raw.meals)) {
      return { ok: false, error: `The entry for ${when} has no meals section.` };
    }
    const meals = emptyMeals();
    for (const step of MEAL_STEPS) {
      const v = raw.meals[step.key];
      if (v === null || v === undefined) continue;
      let value;
      if (Array.isArray(v)) {
        const valid = v.every((f) => f && typeof f === 'object' && Number.isFinite(Number(f.calories)));
        if (!valid) return { ok: false, error: `${step.label} on ${when} isn't in the expected format.` };
        value = normalizeMealValue(v);
      } else if (typeof v === 'number') {
        value = Math.round(v);
      } else {
        return { ok: false, error: `${step.label} on ${when} isn't a number.` };
      }
      if (value !== null && !isCaloriesInRange(value)) {
        return { ok: false, error: `${step.label} on ${when} is ${String(v)} calories, which is out of range.` };
      }
      meals[step.key] = value;
    }
    let weight = null;
    if (raw.weight !== null && raw.weight !== undefined) {
      if (!isWeightInRange(raw.weight)) {
        return { ok: false, error: `The weight on ${when} (${String(raw.weight).slice(0, 20)}) is out of range.` };
      }
      weight = raw.weight;
    }
    return { ok: true, entry: { date, weight, meals } };
  }

  // ---------------------------------------------------------------- backup
  //
  // Backup file (version 2):
  //   { app: "kenna", version: 2, exportedAt, entries: { "YYYY-MM-DD": entry },
  //     photos: [ { date, createdAt, type, data /* base64 */ } ] }
  // Version-1 files (entries only, no "app"/"version") still import.

  const BACKUP_VERSION = 2;
  const MAX_BACKUP_ISSUES_SHOWN = 1;

  function photoKey(p) {
    return `${p.date}|${p.createdAt}`;
  }

  // Returns the backup as an array of string chunks (for a Blob), so a
  // backup with many photos never has to exist as one giant string.
  function serializeBackup(entries, photos, exportedAt) {
    const parts = [
      `{"app":"kenna","version":${BACKUP_VERSION},"exportedAt":${JSON.stringify(exportedAt)},"entries":`,
      JSON.stringify(entries),
      ',"photos":[',
    ];
    (photos || []).forEach((p, i) => {
      if (i > 0) parts.push(',');
      parts.push(JSON.stringify({ date: p.date, createdAt: p.createdAt, type: p.type, data: p.data }));
    });
    parts.push(']}');
    return parts;
  }

  // Validates a whole backup before anything is changed. Returns
  // { ok: true, entries, photos, dayCount, photoCount } or { ok: false, error }.
  function parseBackup(input) {
    let payload = input;
    if (typeof input === 'string') {
      try {
        payload = JSON.parse(input);
      } catch {
        return { ok: false, error: "This file isn't a Kenna backup: it isn't readable backup data." };
      }
    }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return { ok: false, error: "This file isn't a Kenna backup." };
    }
    if (payload.app !== undefined && payload.app !== 'kenna') {
      return { ok: false, error: "This file isn't a Kenna backup." };
    }
    if (typeof payload.version === 'number' && payload.version > BACKUP_VERSION) {
      return { ok: false, error: 'This backup was made by a newer version of Kenna. Update the app, then import it again.' };
    }
    if (!payload.entries || typeof payload.entries !== 'object' || Array.isArray(payload.entries)) {
      return { ok: false, error: "This file isn't a Kenna backup: it has no days in it." };
    }

    const entries = {};
    const problems = [];
    for (const date of Object.keys(payload.entries)) {
      const result = validateIncomingEntry(date, payload.entries[date]);
      if (result.ok) entries[date] = result.entry;
      else problems.push(result.error);
    }

    const photos = [];
    if (payload.photos !== undefined) {
      if (!Array.isArray(payload.photos)) {
        problems.push('The photos section is not in the expected format.');
      } else {
        payload.photos.forEach((p, i) => {
          const n = i + 1;
          if (!p || typeof p !== 'object') return problems.push(`Photo ${n} isn't in the expected format.`);
          if (!isValidDateStr(p.date)) return problems.push(`Photo ${n} has no valid date.`);
          if (typeof p.createdAt !== 'string' || Number.isNaN(Date.parse(p.createdAt))) {
            return problems.push(`Photo ${n} has no valid upload time.`);
          }
          if (typeof p.type !== 'string' || !/^image\/[\w.+-]+$/.test(p.type)) {
            return problems.push(`Photo ${n} isn't an image.`);
          }
          if (typeof p.data !== 'string' || p.data.length === 0 || !/^[A-Za-z0-9+/]+=*$/.test(p.data)) {
            return problems.push(`Photo ${n}'s image data is damaged.`);
          }
          photos.push({ date: p.date, createdAt: p.createdAt, type: p.type, data: p.data });
          return undefined;
        });
      }
    }

    if (problems.length > 0) {
      const extra = problems.length > MAX_BACKUP_ISSUES_SHOWN ? ` (and ${problems.length - 1} more problem${problems.length > 2 ? 's' : ''})` : '';
      return { ok: false, error: `Nothing was imported. ${problems[0]}${extra}` };
    }
    return { ok: true, entries, photos, dayCount: Object.keys(entries).length, photoCount: photos.length };
  }

  // ---------------------------------------------------------------- charts

  function niceNum(range, round) {
    const exponent = Math.floor(Math.log10(range));
    const fraction = range / Math.pow(10, exponent);
    let nice;
    if (round) {
      if (fraction < 1.5) nice = 1;
      else if (fraction < 3) nice = 2;
      else if (fraction < 7) nice = 5;
      else nice = 10;
    } else if (fraction <= 1) nice = 1;
    else if (fraction <= 2) nice = 2;
    else if (fraction <= 5) nice = 5;
    else nice = 10;
    return nice * Math.pow(10, exponent);
  }

  // Evenly spaced, unique axis ticks covering [min, max], plus how many
  // decimals the step needs (a 0.5 step shows 149.5, 150, 150.5, ...).
  function niceTicks(min, max, count, minStep) {
    let lo = min;
    let hi = max;
    const floorStep = minStep || 0;
    if (hi - lo < floorStep * 2 || lo === hi) {
      const mid = (lo + hi) / 2;
      const half = Math.max(floorStep * 2, Math.abs(mid) * 0.01, 1) / 2;
      lo = mid - half;
      hi = mid + half;
    }
    const range = niceNum(hi - lo, false);
    let step = niceNum(range / Math.max(1, (count || 5) - 1), true);
    if (step < floorStep) step = floorStep;
    const decimals = Math.max(0, -Math.floor(Math.log10(step) + 1e-9));
    const start = Math.floor(lo / step + 1e-9) * step;
    const end = Math.ceil(hi / step - 1e-9) * step;
    const ticks = [];
    for (let i = 0; start + i * step <= end + step / 2; i += 1) {
      ticks.push(Number((start + i * step).toFixed(decimals)));
    }
    return { ticks, decimals };
  }

  // ---------------------------------------------------------------- photos

  // Recognises the image formats a phone camera or browser produces from the
  // first bytes of the file, independent of its name or claimed type.
  function sniffImageType(bytes) {
    if (!bytes || bytes.length < 12) return null;
    const b = bytes;
    if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
    if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
    if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return 'image/gif';
    const ascii = (from, to) => String.fromCharCode(...Array.from(b.slice(from, to)));
    if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
    if (ascii(4, 8) === 'ftyp') {
      const brand = ascii(8, 12);
      if (brand === 'avif' || brand === 'avis') return 'image/avif';
      if (['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis'].includes(brand)) return 'image/heic';
      if (brand === 'mif1' || brand === 'msf1') return 'image/heif';
    }
    return null;
  }

  const IMAGE_EXTENSIONS = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'image/avif': 'avif',
    'image/heic': 'heic',
    'image/heif': 'heif',
  };

  return {
    MEAL_STEPS,
    MEAL_KEYS,
    LIMITS,
    BACKUP_VERSION,
    IMAGE_EXTENSIONS,
    todayStr,
    localDateStr,
    parseDateStr,
    isValidDateStr,
    dayNumber,
    dateFromDayNumber,
    shiftDate,
    daysBetween,
    formatDate,
    formatRelativeDate,
    formatMonthDay,
    formatNumber,
    formatCalories,
    formatWeight,
    emptyMeals,
    normalizeMealValue,
    normalizeWeight,
    normalizeEntry,
    sanitizeEntries,
    hasMeals,
    isEntryEmpty,
    totalCalories,
    applyPatch,
    computeDayStats,
    computeAllTimeAverages,
    buildDailyRows,
    seriesFromRows,
    rollingAverage,
    validateCalories,
    validateWeight,
    validateIncomingEntry,
    photoKey,
    serializeBackup,
    parseBackup,
    niceTicks,
    sniffImageType,
  };
});
