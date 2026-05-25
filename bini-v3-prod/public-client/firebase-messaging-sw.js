// BINI Blooms FCM Service Worker v3.0.44-PROD-prod

importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');

// ⚠️ 必須與 firebase-config.js 的 bini-blooms 設定一致
firebase.initializeApp({
  apiKey:            "AIzaSyB1hpvHwZA6kBgPzwq2jfylsAllq1_RUxI",
  authDomain:        "bini-blooms.firebaseapp.com",
  projectId:         "bini-blooms",
  storageBucket:     "bini-blooms.firebasestorage.app",
  messagingSenderId: "870226740523",
  appId:             "1:870226740523:web:b1c8fa3d074eb0cfb7b16e"
});

const messaging = firebase.messaging();

// 去重：500ms 內不重複顯示同 tag 通知
const recentTags = new Map();
function showBiniNotification(title, body, url, tag) {
  const now = Date.now();
  if (recentTags.has(tag) && now - recentTags.get(tag) < 500) return Promise.resolve();
  recentTags.set(tag, now);
  for (const [k, t] of recentTags) { if (now - t > 2000) recentTags.delete(k); }
  return self.registration.showNotification(title, {
    body, icon: '/icons/icon-192.png', badge: '/icons/icon-192.png',
    tag, renotify: true, data: { url: url || '/' },
  });
}

messaging.onBackgroundMessage(payload => {
  const n = payload.notification || {};
  const d = payload.data || {};
  const title = n.title || d.title || 'BINI Blooms';
  const body  = n.body  || d.body  || '';
  const url   = d.url   || '/';
  const tag   = `bini-${d.type || 'general'}`;
  return showBiniNotification(title, body, url, tag);
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = e.notification.data?.url || '/';
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(ws => {
      // 找已開啟的 PWA 視窗
      for (const w of ws) {
        if (w.url.includes(self.location.origin) && 'focus' in w) {
          // 若有 hash（如 /#announce），用 postMessage 通知 app.js 切換頁面
          const hash = url.includes('#') ? url.split('#')[1] : null;
          if (hash) w.postMessage({ type: 'navigate', page: hash });
          else if (w.navigate) w.navigate(url);
          return w.focus();
        }
      }
      return clients.openWindow(url);
    })
  );
});

const CACHE = 'bini-v3.0.44-PROD-prod';
self.addEventListener('install', e => { e.waitUntil(self.skipWaiting()); });
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  if (/firebase|googleapis|gstatic/.test(e.request.url)) return;
  e.respondWith(caches.match(e.request).then(c => c || fetch(e.request)));
});
