// History: every logged day, newest first. Tap a day to open it.

import { core, h, prefs, today, visibleEntries } from './dom.js';
import { store } from './store.js';
import { dayHash } from './router.js';

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
    card.append(h('p', { class: 'card-sub', text: 'Tap a day to view or edit it.' }));
    const list = h('ul', { class: 'history-list' });
    for (const e of entries) {
      const total = core.totalCalories(e.meals);
      const parts = [total === null ? 'No meals logged' : core.formatCalories(total)];
      if (e.weight !== null) parts.push(core.formatWeight(e.weight));
      list.append(
        h(
          'li',
          null,
          h(
            'a',
            { class: 'history-item', href: dayHash(e.date), 'data-date': e.date },
            h('span', { class: 'history-date', text: core.formatRelativeDate(e.date, now) }),
            h('span', { class: `history-stats${total === null ? ' is-muted' : ''}`, text: parts.join(' · ') }),
            h('span', { class: 'chevron', 'aria-hidden': 'true', text: '›' })
          )
        )
      );
    }
    card.append(list);
  }
  const last = prefs.get('lastBackupAt', null);
  const backupCard = h(
    'section',
    { class: 'card card-quiet' },
    h('h3', { class: 'section-title', text: 'Backup' }),
    h('p', {
      class: 'card-sub',
      text: last ? `Last backup file: ${core.formatDate(core.localDateStr(new Date(last)), now)}.` : "You haven't saved a backup file from this device yet.",
    }),
    h('a', { class: 'btn btn-secondary', href: '#/settings', text: 'Back up or restore' })
  );
  return { title: 'History', root: h('div', { class: 'screen-stack' }, card, backupCard) };
}
