// BINI Blooms Client v3.0.31
// ══════════════════════════════════════════════
//  BINI Blooms app.js v2.0.0
//  OTP 手機登入 + 點數批次到期 + 升級制度
// ══════════════════════════════════════════════
import { db, auth, storage, messaging } from './firebase-config.js';
import {
  RecaptchaVerifier, signInWithPhoneNumber,
  signInWithEmailAndPassword,
  EmailAuthProvider, linkWithCredential,
  sendPasswordResetEmail,
  onAuthStateChanged, signOut, updatePassword
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import {
  doc, getDoc, setDoc, addDoc, updateDoc, deleteDoc,
  collection, query, where, orderBy, limit,
  getDocs, onSnapshot, serverTimestamp, runTransaction, increment, writeBatch, Timestamp
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { ref, uploadBytes, getDownloadURL } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js';
import { getToken, onMessage } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging.js';
import { getFunctions, httpsCallable } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js';

const _fns = getFunctions(undefined, 'us-central1');
async function callFn(name, data = {}) { const r = await httpsCallable(_fns, name)(data); return r.data; }

// 骨架載入動畫
window.skeletonList = function(n = 3) {
  let h = '';
  for (let i = 0; i < n; i++) h += '<div class="sk-card"><div class="skeleton sk-avatar"></div><div class="sk-lines"><div class="skeleton sk-line m"></div><div class="skeleton sk-line s"></div></div></div>';
  return h;
};
window.skeletonGrid = function(n = 4) {
  let h = '<div class="sk-grid">';
  for (let i = 0; i < n; i++) h += '<div class="sk-tile"><div class="skeleton sk-tile-img"></div><div class="sk-tile-body"><div class="skeleton sk-line l"></div><div class="skeleton sk-line s"></div></div></div>';
  return h + '</div>';
};

// ── 會員等級設定 ──
// VAPID Key 來自 Firebase Console → Project Settings → Cloud Messaging → 網路推播憑證
// 截圖中可見的 Key（請確認完整 Key 後填入）
const VAPID_KEY = 'BHTHLzWPh4B-4m_moKfu7jCUwfqeT-r8vTbtUQct3EMAiaUKz45YbexrWx_xp72plFRNSq0ss2hmhWMvv13m2F4';
const TIERS = [
  { id:'normal', name:{zh:'一般會員',en:'Member'},    icon:'🛍️', minSpent:0,     maxSpent:10000,  rate:1.0, label:{zh:'消費 NT$200 = 1 點',en:'NT$200 = 1 pt'} },
  { id:'vip',    name:{zh:'VIP 會員',en:'VIP'},       icon:'⭐', minSpent:10001, maxSpent:15000,  rate:1.3, label:{zh:'消費 NT$200 = 1.3 點',en:'NT$200 = 1.3 pts'} },
  { id:'vvip',   name:{zh:'VVIP 會員',en:'VVIP'},     icon:'🌟', minSpent:15001, maxSpent:25000,  rate:1.5, label:{zh:'消費 NT$200 = 1.5 點',en:'NT$200 = 1.5 pts'} },
  { id:'vvvip',  name:{zh:'VVVIP 會員',en:'VVVIP'},   icon:'💎', minSpent:25001, maxSpent:Infinity, rate:2.0, label:{zh:'消費 NT$200 = 2 點',en:'NT$200 = 2 pts'} },
];
const BASE_UNIT = 200;         // 每 NT$200 計算一次
const POINTS_EXPIRY_DAYS = 90; // 點數有效期 90 天（3個月）

function getTierBySpent(spent) {
  for (let i = TIERS.length-1; i >= 0; i--) {
    if (spent >= TIERS[i].minSpent) return TIERS[i];
  }
  return TIERS[0];
}
function calcPoints(amount, tier) {
  return Math.round(Math.floor(amount / BASE_UNIT) * tier.rate * 10) / 10; // 先取整數單位再乘倍率
}
function phoneToEmail(p) { return `m${p.replace(/\D/g,'')}@bini-blooms.app`; }
function getTodayCode() {
  const d = new Date();
  return String(d.getMonth()+1).padStart(2,'0') + String(d.getDate()).padStart(2,'0');
}
function addDays(date, days) {
  const d = new Date(date); d.setDate(d.getDate()+days); return d;
}

// ── 語言 ──
let lang = localStorage.getItem('bini_lang') || 'zh';
window.setLang = function(l) {
  lang = l; localStorage.setItem('bini_lang', l);
  document.querySelectorAll('.lang-btn').forEach(b => b.classList.toggle('active', (b.getAttribute('onclick')||'').includes(`'${l}'`)));
  ['zh','en'].forEach(x => {
    const el = document.getElementById('lbtn-'+x); if(el){ el.classList.toggle('act', x===l); el.classList.toggle('inact', x!==l); }
    const shopEl = document.getElementById('shop-lbtn-'+x); if(shopEl){ shopEl.classList.toggle('act', x===l); shopEl.classList.toggle('inact', x!==l); }
  });
  applyLang();

  // 即時更新各頁面動態內容
  const activePage = document.querySelector('.page.active')?.id || '';

  // Shop 子頁面
  if (activePage.startsWith('page-shop') || activePage === 'page-shop') {
    if (typeof ShopPage !== 'undefined' && typeof ShopPage.rerenderCurrentPage === 'function') {
      ShopPage.rerenderCurrentPage();
    }
  }
  // 購物車頁（單獨判斷，cart 也要重新 render 小計按鈕）
  if (document.getElementById('page-shop-cart')?.classList.contains('active')) {
    if (typeof ShopPage !== 'undefined') ShopPage.renderCart();
  }
  // 客服頁 — 重新載入讓 placeholder 和靜態文字更新
  if (activePage === 'page-support') {
    if (typeof loadSupport === 'function') loadSupport();
  }
};
function applyLang() {
  document.querySelectorAll('[data-zh]').forEach(el => {
    el.textContent = lang==='zh' ? el.dataset.zh : (el.dataset.en||el.dataset.zh);
  });
  const ci = document.getElementById('chat-input'); if(ci) ci.placeholder = lang==='zh'?'輸入訊息...':'Type a message...';
  updateTopTitle();
  renderTierRules();
  // 語言切換時重新渲染過期點數文字
  if (typeof loadExpiryInfo === 'function') { try { loadExpiryInfo(); } catch(e){} }
  // 更新歡迎卡語言
  const welcomeEl = document.getElementById('welcome-bonus-card');
  if (welcomeEl && welcomeEl.style.display !== 'none') {
    const wzh = welcomeEl.querySelector('[data-welcome-zh]');
    const wen = welcomeEl.querySelector('[data-welcome-en]');
    if (wzh) wzh.style.display = lang==='zh' ? '' : 'none';
    if (wen) wen.style.display = lang==='en' ? '' : 'none';
  }
}
function t(zh, en) { return lang==='zh' ? zh : en; }

function renderTierRules() {
  const el = document.getElementById('tier-rules-display'); if(!el) return;
  el.innerHTML = TIERS.map(ti =>
    `${ti.icon} ${lang==='zh'?ti.name.zh:ti.name.en}：${lang==='zh'?ti.label.zh:ti.label.en}`
  ).join('<br>');
}

// ── 狀態 ──
let currentUser=null, memberData=null, confirmResult=null;
let chatUnsub=null, lastDateLabel='';
let pendingDeductPts=0, pendingReward=null, deferredInstall=null;
let regPhone='', regName='', regBirthday='', regPassword='';

// ── PWA ──
window.addEventListener('beforeinstallprompt', e=>{ e.preventDefault(); deferredInstall=e; const btn=document.getElementById('btn-install'); if(btn) btn.style.display='flex'; });
window.addEventListener('appinstalled', ()=>{ deferredInstall=null; showToast(t('已加入主畫面！','Added!')); const btn=document.getElementById('btn-install'); if(btn) btn.style.display='none'; });
window.handleInstall = async function() {
  if(window.matchMedia('(display-mode: standalone)').matches){ showToast(t('已在主畫面！','Already on home screen!')); return; }
  if(deferredInstall){
    if(!confirm(t('BINI Blooms 將加入手機主畫面，方便下次直接開啟。\n確認加入？','Add BINI Blooms to your home screen?\nConfirm?'))) return;
    deferredInstall.prompt(); const{outcome}=await deferredInstall.userChoice;
    if(outcome==='accepted') showToast(t('成功加入主畫面！','Added!')); deferredInstall=null;
  } else {
    alert(t('iOS 步驟：\n1. 點 Safari 下方「分享」按鈕 □↑\n2. 選「加入主畫面」\n3. 確認名稱「BINI Blooms」後點新增','iOS: Tap Share □↑ → Add to Home Screen → confirm "BINI Blooms"'));
  }
};

// ── Auth 監聽 ──
onAuthStateChanged(auth, async user => {
  if (user) {
    currentUser = user;
    const snap = await getDoc(doc(db,'members',user.uid));
    if (snap.exists()) {
      memberData = snap.data();
      showApp(); loadHomeData(); checkUnread();
      // 推播權限判斷（iOS PWA 必須透過使用者手勢觸發）
      setTimeout(() => {
        const perm = ('Notification' in window) ? Notification.permission : 'unsupported';
        console.log('[Push] Notification.permission =', perm);
        if (perm === 'granted') {
          // 已授權：直接初始化
          initPushNotifications();
        } else {
          // default / denied / unsupported：都顯示按鈕讓使用者點擊
          // denied 在 iOS PWA 可以透過設定重置，顯示按鈕提示使用者操作
          const btn = document.getElementById('btn-enable-push');
          if (btn) {
            btn.style.display = 'flex';
            console.log('[Push] 顯示「開啟推播通知」按鈕，permission =', perm);
          } else {
            console.log('[Push] ❌ 找不到 btn-enable-push 元素');
          }
        }
      }, 1500);
    } else {
      showLogin();
    }
  } else {
    currentUser=null; memberData=null; showLogin();
  }
});
setTimeout(applyLang, 50);

// ── 生日下拉選單（年/月/日）──
// 原生 <input type="date"> 在 Android 無法直接選年份，改用三個下拉選單，
// 任何平台都能直接點選年份。值仍以 YYYY-MM-DD 字串寫入會員資料。
function initBirthdaySelects() {
  const yEl = document.getElementById('reg-bd-year');
  const mEl = document.getElementById('reg-bd-month');
  const dEl = document.getElementById('reg-bd-day');
  if (!yEl || !mEl || !dEl) return;

  const ph = (zh, en) => {
    const o = document.createElement('option');
    o.value = ''; o.dataset.zh = zh; o.dataset.en = en;
    o.textContent = lang === 'zh' ? zh : en;
    o.disabled = true; o.selected = true;
    return o;
  };
  const opt = (v, label) => {
    const o = document.createElement('option');
    o.value = v; o.textContent = label;
    return o;
  };

  const thisYear = new Date().getFullYear();
  yEl.appendChild(ph('年', 'Year'));
  for (let y = thisYear; y >= thisYear - 100; y--) yEl.appendChild(opt(y, y));

  mEl.appendChild(ph('月', 'Month'));
  for (let m = 1; m <= 12; m++) mEl.appendChild(opt(m, m));

  // 依年/月填入正確天數（處理 2 月與大小月）
  const fillDays = () => {
    const y = parseInt(yEl.value) || 2000;
    const m = parseInt(mEl.value) || 1;
    const max = new Date(y, m, 0).getDate();
    const cur = dEl.value;
    dEl.innerHTML = '';
    dEl.appendChild(ph('日', 'Day'));
    for (let d = 1; d <= max; d++) dEl.appendChild(opt(d, d));
    if (cur && parseInt(cur) <= max) dEl.value = cur;
  };
  fillDays();
  yEl.addEventListener('change', fillDays);
  mEl.addEventListener('change', fillDays);
}
initBirthdaySelects();

// ── 登入流程 ──
function showView(view) {
  ['auth-login','auth-register','auth-otp','auth-profile'].forEach(id => {
    const el=document.getElementById(id); if(el) el.style.display='none';
  });
  const target = document.getElementById('auth-'+view);
  if (target) target.style.display = 'block';
}
window.showView = showView;

window.handleSignIn = async function() {
  const phone = document.getElementById('inp-phone').value.trim();
  const pw    = document.getElementById('inp-password').value;
  const msgEl = document.getElementById('login-msg');
  if (!/^09\d{8}$/.test(phone)) { setMsg(msgEl,t('請輸入正確手機號碼（09開頭10碼）','Enter valid phone'),'error'); return; }
  if (!pw||pw.length<6) { setMsg(msgEl,t('請輸入密碼（至少6碼）','Enter password 6+ chars'),'error'); return; }
  setMsg(msgEl,t('登入中...','Signing in...'),'');
  try {
    await signInWithEmailAndPassword(auth, phoneToEmail(phone), pw);
  } catch(e) {
    const m = {'auth/invalid-credential':t('手機號碼或密碼錯誤','Wrong phone or password'),'auth/user-not-found':t('找不到此帳號，請先註冊','Account not found'),'auth/wrong-password':t('密碼錯誤','Wrong password'),'auth/too-many-requests':t('嘗試次數過多，請稍後','Too many attempts')};
    setMsg(msgEl, m[e.code]||t('登入失敗','Login failed: '+e.code), 'error');
  }
};

window.handleForgotPwd = async function() {
  const phone = document.getElementById('inp-phone').value.trim();
  const msgEl = document.getElementById('login-msg');
  if (!/^09\d{8}$/.test(phone)) { setMsg(msgEl,t('請先輸入手機號碼','Enter phone first'),'error'); return; }
  try {
    await sendPasswordResetEmail(auth, phoneToEmail(phone));
    setMsg(msgEl,t('重設密碼郵件已發送，請查看信箱','Reset email sent'),'success');
  } catch(e) { setMsg(msgEl,t('發送失敗，請確認帳號是否已註冊','Send failed'),'error'); }
};

// ── 註冊流程：步驟1 輸入手機發 OTP ──
window.handleSendOTP = async function() {
  const phone = document.getElementById('reg-phone').value.trim();
  const msgEl = document.getElementById('reg-msg');
  if (!/^09\d{8}$/.test(phone)) { setMsg(msgEl,t('請輸入正確手機號碼（09開頭10碼）','Enter valid phone number (10 digits)'),'error'); return; }
  regPhone = phone;
  setMsg(msgEl,t('發送中...','Sending...'),'');
  try {
    if (window.recaptchaVerifier) { try{window.recaptchaVerifier.clear();}catch(e){} window.recaptchaVerifier=null; }
    document.getElementById('recaptcha-container-reg').innerHTML='';
    window.recaptchaVerifier = new RecaptchaVerifier(auth,'recaptcha-container-reg',{
      size:'invisible',
      callback:()=>{},
      'expired-callback':()=>{ window.recaptchaVerifier=null; }
    });
    await window.recaptchaVerifier.render();
    confirmResult = await signInWithPhoneNumber(auth,'+886'+phone.slice(1),window.recaptchaVerifier);
    document.getElementById('otp-hint-phone').textContent = t(`已發送驗證碼至 ${phone}，請查看簡訊`,'SMS sent to '+phone);
    showView('otp');
    setMsg(document.getElementById('otp-msg'),t('驗證碼已發送','Code sent'),'success');
  } catch(e) {
    console.error('OTP error:', e.code, e.message);
    if(window.recaptchaVerifier){try{window.recaptchaVerifier.clear();}catch(err){} window.recaptchaVerifier=null;}
    const msgs = {
      'auth/captcha-check-failed':    t('驗證失敗，請重新整理頁面後再試','Captcha failed, please refresh and retry'),
      'auth/invalid-phone-number':    t('手機號碼格式錯誤','Invalid phone number format'),
      'auth/quota-exceeded':          t('今日簡訊已達上限，請明天再試','SMS quota exceeded, try tomorrow'),
      'auth/operation-not-allowed':   t('手機驗證未開啟，請聯絡管理員','Phone auth not enabled'),
      'auth/too-many-requests':       t('嘗試次數太多，請稍後再試','Too many attempts, try later'),
      'auth/network-request-failed':  t('網路連線失敗，請檢查網路','Network error, check connection'),
    };
    setMsg(msgEl, msgs[e.code] || t('發送失敗（'+e.code+'）','Failed: '+e.code), 'error');
  }
};

// ── 步驟2 驗證 OTP ──
window.handleVerifyOTP = async function() {
  const otp   = document.getElementById('inp-otp').value.trim();
  const msgEl = document.getElementById('otp-msg');
  if (!otp||otp.length<6) { setMsg(msgEl,t('請輸入6位數驗證碼','Enter 6-digit code'),'error'); return; }
  if (!confirmResult) { setMsg(msgEl,t('請重新取得驗證碼','Please resend OTP'),'error'); return; }
  setMsg(msgEl,t('驗證中...','Verifying...'),'');
  try {
    const cred = await confirmResult.confirm(otp);
    const snap = await getDoc(doc(db,'members',cred.user.uid));
    if (snap.exists()) {
      // 舊會員 → 資料已存在，onAuthStateChanged 會自動導入 APP
      setMsg(msgEl,t('✅ 驗證成功！','✅ Verified!'),'success');
    } else {
      // 新用戶 → 進入填寫資料步驟
      setMsg(msgEl,'','');
      showView('profile');
    }
  } catch(e) {
    console.error('handleVerifyOTP:', e.code, e.message);
    setMsg(msgEl,
      e.code==='auth/invalid-verification-code' ? t('驗證碼錯誤，請重新輸入','Wrong code') :
      e.code==='auth/code-expired' ? t('驗證碼已過期，請重新發送','Code expired') :
      t('驗證失敗：'+e.code,'Failed: '+e.code), 'error');
  }
};

// ── 步驟3 完成填資料 + 設密碼 ──
// Phone Auth 完成後，用 EmailAuthProvider.credential + linkWithCredential
// 將 email(手機轉換格式) + 密碼綁定到同一個帳號，讓後續可用手機+密碼登入
window.handleCompleteRegister = async function() {
  const name  = document.getElementById('reg-name').value.trim();
  const by    = document.getElementById('reg-bd-year').value;
  const bm    = document.getElementById('reg-bd-month').value;
  const bdy   = document.getElementById('reg-bd-day').value;
  const bd    = (by && bm && bdy) ? `${by}-${String(bm).padStart(2,'0')}-${String(bdy).padStart(2,'0')}` : '';
  const pw    = document.getElementById('reg-password').value;
  const pw2   = document.getElementById('reg-password2').value;
  const msgEl = document.getElementById('profile-msg');
  if (!name)          { setMsg(msgEl,t('請輸入姓名','Enter name'),'error'); return; }
  if (!bd)            { setMsg(msgEl,t('請選擇生日','Select birthday'),'error'); return; }
  if (!pw||pw.length<6){ setMsg(msgEl,t('密碼至少6個字元','Password 6+ chars'),'error'); return; }
  if (pw !== pw2)     { setMsg(msgEl,t('兩次密碼不一致','Passwords do not match'),'error'); return; }
  if (!regPhone)      { setMsg(msgEl,t('手機號碼遺失，請重新取得驗證碼','Phone lost, resend OTP'),'error'); return; }
  setMsg(msgEl,t('建立帳號中...','Creating account...'),'');
  try {
    const user = auth.currentUser;
    if (!user) throw new Error('no_user');
    // 將 Email(手機格式) + 密碼綁定到 Phone Auth 帳號
    // 之後可直接用 signInWithEmailAndPassword(phoneToEmail(phone), pw) 登入
    const emailCredential = EmailAuthProvider.credential(phoneToEmail(regPhone), pw);
    try {
      await linkWithCredential(user, emailCredential);
    } catch(linkErr) {
      // auth/provider-already-linked → 已綁定，嘗試 updatePassword
      if (linkErr.code === 'auth/provider-already-linked' || linkErr.code === 'auth/email-already-in-use') {
        try { await updatePassword(user, pw); } catch(e) { /* 忽略 */ }
      } else {
        throw linkErr;
      }
    }
    // 建立 Firestore member 文件（含新會員贈點 10 點）
    await setDoc(doc(db,'members',user.uid), {
      uid: user.uid,
      phone: regPhone,
      email: phoneToEmail(regPhone),
      name,
      birthday: bd||'',
      points: 10, totalSpent: 0, visitCount: 0, redeemCount: 0, deductedPts: 0,
      tier: 'normal',
      joinedAt: serverTimestamp(),
      welcomeBonus: true,
    });
    // 寫入歡迎贈點交易紀錄
    await addDoc(collection(db,'transactions'), {
      uid: user.uid,
      type: 'welcome',
      points: 10,
      desc: '新會員歡迎贈點',
      descEn: 'Welcome bonus points',
      createdAt: serverTimestamp(),
    });
    // 推薦碼（選填）：僅記錄推薦關係，新會員不會額外加點；
    // 推薦人的回饋待此新會員首次消費集點時才發放。
    let referralApplied = false;
    const refCode = (document.getElementById('reg-referral')?.value || '').trim().toUpperCase();
    if (refCode) {
      try {
        const r = await callFn('applyReferralCode', { code: refCode });
        if (r?.success) referralApplied = true;
      } catch(refErr) {
        // 推薦碼無效不影響註冊，僅提示
        console.log('applyReferralCode:', refErr.code || refErr.message);
        setMsg(msgEl, t('推薦碼無效，已略過（帳號已建立）','Invalid referral code, skipped'), 'error');
      }
    }
    // 註冊成功後登出本次階段，回到登入首頁，讓新會員以手機＋密碼登入
    const newPhone = regPhone;
    await signOut(auth);
    showView('login');
    const phoneInput = document.getElementById('inp-phone');
    if (phoneInput) phoneInput.value = newPhone;
    const pwInput = document.getElementById('inp-password');
    if (pwInput) pwInput.value = '';
    setMsg(document.getElementById('login-msg'),
      referralApplied
        ? t('✅ 註冊成功！推薦碼已套用，請登入','✅ Registered! Referral code applied. Please sign in')
        : t('✅ 註冊成功！請用手機號碼與密碼登入','✅ Registered! Please sign in with your phone & password'),
      'success');
  } catch(e) {
    console.error('handleCompleteRegister:', e.code, e.message);
    const m = {
      'auth/email-already-in-use': t('此手機號碼已被使用，請直接登入','Phone already registered, sign in'),
      'auth/weak-password': t('密碼強度不足','Weak password'),
      'auth/operation-not-allowed': t('操作不允許，請聯絡管理員','Operation not allowed'),
    };
    setMsg(msgEl, m[e.code]||t('建立失敗，請重試（'+e.code+'）','Failed: '+e.code), 'error');
  }
};

window.handleLogout = async function() {
  if (!confirm(t('確定要登出嗎？','Sign out?'))) return;
  if (chatUnsub) { chatUnsub(); chatUnsub=null; }
  if (notificationsUnsub) { notificationsUnsub(); notificationsUnsub=null; }
  await signOut(auth);
};

// ── 畫面切換 ──
function showLogin() {
  if(window.hideSplash) window.hideSplash();
  document.getElementById('screen-login').classList.add('active');
  document.getElementById('screen-app').classList.remove('active');
  const nav = document.querySelector('.bottom-nav'); if(nav) nav.style.display='none';
  showView('login'); applyLang();
}
function showApp() {
  if(window.hideSplash) window.hideSplash();
  document.getElementById('screen-login').classList.remove('active');
  document.getElementById('screen-app').classList.add('active');
  const nav = document.querySelector('.bottom-nav'); if(nav) nav.style.display='';
  applyLang();
  // 動態取得 top-bar 高度，供 page-support 定位使用
  requestAnimationFrame(() => {
    const tb = document.querySelector('.top-bar');
    if(tb) document.documentElement.style.setProperty('--topbar-h', tb.offsetHeight + 'px');
  });
  // 推播點擊後帶 hash 跳轉（e.g. /#announce）
  const hash = location.hash.replace('#','');
  const validPages = ['home','scan','redeem','announce','support','shop','profile'];
  if(hash && validPages.includes(hash)) {
    const btn = document.querySelector(`.bnav-btn[onclick*="${hash}"]`);
    window.switchPage(hash, btn || document.querySelector('.bnav-btn'));
    history.replaceState(null,'', location.pathname); // 清除 hash 避免重整重跳
  }
}

const PAGE_TITLES = {
  home:{zh:'',en:''}, scan:{zh:'掃描集點',en:'Earn Points'},
  redeem:{zh:'兌換',en:'Redeem'}, announce:{zh:'最新公告',en:'News'},
  support:{zh:'客服訊息',en:'Support'}, profile:{zh:'我的帳戶',en:'My Account'}
};
function updateTopTitle() {
  const a = document.querySelector('.page.active'); if(!a) return;
  const pid = a.id.replace('page-','');
  const topBar  = document.getElementById('main-top-bar');
  const logoEl  = document.getElementById('top-logo');
  const titleEl = document.getElementById('top-title');

  // 購物相關頁面：完整顯示 main-top-bar（含 LOGO、按鈕、Banner）
  // page-top-bar 只負責返回按鈕和頁面標題
  if (pid.startsWith('shop')) {
    if (topBar) topBar.style.display = '';
    const topRow = topBar?.querySelector('.top-row');
    if (topRow) topRow.style.display = '';
    if (logoEl)  logoEl.style.display  = 'flex';
    if (titleEl) titleEl.style.display = 'none';
    return;
  }
  // 非購物頁：恢復 top-row
  if (topBar) {
    topBar.style.display = '';
    const topRow = topBar.querySelector('.top-row');
    if (topRow) topRow.style.display = '';
  }

  // 首頁：顯示 LOGO，隱藏文字標題
  if (pid === 'home') {
    if (logoEl)  logoEl.style.display  = 'flex';
    if (titleEl) titleEl.style.display = 'none';
    return;
  }

  // 其他頁：隱藏 LOGO，顯示頁面標題
  if (logoEl)  logoEl.style.display  = 'none';
  if (titleEl) {
    titleEl.style.display = 'block';
    const ti = PAGE_TITLES[pid];
    titleEl.textContent = ti ? (lang==='zh' ? ti.zh : ti.en) : '';
  }
}
window.switchPage = function(pageId, btn) {
  document.querySelectorAll('.page').forEach(p=>{ p.classList.remove('active'); p.scrollTop=0; });
  document.querySelectorAll('.bnav-btn').forEach(b=>b.classList.remove('active'));
  document.getElementById('page-'+pageId).classList.add('active');
  btn.classList.add('active'); updateTopTitle();
  const tb=document.querySelector('.top-bar'); if(tb) document.documentElement.style.setProperty('--topbar-h', tb.offsetHeight+'px');
  if(pageId==='support') loadSupport(); else { if(chatUnsub){chatUnsub();chatUnsub=null;} }
  if(pageId==='home')     loadHomeData();
  if(pageId==='redeem')   loadRedeem();
  if(pageId==='announce') loadAnnouncements();
  if(pageId==='profile')  loadProfile();
    if(pageId==='shop') {
      // shop.js 是 type=module，非同步載入，需等待掛載到 window
      const waitShop = (retry = 0) => {
        if (typeof ShopPage !== 'undefined') {
          ShopPage.init();
        } else if (retry < 50) {
          setTimeout(() => waitShop(retry + 1), 100);
        } else {
          // 逾時：顯示重試按鈕
          const grid = document.getElementById('shop-product-grid');
          if (grid) grid.innerHTML = '<div class="shop-empty"><p>載入失敗，請重試</p><button class="btn-outline" onclick="ShopPage&&ShopPage.init()" style="margin-top:8px">重新載入</button></div>';
          console.warn('ShopPage 載入逾時');
        }
      };
      // 先試一次（可能已載入）
      if (typeof ShopPage !== 'undefined') {
        ShopPage.init();
      } else {
        // 監聽 shop.js 載入完成事件
        window.addEventListener('shopModuleReady', function() {
          if (typeof ShopPage !== 'undefined') ShopPage.init();
        }, { once: true });
        // 備用輪詢（最多5秒）
        const waitShop2 = (retry = 0) => {
          if (typeof ShopPage !== 'undefined') { ShopPage.init(); }
          else if (retry < 50) { setTimeout(() => waitShop2(retry + 1), 100); }
          else {
            const grid = document.getElementById('shop-product-grid');
            if (grid) grid.innerHTML = '<div class="shop-empty"><p>載入失敗，請重試</p><button class="btn-outline" onclick="location.reload()" style="margin-top:8px">重新整理</button></div>';
          }
        };
        setTimeout(() => waitShop2(), 200);
      }
    }
};

// ── 首頁：點數 + 即將過期 ──
async function loadHomeData() {
  if (!currentUser) return;
  try {
    const snap = await getDoc(doc(db,'members',currentUser.uid));
    if (!snap.exists()) return;
    memberData = snap.data();
    const tier = getTierBySpent(memberData.totalSpent||0);
    document.getElementById('hero-name').textContent  = memberData.name;
    document.getElementById('hero-id').textContent    = 'ID #'+currentUser.uid.slice(-6).toUpperCase();
    document.getElementById('hero-tier').textContent  = tier.icon+' '+(lang==='zh'?tier.name.zh:tier.name.en);
    const _pts = memberData.points||0; document.getElementById('hero-pts').textContent = Number.isInteger(_pts)?_pts.toLocaleString():_pts.toFixed(1);

    // 載入即將過期的點數批次
    await loadExpiryInfo();
    loadMonthRank(); // 排行榜（不 await，背景載入）

    // 新會員歡迎通知
    const welcomeEl = document.getElementById('welcome-bonus-card');
    if (welcomeEl) {
      if (memberData.welcomeBonus) {
        welcomeEl.style.display = 'block';
        welcomeEl.querySelector('[data-welcome-zh]').style.display = lang==='zh' ? '' : 'none';
        welcomeEl.querySelector('[data-welcome-en]').style.display = lang==='en' ? '' : 'none';
      } else {
        welcomeEl.style.display = 'none';
      }
    }

    // 消費紀錄
    const list   = document.getElementById('history-list');
    if (list) list.innerHTML = window.skeletonList(3);
    const txSnap = await getDocs(query(collection(db,'transactions'),where('uid','==',currentUser.uid),limit(30)));
    if (txSnap.empty) { list.innerHTML=`<p class="empty-hint">${t('還沒有紀錄','No records yet')}</p>`; return; }
    const docs=[]; txSnap.forEach(d=>docs.push({id:d.id,...d.data()}));
    docs.sort((a,b)=>(b.createdAt?.toDate()||0)-(a.createdAt?.toDate()||0));
    list.innerHTML='';
    // 翻譯 Firestore 存的中文 desc
    function translateDesc(desc, type) {
      if (lang === 'zh' || !desc) return desc;
      // 消費集點 NT$XXX（等級）
      const earnMatch = desc.match(/消費集點 NT\$(\d+)（(.+?)）/);
      if (earnMatch) return `Points earned NT${earnMatch[1]} (${earnMatch[2].replace('一般會員','Regular').replace('VIP 會員','VIP').replace('VVIP 會員','VVIP').replace('VVVIP 會員','VVVIP')})`;
      // 折抵消費 NT$XXX
      const deductMatch = desc.match(/折抵消費 NT\$(\d+)/);
      if (deductMatch) return `Discount NT${deductMatch[1]}`;
      // 兌換：名稱
      const redeemMatch = desc.match(/兌換：(.+)/);
      if (redeemMatch) return `Redeemed: ${redeemMatch[1]}`;
      // 新會員歡迎贈點
      if (desc === '新會員歡迎贈點') return 'Welcome bonus points';
      // 推薦相關
      if (desc === '輸入推薦碼獎勵') return 'Referral signup bonus';
      if (desc === '好友推薦獎勵') return 'Referral reward';
      // 點數到期
      if (desc === '點數到期') return 'Points expired';
      return desc;
    }
    docs.slice(0,15).forEach(tx=>{
      const isEarn=tx.type==='earn', isDeduct=tx.type==='deduct', isWelcome=tx.type==='welcome';
      const isReferral=tx.type==='referral_signup'||tx.type==='referral_reward';
      const isExpire=tx.type==='expire';
      const isPos=isEarn||isWelcome||isReferral;
      const dateStr=tx.createdAt?tx.createdAt.toDate().toLocaleDateString('zh-TW',{year:'numeric',month:'2-digit',day:'2-digit'}):'—';
      const item=document.createElement('div'); item.className='history-item';
      item.innerHTML=`<div class="h-icon ${isPos?'earn':'deduct'}">${isWelcome||isReferral?'🎁':isEarn?'+':isExpire?'⏰':'💰'}</div>
        <div class="h-info"><div class="h-desc">${escHtml(translateDesc(tx.desc,tx.type)||t('紀錄','Record'))}</div>
        <div class="h-date">${dateStr}${tx.amount?' · NT$'+tx.amount.toLocaleString():''}</div></div>
        <div class="h-pts ${isPos?'earn':'deduct'}">${isPos?'+':'-'}${tx.points}</div>`;
      list.appendChild(item);
    });
  } catch(e) { console.error('loadHomeData:',e); }
}


// ── 排行榜：本月集點排名 ──
async function loadMonthRank() {
  try {
    if (!currentUser) return;
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    // 讀全體 earn 交易（Firestore rules 允許任何登入者讀 type==='earn'），
    // 於前端篩出本月並即時計算排名，不依賴後端是否寫入 monthlyRank。
    const snap = await getDocs(query(
      collection(db, 'transactions'),
      where('type', '==', 'earn')
    ));

    // 加總每位會員本月點數（與後端 updateMonthlyRanks 相同邏輯）
    const monthPts = {};
    let myTxCount = 0;
    snap.forEach(d => {
      const tx = d.data();
      const created = tx.createdAt?.toDate?.();
      if (!tx.uid || !created || created < monthStart) return;
      monthPts[tx.uid] = Math.round(((monthPts[tx.uid] || 0) + (tx.points || 0)) * 10) / 10;
      if (tx.uid === currentUser.uid) myTxCount++;
    });

    // 依點數高到低排序，計算名次（同分同名）
    const sorted = Object.entries(monthPts).sort((a, b) => b[1] - a[1]);
    const total  = sorted.length;
    let myRank = null, rank = 1;
    for (let i = 0; i < sorted.length; i++) {
      if (i > 0 && sorted[i][1] < sorted[i - 1][1]) rank = i + 1;
      if (sorted[i][0] === currentUser.uid) { myRank = rank; break; }
    }
    const myPts = monthPts[currentUser.uid] || 0;

    const rankEl  = document.getElementById('hero-rank');
    const countEl = document.getElementById('hero-month-count');

    if (rankEl) {
      if (myRank != null && total > 0) {
        // 顯示名次，例如「#3 / 28」
        rankEl.innerHTML = `#${myRank}<span style="font-size:12px;opacity:.7"> / ${total}</span>`;
      } else if (myPts > 0) {
        rankEl.textContent = myPts + ' pts';
      } else {
        rankEl.textContent = '—';
      }
    }
    if (countEl) countEl.textContent = myTxCount;
  } catch(e) { console.warn('loadMonthRank failed:', e.code || e.message); }
}

async function loadExpiryInfo() {
  try {
    if (!currentUser) return;  // 未登入時直接跳過
    const now  = new Date();
    const soon = new Date(now.getTime() + 30*24*60*60*1000);
    // 只用單一 where('uid') 避免複合索引需求，前端過濾 remaining > 0
    const batchSnap = await getDocs(query(
      collection(db,'point_batches'),
      where('uid','==',currentUser.uid)
    ));
    const batches=[];
    batchSnap.forEach(d=>{
      const b=d.data();
      if((b.remaining||0)>0 && b.expiresAt?.toDate()>now) batches.push(b);
    });
    batches.sort((a,b)=>(a.expiresAt?.toDate()||0)-(b.expiresAt?.toDate()||0));
    // 顯示下一筆到期點數
    const nextBlock = document.getElementById('next-expiry-block');
    const nextText  = document.getElementById('next-expiry-text');
    if (nextBlock && nextText) {
      if (batches.length > 0) {
        const next = batches[0];
        const expDate = next.expiresAt.toDate();
        const dateStr = expDate.toLocaleDateString(lang==='zh'?'zh-TW':'en-US', {year:'numeric',month:'2-digit',day:'2-digit'});
        nextText.textContent = lang==='zh'
          ? `下一筆到期點數：${Number.isInteger(next.remaining)?next.remaining:next.remaining.toFixed(1)} 點，將於 ${dateStr} 過期`
          : `Next expiry: ${Number.isInteger(next.remaining)?next.remaining:next.remaining.toFixed(1)} pts on ${dateStr}`;
        nextBlock.style.display = 'block';
      } else {
        nextBlock.style.display = 'none';
      }
    }

    const expiryBlock = document.getElementById('pts-expiry-block');
    const expiryList  = document.getElementById('pts-expiry-list');
    const soonBatches = batches.filter(b=>b.expiresAt?.toDate()<=soon);
    if (soonBatches.length===0) { expiryBlock.style.display='none'; return; }
    expiryBlock.style.display='block'; expiryList.innerHTML='';
    soonBatches.slice(0,3).forEach(b=>{
      const exp  = b.expiresAt.toDate();
      const days = Math.ceil((exp-now)/(1000*60*60*24));
      const row  = document.createElement('div');
      row.className = 'pts-expiry-row' + (days<=7?' urgent':'');
      row.innerHTML = `<span>${lang==='zh'?'即將到期：':'Expiring: '} <strong>${exp.toLocaleDateString('zh-TW')}</strong></span><span class="pts-expiry-qty">${b.remaining} ${lang==='zh'?'點':'pts'}</span>`;
      expiryList.appendChild(row);
    });
    const total = soonBatches.reduce((s,b)=>s+b.remaining,0);
    const note  = document.createElement('div');
    note.style.cssText='font-size:11px;color:rgba(255,255,255,.65);margin-top:6px';
    note.textContent = lang==='zh'?`共 ${total} 點在30天內到期`:`${total} pts expiring within 30 days`;
    expiryList.appendChild(note);
  } catch(e) { console.error('expiryInfo:',e); }
}

// ── QR 掃描（高成功率版本）──
window.handleQRFile = async function(input) {
  const file = input.files[0]; if (!file) return;
  const statusEl  = document.getElementById('scan-status');
  const btnLabel  = document.getElementById('scan-btn-label');
  const btnText   = document.getElementById('scan-btn-text');

  // 顯示掃描中動畫
  statusEl.innerHTML = `<span style="display:inline-flex;align-items:center;gap:8px;color:var(--brown)"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="animation:spin .8s linear infinite"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg>${t('解析中，請稍候...','Processing...')}</span>`;
  if (btnLabel) { btnLabel.style.opacity = '0.6'; btnLabel.style.pointerEvents = 'none'; }

  try {
    const bitmap = await createImageBitmap(file);
    const code   = await tryDecodeQR(bitmap);
    if (code) {
      statusEl.innerHTML = `<span style="color:#27ae60;font-weight:700">✅ ${t('辨識成功！傳送資料中...','Recognized! Sending...')}</span>`;
      await processQRScan(code);
    } else {
      statusEl.innerHTML = `<span style="color:#c0392b">❌ ${t('無法辨識 QR Code','Cannot read QR Code')}</span><br><span style="font-size:12px;color:#888">${t('請調整距離（15～25公分）或改善光線後重試','Adjust distance or improve lighting and retry')}</span>`;
    }
  } catch(e) {
    console.error('QR scan error:', e);
    statusEl.textContent = t('掃描失敗，請重試','Scan failed, please retry');
  } finally {
    if (btnLabel) { btnLabel.style.opacity = '1'; btnLabel.style.pointerEvents = 'auto'; }
    input.value = '';
  }
};

// 主要解碼函式：多策略嘗試，直到成功
async function tryDecodeQR(bitmap) {
  const W = bitmap.width, H = bitmap.height;

  // 策略清單：[縮放尺寸, 對比倍率, 是否灰階, 旋轉角度(deg)]
  const strategies = [
    // 原始尺寸優先
    [Math.min(W, 800), 1.0, false, 0],
    [Math.min(W, 600), 1.0, false, 0],
    [Math.min(W, 400), 1.0, false, 0],
    // 高對比
    [Math.min(W, 800), 1.8, true,  0],
    [Math.min(W, 600), 1.8, true,  0],
    // 更高對比
    [Math.min(W, 800), 2.5, true,  0],
    [Math.min(W, 600), 2.5, true,  0],
    // 旋轉版本（手持手機可能有角度）
    [Math.min(W, 800), 1.8, true, 90],
    [Math.min(W, 800), 1.8, true,270],
    [Math.min(W, 800), 1.8, true,180],
    // 大圖
    [Math.min(W,1200), 1.0, false, 0],
    [Math.min(W,1200), 2.0, true,  0],
    // 小圖（有時縮小反而更好）
    [300, 1.5, true, 0],
    [200, 1.5, true, 0],
  ];

  for (const [size, contrast, grayscale, rotate] of strategies) {
    const result = decodeAtConfig(bitmap, W, H, size, contrast, grayscale, rotate);
    if (result) return result;
  }

  // 最後嘗試：裁切中央 70% 區域（去除邊框雜訊）
  const cropResult = await tryCroppedCenter(bitmap, W, H);
  if (cropResult) return cropResult;

  return null;
}

function decodeAtConfig(bitmap, origW, origH, targetSize, contrast, grayscale, rotateDeg) {
  try {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    if (rotateDeg === 0) {
      const scale = targetSize / Math.max(origW, origH);
      canvas.width  = Math.round(origW * scale);
      canvas.height = Math.round(origH * scale);
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    } else {
      // 旋轉繪製
      const scale = targetSize / Math.max(origW, origH);
      const w = Math.round(origW * scale), h = Math.round(origH * scale);
      const rad = rotateDeg * Math.PI / 180;
      if (rotateDeg === 90 || rotateDeg === 270) { canvas.width = h; canvas.height = w; }
      else { canvas.width = w; canvas.height = h; }
      ctx.translate(canvas.width/2, canvas.height/2);
      ctx.rotate(rad);
      ctx.drawImage(bitmap, -w/2, -h/2, w, h);
    }

    // 取得像素資料並做影像處理
    let imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    if (grayscale || contrast !== 1.0) {
      imageData = processPixels(imageData, grayscale, contrast);
      ctx.putImageData(imageData, 0, 0);
    }

    const data = ctx.getImageData(0, 0, canvas.width, canvas.height);

    // dontInvert + onlyInvert 各試一次
    let code = jsQR(data.data, data.width, data.height, {inversionAttempts:'dontInvert'});
    if (!code) code = jsQR(data.data, data.width, data.height, {inversionAttempts:'onlyInvert'});
    if (code) return code.data;
  } catch(e) { /* 忽略單一策略失敗 */ }
  return null;
}

// 裁切中央 70%（去除邊緣雜訊）
async function tryCroppedCenter(bitmap, W, H) {
  try {
    const cx = W * 0.15, cy = H * 0.15, cw = W * 0.7, ch = H * 0.7;
    const cropped = await createImageBitmap(bitmap, cx, cy, cw, ch);
    const sizes = [600, 400, 800];
    for (const s of sizes) {
      const r = decodeAtConfig(cropped, cw, ch, s, 2.0, true, 0);
      if (r) return r;
    }
  } catch(e) {}
  return null;
}

// 像素預處理：灰階 + 對比增強
function processPixels(imageData, grayscale, contrast) {
  const data = new Uint8ClampedArray(imageData.data);
  const factor = (259 * (contrast * 128 + 255)) / (255 * (259 - contrast * 128));

  for (let i = 0; i < data.length; i += 4) {
    let r = data[i], g = data[i+1], b = data[i+2];

    if (grayscale) {
      // 加權灰階（人眼感知）
      const gray = Math.round(0.299*r + 0.587*g + 0.114*b);
      r = g = b = gray;
    }

    if (contrast !== 1.0) {
      r = Math.min(255, Math.max(0, Math.round(factor*(r - 128) + 128)));
      g = Math.min(255, Math.max(0, Math.round(factor*(g - 128) + 128)));
      b = Math.min(255, Math.max(0, Math.round(factor*(b - 128) + 128)));
    }

    data[i] = r; data[i+1] = g; data[i+2] = b;
  }
  return new ImageData(data, imageData.width, imageData.height);
}

async function processQRScan(tokenStr) {
  const statusEl=document.getElementById('scan-status');
  try {
    const { token } = JSON.parse(tokenStr);
    if (!token) { showScanError(t('QR Code 無效','Invalid QR')); return; }
    // 回傳會員 ID 到 QR Token
    const tokenRef = doc(db,'qr_tokens',token);
    const tokenSnap= await getDoc(tokenRef);
    if (!tokenSnap.exists()) { showScanError(t('QR Code 無效或已過期','Invalid or expired QR')); return; }
    const td = tokenSnap.data();
    if (td.used || td.cancelled) { showScanError(t('此 QR Code 已使用過','QR Code already used')); return; }
    if ((new Date()-td.createdAt.toDate())>2*60*1000) { showScanError(t('QR Code 已過期（超過2分鐘）','QR expired')); return; }
    if (td.memberUid && td.memberUid!==currentUser.uid) { showScanError(t('此 QR Code 已被其他會員掃描','QR already scanned by another member')); return; }
    // 寫入會員 UID
    await updateDoc(tokenRef,{memberUid:currentUser.uid,memberName:memberData?.name||'',scannedAt:serverTimestamp(),status:'scanned'});
    statusEl.textContent=t('✅ 資料已送出，請等候店員確認消費金額','✅ Sent! Please wait for staff to confirm amount');
    showToast(t('QR Code 已確認，請向店員告知消費金額','Confirmed! Tell staff your purchase amount'));
    // 監聽是否店家已確認並發點
    listenForPoints(token);
  } catch(e) {
    console.error(e);
    showScanError(t('掃描失敗，請重試','Scan failed'));
  }
}

let pointsListener=null;
function listenForPoints(token) {
  if(pointsListener){pointsListener();pointsListener=null;}
  const tokenRef=doc(db,'qr_tokens',token);
  pointsListener=onSnapshot(tokenRef, snap=>{
    if(!snap.exists()) return;
    const d=snap.data();
    if(d.status==='completed'&&d.pointsAwarded>0){
      pointsListener();pointsListener=null;
      const tier=getTierBySpent(d.totalSpent||0);
      showEarnModal(d.pointsAwarded,d.amount,tier,d.newTotalPts||0,d.birthdayBonus===true,d.basePoints||0);
      loadHomeData();
    }
    if(d.status==='cancelled'){
      pointsListener();pointsListener=null;
      showToast(t('店員已取消此次集點','Staff cancelled this scan'));
      document.getElementById('scan-status').textContent='';
    }
  });
  // 5分鐘後自動停止監聽
  setTimeout(()=>{ if(pointsListener){pointsListener();pointsListener=null;} },5*60*1000);
}

function showScanError(msg) {
  document.getElementById('scan-status').textContent=msg;
}
function showEarnModal(pts,amount,tier,newTotal,birthdayBonus=false,basePoints=0) {
  document.getElementById('modal-icon').textContent=birthdayBonus?'🎂':'🎉';
  document.getElementById('modal-icon').className='modal-icon';
  document.getElementById('modal-title').textContent=birthdayBonus
    ? t('生日快樂！今日點數加倍 🎉','Happy Birthday! Double Points Today 🎉')
    : t('集點成功！恭喜獲得點數','Points Added! Congratulations!');
  document.getElementById('modal-pts').textContent='+'+(Number.isInteger(pts)?pts:pts.toFixed(1));
  document.getElementById('modal-pts').className='modal-pts';
  document.getElementById('modal-earn-detail').style.display='block';
  document.getElementById('modal-earn-detail').innerHTML=
    (birthdayBonus?`🎂 ${t('今天是您的生日，點數加倍贈送！','Birthday bonus: points doubled!')}${basePoints?`（${t('原','base')} ${Number.isInteger(basePoints)?basePoints:basePoints.toFixed(1)} ×2）`:''}<br>`:'')+
    `💳 ${t('消費','Spent')} NT$${amount.toLocaleString()}<br>`+
    `${tier.icon} ${lang==='zh'?tier.name.zh:tier.name.en}（${lang==='zh'?tier.label.zh:tier.label.en}）<br>`+
    `🏆 ${t('目前共','Total')} <strong>${Number.isInteger(newTotal)?newTotal.toLocaleString():newTotal.toFixed(1)}</strong> ${t('點','pts')}`;
  document.getElementById('modal-sub').textContent=t('點數有效期：獲得後3個月內','Points valid for 3 months');
  document.getElementById('modal-overlay').style.display='flex';
}

// ── 兌換頁 ──
async function loadRedeem() {
  if(!currentUser) return;
  const rewardsListEl=document.getElementById('rewards-list');
  if(rewardsListEl) rewardsListEl.innerHTML=window.skeletonList(3);
  try {
    const snap=await getDoc(doc(db,'members',currentUser.uid)); if(snap.exists()) memberData=snap.data();
    const pts=memberData?.points||0;
    document.getElementById('redeem-pts-avail').textContent=Number.isInteger(pts)?pts.toLocaleString():pts.toFixed(1);
    document.getElementById('deduct-preview').textContent='0'; document.getElementById('deduct-input').value='';
    const list=document.getElementById('rewards-list');
    const rSnap=await getDocs(collection(db,'rewards'));
    if(rSnap.empty){ list.innerHTML=`<p class="empty-hint">${t('目前無兌換項目','No rewards available')}</p>`; return; }
    const rewards=[]; rSnap.forEach(d=>rewards.push({id:d.id,...d.data()})); rewards.sort((a,b)=>a.pts-b.pts);
    list.innerHTML='';
    rewards.forEach(r=>{
      const ok=pts>=r.pts; const item=document.createElement('div'); item.className='reward-item';
      const media = r.imageUrl
        ? `<img class="reward-photo" src="${r.imageUrl}" alt="" onclick="openImageViewer('${(r.imageUrl||'').replace(/'/g,"\\'")}')">`
        : `<div class="reward-emoji">${r.emoji||'🎁'}</div>`;
      item.innerHTML=`${media}
        <div class="reward-info"><div class="reward-name">${r.name_zh||r.name}</div><div class="reward-name-en">${r.name_en||''}</div><div class="reward-pts">${r.pts.toLocaleString()} ${t('點','pts')}</div></div>
        <button class="btn-redeem" ${!ok?'disabled':''} onclick="startRewardRedeem('${r.id}','${(r.name_zh||r.name).replace(/'/g,"\\'")}','${(r.name_en||r.name).replace(/'/g,"\\'")}',${r.pts})">
          ${ok?t('兌換','Redeem'):t('點數不足','Not enough')}</button>`;
      list.appendChild(item);
    });
  } catch(e) { console.error(e); }
}
// 圖片檢視（點獎品圖放大看品相）
window.openImageViewer=function(url){
  if(!url) return;
  const v=document.getElementById('img-viewer'), i=document.getElementById('img-viewer-img');
  if(v&&i){ i.src=url; v.style.display='flex'; }
};
window.closeImageViewer=function(){
  const v=document.getElementById('img-viewer'); if(v){ v.style.display='none'; document.getElementById('img-viewer-img').src=''; }
};
window.updateDeductPreview=function(){ document.getElementById('deduct-preview').textContent=(parseInt(document.getElementById('deduct-input').value)||0).toLocaleString(); };
window.startDeduct=function(){
  const pts=parseInt(document.getElementById('deduct-input').value)||0;
  if(pts<1){ showToast(t('請輸入折抵點數（至少1點）','Enter points (min 1)')); return; }
  if(pts>(memberData?.points||0)){ showToast(t('點數不足','Not enough points')); return; }
  pendingDeductPts=pts;
  document.getElementById('deduct-modal-info').textContent=`${t('折抵','Deduct')} ${pts} ${t('點 = NT$','pts = NT$')}${pts.toLocaleString()}\n${t('折抵後剩餘','After deduction')} ${((memberData?.points||0)-pts).toLocaleString()} ${t('點','pts')}`;
  document.getElementById('deduct-code-input').value='';
  document.getElementById('deduct-modal').style.display='flex';
};
window.confirmDeduct=async function(){
  if(document.getElementById('deduct-code-input').value.trim()!==getTodayCode()){ showToast(t('確認碼錯誤','Wrong code')); return; }
  document.getElementById('deduct-modal').style.display='none';
  try {
    // 優先扣除最快到期的點數批次
    await deductPointsByExpiry(pendingDeductPts);
    memberData.points-=pendingDeductPts;
    const _rp=memberData.points; document.getElementById('redeem-pts-avail').textContent=Number.isInteger(_rp)?_rp.toLocaleString():_rp.toFixed(1);
    showModal('💰',t('折抵成功！','Discount Applied!'),`-${pendingDeductPts}`,`${t('已折抵','Deducted')} NT${pendingDeductPts.toLocaleString()}\n${t('剩餘','Remaining')} ${Number.isInteger(_rp)?_rp.toLocaleString():_rp.toFixed(1)} ${t('點','pts')}`,false);
    document.getElementById('deduct-input').value=''; document.getElementById('deduct-preview').textContent='0';
  } catch(e) { console.error(e); showToast(t('折抵失敗','Deduction failed')); }
};

async function deductPointsByExpiry(ptsToDeduct) {
  // 只用單一 where('uid') 避免複合索引，前端過濾 remaining > 0
  const batchSnap = await getDocs(query(
    collection(db,'point_batches'),
    where('uid','==',currentUser.uid)
  ));
  const batches=[];
  const now=new Date();
  batchSnap.forEach(d=>{
    const b={id:d.id,...d.data()};
    if((b.remaining||0)>0 && b.expiresAt?.toDate()>now) batches.push(b);
  });
  batches.sort((a,b)=>(a.expiresAt?.toDate()||0)-(b.expiresAt?.toDate()||0));

  let left = ptsToDeduct;
  const batch = writeBatch(db);
  const mRef  = doc(db,'members',currentUser.uid);

  for (const b of batches) {
    if (left<=0) break;
    const deduct=Math.min(b.remaining, left);
    batch.update(doc(db,'point_batches',b.id),{remaining:b.remaining-deduct});
    left-=deduct;
  }
  batch.update(mRef,{points:increment(-ptsToDeduct),redeemCount:increment(1),deductedPts:increment(ptsToDeduct)});
  batch.set(doc(collection(db,'transactions')),{uid:currentUser.uid,type:'deduct',points:ptsToDeduct,desc:t(`折抵消費 NT$${ptsToDeduct}`,`Discount NT$${ptsToDeduct}`),createdAt:serverTimestamp()});
  await batch.commit();
}

window.startRewardRedeem=function(rewardId,nameZh,nameEn,pts){
  if((memberData?.points||0)<pts){ showToast(t('點數不足','Not enough')); return; }
  pendingReward={rewardId,nameZh,nameEn,pts};
  document.getElementById('reward-modal-info').textContent=`${lang==='zh'?nameZh:nameEn}\n${t('需要','Cost')} ${pts.toLocaleString()} ${t('點','pts')}\n${t('兌換後剩餘','Remaining')} ${((memberData?.points||0)-pts).toLocaleString()} ${t('點','pts')}`;
  document.getElementById('reward-code-input').value='';
  document.getElementById('reward-modal').style.display='flex';
};
window.confirmRewardRedeem=async function(){
  if(document.getElementById('reward-code-input').value.trim()!==getTodayCode()){ showToast(t('確認碼錯誤','Wrong code')); return; }
  document.getElementById('reward-modal').style.display='none'; if(!pendingReward) return;
  const{rewardId,nameZh,nameEn,pts}=pendingReward;
  try {
    await deductPointsByExpiry(pts);
    memberData.points-=pts; pendingReward=null; loadRedeem();
    showModal('🎁',t('兌換成功！','Redeemed!'),`-${pts}`,`${t('已兌換','Redeemed')}: ${lang==='zh'?nameZh:nameEn}\n${t('剩餘','Remaining')} ${memberData.points.toLocaleString()} ${t('點','pts')}`,false);
  } catch(e){ console.error(e); showToast(t('兌換失敗','Failed')); }
};

// ── 公告（同時讀取 announcements + broadcasts）──
async function loadAnnouncements() {
  const list=document.getElementById('announce-list');
  list.innerHTML=window.skeletonList(3);
  try {
    const [annSnap, bcSnap] = await Promise.all([
      getDocs(collection(db,'announcements')),
      getDocs(collection(db,'broadcasts')),
    ]);
    const items=[];
    annSnap.forEach(d=>items.push({id:d.id,...d.data(),_type:'ann'}));
    bcSnap.forEach(d=>items.push({id:d.id,...d.data(),_type:'bc'}));
    if(items.length===0){ list.innerHTML=`<p class="empty-hint">${t('目前沒有公告','No announcements')}</p>`; return; }
    items.sort((a,b)=>(b.createdAt?.toDate()||0)-(a.createdAt?.toDate()||0));
    list.innerHTML='';
    items.forEach(item=>{
      const dateStr=item.createdAt?item.createdAt.toDate().toLocaleDateString('zh-TW'):'';
      const isBc = item._type==='bc';
      const card=document.createElement('div');
      card.className='announce-card';
      card.style.borderLeftColor = isBc ? '#E67E22' : 'var(--pink)';
      const tag = isBc ? `<span style="font-size:10px;background:#FFF0D9;color:#E67E22;padding:1px 7px;border-radius:8px;font-weight:700;margin-left:6px">📣 ${t('廣播','Broadcast')}</span>` : '';
      card.innerHTML=`<div class="announce-date">${dateStr}${tag}</div>
        <div class="announce-title">${escHtml(item.title||'')}</div>
        <div class="announce-body">${escHtml(item.body||'')}</div>
        ${item.imageUrl?`<img src="${item.imageUrl}" class="announce-img" onclick="window.open('${item.imageUrl}','_blank')" alt="圖">`:''}`;
      list.appendChild(card);
    });
  } catch(e) { list.innerHTML=`<p class="empty-hint">${t('載入失敗','Load failed')}</p>`; }
}

// ── 客服 ──
async function loadSupport() {
  if(!currentUser) return;
  const loadEl=document.getElementById('chat-loading'); if(loadEl) loadEl.style.display='block';
  if(chatUnsub){chatUnsub();chatUnsub=null;}
  try {
    chatUnsub=onSnapshot(query(collection(db,'chats',currentUser.uid,'messages'),limit(200)),
      snap=>{
        if(loadEl) loadEl.style.display='none';
        const list=document.getElementById('chat-list'); list.innerHTML=''; lastDateLabel='';
        let hasUnread=false;
        const msgs=[]; snap.forEach(d=>msgs.push({id:d.id,...d.data()}));
        msgs.sort((a,b)=>(a.createdAt?.toDate()||0)-(b.createdAt?.toDate()||0));
        msgs.forEach(msg=>{
          const ds=msg.createdAt?msg.createdAt.toDate().toLocaleDateString('zh-TW',{month:'long',day:'numeric',weekday:'short'}):'';
          if(ds&&ds!==lastDateLabel){ lastDateLabel=ds; const sep=document.createElement('div'); sep.className='msg-date-divider'; sep.textContent=ds; list.appendChild(sep); }
          const isMine=msg.sender==='user';
          const ts=msg.createdAt?msg.createdAt.toDate().toLocaleTimeString('zh-TW',{hour:'2-digit',minute:'2-digit'}):'';
          if(!isMine&&!msg.read) hasUnread=true;
          const row=document.createElement('div'); row.className='msg-row '+(isMine?'mine':'theirs');
          const content=msg.imageUrl?`<img src="${msg.imageUrl}" class="chat-img-msg" onclick="window.open('${msg.imageUrl}','_blank')" alt="圖">`:`<div class="msg-bubble ${isMine?'mine':'theirs'}">${escHtml(msg.text||'')}</div>`;
          row.innerHTML=`${!isMine?`<div class="msg-avatar"><img src="/icons/logo.png" alt="BINI"></div>`:''}
          <div>${content}<div class="msg-time">${ts}</div></div>`;
          list.appendChild(row);
        });
        const el=document.getElementById('chat-messages'); el.scrollTop=el.scrollHeight;
        const badge=document.getElementById('unread-badge'); if(badge) badge.style.display=hasUnread?'block':'none';
        if(hasUnread) markMessagesRead();
      },
      err=>{
        console.log('chat 監聽錯誤:', err.code);
        if(loadEl) loadEl.style.display='none';
        // permission-denied 時停止重試，不讓 SDK 自動重連
        if(chatUnsub){ chatUnsub(); chatUnsub=null; }
        const list=document.getElementById('chat-list');
        if(list && err.code==='permission-denied') list.innerHTML='<p style="text-align:center;color:#aaa;padding:20px">載入失敗，請重新整理</p>';
      }
    );
  } catch(e) { console.log('loadSupport 初始化失敗:', e.message); }
}
async function markMessagesRead() {
  if(!currentUser) return;
  try {
    const snap=await getDocs(collection(db,'chats',currentUser.uid,'messages'));
    const toUpdate=snap.docs.filter(d=>{ const m=d.data(); return m.sender==='admin'&&m.read===false; });
    await Promise.all(toUpdate.map(d=>updateDoc(d.ref,{read:true})));
    await setDoc(doc(db,'chats',currentUser.uid),{unreadUser:0},{merge:true});
    const badge=document.getElementById('unread-badge'); if(badge) badge.style.display='none';
  } catch(e){ if(e.code!=='permission-denied') console.error('markRead:',e.code); }
}
window.sendMessage=async function(){
  const input=document.getElementById('chat-input'); const text=input.value.trim(); if(!text||!currentUser) return;
  const btn=document.getElementById('chat-send-btn'); if(btn) btn.disabled=true;
  const saved=input.value; input.value=''; input.style.height='auto';
  try{
    const uid=currentUser.uid;
    await addDoc(collection(db,'chats',uid,'messages'),{text,sender:'user',read:false,createdAt:serverTimestamp()});
    await setDoc(doc(db,'chats',uid),{uid,memberName:memberData?.name||'Member',phone:memberData?.phone||'',lastMsg:text,lastMsgAt:serverTimestamp(),unreadAdmin:increment(1),hidden:false},{merge:true});
  } catch(e){ console.error(e); input.value=saved; showToast(t('發送失敗: '+(e.code||e.message),'Failed: '+(e.code||e.message))); }
  finally{ if(btn) btn.disabled=false; input.focus(); }
};
window.handleChatImage=async function(input){
  const file=input.files[0]; if(!file||!currentUser) return;
  if(file.size>5*1024*1024){ showToast(t('圖片不能超過5MB','Max 5MB')); return; }
  showToast(t('上傳中...','Uploading...'));
  try{
    const uid=currentUser.uid;
    const sRef=ref(storage,`chat_images/${uid}/${Date.now()}_${file.name}`);
    await uploadBytes(sRef,file); const imageUrl=await getDownloadURL(sRef);
    await addDoc(collection(db,'chats',uid,'messages'),{imageUrl,sender:'user',read:false,createdAt:serverTimestamp()});
    await setDoc(doc(db,'chats',uid),{uid,memberName:memberData?.name||'Member',phone:memberData?.phone||'',lastMsg:'[圖片]',lastMsgAt:serverTimestamp(),unreadAdmin:increment(1),hidden:false},{merge:true});
  } catch(e){ showToast(t('上傳失敗','Upload failed')); }
  input.value='';
};
window.insertTopic=function(key){
  const topics={a:{zh:'想詢問點數相關問題',en:'Question about my points'},b:{zh:'想了解兌換方式',en:'About redemption'},c:{zh:'想詢問目前優惠活動',en:'About promotions'},d:{zh:'其他問題',en:'Other'}};
  const tp=topics[key]||topics.a; const input=document.getElementById('chat-input');
  input.value=lang==='zh'?tp.zh:tp.en; autoResize(input);
};
window.autoResize=function(el){ el.style.height='auto'; el.style.height=Math.min(el.scrollHeight,90)+'px'; };

// ── 個人資料 ──
async function loadProfile() {
  if(!currentUser) return;
  try{
    const snap=await getDoc(doc(db,'members',currentUser.uid)); if(!snap.exists()) return;
    const d=snap.data(); memberData=d;
    document.getElementById('profile-avatar').textContent=d.name.slice(0,1);
    document.getElementById('profile-name').textContent=d.name;
    document.getElementById('info-phone').textContent=d.phone;
    document.getElementById('info-birthday').textContent=d.birthday||t('未填寫','Not provided');
    const joined=d.joinedAt?.toDate();
    document.getElementById('profile-since').textContent=joined?(t('會員自 ','Since ')+joined.getFullYear()+'/'+(joined.getMonth()+1)):'—';
    const spent=d.totalSpent||0;
    const tier=getTierBySpent(spent); const nextTierIdx=TIERS.findIndex(ti=>ti.id===tier.id)+1;
    const nextTier=TIERS[nextTierIdx];
    document.getElementById('profile-tier').textContent=tier.icon+' '+(lang==='zh'?tier.name.zh:tier.name.en);
    document.getElementById('stat-spent').textContent='NT$'+(spent||0).toLocaleString();
    document.getElementById('stat-visits').textContent=(d.visitCount||0).toLocaleString();
    document.getElementById('stat-pts').textContent=(d.points||0).toLocaleString();
    document.getElementById('stat-redeems').textContent=(d.deductedPts||0).toLocaleString();
    if(nextTier){
      const pct=Math.min(Math.round((spent-tier.minSpent)/(nextTier.minSpent-tier.minSpent)*100),100);
      document.getElementById('tier-bar').style.width=pct+'%';
      document.getElementById('tier-from').textContent=lang==='zh'?tier.name.zh:tier.name.en;
      document.getElementById('tier-to').textContent=lang==='zh'?nextTier.name.zh:nextTier.name.en;
      document.getElementById('tier-progress').textContent=`NT$${spent.toLocaleString()} / NT$${nextTier.minSpent.toLocaleString()}`;
      document.getElementById('tier-label').textContent=t(`距離 ${nextTier.name.zh} 還需消費 NT$${(nextTier.minSpent-spent).toLocaleString()}`,`NT$${(nextTier.minSpent-spent).toLocaleString()} more to reach ${nextTier.name.en}`);
      document.getElementById('tier-next-rule').textContent=lang==='zh'?nextTier.label.zh:nextTier.label.en;
    } else {
      document.getElementById('tier-bar').style.width='100%';
      document.getElementById('tier-label').textContent=t('已達最高等級 💎','Top tier reached 💎');
      ['tier-from','tier-to','tier-progress','tier-next-rule'].forEach(id=>document.getElementById(id).textContent='');
    }
    const rcEl=document.getElementById('profile-referral-count');
    if(rcEl) rcEl.textContent=`${d.referralRewardCount||0} / 10`;
    loadReferralCode();
  } catch(e){ console.error(e); }
}
// 取得並顯示自己的推薦碼
async function loadReferralCode() {
  const el=document.getElementById('profile-referral-code'); if(!el) return;
  try {
    const r=await callFn('getOrCreateReferralCode');
    if(r?.code){ el.textContent=r.code; window._myReferralCode=r.code; }
  } catch(e){ console.log('referralCode:',e.code||e.message); el.textContent='—'; }
}
window.copyReferralCode=function(){
  const code=window._myReferralCode||document.getElementById('profile-referral-code')?.textContent||'';
  if(!code||code==='—') return;
  const done=()=>showToast(t('推薦碼已複製','Code copied'));
  if(navigator.clipboard?.writeText){ navigator.clipboard.writeText(code).then(done).catch(done); }
  else { done(); }
};
async function checkUnread() {
  if(!currentUser) return;
  try {
    const snap=await getDocs(collection(db,'chats',currentUser.uid,'messages'));
    const hasUnread=snap.docs.some(d=>{ const m=d.data(); return m.sender==='admin'&&m.read===false; });
    const badge=document.getElementById('unread-badge'); if(badge) badge.style.display=hasUnread?'block':'none';
  } catch(e){}
}

// ── 推播通知系統 ──
// ── 推播通知系統（雙軌：FCM Web Push + Firestore 即時監聽）──
let notificationsUnsub = null;

// 使用者點擊「開啟推播通知」按鈕後呼叫（iOS 需要手勢觸發）
window.handleEnablePush = async function() {
  const btn = document.getElementById('btn-enable-push');
  if (btn) btn.style.display = 'none';
  await initPushNotifications();
};

async function initPushNotifications() {
  if (!currentUser) return;

  if (messaging && 'Notification' in window) {
    try {
      const permission = await Notification.requestPermission();
      console.log('通知權限:', permission);
      if (permission !== 'granted') return;

      // ── 方案A：FCM Token（個人推播）──
      let swReg = null;
      try {
        const allRegs = await navigator.serviceWorker.getRegistrations();
        swReg = allRegs.find(r =>
          (r.active?.scriptURL || r.installing?.scriptURL || r.waiting?.scriptURL || '')
          .includes('firebase-messaging-sw')
        ) || await navigator.serviceWorker.ready;
      } catch(swErr) { console.log('SW ready 失敗:', swErr.message); }

      let token = null;
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          token = await getToken(messaging, {
            vapidKey: VAPID_KEY,
            serviceWorkerRegistration: swReg,
          });
          if (token) { console.log(`✅ getToken 成功 (嘗試${attempt})`); break; }
        } catch(tokenErr) {
          console.log(`❌ getToken 失敗 (嘗試${attempt}):`, tokenErr.message);
          if (attempt < 3) await new Promise(r => setTimeout(r, 2000 * attempt));
        }
      }

      if (token) {
        const platform = /iPhone|iPad|iPod|Android/.test(navigator.userAgent) ? 'mobile' : 'web';
        const tokenRef = doc(db, 'push_tokens', currentUser.uid);
        try {
          await setDoc(tokenRef, { uid: currentUser.uid }, { merge: true });
          await updateDoc(tokenRef, {
            [`tokens.${platform}`]: token,
            [`ua.${platform}`]: navigator.userAgent.substring(0, 100),
            updatedAt: serverTimestamp(),
          });
          console.log(`✅ FCM Token 儲存完成 [${platform}]`);
        } catch(saveErr) {
          console.error('❌ FCM Token 儲存失敗:', saveErr.message);
        }
      } else {
        console.log('⚠️ getToken 失敗，推播功能將受限（app 前景通知仍可運作）');
      }

      // ── 方案B：前台推播（APP 開啟時收到通知）──
      try {
        onMessage(messaging, payload => {
          const n = payload.notification || {};
          showInAppNotification(n.title || 'BINI Blooms', n.body || '', payload.data?.type);
        });
      } catch(msgErr) { console.log('onMessage 設定失敗:', msgErr.message); }

    } catch(e) {
      console.log('推播初始化失敗:', e.code || e.message);
    }
  } else {
    console.log('推播不支援:', !messaging ? 'messaging=null' : 'Notification API 不存在');
  }

  // ── 方案B：Firestore 即時監聽（APP 開著時）──
  if (notificationsUnsub) { notificationsUnsub(); notificationsUnsub = null; }
  const listenStartTime = Date.now();
  try {
    notificationsUnsub = onSnapshot(
      query(collection(db, 'notifications'), orderBy('createdAt', 'desc'), limit(20)),
      snap => {
        snap.docChanges().forEach(change => {
          if (change.type !== 'added') return;
          const d = change.doc.data();
          if (d.target !== 'all' && d.target !== currentUser.uid) return;
          const ts = d.createdAt?.toDate();
          if (!ts || ts.getTime() < listenStartTime - 3000) return;
          showInAppNotification(d.title, d.body, d.type);
        });
      },
      err => {
        console.log('notifications 監聽錯誤:', err.code);
        // 權限錯誤時停止監聽，不重試
        if (notificationsUnsub) { notificationsUnsub(); notificationsUnsub = null; }
      }
    );
  } catch(e) {
    console.log('notifications 監聽初始化失敗:', e.message);
  }
}

function showInAppNotification(title, body, type) {
  // 前台通知：toast + 原生 Notification（若有權限）
  // 前台僅顯示 toast，不再呼叫 new Notification()
  // iOS PWA 前台時 SW 的 onBackgroundMessage 不觸發，背景時才觸發，不會重複
  // 曾用 new Notification() 導致 iOS 前台+背景各顯示一次，移除避免重複
  showToast(`🔔 ${title}: ${body}`);
  // 依類型更新 UI
  if (type === 'chat') { checkUnread(); if(document.getElementById('page-support').classList.contains('active')) loadSupport(); }
  if (type === 'announcement') { if(document.getElementById('page-announce').classList.contains('active')) loadAnnouncements(); }
  // 訂單狀態更新：若訂單相關頁面開著就自動刷新
  if (type === 'order_status' || type === 'order_created') {
    const myOrdersPage = document.getElementById('page-shop-my-orders');
    if (myOrdersPage?.classList.contains('active') && window.ShopPage) ShopPage.openMyOrders();
  }
}

window.updateShopLangBtns = function() {
  const l = lang;
  ['zh','en'].forEach(x => {
    const el = document.getElementById('shop-lbtn-'+x); if(el){ el.classList.toggle('act', x===l); el.classList.toggle('inact', x!==l); }
  });
};

// ── SW postMessage：推播點擊後頁面切換 ──
navigator.serviceWorker?.addEventListener('message', e => {
  if (e.data?.type === 'navigate' && e.data.page) {
    const pageId = e.data.page;
    const validPages = ['home','scan','redeem','announce','support','shop','profile'];
    if (!validPages.includes(pageId)) return;
    // 必須等 app 畫面顯示才能切換
    const trySwitch = (retry = 0) => {
      const btn = document.querySelector(`.bnav-btn[onclick*="${pageId}"]`);
      const page = document.getElementById('page-' + pageId);
      if (btn && page && document.getElementById('screen-app').classList.contains('active')) {
        window.switchPage(pageId, btn);
      } else if (retry < 20) {
        setTimeout(() => trySwitch(retry + 1), 200);
      }
    };
    trySwitch();
  }
});

// ── 工具 ──
function setMsg(el,msg,type){ el.textContent=msg; el.className='login-msg '+(type||''); }
function showToast(msg){ const t=document.getElementById('toast'); t.textContent=msg; t.classList.add('show'); setTimeout(()=>t.classList.remove('show'),2800); }
function showModal(icon,title,pts,sub,isEarn=true){
  document.getElementById('modal-icon').textContent=icon;
  document.getElementById('modal-icon').className='modal-icon';
  document.getElementById('modal-title').textContent=title;
  document.getElementById('modal-pts').textContent=pts;
  document.getElementById('modal-pts').className='modal-pts '+(isEarn?'':'minus');
  document.getElementById('modal-earn-detail').style.display='none';
  document.getElementById('modal-sub').textContent=sub;
  document.getElementById('modal-overlay').style.display='flex';
}
window.closeModal=function(){ document.getElementById('modal-overlay').style.display='none'; loadHomeData(); if(document.getElementById('page-redeem').classList.contains('active'))loadRedeem(); };
function escHtml(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/\n/g,'<br>'); }
