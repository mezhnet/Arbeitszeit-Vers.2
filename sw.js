// Service Worker: speichert alle App-Dateien, damit die App auch offline startet.
// WICHTIG: Nach jeder Änderung an App-Dateien VERSION erhöhen – dann bietet die App das Update an.

const VERSION = '1.1.0';
const PREFIX = 'arbeitszeit-gleitzeit-';
const CACHE = `${PREFIX}${VERSION}`;
const FILES = [
  './',
  './index.html',
  './styles.css',
  './manifest.json',
  './app.js',
  './store.js',
  './db.js',
  './calc.js',
  './time.js',
  './holidays.js',
  './export.js',
  './ui-common.js',
  './ui-today.js',
  './ui-plan.js',
  './ui-history.js',
  './ui-settings.js',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
];

self.addEventListener('install', (event) => {
  // cache: 'reload' umgeht den HTTP-Cache, damit wirklich die neue Version gespeichert wird
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(FILES.map((url) => new Request(url, { cache: 'reload' })))));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Nur eigene alte Caches löschen – andere Apps unter derselben github.io-Adresse bleiben unberührt.
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k.startsWith(PREFIX) && k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
  if (event.data?.type === 'GET_VERSION') event.ports[0]?.postMessage({ version: VERSION });
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      if (req.mode === 'navigate') return (await cache.match('./index.html')) ?? fetch(req);
      return (await cache.match(req, { ignoreSearch: true })) ?? fetch(req);
    })(),
  );
});
