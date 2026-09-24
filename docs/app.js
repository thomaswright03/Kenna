// Kenna UI entry point. One codebase for both versions: the installable
// phone app (backend "local": localStorage + IndexedDB) and the Node server
// version (backend "server": the /api endpoints). Only the store differs.
// The screens and their helpers live in ui/.

import { h, prefs, byId, BACKEND } from './ui/dom.js';
import { applyTheme, followSystemTheme } from './ui/theme.js';
import { store } from './ui/store.js';
import { route, startRouter } from './ui/router.js';
import { render, registerScreens, getCurrentView } from './ui/render.js';
import { dayHasChanged } from './ui/day.js';
import { loadDraftFromLastVisit, dropStoredDraft, reportUnclaimedDraft } from './ui/drafts.js';
import { buildToday } from './ui/screen-today.js';
import { buildLog } from './ui/screen-log.js';
import { buildHistory } from './ui/screen-history.js';
import { buildCompare } from './ui/screen-compare.js';
import { buildPhotos } from './ui/screen-photos.js';
import { buildSettings } from './ui/screen-settings.js';

registerScreens({
  today: buildToday,
  log: buildLog,
  history: buildHistory,
  compare: buildCompare,
  photos: buildPhotos,
  settings: buildSettings,
});

// If the app is left open (or resumed) past midnight, Today moves to the
// new day, unless the user is typing.
function checkForNewDay() {
  if (!dayHasChanged()) return;
  const main = byId('main');
  const active = document.activeElement;
  const typing = active !== null && main.contains(active) && active.tagName === 'INPUT';
  if (!typing) render();
}

function renderBlocked() {
  document.title = 'Storage is blocked · Kenna';
  byId('main').replaceChildren(
    h(
      'section',
      { class: 'card' },
      h('h2', { class: 'card-title', text: 'Storage is blocked here' }),
      h('p', { class: 'card-sub', text: "This browser or tab won't let Kenna save anything, so nothing you logged would actually be kept." }),
      h('p', {
        class: 'card-sub',
        text: "This usually means Private Browsing, or a link opened inside another app's built-in browser (Messages, Instagram, TikTok and so on).",
      }),
      h('p', { class: 'card-sub', text: 'Fix: open this page in Safari itself, tap Share, then Add to Home Screen, and open Kenna from that icon from now on.' })
    )
  );
}

async function start() {
  applyTheme(prefs.get('theme', 'system'));
  followSystemTheme();
  byId('storageNote').textContent = BACKEND === 'server' ? 'Data is saved on the Kenna server.' : 'Data is saved only in this browser, on this device.';
  const status = await store.init();
  if (!status.ok) {
    renderBlocked();
    return;
  }
  store.requestPersistence();
  store.onExternalChange(() => {
    const view = getCurrentView();
    if (view && view.refreshFromStorage) view.refreshFromStorage().catch(() => {});
    else if (route.screen === 'history' || route.screen === 'compare') render();
  });

  // A number typed but not yet saved is saved when the page is hidden (app
  // switched away from, phone locked) or closed/reloaded, since the app may
  // never get the chance once it's in the background.
  const flushInput = () => {
    const view = getCurrentView();
    if (view && view.flush) view.flush();
  };
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      flushInput();
    } else {
      dropStoredDraft();
      checkForNewDay();
    }
  });
  window.addEventListener('pagehide', flushInput);
  window.addEventListener('focus', checkForNewDay);
  window.addEventListener('pageshow', checkForNewDay);
  setInterval(checkForNewDay, 30000);

  loadDraftFromLastVisit();
  startRouter(render);
  await render();
  reportUnclaimedDraft();

  // The app's files are kept for opening offline (the phone app) or while
  // the server is stopped (the server version, which then says so).
  // Browsers allow this on https and on localhost only.
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {
      // The app still works online without offline caching.
    });
  }
}

start();
