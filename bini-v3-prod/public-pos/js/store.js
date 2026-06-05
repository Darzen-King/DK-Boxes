// ============================================================================
// BINI POS — 資料存取層（Data Store）
// ----------------------------------------------------------------------------
// 抽象化「POS 帳號」的讀寫，讓上層 (auth.js) 不需關心後端：
//   • 已設定 bini-blooms-dev → 走 Firestore（collection: pos_users / pos_roles）
//   • 尚未設定（佔位設定）   → 走 localStorage「離線測試模式」
//
// 之後填入 dev 設定即可無痛切換到 Firestore；待整套封閉測試完成，
// 再做專案轉移到正式版 bini-blooms。
// ============================================================================

import { db, auth, isPlaceholderConfig } from './firebase-config.js';

const LOCAL_USERS_KEY = 'bini_pos_users';
const LOCAL_ROLES_KEY = 'bini_pos_roles';

// 是否使用離線（localStorage）模式
export const OFFLINE = isPlaceholderConfig;

// Firestore SDK（僅線上模式才載入使用）
let fs = null;
async function ensureFirestore() {
  if (fs) return fs;
  fs = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');
  return fs;
}

// 線上模式：確保已（匿名）登入 Firebase，Firestore 規則才放行
let authReady = null;
async function ensureAuth() {
  if (OFFLINE) return;
  if (authReady) return authReady;
  authReady = (async () => {
    try {
      const a = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js');
      if (!auth.currentUser) await a.signInAnonymously(auth);
    } catch (e) {
      // 匿名登入未啟用或失敗時，仍嘗試後續操作（依 dev 規則而定）
      console.warn('[store] anonymous auth unavailable:', e && e.code);
    }
  })();
  return authReady;
}

// ── localStorage 工具 ──
function lsRead(key) {
  try { return JSON.parse(localStorage.getItem(key) || '{}'); }
  catch { return {}; }
}
function lsWrite(key, obj) {
  localStorage.setItem(key, JSON.stringify(obj));
}

// ============================ 帳號 (pos_users) ============================

export async function getUser(username) {
  if (OFFLINE) {
    const users = lsRead(LOCAL_USERS_KEY);
    return users[username] || null;
  }
  await ensureAuth();
  const f = await ensureFirestore();
  const snap = await f.getDoc(f.doc(db, 'pos_users', username));
  return snap.exists() ? snap.data() : null;
}

export async function getAllUsers() {
  if (OFFLINE) {
    const users = lsRead(LOCAL_USERS_KEY);
    return Object.values(users);
  }
  await ensureAuth();
  const f = await ensureFirestore();
  const snap = await f.getDocs(f.collection(db, 'pos_users'));
  return snap.docs.map(d => d.data());
}

export async function setUser(username, data) {
  const record = { ...data, username };
  if (OFFLINE) {
    const users = lsRead(LOCAL_USERS_KEY);
    users[username] = record;
    lsWrite(LOCAL_USERS_KEY, users);
    return record;
  }
  await ensureAuth();
  const f = await ensureFirestore();
  await f.setDoc(f.doc(db, 'pos_users', username), record, { merge: true });
  return record;
}

export async function updateUser(username, partial) {
  const existing = (await getUser(username)) || { username };
  return setUser(username, { ...existing, ...partial });
}

// ============================ 角色 (pos_roles) ============================

export async function getAllRoles() {
  if (OFFLINE) {
    const roles = lsRead(LOCAL_ROLES_KEY);
    return Object.values(roles);
  }
  await ensureAuth();
  const f = await ensureFirestore();
  const snap = await f.getDocs(f.collection(db, 'pos_roles'));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function getRole(roleId) {
  if (!roleId) return null;
  if (OFFLINE) {
    const roles = lsRead(LOCAL_ROLES_KEY);
    return roles[roleId] || null;
  }
  await ensureAuth();
  const f = await ensureFirestore();
  const snap = await f.getDoc(f.doc(db, 'pos_roles', roleId));
  return snap.exists() ? { id: roleId, ...snap.data() } : null;
}

export async function setRole(roleId, data) {
  if (OFFLINE) {
    const roles = lsRead(LOCAL_ROLES_KEY);
    roles[roleId] = { id: roleId, ...data };
    lsWrite(LOCAL_ROLES_KEY, roles);
    return roles[roleId];
  }
  await ensureAuth();
  const f = await ensureFirestore();
  await f.setDoc(f.doc(db, 'pos_roles', roleId), data, { merge: true });
  return { id: roleId, ...data };
}
