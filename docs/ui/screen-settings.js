// Settings: theme, backup export/import and where the data is stored.

import { core, h, uid, prefs, today, BACKEND } from './dom.js';
import { failureText, recordProblem, buildProblemLogCard } from './problems.js';
import { confirmDialog, createStatusLine } from './feedback.js';
import { store } from './store.js';
import { applyTheme } from './theme.js';
import { buildBackupSection, downloadBlob } from './backup.js';
import { inAppleBrowserTab, runningInstalled, installSteps } from './install-note.js';

/** @type {import('./render.js').ScreenBuilder} */
export async function buildSettings() {
  const pref = prefs.get('theme', 'system');
  const name = uid('theme');
  const options = [
    { value: 'system', label: 'System' },
    { value: 'light', label: 'Light' },
    { value: 'dark', label: 'Dark' },
  ];
  const themeGroup = h(
    'fieldset',
    { class: 'segmented segmented-wide' },
    h('legend', { class: 'visually-hidden', text: 'Theme' }),
    options.map((o) => {
      const radio = h('input', { type: 'radio', name, value: o.value, id: `${name}-${o.value}`, class: 'visually-hidden', checked: o.value === pref });
      radio.addEventListener('change', () => {
        prefs.set('theme', o.value);
        applyTheme(o.value);
      });
      return [radio, h('label', { for: radio.id, class: 'segment', text: o.label })];
    })
  );
  const appearance = h(
    'section',
    { class: 'card' },
    h('h2', { class: 'card-title', text: 'Settings' }),
    h('h3', { class: 'section-title', text: 'Appearance' }),
    h('p', { class: 'card-sub', text: 'System follows your device’s light or dark setting.' }),
    themeGroup
  );

  const storageCard = h('section', { class: 'card' }, h('h3', { class: 'section-title', text: 'Where your data lives' }));
  if (BACKEND === 'server') {
    storageCard.append(h('p', { class: 'card-sub', text: 'Days and photos are saved by the Kenna server in its data folder, on the computer running it.' }));
  } else {
    storageCard.append(h('p', { class: 'card-sub', text: 'Days and photos are saved only in this browser on this device. Nothing is uploaded anywhere.' }));
    storageCard.append(
      h('p', {
        class: 'card-sub',
        text: 'In a browser tab on iPhone or iPad, Safari may delete a website’s data, Kenna’s included, when it hasn’t been used for about a week. Kenna added to the Home Screen isn’t affected.',
      })
    );
    if (inAppleBrowserTab()) {
      storageCard.append(
        h(
          'div',
          { class: 'note-box', 'data-install-steps': '' },
          h('p', { class: 'notice-title', text: 'You’re using Kenna in a Safari tab' }),
          h('p', { class: 'notice-text', text: 'To keep your data, add Kenna to your Home Screen:' }),
          installSteps(),
          h('p', {
            class: 'notice-text',
            text: 'Kenna on the Home Screen may open empty, because iPhone keeps its data apart from Safari’s: export a backup here first and import it there.',
          })
        )
      );
    } else if (runningInstalled()) {
      storageCard.append(h('p', { class: 'card-sub', text: 'Kenna is running from your Home Screen, so this doesn’t apply.' }));
    }
    const persisted = await store.persistenceStatus();
    if (persisted === true) {
      storageCard.append(h('p', { class: 'card-sub', text: 'This browser has agreed to keep Kenna’s data even when the device is low on space.' }));
    } else if (persisted === false) {
      storageCard.append(
        h('p', {
          class: 'card-sub',
          text: runningInstalled()
            ? 'This browser may clear Kenna’s data if the device runs low on space. Saving backup files regularly keeps it safe.'
            : 'This browser may clear Kenna’s data if the device runs low on space. Adding Kenna to your Home Screen and saving backup files regularly keeps it safe.',
        })
      );
    }
  }

  const damaged = await buildDamagedDataCard();
  return {
    title: 'Settings',
    root: h('div', { class: 'screen-stack two-col' }, h('div', { class: 'screen-stack' }, appearance, buildBackupSection()), h('div', { class: 'screen-stack' }, damaged, storageCard, buildProblemLogCard(downloadBlob))),
  };
}

/**
 * When stored days were ever found damaged, Kenna kept a copy of the
 * damaged data (at most the two newest). This card lets it be downloaded,
 * to send off for repair, or deleted. Null when there's none.
 */
async function buildDamagedDataCard() {
  const copies = await store.damagedCopies().catch((err) => {
    recordProblem('List damaged data', err);
    return [];
  });
  if (copies.length === 0) return null;
  const status = createStatusLine();
  const newest = copies[0].savedAt;
  const when = newest ? ` on ${core.formatDate(core.localDateStr(new Date(newest)), today())}` : '';
  const downloadBtn = h('button', { type: 'button', class: 'btn btn-secondary', text: 'Download damaged data' });
  const deleteBtn = h('button', { type: 'button', class: 'btn btn-danger-outline', text: 'Delete damaged data…' });
  const card = h(
    'section',
    { class: 'card', 'data-damaged-data': '' },
    h('h3', { class: 'section-title', text: 'Damaged data' }),
    h('p', {
      class: 'card-sub',
      text: `Kenna found its saved days damaged${when} and kept ${copies.length === 1 ? 'a copy' : `${core.formatNumber(copies.length)} copies`} of what was there. Download it to send off for repair, or delete it once you don’t need it. It takes up some of this browser’s storage.`,
    }),
    h('div', { class: 'notice-actions' }, deleteBtn, downloadBtn),
    status.el
  );
  downloadBtn.addEventListener('click', () => {
    const file = JSON.stringify({ app: 'kenna', kind: 'damaged-data', copies }, null, 2);
    downloadBlob(new Blob([file], { type: 'application/json' }), `kenna-damaged-data-${today()}.json`);
    status.set('saved', 'Downloading the damaged data…');
  });
  deleteBtn.addEventListener('click', async () => {
    const ok = await confirmDialog({
      title: 'Delete the damaged data?',
      message: 'The kept copy will be removed for good. Your days, photos and backups aren’t affected.',
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    try {
      await store.deleteDamagedCopies();
      card.replaceChildren(h('h3', { class: 'section-title', text: 'Damaged data' }), h('p', { class: 'card-sub', role: 'status', text: 'The damaged data was deleted.' }));
    } catch (err) {
      status.set('error', failureText('Delete damaged data', err));
    }
  });
  return card;
}
