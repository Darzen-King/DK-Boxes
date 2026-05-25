// BINI Blooms Admin FCM Service Worker v3.0.44-PROD-prod

importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey:            "AIzaSyBW_ofsSXtFw736LEC-TtBxNLiMmsjrmhE",
  authDomain:        "bini-blooms.firebaseapp.com",
  projectId:         "bini-blooms",
  storageBucket:     "bini-blooms.firebasestorage.app",
  messagingSenderId: "870226740523",
  appId:             "1:870226740523:web:99e847fc4133d13ab7b16e"
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage(payload => {
  const n = payload.notification || {};
  const d = payload.data || {};
  const title = n.title || d.title || 'BINI Backend';
  const body  = n.body  || d.body  || '';
  return self.registration.showNotification(title, {
    body, icon: '/shop-icon.png', badge: '/shop-icon.png',
    tag: `admin-${d.type || 'general'}`, renotify: true,
    data: { url: d.url || '/' },
  });
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(clients.openWindow(e.notification.data?.url || '/'));
});

const CACHE = 'bini-admin-v3.0.44-PROD-prod';
self.addEventListener('install', e => { e.waitUntil(self.skipWaiting()); });
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});
