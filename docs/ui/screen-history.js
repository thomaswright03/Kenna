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

/**
 * A month's averages: calories over the days with meals (leaving out
 * today, which isn't over, as every average does), weight over the days
 * with a weight.
 * @param {Entry[]} days
 * @param {string} now
 */
function monthSummary(days, now) {
  const totals = days
    .filter((e) => e.date < now)
    .map((e) => core.totalCalories(e.meals))
    .filter((t) => t !== null);
  const weights = days.map((e) => e.weight).filter((w) => w !== null);
  /** @param {number[]} list */
  const mean = (list) => list.reduce((a, b) => a + b, 0) / list.length;
  const parts = [plural(days.length, 'day')];
  if (totals.length) parts.push(`avg ${core.formatCalories(mean(/** @type {number[]} */ (totals)))}`);
  if (weights.length) parts.push(`avg ${core.formatWeight(mean(/** @type {number[]} */ (weights)), 1)}`);
  return parts.join(' · ');
}

/** @param {Entry} e @param {string} now */
function dayRow(e, now) {
  const total = core.totalCalories(e.meals);
  const parts = [total === null ? 'No meals logged' : core.formatCalories(total)];
  if (e.weight !== null) parts.push(core.formatWeight(e.weight));
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
  } else {
    const months = byMonth(entries);
    card.append(h('p', { class: 'card-sub', text: `${plural(entries.length, 'day')} logged. Tap a day to view or edit it.` }));
    const list = h('div', { class: 'history-months' });
    const moreBtn = h('button', { type: 'button', class: 'btn btn-secondary' });
    let shown = 0;

    /** @param {Month} m */
    function monthSection(m) {
      const headingId = uid('month');
      return h(
        'section',
        { class: 'history-month', 'aria-labelledby': headingId, 'data-month': m.key },
        h('h3', { class: 'history-month-title', id: headingId, tabindex: '-1', text: core.formatMonth(m.key) }),
        h('p', { class: 'history-month-sub', text: monthSummary(m.days, now) }),
        h('ul', { class: 'history-list' }, m.days.map((e) => dayRow(e, now)))
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
      moreBtn.hidden = shown >= months.length;
      moreBtn.textContent = `Show earlier months (${plural(left, 'more day')})`;
    }

    moreBtn.addEventListener('click', () => {
      const first = shown;
      showMore(MORE_DAYS);
      const heading = list.querySelectorAll('.history-month-title')[first];
      if (heading instanceof HTMLElement) heading.focus();
    });

    showMore(FIRST_DAYS);
    if (months.length > 3) {
      const select = h(
        'select',
        { id: uid('jump') },
        h('option', { value: '', text: 'Choose a month' }),
        months.map((m, i) => h('option', { value: String(i), text: `${core.formatMonth(m.key)} (${plural(m.days.length, 'day')})` }))
      );
      select.addEventListener('change', () => {
        if (select.value === '') return;
        const index = Number(select.value);
        showMore(0, index);
        const section = list.querySelector(`[data-month="${months[index].key}"] .history-month-title`);
        if (section instanceof HTMLElement) {
          section.scrollIntoView({ block: 'start' });
          section.focus({ preventScroll: true });
        }
        select.value = '';
      });
      card.append(h('div', { class: 'field' }, h('label', { for: select.id, text: 'Go to month' }), select));
    }
    card.append(list, moreBtn);
  }
  const backupCard = h(
    'section',
    { class: 'card card-quiet' },
    h('h3', { class: 'section-title', text: 'Backup' }),
    h('p', {
      class: 'card-sub',
      text: lastBackupText(),
    }),
    h('a', { class: 'btn btn-secondary', href: '#/settings', text: 'Back up or restore' })
  );
  return { title: 'History', root: h('div', { class: 'screen-stack' }, card, backupCard) };
}
