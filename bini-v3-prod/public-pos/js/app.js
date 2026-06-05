// ============================================================================
// BINI POS — 主程式（UI 流程編排）
// 登入 → (首次強制改密碼) → 主畫面（依權限顯示模組）
// ============================================================================

import { t, getLang, setLang, toggleLang } from './i18n.js';
import { OFFLINE } from './store.js';
import {
  ensureSeedAdmin, login, logout, getCurrentUser, changePassword,
  listAccounts, saveAccount, resetAccountPassword, setAccountActive,
} from './auth.js';
import {
  PERMISSIONS, canAccessModule, emptyPermissions,
} from './permissions.js';

// ── DOM 速查 ──
const $ = (id) => document.getElementById(id);
const show = (el) => el.classList.remove('hidden');
const hide = (el) => el.classList.add('hidden');

// 目前登入者（含 _perms / _role）
let CURRENT = null;
let ACTIVE_MODULE = null;

// 模組清單（順序＝導覽列順序）
const MODULES = [
  { id: 'sales',     icon: '🧾', key: 'mod_sales' },
  { id: 'members',   icon: '👤', key: 'mod_members' },
  { id: 'orders',    icon: '📦', key: 'mod_orders' },
  { id: 'inventory', icon: '🏷️', key: 'mod_inventory' },
  { id: 'today',     icon: '📊', key: 'mod_today' },
  { id: 'reports',   icon: '📈', key: 'mod_reports' },
  { id: 'settings',  icon: '⚙️', key: 'mod_settings' },
  { id: 'accounts',  icon: '🔑', key: 'mod_accounts' },
];

// ============================ 啟動 ============================

async function boot() {
  // 註冊 Service Worker（PWA 殼）
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  // 套用語言
  setLang(getLang());

  // 離線測試模式提示
  if (OFFLINE) show($('offlineBanner'));

  // 確保預設 admin/admin 存在
  try { await ensureSeedAdmin(); }
  catch (e) { console.error('seed admin failed', e); }

  wireGlobalEvents();

  // 是否已有 session
  const user = await getCurrentUser();
  if (user) {
    CURRENT = user;
    enterApp();
  } else {
    showLogin();
  }
}

function wireGlobalEvents() {
  // 語言切換（兩處）
  $('langToggle').addEventListener('click', () => { toggleLang(); refreshDynamicText(); });
  $('appLangToggle').addEventListener('click', () => { toggleLang(); refreshDynamicText(); });

  // 登入
  $('loginForm').addEventListener('submit', onLoginSubmit);

  // 改密碼
  $('changePwForm').addEventListener('submit', onChangePwSubmit);
  $('cpCancelBtn').addEventListener('click', closeChangePw);

  // 主畫面
  $('logoutBtn').addEventListener('click', onLogout);
  $('appChangePwBtn').addEventListener('click', () => openChangePw(false));
}

// 切換語言後，補刷新由 JS 產生的動態文字
function refreshDynamicText() {
  if (CURRENT && !$('appView').classList.contains('hidden')) {
    renderUserBadge();
    renderModuleNav();
    if (ACTIVE_MODULE) openModule(ACTIVE_MODULE);
  }
}

// ============================ 登入畫面 ============================

function showLogin() {
  hide($('appView'));
  hide($('changePwView'));
  show($('loginView'));
  $('loginUsername').value = '';
  $('loginPassword').value = '';
  hide($('loginError'));
  $('loginUsername').focus();
}

async function onLoginSubmit(e) {
  e.preventDefault();
  const btn = $('loginBtn');
  const errEl = $('loginError');
  hide(errEl);

  const username = $('loginUsername').value;
  const password = $('loginPassword').value;

  btn.disabled = true;
  const prev = btn.textContent;
  btn.textContent = t('loggingIn');

  try {
    const res = await login(username, password);
    if (!res.ok) {
      const map = { empty: 'loginErrorEmpty', invalid: 'loginErrorInvalid', disabled: 'loginErrorDisabled' };
      errEl.textContent = t(map[res.code] || 'loginErrorInvalid');
      show(errEl);
      return;
    }
    CURRENT = await getCurrentUser();
    if (CURRENT && CURRENT.mustChangePassword) {
      openChangePw(true);
    } else {
      enterApp();
    }
  } catch (err) {
    console.error(err);
    errEl.textContent = t('loginErrorInvalid');
    show(errEl);
  } finally {
    btn.disabled = false;
    btn.textContent = prev;
  }
}

function onLogout() {
  logout();
  CURRENT = null;
  ACTIVE_MODULE = null;
  showLogin();
}

// ============================ 變更密碼 ============================

let changePwForced = false;

function openChangePw(forced) {
  changePwForced = forced;
  hide($('loginView'));
  hide($('appView'));
  show($('changePwView'));
  $('cpCurrent').value = '';
  $('cpNew').value = '';
  $('cpConfirm').value = '';
  hide($('cpError'));
  hide($('cpSuccess'));
  // 強制模式：隱藏取消、顯示提示；主動模式：相反
  if (forced) { show($('changePwForcedMsg')); hide($('cpCancelBtn')); }
  else { hide($('changePwForcedMsg')); show($('cpCancelBtn')); }
  $('cpCurrent').focus();
}

function closeChangePw() {
  if (changePwForced) return; // 強制時不可取消
  if (CURRENT) enterApp(); else showLogin();
}

async function onChangePwSubmit(e) {
  e.preventDefault();
  const errEl = $('cpError');
  const okEl = $('cpSuccess');
  hide(errEl); hide(okEl);

  if (!CURRENT) { showLogin(); return; }

  const res = await changePassword(
    CURRENT.username,
    $('cpCurrent').value,
    $('cpNew').value,
    $('cpConfirm').value,
  );

  if (!res.ok) {
    const map = {
      tooShort: 'pwTooShort', mismatch: 'pwMismatch',
      sameAsOld: 'pwSameAsOld', currentWrong: 'pwCurrentWrong',
    };
    errEl.textContent = t(map[res.code] || 'pwCurrentWrong');
    show(errEl);
    return;
  }

  show(okEl);
  CURRENT = await getCurrentUser();
  setTimeout(() => {
    changePwForced = false;
    enterApp();
  }, 800);
}

// ============================ 主畫面 ============================

function enterApp() {
  hide($('loginView'));
  hide($('changePwView'));
  show($('appView'));
  renderUserBadge();
  renderModuleNav();
  // 預設開啟第一個可進入的模組
  const first = MODULES.find(m => canAccessModule(m.id, CURRENT, CURRENT._perms));
  openModule(first ? first.id : 'sales');
}

function renderUserBadge() {
  const roleLabel = CURRENT.isSuperAdmin
    ? t('superAdmin')
    : (CURRENT._role && CURRENT._role.name) || '—';
  $('userBadge').innerHTML =
    `<strong>${escapeHtml(CURRENT.displayName || CURRENT.username)}</strong>` +
    `<span class="role-chip">${escapeHtml(roleLabel)}</span>`;
}

function renderModuleNav() {
  const nav = $('moduleNav');
  nav.innerHTML = '';
  for (const m of MODULES) {
    if (!canAccessModule(m.id, CURRENT, CURRENT._perms)) continue;
    const btn = document.createElement('button');
    btn.className = 'nav-item' + (m.id === ACTIVE_MODULE ? ' active' : '');
    btn.dataset.module = m.id;
    btn.innerHTML = `<span class="nav-icon">${m.icon}</span><span class="nav-label">${escapeHtml(t(m.key))}</span>`;
    btn.addEventListener('click', () => openModule(m.id));
    nav.appendChild(btn);
  }
}

function openModule(moduleId) {
  if (!canAccessModule(moduleId, CURRENT, CURRENT._perms)) {
    renderNoPermission();
    return;
  }
  ACTIVE_MODULE = moduleId;
  // 高亮
  document.querySelectorAll('.nav-item').forEach(b =>
    b.classList.toggle('active', b.dataset.module === moduleId));

  if (moduleId === 'accounts') return renderAccounts();
  return renderComingSoon(moduleId);
}

function renderNoPermission() {
  $('moduleContent').innerHTML = `
    <div class="placeholder">
      <div class="placeholder-icon">🔒</div>
      <h2>${escapeHtml(t('noPermissionTitle'))}</h2>
      <p class="muted">${escapeHtml(t('noPermissionDesc'))}</p>
    </div>`;
}

// 尚未開發的模組（A~H 後續版本逐步補上）
function renderComingSoon(moduleId) {
  const mod = MODULES.find(m => m.id === moduleId);
  $('moduleContent').innerHTML = `
    <div class="placeholder">
      <div class="placeholder-icon">${mod ? mod.icon : '🛠️'}</div>
      <h2>${escapeHtml(t(mod ? mod.key : 'moduleComingSoon'))}</h2>
      <p class="muted">${escapeHtml(t('moduleComingSoonDesc'))}</p>
    </div>`;
}

// ============================ 帳號權限管理（超管） ============================

async function renderAccounts() {
  const content = $('moduleContent');
  content.innerHTML = `
    <div class="module-head">
      <div>
        <h2>${escapeHtml(t('accountsTitle'))}</h2>
        <p class="muted">${escapeHtml(t('accountsDesc'))}</p>
      </div>
      <button id="addAccountBtn" class="btn-primary">${escapeHtml(t('addAccount'))}</button>
    </div>
    <div id="accountTableWrap" class="table-wrap"><p class="muted">${escapeHtml(t('loading'))}</p></div>
    <div id="accountFormWrap"></div>
  `;
  $('addAccountBtn').addEventListener('click', () => showAccountForm(null));
  await refreshAccountTable();
}

async function refreshAccountTable() {
  const accounts = await listAccounts();
  const wrap = $('accountTableWrap');
  const rows = accounts.map(a => {
    const permLabel = a.isSuperAdmin
      ? `<span class="role-chip super">${escapeHtml(t('superAdmin'))}</span>`
      : PERMISSIONS.filter(p => a.customPermissions && a.customPermissions[p])
          .map(p => `<span class="perm-chip">${escapeHtml(t('perm_' + p))}</span>`).join(' ') || '<span class="muted">—</span>';
    const statusLabel = a.active === false
      ? `<span class="status-chip off">${escapeHtml(t('statusDisabled'))}</span>`
      : `<span class="status-chip on">${escapeHtml(t('statusActive'))}</span>`;
    const toggleLabel = a.active === false ? t('enable') : t('disable');
    return `
      <tr>
        <td><strong>${escapeHtml(a.username)}</strong></td>
        <td>${escapeHtml(a.displayName || '')}</td>
        <td>${permLabel}</td>
        <td>${statusLabel}</td>
        <td class="row-actions">
          <button class="btn-mini" data-act="edit" data-u="${escapeHtml(a.username)}">${escapeHtml(t('edit'))}</button>
          <button class="btn-mini" data-act="reset" data-u="${escapeHtml(a.username)}">${escapeHtml(t('resetPw'))}</button>
          <button class="btn-mini" data-act="toggle" data-u="${escapeHtml(a.username)}">${escapeHtml(toggleLabel)}</button>
        </td>
      </tr>`;
  }).join('');

  wrap.innerHTML = `
    <table class="data-table">
      <thead>
        <tr>
          <th>${escapeHtml(t('username'))}</th>
          <th>${escapeHtml(t('displayName'))}</th>
          <th>${escapeHtml(t('permissions'))}</th>
          <th>${escapeHtml(t('status'))}</th>
          <th>${escapeHtml(t('actions'))}</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;

  wrap.querySelectorAll('button[data-act]').forEach(btn => {
    const u = btn.dataset.u;
    const act = btn.dataset.act;
    btn.addEventListener('click', () => {
      if (act === 'edit') return editAccount(u);
      if (act === 'reset') return resetAccount(u);
      if (act === 'toggle') return toggleAccount(u);
    });
  });
}

async function editAccount(username) {
  const accounts = await listAccounts();
  showAccountForm(accounts.find(a => a.username === username) || null);
}

function showAccountForm(account) {
  const isEdit = !!account;
  const perms = (account && account.customPermissions) || emptyPermissions();
  const permRows = PERMISSIONS.map(p => `
    <label class="perm-row">
      <input type="checkbox" data-perm="${p}" ${perms[p] ? 'checked' : ''}>
      <span class="perm-name">${escapeHtml(t('perm_' + p))}</span>
      <span class="perm-desc muted">${escapeHtml(t('perm_' + p + '_desc'))}</span>
    </label>`).join('');

  $('accountFormWrap').innerHTML = `
    <div class="card form-card">
      <h3>${escapeHtml(isEdit ? t('editAccountTitle') : t('newAccountTitle'))}</h3>
      <div class="form-grid">
        <label class="field">
          <span>${escapeHtml(t('username'))}</span>
          <input id="afUsername" type="text" value="${escapeHtml(account ? account.username : '')}" ${isEdit ? 'disabled' : ''}>
        </label>
        <label class="field">
          <span>${escapeHtml(t('displayName'))}</span>
          <input id="afDisplay" type="text" value="${escapeHtml(account ? (account.displayName || '') : '')}">
        </label>
        <label class="field">
          <span>${escapeHtml(isEdit ? t('resetPw') : t('initialPassword'))}</span>
          <input id="afPassword" type="text" placeholder="${isEdit ? '••••（留空不變）' : ''}">
        </label>
      </div>

      <label class="check-row">
        <input id="afSuper" type="checkbox" ${account && account.isSuperAdmin ? 'checked' : ''}>
        <span>${escapeHtml(t('isSuperAdmin'))}</span>
      </label>

      <div id="afPermBlock" class="perm-block ${account && account.isSuperAdmin ? 'hidden' : ''}">
        <p class="muted">${escapeHtml(t('permissions'))}</p>
        ${permRows}
      </div>

      <label class="check-row">
        <input id="afMustChange" type="checkbox" ${!account || account.mustChangePassword !== false ? 'checked' : ''}>
        <span>${escapeHtml(t('mustChangeOnFirst'))}</span>
      </label>

      <div id="afError" class="form-error hidden"></div>
      <div class="modal-actions">
        <button id="afCancel" class="btn-ghost">${escapeHtml(t('cancel'))}</button>
        <button id="afSave" class="btn-primary">${escapeHtml(t('save'))}</button>
      </div>
    </div>`;

  const superBox = $('afSuper');
  superBox.addEventListener('change', () => {
    $('afPermBlock').classList.toggle('hidden', superBox.checked);
  });
  $('afCancel').addEventListener('click', () => { $('accountFormWrap').innerHTML = ''; });
  $('afSave').addEventListener('click', () => submitAccountForm(isEdit));
  $('afUsername').focus();
}

async function submitAccountForm(isEdit) {
  const errEl = $('afError');
  hide(errEl);

  const customPermissions = emptyPermissions();
  document.querySelectorAll('#afPermBlock input[data-perm]').forEach(cb => {
    customPermissions[cb.dataset.perm] = cb.checked;
  });

  const opts = {
    username: $('afUsername').value,
    displayName: $('afDisplay').value,
    password: $('afPassword').value || null,
    isSuperAdmin: $('afSuper').checked,
    customPermissions,
    mustChangePassword: $('afMustChange').checked,
    active: true,
  };

  if (!opts.username.trim()) {
    errEl.textContent = t('loginErrorEmpty'); show(errEl); return;
  }
  if (!isEdit) {
    const accounts = await listAccounts();
    if (accounts.some(a => a.username === opts.username.trim())) {
      errEl.textContent = t('accountExists'); show(errEl); return;
    }
    if (!opts.password) {
      errEl.textContent = t('pwTooShort'); show(errEl); return;
    }
  }

  const res = await saveAccount(opts);
  if (!res.ok) {
    errEl.textContent = res.code === 'noPassword' ? t('pwTooShort') : t('accountExists');
    show(errEl); return;
  }
  $('accountFormWrap').innerHTML = '';
  await refreshAccountTable();
}

async function resetAccount(username) {
  const newPw = prompt(t('resetPw') + ' — ' + username + '\n' + t('newPassword') + ':');
  if (!newPw) return;
  if (newPw.length < 4) { alert(t('pwTooShort')); return; }
  await resetAccountPassword(username, newPw);
  alert(t('pwChanged'));
}

async function toggleAccount(username) {
  const accounts = await listAccounts();
  const target = accounts.find(a => a.username === username);
  if (!target) return;
  const nextActive = target.active === false; // 反轉
  const res = await setAccountActive(username, nextActive, CURRENT.username);
  if (!res.ok) {
    alert(res.code === 'self' ? t('cannotDisableSelf') : t('cannotDisableLastAdmin'));
    return;
  }
  await refreshAccountTable();
}

// ============================ 工具 ============================

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// 啟動
boot();
