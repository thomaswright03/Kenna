// Today (or a past day): date, weight, the day's calories per meal, and the
// Calories and Weight charts. The weight box and the meal list are their
// own modules (today-weight.js, today-meals.js); this one puts the day's
// card together with the charts and the notice above them.

import { core, h, uid, today, blankEntry, visibleEntries } from './dom.js';
import { createFieldStatus } from './feedback.js';
import { store } from './store.js';
import { dayHash, logHash, navigate } from './router.js';
import { render } from './render.js';
import { farBackGate } from './day.js';
import { buildChartsCard } from './charts.js';
import { buildBackupReminder } from './backup-reminder.js';
import { buildInstallNote } from './install-note.js';
import { buildWeightField } from './today-weight.js';
import { buildMealList } from './today-meals.js';

/**
 * "Day to view or edit": picking a day opens it; a day that hasn't
 * happened yet is refused.
 * @param {string} date the day shown
 */
function buildDatePicker(date) {
  const now = today();
  const input = h('input', { type: 'date', id: uid('date'), value: date, max: now, required: true });
  const status = createFieldStatus(input);
  input.addEventListener('change', () => {
    const picked = input.value;
    if (!core.isValidDateStr(picked)) {
      input.value = date;
      status.set('error', 'Pick a date to view.');
      return;
    }
    if (picked > today()) {
      input.value = date;
      status.set('error', core.FUTURE_DAY);
      return;
    }
    if (picked !== date) navigate(dayHash(picked));
  });
  input.addEventListener('blur', () => {
    if (!input.value) input.value = date;
  });
  return h('div', { class: 'field' }, h('label', { for: input.id, text: 'Day to view or edit' }), input, status.el);
}

/**
 * The day's heading: "Today" and its date, or the past day and a way back.
 * @param {string} date
 */
function dayHeading(date) {
  const now = today();
  const isToday = date === now;
  return [
    h('h2', { class: 'card-title', text: isToday ? 'Today' : core.formatDate(date, now) }),
    h('p', { class: 'card-sub', text: isToday ? core.formatDate(date, now) : 'Past day' }),
  ];
}

/** @param {string} date */
function pastDayNote(date) {
  return h(
    'div',
    { class: 'inline-note' },
    h('span', { text: `You're viewing ${core.formatRelativeDate(date, today())}.` }),
    h('a', { class: 'btn-text', href: '#/', text: 'Back to today' })
  );
}

/** @type {import('./render.js').ScreenBuilder} */
export async function buildToday(ctx) {
  const now = today();
  const date = ctx.route.date || now;
  // Asked for alongside the days, so a slow connection waits once, not twice;
  // it's only needed when no day is logged yet.
  const photoCount = store.countPhotos().catch(() => 0);
  const [storedEntry, allEntries] = await Promise.all([store.getEntry(date), store.loadEntries()]);
  /** @type {import('./today-weight.js').DayView} */
  const view = { date, entry: storedEntry || blankEntry(date), rolledOver: false };
  const isToday = date === now;
  const dateField = buildDatePicker(date);

  // A day long before anything logged asks first; until then only the
  // day picker is offered, to fix a mistyped year.
  const gate = farBackGate(date, allEntries, () => render());
  const weight = gate ? null : buildWeightField(view);
  const meals = gate ? null : buildMealList(view, { routeDate: ctx.route.date, isToday });
  const dayCard =
    gate || !weight || !meals
      ? h('section', { class: 'card' }, dayHeading(date), gate, dateField)
      : h(
          'section',
          { class: 'card' },
          dayHeading(date),
          isToday ? null : pastDayNote(date),
          h('div', { class: 'field-row' }, dateField, weight.root),
          meals.total,
          h('a', { class: 'btn btn-primary', href: logHash(ctx.route.date, null), text: 'Log Meal' }),
          meals.list
        );

  const charts = buildChartsCard({
    title: 'Graphs',
    entries: allEntries,
    smoothing: false,
    footer: h('p', { class: 'card-foot' }, h('a', { class: 'btn-text', href: '#/history', text: 'See exact numbers in History' })),
  });
  const hasData = visibleEntries(allEntries).length > 0 || (await photoCount) > 0;
  // At most one card above the day, so logging stays in reach. The Home
  // Screen note wins: it already says to back up first. The backup
  // reminder shows once the note is hidden or doesn't apply.
  const installNote = buildInstallNote(hasData, () => {
    const next = buildBackupReminder(hasData);
    if (!next) return;
    root.prepend(next.root);
    next.root.setAttribute('tabindex', '-1');
    next.root.focus();
  });
  const reminder = installNote ? null : buildBackupReminder(hasData);
  const root = h('div', { class: 'screen-stack two-col' }, installNote ? installNote.root : null, reminder ? reminder.root : null, dayCard, charts.root);

  return {
    title: isToday ? 'Today' : core.formatDate(date, now),
    root,
    mounted: () => {
      charts.draw();
      if (installNote) installNote.mounted();
      else if (reminder) reminder.mounted();
      if (weight) weight.mounted();
    },
    flush: weight ? weight.flush : undefined,
    async refreshFromStorage() {
      view.entry = (await store.getEntry(view.date)) || blankEntry(view.date);
      if (weight) weight.refresh();
      if (meals) meals.refresh();
    },
  };
}
