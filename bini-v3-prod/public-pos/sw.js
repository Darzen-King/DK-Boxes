// BINI POS — Service Worker（最小快取殼）
// 注意：每次部署若更新了 index.html / 重要 JS，請更新下方 CACHE 版本字串。
const CACHE = 'bini-pos-v0.1.0-20260605';

const ASSETS = [
  './',
  './index.html',
  './css/pos.css',
  './js/app.js',
  './js/auth.js',
  './js/store.js',
  './js/i18n.js',
  './js/permissions.js',
  './js/firebase-config.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// 網路優先（POS 需要最新資料）；離線時退回快取
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  // 不快取 Firebase / gstatic 動態請求
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  e.respondWith(
    fetch(req)
      .then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(req).then(r => r || caches.match('./index.html')))
  );
});
