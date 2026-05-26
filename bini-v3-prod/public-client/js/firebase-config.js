import { initializeApp }  from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getFirestore }   from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { getAuth }        from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import { getStorage }     from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js';
import { getMessaging }   from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging.js';

// bini-blooms（正式環境 - Client）
const app = initializeApp({
  apiKey:            "AIzaSyB1hpvHwZA6kBgPzwq2jfylsAllq1_RUxI",
  authDomain:        "bini-blooms.firebaseapp.com",
  projectId:         "bini-blooms",
  storageBucket:     "bini-blooms.firebasestorage.app",
  messagingSenderId: "870226740523",
  appId:             "1:870226740523:web:b1c8fa3d074eb0cfb7b16e",
  measurementId:     "G-EFHF0WRY98"
});

export const db        = getFirestore(app);
export const auth      = getAuth(app);
export const storage   = getStorage(app);
export let   messaging = null;
try { messaging = getMessaging(app); } catch(e) { /* iOS Safari 不支援 */ }
