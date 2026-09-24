// Today (or a past day): date, weight, the day's calories per meal, and the
// Calories and Weight charts. The weight box and the meal list are their
// own modules (today-weight.js, today-meals.js); this one puts the day's
// card together with the charts, the backup line and the notices.

import { core, h, svg, uid, today, blankEntry, visibleEntries } from './dom.js';
import { createFieldStatus } from './feedback.js';
import { store } from './store.js';
import { dayHash, logHash, navigate } from './router.js';
import { render } from './render.js';
import { farBackGate } from './day.js';
import { buildChartsCard } from './charts.js';
import { buildBackupReminder, buildBackupStatus, loggedDayCount } from './backup-reminder.js';
import { buildInstallNote } from './install-note.js';
import { buildWeightField } from './today-weight.js';
import { buildMealList } from './today-meals.js';

/**
 * "Change day", beside the day's heading: a secondary control, so the
 * Weight box is the only thing on Today that looks like a field to fill.
 * The date input itself lies unseen over the button, so a tap on the
 * button is a tap on the input and opens the phone's own date picker;
 * with a mouse, a click opens the browser's picker. Picking a day opens
 * it; a day that hasn't happened yet is refused.
 * @param {string} date the day shown
 */
function buildDaySwitch(date) {
  const now = today();
  const input = h('input', { type: 'date', id: uid('date'), class: 'day-switch-input', value: date, max: now, required: true });
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
  input.addEventListener('click', () => {
    if (!window.matchMedia || !window.matchMedia('(pointer: fine)').matches) return;
    const picker = /** @type {HTMLInputElement & { showPicker?: () => void }} */ (input);
    try {
      if (picker.showPicker) picker.showPicker();
    } catch {
      // The input still takes typing.
    }
  });
  const icon = svg('svg', { class: 'day-switch-icon', viewBox: '0 0 24 24', width: 18, height: 18, 'aria-hidden': 'true', focusable: 'false' });
  icon.append(
    svg('rect', { x: 3.5, y: 5, width: 17, height: 15, rx: 2.5, fill: 'none', stroke: 'currentColor', 'stroke-width': 2 }),
    svg('path', { d: 'M3.5 10h17M8 3v4M16 3v4', fill: 'none', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round' })
  );
  const control = h('div', { class: 'day-switch' }, h('label', { class: 'day-switch-label', for: input.id }, icon, h('span', { text: 'Change day' })), input);
  return { control, status: status.el };
}

/**
 * The day's heading: "Today" and its date, or the past day, with Change
 * day beside it.
 * @param {string} date
 */
function dayHeading(date) {
  const now = today();
  const isToday = date === now;
  const daySwitch = buildDaySwitch(date);
  return [
    h(
      'div',
      { class: 'day-head' },
      h('div', null, h('h2', { class: 'card-title', text: isToday ? 'Today' : core.formatDate(date, now) }), h('p', { class: 'card-sub', text: isToday ? core.formatDate(date, now) : 'Past day' })),
      daySwitch.control
    ),
    daySwitch.status,
  ];
}

/** What Kenna is, said once, before anything is logged. */
function welcome() {
  return h(
    'p',
    { class: 'welcome', 'data-welcome': '' },
    h('strong', { text: 'Welcome to Kenna.' }),
    ' Log your weight and each meal’s calories each day to see your trends and averages. Everything stays on this phone.'
  );
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
  // Asked for alongside the days, so a slow connection waits once, not
  // twice: which days have photos counts toward the backup reminder.
  const photos = store.listPhotos().catch(() => []);
  const [storedEntry, allEntries] = await Promise.all([store.getEntry(date), store.loadEntries()]);
  /** @type {import('./today-weight.js').DayView} */
  const view = { date, entry: storedEntry || blankEntry(date), rolledOver: false };
  const isToday = date === now;
  const loggedDays = loggedDayCount(visibleEntries(allEntries), await photos);
  const hasData = loggedDays > 0;

  // A day long before anything logged asks first; until then only Change
  // day is offered, to fix a mistyped year.
  const gate = farBackGate(date, allEntries, () => render());
  const weight = gate ? null : buildWeightField(view);
  const meals = gate ? null : buildMealList(view, { routeDate: ctx.route.date, isToday });
  if (meals) ctx.onRelease(meals.offerUndoAfterLeaving);
  const dayCard =
    gate || !weight || !meals
      ? h('section', { class: 'card' }, dayHeading(date), gate)
      : h(
          'section',
          { class: 'card' },
          dayHeading(date),
          hasData ? null : welcome(),
          isToday ? null : pastDayNote(date),
          weight.root,
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

  // How old the last backup is, under the day, once there's anything to
  // lose; hidden while a card above the day asks for a backup.
  const backupStatus = hasData ? buildBackupStatus(loggedDays) : null;
  const showBackupStatus = () => backupStatus && backupStatus.show();
  // At most one card above the day, so logging stays in reach, and none
  // before anything is logged: the day comes first. The Home Screen note
  // wins (it already says to back up first); before anything is logged it
  // sits under the day instead. The backup reminder shows once the note is
  // hidden or doesn't apply.
  const installNote = buildInstallNote(hasData, () => {
    const next = buildBackupReminder(loggedDays, showBackupStatus);
    if (!next) return;
    if (backupStatus) backupStatus.root.hidden = true;
    root.prepend(next.root);
    next.root.setAttribute('tabindex', '-1');
    next.root.focus();
  });
  const reminder = installNote ? null : buildBackupReminder(loggedDays, showBackupStatus);
  if (backupStatus && reminder) backupStatus.root.hidden = true;
  const above = hasData ? installNote || reminder : reminder;
  const below = hasData ? null : installNote;
  const dayColumn = h('div', { class: 'screen-stack' }, dayCard, backupStatus ? backupStatus.root : null, below ? below.root : null);
  const root = h('div', { class: 'screen-stack two-col' }, above ? above.root : null, dayColumn, charts.root);

  return {
    title: isToday ? 'Today' : core.formatDate(date, now),
    root,
    mounted: () => {
      charts.draw();
      if (above) above.mounted();
      if (weight) weight.mounted();
    },
    flush: weight ? weight.flush : undefined,
    leave: weight ? () => weight.leave(dayHash(ctx.route.date)) : undefined,
    async refreshFromStorage() {
      view.entry = (await store.getEntry(view.date)) || blankEntry(view.date);
      if (weight) weight.refresh();
      if (meals) meals.refresh();
    },
  };
}
