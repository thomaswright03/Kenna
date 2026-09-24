// History: every logged day, newest first, grouped by month with each
// month's averages. Recent months are shown straight away and older ones on
// request (or by jumping to a month), so years of data stay quick to open
// and to find your way around.

import { core, h, uid, today, visibleEntries, plural } from './dom.js';
import { store } from './store.js';
import { dayHash } from './router.js';
import { lastBackupText } from './backup.js';

/** @typedef {import('../core.js').Entry} Entry */
/** @typedef {{ key: string, days: Entry[] }} Month */

// Months are added until at least this many days are on screen.
const FIRST_DAYS = 60;
const MORE_DAYS = 120;

/** @param {Entry[]} days newest first @returns {Month[]} */
function byMonth(days) {
  /** @type {Month[]} */
  const months = [];
  for (const e of days) {
    const key = e.date.slice(0, 7);
    const last = months[months.length - 1];
    if (last && last.key === key) last.days.push(e);
    else months.push({ key, days: [e] });
  }
  return months;
}

// A month's averages leave out today, as every average does.
const monthAverages = core.computeMonthAverages;

// A month's weights, its average among them, are all written with the same
// number of decimals ("180.0 lbs" above "180.6 lbs").
/** @param {Entry[]} days */
const monthWeights = (days) => core.weightFormatFor(days.map((e) => e.weight)).format;

/** @param {Entry[]} days @param {string} now @param {(n: number) => string} lbs */
function monthSummary(days, now, lbs) {
  const avg = monthAverages(days, now);
  const parts = [plural(days.length, 'day')];
  if (avg.calories !== null) parts.push(`avg ${core.formatCalories(avg.calories)}`);
  if (avg.weight !== null) parts.push(`avg ${lbs(avg.weight)}`);
  return parts.join(' · ');
}

// Where History was left when a day was opened from it: the oldest month
// on the page, the day tapped and how far down the screen it was. It's
// kept with History's own entry in the browser history, so Back (or the
// back gesture) returns to the same place, while opening History from the
// tab bar starts at the top.
/** @typedef {{ month: string, date: string, top: number, scrollY: number }} Place */

/** @returns {Place | null} */
function savedPlace() {
  const state = window.history.state;
  const place = state && typeof state === 'object' ? state.kennaHistoryPlace : null;
  if (!place || typeof place.month !== 'string' || typeof place.date !== 'string') return null;
  return { month: place.month, date: place.date, top: Number(place.top) || 0, scrollY: Number(place.scrollY) || 0 };
}

/** @param {Place} place */
function keepPlace(place) {
  const state = window.history.state && typeof window.history.state === 'object' ? window.history.state : {};
  try {
    window.history.replaceState({ ...state, kennaHistoryPlace: place }, '');
  } catch {
    // Not remembered; History opens at the top instead.
  }
}

/**
 * Scrolls back to where the day was on screen and focuses it.
 * @param {HTMLElement} root
 * @param {Place} place
 */
function returnToPlace(root, place) {
  const link = root.querySelector(`.history-item[data-date="${place.date}"]`);
  if (!(link instanceof HTMLElement)) {
    window.scrollTo(0, place.scrollY);
    return;
  }
  window.scrollTo(0, link.getBoundingClientRect().top + window.scrollY - place.top);
  const box = link.getBoundingClientRect();
  if (box.top < 0 || box.bottom > window.innerHeight) link.scrollIntoView({ block: 'center' });
  link.focus({ preventScroll: true });
}

/** @param {Entry} e @param {string} now @param {(n: number) => string} lbs */
function dayRow(e, now, lbs) {
  const total = core.totalCalories(e.meals);
  const parts = [total === null ? 'No meals logged' : core.formatCalories(total)];
  if (e.weight !== null) parts.push(lbs(e.weight));
  return h(
    'li',
    null,
    h(
      'a',
      { class: 'history-item', href: dayHash(e.date), 'data-date': e.date },
      h('span', { class: 'history-date', text: core.formatRelativeDate(e.date, now) }),
      h('span', { class: `history-stats${total === null ? ' is-muted' : ''}`, text: parts.join(' · ') }),
      h('span', { class: 'chevron', 'aria-hidden': 'true', text: '›' })
    )
  );
}

/**
 * The months, newest first: recent ones straight away, older ones on
 * request. `jump` shows every month down to one and scrolls to it.
 * @param {Month[]} months
 * @param {string} now
 * @param {Place | null} place where History was left, to show the same months again
 */
function monthList(months, now, place) {
  const list = h('div', { class: 'history-months' });
  const moreBtn = h('button', { type: 'button', class: 'btn btn-secondary' });
  let shown = 0;

  /** @param {Month} m */
  function monthSection(m) {
    const headingId = uid('month');
    const lbs = monthWeights(m.days);
    return h(
      'section',
      { class: 'history-month', 'aria-labelledby': headingId, 'data-month': m.key },
      h('h3', { class: 'history-month-title', id: headingId, tabindex: '-1', text: core.formatMonth(m.key) }),
      h('p', { class: 'history-month-sub', text: monthSummary(m.days, now, lbs) }),
      h('ul', { class: 'history-list' }, m.days.map((e) => dayRow(e, now, lbs)))
    );
  }

  /** Shows months until `days` more days are on screen, or up to month index `upTo`. @param {number} days @param {number} [upTo] */
  function showMore(days, upTo) {
    let added = 0;
    while (shown < months.length && (added < days || (upTo !== undefined && shown <= upTo))) {
      list.append(monthSection(months[shown]));
      added += months[shown].days.length;
      shown += 1;
    }
    const left = months.slice(shown).reduce((n, m) => n + m.days.length, 0);
    moreBtn.hidden = left === 0;
    moreBtn.textContent = left === 0 ? '' : `Show earlier months (${plural(left, 'more day')})`;
  }

  moreBtn.addEventListener('click', () => {
    const first = shown;
    showMore(MORE_DAYS);
    const heading = list.querySelectorAll('.history-month-title')[first];
    if (heading instanceof HTMLElement) heading.focus();
  });

  // Opening a day remembers where History was, for coming back to it.
  list.addEventListener('click', (e) => {
    const link = e.target instanceof Element ? e.target.closest('.history-item') : null;
    if (!(link instanceof HTMLElement) || !link.dataset.date) return;
    keepPlace({ month: months[shown - 1].key, date: link.dataset.date, top: link.getBoundingClientRect().top, scrollY: window.scrollY });
  });

  /** @param {number} index */
  function jump(index) {
    showMore(0, index);
    const section = list.querySelector(`[data-month="${months[index].key}"] .history-month-title`);
    if (section instanceof HTMLElement) {
      section.scrollIntoView({ block: 'start' });
      section.focus({ preventScroll: true });
    }
  }

  const upTo = place ? months.findIndex((m) => m.key === place.month) : -1;
  showMore(FIRST_DAYS, upTo >= 0 ? upTo : undefined);
  return { list, moreBtn, jump };
}

/**
 * "Go to month", for a long history.
 * @param {Month[]} months
 * @param {(index: number) => void} jump
 */
function jumpField(months, jump) {
  const select = h(
    'select',
    { id: uid('jump') },
    h('option', { value: '', text: 'Choose a month' }),
    months.map((m, i) => h('option', { value: String(i), text: `${core.formatMonth(m.key)} (${plural(m.days.length, 'day')})` }))
  );
  select.addEventListener('change', () => {
    if (select.value === '') return;
    jump(Number(select.value));
    select.value = '';
  });
  return h('div', { class: 'field history-jump' }, h('label', { for: select.id, text: 'Go to month' }), select);
}

/**
 * On a wide screen, every month's averages at a glance beside the list;
 * a month's name jumps to it.
 * @param {Month[]} months
 * @param {string} now
 * @param {(index: number) => void} jump
 */
function monthsOverview(months, now, jump) {
  /** @param {number | null} v @param {(n: number) => string} format */
  const cell = (v, format) => h('td', { text: v === null ? '—' : format(v) });
  const rows = months.map((m, i) => {
    const avg = monthAverages(m.days, now);
    const name = h('button', { type: 'button', class: 'btn-text month-link', text: core.formatMonth(m.key), onClick: () => jump(i) });
    return h(
      'tr',
      { 'data-overview-month': m.key },
      h('th', { scope: 'row' }, name),
      h('td', { text: core.formatNumber(m.days.length) }),
      cell(avg.calories, (n) => core.formatNumber(Math.round(n))),
      cell(avg.weight, (n) => core.formatNumber(n, 1, 1))
    );
  });
  return h(
    'section',
    { class: 'card months-overview', 'aria-labelledby': 'months-overview-title' },
    h('h3', { class: 'section-title', id: 'months-overview-title', text: 'Month by month' }),
    h('p', { class: 'card-sub', text: 'Average calories (days with meals) and weight (lbs) each month, not counting today. Tap a month to go to it.' }),
    h(
      'div',
      { class: 'months-overview-scroll' },
      h(
        'table',
        { class: 'meal-table' },
        h('caption', { class: 'visually-hidden', text: 'Averages for each month' }),
        h('thead', null, h('tr', null, h('th', { scope: 'col', text: 'Month' }), h('th', { scope: 'col', text: 'Days' }), h('th', { scope: 'col', text: 'Avg cal' }), h('th', { scope: 'col', text: 'Avg lbs' }))),
        h('tbody', null, rows)
      )
    )
  );
}

function backupCard() {
  return h(
    'section',
    { class: 'card card-quiet' },
    h('h3', { class: 'section-title', text: 'Backup' }),
    h('p', { class: 'card-sub', text: lastBackupText() }),
    h('a', { class: 'btn btn-secondary', href: '#/settings', text: 'Back up or restore' })
  );
}

/** @type {import('./render.js').ScreenBuilder} */
export async function buildHistory() {
  const now = today();
  // A day dated after today (only possible from an old version or a wrong
  // clock) is kept in storage and backups but not listed.
  const entries = visibleEntries(await store.loadEntries())
    .filter((e) => !core.isFutureDate(e.date, now))
    .sort((a, b) => (a.date < b.date ? 1 : -1));
  const card = h('section', { class: 'card' }, h('h2', { class: 'card-title', text: 'History' }));
  if (entries.length === 0) {
    card.append(h('p', { class: 'empty-hint', text: 'No days logged yet.' }), h('a', { class: 'btn btn-primary', href: '#/', text: 'Log today' }));
    return { title: 'History', root: h('div', { class: 'screen-stack' }, card, backupCard()) };
  }
  const months = byMonth(entries);
  const place = savedPlace();
  const { list, moreBtn, jump } = monthList(months, now, place);
  card.append(h('p', { class: 'card-sub', text: `${plural(entries.length, 'day')} logged. Tap a day to view or edit it.` }));
  if (months.length > 3) card.append(jumpField(months, jump));
  card.append(list, moreBtn);
  const side = h('div', { class: 'screen-stack history-side' }, months.length > 1 ? monthsOverview(months, now, jump) : null, backupCard());
  const root = h('div', { class: 'screen-stack two-col history-layout' }, card, side);
  return { title: 'History', root, mounted: place ? () => returnToPlace(root, place) : undefined };
}
