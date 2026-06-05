// ============================================================================
// BINI POS — 雙語系 (繁體中文 / English)
// 登入畫面可切換語言；選擇會記在 localStorage，全 App 共用。
// ============================================================================

const STRINGS = {
  zh: {
    // ── 通用 ──
    appName: 'BINI POS',
    appSubtitle: '門市銷售系統',
    confirm: '確認',
    cancel: '取消',
    save: '儲存',
    close: '關閉',
    loading: '載入中…',
    logout: '登出',
    langName: '中文',

    // ── 登入畫面 ──
    loginTitle: '登入',
    username: '帳號',
    password: '密碼',
    usernamePlaceholder: '請輸入帳號',
    passwordPlaceholder: '請輸入密碼',
    loginBtn: '登入',
    loggingIn: '登入中…',
    loginErrorEmpty: '請輸入帳號與密碼',
    loginErrorInvalid: '帳號或密碼錯誤',
    loginErrorDisabled: '此帳號已被停用',
    defaultAdminHint: '預設管理員帳號：admin / admin（首次登入後請立即變更密碼）',

    // ── 強制改密碼 ──
    changePwTitle: '變更密碼',
    changePwForced: '為了帳號安全，首次登入請設定新密碼',
    currentPassword: '目前密碼',
    newPassword: '新密碼',
    confirmPassword: '確認新密碼',
    changePwBtn: '更新密碼',
    pwTooShort: '新密碼至少需 4 個字元',
    pwMismatch: '兩次輸入的新密碼不一致',
    pwSameAsOld: '新密碼不可與目前密碼相同',
    pwCurrentWrong: '目前密碼錯誤',
    pwChanged: '密碼已更新',

    // ── App 主畫面 ──
    welcome: '歡迎',
    role: '角色',
    superAdmin: '超級管理員',
    noPermissionTitle: '權限不足',
    noPermissionDesc: '您目前的角色沒有使用此功能的權限，請聯絡管理員。',
    moduleComingSoon: '此模組開發中',
    moduleComingSoonDesc: '本功能將於後續版本提供。',

    // ── 模組名稱（A~H）──
    mod_sales: '銷售收銀',
    mod_members: '會員管理',
    mod_orders: '網購訂單',
    mod_inventory: '庫存操作',
    mod_today: '今日銷售',
    mod_reports: '分析報表',
    mod_settings: '系統設定',
    mod_accounts: '帳號權限',

    // ── 權限名稱（6 項）──
    perm_inventory: '庫存操作',
    perm_cost: '成本查看',
    perm_member_manage: '會員管理',
    perm_settings: '系統設定',
    perm_reports: '報表查看',
    perm_order_discount: '整單折扣',
    perm_inventory_desc: '改數量、進貨、出貨、盤點、上下架、分類管理',
    perm_cost_desc: '成本價、獲利、毛利、進價',
    perm_member_manage_desc: '編輯、刪除、點數調整、改等級',
    perm_settings_desc: '集點規則、購物規則、快捷鍵',
    perm_reports_desc: '今日銷售、分析報表進入',
    perm_order_discount_desc: '整單折扣',

    // ── 帳號權限管理 ──
    accountsTitle: '帳號與權限管理',
    accountsDesc: '建立 POS 操作帳號並指派權限（僅超級管理員可進入）',
    addAccount: '新增帳號',
    accountList: '帳號列表',
    displayName: '顯示名稱',
    permissions: '權限',
    status: '狀態',
    statusActive: '啟用',
    statusDisabled: '停用',
    actions: '操作',
    edit: '編輯',
    resetPw: '重設密碼',
    enable: '啟用',
    disable: '停用',
    isSuperAdmin: '超級管理員（全部權限）',
    newAccountTitle: '新增 POS 帳號',
    editAccountTitle: '編輯帳號',
    initialPassword: '初始密碼',
    mustChangeOnFirst: '要求首次登入變更密碼',
    accountExists: '此帳號已存在',
    accountSaved: '帳號已儲存',
    cannotDisableSelf: '無法停用自己的帳號',
    cannotDisableLastAdmin: '無法停用最後一位超級管理員',

    offlineModeBanner: '離線測試模式：尚未設定 bini-blooms-dev，資料暫存於本機瀏覽器',
  },

  en: {
    // ── Common ──
    appName: 'BINI POS',
    appSubtitle: 'Point of Sale',
    confirm: 'Confirm',
    cancel: 'Cancel',
    save: 'Save',
    close: 'Close',
    loading: 'Loading…',
    logout: 'Log out',
    langName: 'English',

    // ── Login ──
    loginTitle: 'Sign In',
    username: 'Username',
    password: 'Password',
    usernamePlaceholder: 'Enter username',
    passwordPlaceholder: 'Enter password',
    loginBtn: 'Sign In',
    loggingIn: 'Signing in…',
    loginErrorEmpty: 'Please enter username and password',
    loginErrorInvalid: 'Incorrect username or password',
    loginErrorDisabled: 'This account has been disabled',
    defaultAdminHint: 'Default admin: admin / admin (please change the password right after first login)',

    // ── Forced password change ──
    changePwTitle: 'Change Password',
    changePwForced: 'For your security, please set a new password on first login',
    currentPassword: 'Current password',
    newPassword: 'New password',
    confirmPassword: 'Confirm new password',
    changePwBtn: 'Update Password',
    pwTooShort: 'New password must be at least 4 characters',
    pwMismatch: 'New passwords do not match',
    pwSameAsOld: 'New password must differ from current password',
    pwCurrentWrong: 'Current password is incorrect',
    pwChanged: 'Password updated',

    // ── App shell ──
    welcome: 'Welcome',
    role: 'Role',
    superAdmin: 'Super Admin',
    noPermissionTitle: 'Access Denied',
    noPermissionDesc: 'Your role does not have permission to use this feature. Please contact an administrator.',
    moduleComingSoon: 'Module under development',
    moduleComingSoonDesc: 'This feature will be available in a future release.',

    // ── Module names (A~H) ──
    mod_sales: 'Sales',
    mod_members: 'Members',
    mod_orders: 'Online Orders',
    mod_inventory: 'Inventory',
    mod_today: "Today's Sales",
    mod_reports: 'Reports',
    mod_settings: 'Settings',
    mod_accounts: 'Accounts',

    // ── Permission names (6) ──
    perm_inventory: 'Inventory',
    perm_cost: 'Cost / Profit',
    perm_member_manage: 'Member Management',
    perm_settings: 'System Settings',
    perm_reports: 'Reports',
    perm_order_discount: 'Order Discount',
    perm_inventory_desc: 'Stock, purchase, dispatch, stocktake, listing, categories',
    perm_cost_desc: 'Cost price, profit, margin, purchase price',
    perm_member_manage_desc: 'Edit, delete, point adjustment, tier change',
    perm_settings_desc: 'Point rules, shop rules, hotkeys',
    perm_reports_desc: "Access Today's Sales and Analytics",
    perm_order_discount_desc: 'Whole-order discount',

    // ── Account management ──
    accountsTitle: 'Accounts & Permissions',
    accountsDesc: 'Create POS operator accounts and assign permissions (Super Admin only)',
    addAccount: 'Add Account',
    accountList: 'Accounts',
    displayName: 'Display name',
    permissions: 'Permissions',
    status: 'Status',
    statusActive: 'Active',
    statusDisabled: 'Disabled',
    actions: 'Actions',
    edit: 'Edit',
    resetPw: 'Reset password',
    enable: 'Enable',
    disable: 'Disable',
    isSuperAdmin: 'Super Admin (all permissions)',
    newAccountTitle: 'New POS Account',
    editAccountTitle: 'Edit Account',
    initialPassword: 'Initial password',
    mustChangeOnFirst: 'Require password change on first login',
    accountExists: 'This username already exists',
    accountSaved: 'Account saved',
    cannotDisableSelf: 'You cannot disable your own account',
    cannotDisableLastAdmin: 'Cannot disable the last Super Admin',

    offlineModeBanner: 'Offline test mode: bini-blooms-dev not configured, data is stored locally in your browser',
  },
};

const LANG_KEY = 'bini_pos_lang';

let currentLang = localStorage.getItem(LANG_KEY) || 'zh';

export function getLang() { return currentLang; }

export function setLang(lang) {
  if (lang !== 'zh' && lang !== 'en') return;
  currentLang = lang;
  localStorage.setItem(LANG_KEY, lang);
  document.documentElement.lang = lang === 'zh' ? 'zh-Hant' : 'en';
  applyTranslations();
}

export function toggleLang() {
  setLang(currentLang === 'zh' ? 'en' : 'zh');
}

// 取得單一字串
export function t(key) {
  const table = STRINGS[currentLang] || STRINGS.zh;
  return table[key] != null ? table[key] : (STRINGS.zh[key] != null ? STRINGS.zh[key] : key);
}

// 套用所有帶 data-i18n / data-i18n-ph 的元素
export function applyTranslations(root = document) {
  root.querySelectorAll('[data-i18n]').forEach(el => {
    el.textContent = t(el.getAttribute('data-i18n'));
  });
  root.querySelectorAll('[data-i18n-ph]').forEach(el => {
    el.setAttribute('placeholder', t(el.getAttribute('data-i18n-ph')));
  });
  root.querySelectorAll('[data-i18n-title]').forEach(el => {
    el.setAttribute('title', t(el.getAttribute('data-i18n-title')));
  });
}
