// BINI Blooms Service Worker v2.1.16-20260602
// 此 SW 僅負責快取，推播完全由 firebase-messaging-sw.js 處理

const CACHE = 'bini-v2.1.16-20260602';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  if (/firebase|googleapis|gstatic/.test(e.request.url)) return;
  e.respondWith(caches.match(e.request).then(c => c || fetch(e.request)));
});
