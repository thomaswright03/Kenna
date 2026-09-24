// Offline support for the installable app.
//
// Requests are network-first: whenever the phone is online it gets the
// latest deployed files (and refreshes the cached copy), and when it's
// offline it falls back to that cached copy. On a weak signal the network
// gets NETWORK_WAIT_MS to answer; after that the cached copy is used, the
// rest of that page load comes from the cache too (so the files match), and
// the network answer, when it arrives, still refreshes the cache for the
// next launch.
//
// Bump CACHE_NAME in the same change as any edit to the files below. A
// changed sw.js is what makes browsers install the new worker, which
// pre-caches the whole new set together, so a phone that goes offline right
// after an update still has matching files. A test checks every listed file
// exists.
const CACHE_NAME = 'kenna-v26';

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
  './ui/photo-image.js',
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

const NETWORK_WAIT_MS = 3000;

/** Pages (by client id) being loaded from the cache because the network was slow. */
const slowClients = new Set();

/** @param {Request} request */
const cachedCopy = (request) => caches.match(request, { ignoreSearch: true });

/**
 * @param {Request} request
 * @param {Promise<Response>} fromNetwork
 * @param {string} clientId
 */
async function respond(request, fromNetwork, clientId) {
  if (clientId && slowClients.has(clientId)) {
    const hit = await cachedCopy(request);
    if (hit) return hit;
    return fromNetwork.catch(() => Response.error());
  }
  /** @type {Promise<'slow'>} */
  const slow = new Promise((resolve) => setTimeout(() => resolve('slow'), NETWORK_WAIT_MS));
  let first;
  try {
    first = await Promise.race([fromNetwork, slow]);
  } catch {
    // Offline.
    return (await cachedCopy(request)) || Response.error();
  }
  if (first !== 'slow') return first;
  const hit = await cachedCopy(request);
  if (!hit) return fromNetwork.catch(() => Response.error());
  if (clientId) slowClients.add(clientId);
  return hit;
}

sw.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== sw.location.origin) return;

  /** @type {Promise<unknown>} */
  let stored = Promise.resolve();
  const fromNetwork = fetch(request).then((response) => {
    if (response.ok) {
      const copy = response.clone();
      stored = caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
    }
    return response;
  });
  // The cache is refreshed even when the cached copy answered first.
  event.waitUntil(fromNetwork.then(() => stored).catch(() => undefined));
  event.respondWith(respond(request, fromNetwork, event.resultingClientId || event.clientId));
});
