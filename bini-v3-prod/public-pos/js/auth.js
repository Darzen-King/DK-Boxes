// ============================================================================
// BINI POS — 認證與帳號管理
// ----------------------------------------------------------------------------
// • 預設管理員 admin / admin（首次登入強制改密碼）
// • 密碼以 SHA-256 + 隨機 salt 雜湊後儲存（不存明碼）
// • 權限由軟體內部設定（見 permissions.js 的 6 項）
// • Session 存於 sessionStorage，重新整理可保留登入狀態（測試方便）
// ============================================================================

import { getUser, getAllUsers, setUser, updateUser, getRole } from './store.js';
import { resolvePermissions, fullPermissions, emptyPermissions, PERMISSIONS } from './permissions.js';

const SESSION_KEY = 'bini_pos_session';

// ── 密碼雜湊 ──
function genSalt() {
  const a = new Uint8Array(16);
  crypto.getRandomValues(a);
  return [...a].map(b => b.toString(16).padStart(2, '0')).join('');
}

async function hashPassword(password, salt) {
  const data = new TextEncoder().encode(salt + ':' + password);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

async function makeCredential(password) {
  const salt = genSalt();
  const passwordHash = await hashPassword(password, salt);
  return { salt, passwordHash };
}

async function verifyPassword(user, password) {
  if (!user || !user.salt || !user.passwordHash) return false;
  const h = await hashPassword(password, user.salt);
  return h === user.passwordHash;
}

// ── 預設 admin 種子 ──
// 首次啟動若無任何帳號，自動建立 admin / admin（超級管理員，強制改密碼）
export async function ensureSeedAdmin() {
  const existing = await getUser('admin');
  if (existing) return;
  const all = await getAllUsers();
  if (all.length > 0) return; // 已有其他帳號，不重建
  const cred = await makeCredential('admin');
  await setUser('admin', {
    username: 'admin',
    displayName: 'Administrator',
    ...cred,
    isSuperAdmin: true,
    roleId: null,
    customPermissions: fullPermissions(),
    active: true,
    mustChangePassword: true,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
}

// ============================ 登入 / 登出 ============================

// 回傳：{ ok, code?, user? }
//   code: 'empty' | 'invalid' | 'disabled'
export async function login(username, password) {
  username = (username || '').trim();
  if (!username || !password) return { ok: false, code: 'empty' };

  const user = await getUser(username);
  if (!user) return { ok: false, code: 'invalid' };
  if (user.active === false) return { ok: false, code: 'disabled' };

  const ok = await verifyPassword(user, password);
  if (!ok) return { ok: false, code: 'invalid' };

  saveSession(username);
  return { ok: true, user };
}

export function logout() {
  sessionStorage.removeItem(SESSION_KEY);
}

function saveSession(username) {
  sessionStorage.setItem(SESSION_KEY, JSON.stringify({ username, at: Date.now() }));
}

export function getSessionUsername() {
  try {
    const s = JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null');
    return s && s.username ? s.username : null;
  } catch { return null; }
}

// 取得目前登入者（含有效權限）；未登入回 null
export async function getCurrentUser() {
  const username = getSessionUsername();
  if (!username) return null;
  const user = await getUser(username);
  if (!user || user.active === false) { logout(); return null; }
  const role = user.roleId ? await getRole(user.roleId) : null;
  const perms = resolvePermissions(user, role);
  return { ...user, _role: role, _perms: perms };
}

// ============================ 變更密碼 ============================

// 回傳：{ ok, code? }
//   code: 'tooShort' | 'mismatch' | 'sameAsOld' | 'currentWrong'
export async function changePassword(username, currentPw, newPw, confirmPw) {
  const user = await getUser(username);
  if (!user) return { ok: false, code: 'currentWrong' };

  const currentOk = await verifyPassword(user, currentPw);
  if (!currentOk) return { ok: false, code: 'currentWrong' };

  if (!newPw || newPw.length < 4) return { ok: false, code: 'tooShort' };
  if (newPw !== confirmPw) return { ok: false, code: 'mismatch' };
  if (newPw === currentPw) return { ok: false, code: 'sameAsOld' };

  const cred = await makeCredential(newPw);
  await updateUser(username, {
    ...cred,
    mustChangePassword: false,
    updatedAt: Date.now(),
  });
  return { ok: true };
}

// ============================ 帳號管理（超級管理員） ============================

export async function listAccounts() {
  const users = await getAllUsers();
  return users.sort((a, b) => (a.username || '').localeCompare(b.username || ''));
}

// 建立 / 更新帳號
//   opts: { username, displayName, password?, isSuperAdmin, customPermissions,
//           roleId, active, mustChangePassword }
//   password 有值時才重設密碼（編輯時可留空保留原密碼）
export async function saveAccount(opts) {
  const username = (opts.username || '').trim();
  if (!username) return { ok: false, code: 'empty' };

  const existing = await getUser(username);
  const record = {
    username,
    displayName: opts.displayName || username,
    isSuperAdmin: !!opts.isSuperAdmin,
    roleId: opts.roleId || null,
    customPermissions: normalizePerms(opts.customPermissions),
    active: opts.active !== false,
    mustChangePassword: opts.mustChangePassword !== false,
    createdAt: existing ? existing.createdAt : Date.now(),
    updatedAt: Date.now(),
  };

  if (opts.password) {
    Object.assign(record, await makeCredential(opts.password));
  } else if (existing) {
    record.salt = existing.salt;
    record.passwordHash = existing.passwordHash;
  } else {
    return { ok: false, code: 'noPassword' };
  }

  await setUser(username, record);
  return { ok: true, isNew: !existing };
}

// 重設某帳號密碼（要求對方下次登入改密碼）
export async function resetAccountPassword(username, newPassword) {
  const cred = await makeCredential(newPassword);
  await updateUser(username, { ...cred, mustChangePassword: true, updatedAt: Date.now() });
  return { ok: true };
}

// 啟用 / 停用帳號（含「不可停用最後一位超管 / 不可停用自己」防護）
export async function setAccountActive(username, active, actingUsername) {
  if (!active) {
    if (username === actingUsername) return { ok: false, code: 'self' };
    const users = await getAllUsers();
    const target = users.find(u => u.username === username);
    if (target && target.isSuperAdmin) {
      const activeSupers = users.filter(u => u.isSuperAdmin && u.active !== false);
      if (activeSupers.length <= 1) return { ok: false, code: 'lastAdmin' };
    }
  }
  await updateUser(username, { active, updatedAt: Date.now() });
  return { ok: true };
}

function normalizePerms(p) {
  const out = emptyPermissions();
  if (p) for (const k of PERMISSIONS) out[k] = !!p[k];
  return out;
}
