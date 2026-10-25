/* Carwash POS service worker — only registered on localhost.
   Cache name is derived from version.json so every release gets a fresh cache. */
const CORE = [
  './',
  './index.html',
  './manifest.json',
  './version.json',
  './CHANGELOG.md',
  './css/style.css',
  './css/print.css',
  './js/app.js',
  './js/db.js',
  './js/ui.js',
  './js/version.js',
  './js/auth.js',
  './js/cashier.js',
  './js/cart.js',
  './js/plate.js',
  './js/print.js',
  './js/escpos.js',
  './js/invoices.js',
  './js/reports.js',
  './js/expenses.js',
  './js/customers.js',
  './js/settings.js',
  './js/backup.js',
  './js/notifications.js',
  './js/updater.js',
  './data/seed.json',
  './lib/dexie.mjs',
  './lib/qrcode.js',
  './lib/fonts/cairo-arabic.woff2',
  './lib/fonts/cairo-latin.woff2',
  './lib/fonts/cairo-latin-ext.woff2',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png'
];

let cacheName = 'carwash-cache-v0.0.0';

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    try {
      const res = await fetch('./version.json', { cache: 'no-store' });
      const json = await res.json();
      if (json && json.version) cacheName = 'carwash-cache-v' + json.version;
    } catch (e) {
      cacheName = 'carwash-cache-v1.0.1';
    }
    const cache = await caches.open(cacheName);
    await cache.addAll(CORE).catch(() => {});
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter((key) => key.startsWith('carwash-cache-') && key !== cacheName)
      .map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith((async () => {
    const cache = await caches.open(cacheName);
    try {
      const fresh = await fetch(req, { cache: 'no-store' });
      if (fresh && fresh.ok) cache.put(req, fresh.clone());
      return fresh;
    } catch (e) {
      const cached = await cache.match(req, { ignoreSearch: true });
      if (cached) return cached;
      if (req.mode === 'navigate') {
        const shell = await cache.match('./index.html');
        if (shell) return shell;
      }
      throw e;
    }
  })());
});
