// Offline support for the installable app.
//
// Requests are network-first: whenever the phone is online it gets the
// latest deployed files (and refreshes the cached copy), and when it's
// offline it falls back to that cached copy.
//
// Bump CACHE_NAME in the same change as any edit to the files below. A
// changed sw.js is what makes browsers install the new worker, which
// pre-caches the whole new set together, so a phone that goes offline right
// after an update still has matching files. A test checks every listed file
// exists.
const CACHE_NAME = 'kenna-v8';

const APP_SHELL = [
  './',
  './index.html',
  './backend.js',
  './core.js',
  './store-local.js',
  './store-server.js',
  './backup-file.js',
  './app.js',
  './ui/backup-reminder.js',
  './ui/backup.js',
  './ui/charts.js',
  './ui/day.js',
  './ui/dom.js',
  './ui/drafts.js',
  './ui/feedback.js',
  './ui/render.js',
  './ui/router.js',
  './ui/screen-compare.js',
  './ui/screen-history.js',
  './ui/screen-log.js',
  './ui/screen-photos.js',
  './ui/screen-settings.js',
  './ui/screen-today.js',
  './ui/store.js',
  './ui/theme.js',
  './style.css',
  './manifest.webmanifest',
  './favicon.svg',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

const sw = /** @type {ServiceWorkerGlobalScope} */ (/** @type {unknown} */ (self));

sw.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  sw.skipWaiting();
});

sw.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => sw.clients.claim())
  );
});

sw.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== sw.location.origin) return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(() => caches.match(request, { ignoreSearch: true }).then((cached) => cached || Response.error()))
  );
});
