// ============================================================================
// BINI POS — 權限框架（定案 6 項，對應總整合藍圖 §4）
// ----------------------------------------------------------------------------
//   inventory       庫存操作（改數量、進貨、出貨、盤點、上下架、分類管理）
//   cost            成本查看（成本價、獲利、毛利、進價）★與 inventory 分離
//   member_manage   會員管理（編輯、刪除、點數調整、改等級）
//   settings        系統設定（集點規則、購物規則、快捷鍵）
//   reports         報表查看（今日銷售進入、分析報表進入）
//   order_discount  整單折扣
//
// 雙重驗證：前端依權限隱藏/禁用 UI；後端 Cloud Function 開頭再 checkPermission。
// 超級管理員 (isSuperAdmin) 永遠全權。
// ============================================================================

export const PERMISSIONS = [
  'inventory',
  'cost',
  'member_manage',
  'settings',
  'reports',
  'order_discount',
];

// 空白權限樣板
export function emptyPermissions() {
  return PERMISSIONS.reduce((o, p) => (o[p] = false, o), {});
}

// 全開權限樣板
export function fullPermissions() {
  return PERMISSIONS.reduce((o, p) => (o[p] = true, o), {});
}

// 解析某使用者的「有效權限」集合：
//   超級管理員 → 全部 true
//   有角色     → 用 role.permissions
//   無角色     → 用 user.customPermissions
export function resolvePermissions(user, role) {
  if (!user) return emptyPermissions();
  if (user.isSuperAdmin) return fullPermissions();
  const base = emptyPermissions();
  const src = (role && role.permissions) || user.customPermissions || {};
  for (const p of PERMISSIONS) base[p] = !!src[p];
  return base;
}

// 模組進入所需權限（對應藍圖 §4 權限規則總表）
//   value 可為：
//     null            → 登入即可
//     'perm'          → 需單一權限
//     ['a','b']       → 需同時具備（AND）
//     'super'         → 僅超級管理員
export const MODULE_ACCESS = {
  sales:     null,                       // A 基本收銀：登入即可
  members:   'member_manage',            // B 會員管理
  orders:    null,                       // C 網購訂單：登入即可（出貨等）
  inventory: 'inventory',                // D 庫存操作
  today:     'reports',                  // E 今日銷售（獲利數字另需 cost）
  reports:   ['reports', 'cost'],        // F 分析報表：整頁需 reports + cost
  settings:  'settings',                 // 系統設定
  accounts:  'super',                    // 帳號權限：僅超級管理員
};

// 判斷使用者是否可進入某模組
export function canAccessModule(moduleId, user, perms) {
  const req = MODULE_ACCESS[moduleId];
  if (req == null) return true;                 // 登入即可
  if (user && user.isSuperAdmin) return true;   // 超管全權
  if (req === 'super') return !!(user && user.isSuperAdmin);
  if (Array.isArray(req)) return req.every(p => perms[p]);
  return !!perms[req];
}

// 單一權限檢查
export function hasPermission(perms, name) {
  return !!(perms && perms[name]);
}
