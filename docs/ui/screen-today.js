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
import { buildBackupReminder, buildBackupStatus, loggedState } from './backup-reminder.js';
import { buildInstallNote } from './install-note.js';
import { buildWeightField } from './today-weight.js';
import { buildMealList } from './today-meals.js';
import { recordProblem } from './problems.js';

/**
 * Opens `picked` as the day shown, or says under the heading why it can't
 * be: an empty or unfinished date, or a day that hasn't happened yet.
 * @param {string} picked
 * @param {string} date the day shown now
 * @param {import('./feedback.js').StatusLine} status
 * @returns {boolean} false when it was refused
 */
function openPicked(picked, date, status) {
  if (!core.isValidDateStr(picked)) {
    status.set('error', 'Pick a date to view.');
    return false;
  }
  if (picked > today()) {
    status.set('error', core.FUTURE_DAY);
    return false;
  }
  if (picked !== date) navigate(dayHash(picked));
  return true;
}

/**
 * Change day from the keyboard: a visible date box with Open day and
 * Cancel. What's typed or changed with the arrow keys only opens a day
 * when it's confirmed: Enter, Open day, or leaving the box for elsewhere
 * on the page. Escape or Cancel puts it away.
 * @param {string} date the day shown
 * @param {(picked: string) => boolean} open opens a day; false when refused
 * @param {() => void} onClose runs when it's put away from the keyboard (focus goes back)
 */
function dayEditor(date, open, onClose) {
  const input = h('input', { type: 'date', id: uid('day'), value: date, max: today(), required: true });
  const openBtn = h('button', { type: 'button', class: 'btn btn-primary btn-compact', text: 'Open day' });
  const cancelBtn = h('button', { type: 'button', class: 'btn btn-secondary btn-compact', text: 'Cancel' });
  const root = h(
    'div',
    { class: 'day-editor', id: uid('day-editor'), hidden: true, 'data-day-editor': '' },
    h('label', { for: input.id, text: 'Day to open' }),
    h('div', { class: 'day-editor-row' }, input, openBtn, cancelBtn)
  );
  // Set once a day has been opened, so leaving the box as the screen
  // changes doesn't open it a second time.
  let done = false;
  const hide = () => {
    root.hidden = true;
  };
  const confirm = () => {
    if (done || root.hidden) return;
    if (!open(input.value)) {
      input.focus();
      return;
    }
    done = true;
    if (input.value === date) {
      hide();
      onClose();
    }
  };
  const cancel = () => {
    hide();
    onClose();
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      confirm();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancel();
    }
  });
  openBtn.addEventListener('click', confirm);
  cancelBtn.addEventListener('click', cancel);
  // Leaving for elsewhere on the page confirms a changed date, as leaving
  // any other box saves it; an unchanged or empty one is simply put away.
  root.addEventListener('focusout', (e) => {
    if (root.hidden || done || (e.relatedTarget instanceof Node && root.contains(e.relatedTarget))) return;
    if (input.value && input.value !== date) {
      if (open(input.value)) done = true;
    } else {
      hide();
    }
  });
  function show() {
    done = false;
    input.value = date;
    root.hidden = false;
    input.focus();
  }
  return { root, input, show };
}

/**
 * "Change day", beside the day's heading: a secondary control, so the
 * Weight box is the only thing on Today that looks like a field to fill.
 * It's one button to the keyboard, which opens a date box (dayEditor). For
 * a tap or a click, a date input lies unseen over the button, so the phone's
 * own date picker opens (with a mouse, the browser's), and picking a day
 * opens it. A day that hasn't happened yet is refused.
 * @param {string} date the day shown
 */
function buildDaySwitch(date) {
  const button = h('button', { type: 'button', class: 'day-switch-label', 'aria-expanded': 'false' });
  const editor = dayEditor(date, (picked) => openPicked(picked, date, status), () => {
    button.setAttribute('aria-expanded', 'false');
    button.focus();
  });
  const status = createFieldStatus(editor.input);
  button.setAttribute('aria-controls', editor.root.id);
  const showEditor = () => {
    status.set(null);
    button.setAttribute('aria-expanded', 'true');
    editor.show();
  };
  button.addEventListener('click', showEditor);

  // For taps and clicks only: out of the Tab order and hidden from screen
  // readers, which use the button.
  const picker = h('input', { type: 'date', class: 'day-switch-input', value: date, max: today(), tabindex: '-1', 'aria-hidden': 'true' });
  picker.addEventListener('change', () => {
    if (!openPicked(picker.value, date, status)) picker.value = date;
  });
  picker.addEventListener('blur', () => {
    if (!picker.value) picker.value = date;
  });
  picker.addEventListener('click', () => {
    if (!window.matchMedia || !window.matchMedia('(pointer: fine)').matches) return;
    const withPicker = /** @type {HTMLInputElement & { showPicker?: () => void }} */ (picker);
    try {
      if (withPicker.showPicker) withPicker.showPicker();
    } catch {
      // The date box below still works.
    }
  });
  // Typing after a click goes to the visible date box instead, so no key
  // opens a day on its own.
  picker.addEventListener('keydown', (e) => {
    if (e.key === 'Tab' || e.key === 'Shift') return;
    e.preventDefault();
    showEditor();
  });

  const icon = svg('svg', { class: 'day-switch-icon', viewBox: '0 0 24 24', width: 18, height: 18, 'aria-hidden': 'true', focusable: 'false' });
  icon.append(
    svg('rect', { x: 3.5, y: 5, width: 17, height: 15, rx: 2.5, fill: 'none', stroke: 'currentColor', 'stroke-width': 2 }),
    svg('path', { d: 'M3.5 10h17M8 3v4M16 3v4', fill: 'none', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round' })
  );
  button.append(icon, h('span', { text: 'Change day' }));
  const control = h('div', { class: 'day-switch' }, button, picker);
  return { control, editor: editor.root, status: status.el };
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
    daySwitch.editor,
    daySwitch.status,
  ];
}

/** What Kenna is, said once, before anything is logged. */
function welcome() {
  return h(
    'p',
    { class: 'welcome', 'data-welcome': '' },
    h('strong', { text: 'Welcome to Kenna.' }),
    ' Log your weight and each meal’s calories each day to see your trends and averages. Everything stays on this device.'
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
  // twice: which days have photos counts toward the backup reminder. If
  // the photos can't be read, Today goes by the days alone, and the
  // problem is noted.
  const photos = store.listPhotos().catch((err) => {
    recordProblem('Check which days have photos', err);
    return [];
  });
  const [storedEntry, allEntries] = await Promise.all([store.getEntry(date), store.loadEntries()]);
  /** @type {import('./today-weight.js').DayView} */
  const view = { date, entry: storedEntry || blankEntry(date), rolledOver: false };
  const isToday = date === now;
  const logged = loggedState(visibleEntries(allEntries), await photos);
  const hasData = logged.loggedDays > 0;

  // A day long before anything logged asks first; until then only Change
  // day is offered, to fix a mistyped year.
  const gate = farBackGate(date, allEntries, () => render());
  const weight = gate ? null : buildWeightField(view, allEntries);
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
    viewing: date,
    footer: h('p', { class: 'card-foot' }, h('a', { class: 'btn-text', href: '#/history', text: 'See exact numbers in History' })),
  });

  // How old the last backup is, under the day, once there's anything to
  // lose; hidden while a card asks for a backup.
  const backupStatus = hasData ? buildBackupStatus(logged) : null;
  const showBackupStatus = () => backupStatus && backupStatus.show();
  // The day always comes first, so logging is the first thing on screen
  // on every visit; advice goes right under it, one card at a time. The
  // Home Screen note wins (it already says to back up first); the backup
  // reminder shows once the note is hidden or doesn't apply.
  const installNote = buildInstallNote(hasData, () => {
    const next = buildBackupReminder(logged, { onGone: showBackupStatus });
    if (!next) return;
    if (backupStatus) backupStatus.root.hidden = true;
    dayCard.after(next.root);
    next.root.setAttribute('tabindex', '-1');
    next.root.focus();
  });
  const notice = installNote || buildBackupReminder(logged, { onGone: showBackupStatus });
  if (backupStatus && notice && notice !== installNote) backupStatus.root.hidden = true;
  const dayColumn = h('div', { class: 'screen-stack' }, dayCard, notice ? notice.root : null, backupStatus ? backupStatus.root : null);
  const root = h('div', { class: 'screen-stack two-col' }, dayColumn, charts.root);

  return {
    title: isToday ? 'Today' : core.formatDate(date, now),
    root,
    mounted: () => {
      charts.draw();
      if (notice) notice.mounted();
      if (weight) weight.mounted();
    },
    flush: weight ? weight.flush : undefined,
    leave: weight ? () => weight.leave(dayHash(ctx.route.date)) : undefined,
    async refreshFromStorage(how) {
      const entry = (await store.getEntry(view.date)) || blankEntry(view.date);
      if (JSON.stringify(entry) === JSON.stringify(view.entry)) return;
      view.entry = entry;
      if (weight) weight.refresh(!!(how && how.elsewhere));
      if (meals) meals.refresh();
    },
  };
}
