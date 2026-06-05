// ============================================================================
// BINI POS — Firebase 設定（測試環境：bini-blooms-dev）
// ----------------------------------------------------------------------------
// ⚠️ 重要：本檔目前為「佔位設定」。請到 Firebase Console 取得 bini-blooms-dev
//          專案的 Web App 設定後，替換下方 firebaseConfig 的每個欄位。
//
//   Firebase Console → 專案 bini-blooms-dev → 專案設定(⚙️) → 一般 →
//   你的應用程式 → Web App → SDK 設定與配置 → 「設定」(Config)
//
// 取得後填入即可；在填入「真實設定」之前，POS 會自動以「本機離線模式」
// （localStorage）運作，讓你可以先測試雙語登入、admin/admin、改密碼等流程。
//
// 整套系統（手機版 + POS）先在 bini-blooms-dev 做封閉測試（Close Test），
// 不影響正式專案 bini-blooms。測試完成後再做專案轉移。
// ============================================================================

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getFirestore }  from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { getAuth }       from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import { getStorage }    from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js';

// ── bini-blooms-dev（測試環境）──
// TODO: 用 bini-blooms-dev 的真實設定替換以下佔位值
const firebaseConfig = {
  apiKey:            "REPLACE_WITH_DEV_API_KEY",
  authDomain:        "bini-blooms-dev.firebaseapp.com",
  projectId:         "bini-blooms-dev",
  storageBucket:     "bini-blooms-dev.firebasestorage.app",
  messagingSenderId: "REPLACE_WITH_DEV_SENDER_ID",
  appId:             "REPLACE_WITH_DEV_APP_ID",
};

// 偵測設定是否仍為佔位值；若是，POS 啟用「本機離線模式」(localStorage)，
// 不連線 Firebase，方便在尚未取得 dev 設定前先測試登入/權限流程。
export const isPlaceholderConfig =
  firebaseConfig.apiKey.startsWith("REPLACE_WITH") ||
  firebaseConfig.appId.startsWith("REPLACE_WITH");

export const PROJECT_ID = firebaseConfig.projectId;

let app = null, db = null, auth = null, storage = null;

if (!isPlaceholderConfig) {
  app     = initializeApp(firebaseConfig);
  db      = getFirestore(app);
  auth    = getAuth(app);
  storage = getStorage(app);
}

export { app, db, auth, storage };
