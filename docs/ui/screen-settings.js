// Settings: theme, backup export/import and where the data is stored.

import { h, uid, prefs, BACKEND } from './dom.js';
import { store } from './store.js';
import { applyTheme } from './theme.js';
import { buildBackupSection } from './backup.js';

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
    h('p', { class: 'card-sub', text: 'System follows your phone’s light or dark setting.' }),
    themeGroup
  );

  const storageCard = h('section', { class: 'card' }, h('h3', { class: 'section-title', text: 'Where your data lives' }));
  if (BACKEND === 'server') {
    storageCard.append(h('p', { class: 'card-sub', text: 'Days and photos are saved by the Kenna server in its data folder, on the computer running it.' }));
  } else {
    storageCard.append(h('p', { class: 'card-sub', text: 'Days and photos are saved only in this browser on this device. Nothing is uploaded anywhere.' }));
    const persisted = await store.persistenceStatus();
    if (persisted === true) {
      storageCard.append(h('p', { class: 'card-sub', text: 'This browser has agreed to keep Kenna’s data even when the device is low on space.' }));
    } else if (persisted === false) {
      storageCard.append(
        h('p', {
          class: 'card-sub',
          text: 'This browser may clear Kenna’s data if the device runs low on space. Adding Kenna to your Home Screen and saving backup files regularly keeps it safe.',
        })
      );
    }
  }

  return { title: 'Settings', root: h('div', { class: 'screen-stack' }, appearance, buildBackupSection(), storageCard) };
}
