// ══════════════════════════════════════════════
//  BINI Backend admin-app.js v2.0.24
//  新QR流程 + 資料分析 + 廣播 + 雙向推播通知
// ══════════════════════════════════════════════
import { db, auth, storage, messaging } from './firebase-config.js';
import {
  signInWithEmailAndPassword, sendPasswordResetEmail,
  updatePassword, onAuthStateChanged, signOut, EmailAuthProvider, reauthenticateWithCredential
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import {
  doc, getDoc, setDoc, addDoc, updateDoc, deleteDoc,
  collection, query, where, getDocs, onSnapshot,
  serverTimestamp, Timestamp, increment, writeBatch, orderBy, limit
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { ref, uploadBytes, getDownloadURL } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js';
import { getToken, onMessage } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging.js';
import { getFunctions, httpsCallable } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js';

// VAPID Key（與客戶端相同）
const VAPID_KEY = 'BHTHLzWPh4B-4m_moKfu7jCUwfqeT-r8vTbtUQct3EMAiaUKz45YbexrWx_xp72plFRNSq0ss2hmhWMvv13m2F4';

// ── 升級制度（與客戶端同步）──
const TIERS = [
  { id:'normal', name:'一般會員', nameEn:'Regular', minSpent:0,     maxSpent:10000,  rate:1.0 },
  { id:'vip',    name:'VIP 會員', nameEn:'VIP',     minSpent:10001, maxSpent:15000,  rate:1.3 },
  { id:'vvip',   name:'VVIP 會員',nameEn:'VVIP',    minSpent:15001, maxSpent:25000,  rate:1.5 },
  { id:'vvvip',  name:'VVVIP 會員',nameEn:'VVVIP',  minSpent:25001,maxSpent:Infinity,rate:2.0},
];
const BASE_UNIT         = 200;
const POINTS_EXPIRY_DAYS= 90;

function getTierBySpent(s){ for(let i=TIERS.length-1;i>=0;i--){if(s>=TIERS[i].minSpent)return TIERS[i];}return TIERS[0]; }
function calcPoints(amount,tier){ return Math.round(Math.floor(amount/BASE_UNIT)*tier.rate*10)/10; } // 先取整數單位再乘倍率

let currentAdmin=null, inboxUnsub=null, chatUnsub=null, pendingQRUnsub=null;
let inboxDocs=[], inboxShowHidden=false;
let chatUid='', cdTimer=null, annImgFile=null;
let shopLang=localStorage.getItem('shop_lang')||'zh';

// ── 語言切換（完整 DOM 重新渲染）──
window.shopSetLang = function(l) {
  shopLang = l;
  localStorage.setItem('shop_lang', l);
  document.getElementById('slbtn-zh').className = l==='zh' ? 'act' : 'inact';
  document.getElementById('slbtn-en').className = l==='en' ? 'act' : 'inact';
  applyAdminLang();
  // 立即重新 render 動態內容（商品/訂單/報表/分析）
  if (typeof syncShopNavLang === 'function') syncShopNavLang();
  // 分析頁
  if (document.getElementById('tab-analytics-page')?.classList.contains('active')) {
    if (typeof window.loadAnalytics === 'function') window.loadAnalytics();
  }
};

function applyAdminLang() {
  const l = shopLang;

  // 1. 所有帶 data-zh/data-en 的 span 元素
  document.querySelectorAll('[data-zh]').forEach(el => {
    el.textContent = l==='zh' ? el.dataset.zh : (el.dataset.en || el.dataset.zh);
  });

  // 2. placeholder 屬性
  document.querySelectorAll('[data-ph-zh]').forEach(el => {
    el.placeholder = l==='zh' ? el.dataset.phZh : (el.dataset.phEn || el.dataset.phZh);
  });

  // 3. Tab 按鈕文字
  // Nav 按鈕：只更新 span 文字，保留 SVG 圖示
  const navTexts = {
    'tab-qr':        ['集點', 'Points'],
    'tab-announce':  ['公告', 'News'],
    'tab-broadcast': ['廣播', 'Broadcast'],
    'tab-rewards':   ['獎品', 'Rewards'],
    'tab-analytics': ['分析', 'Stats'],
    'tab-msg':       ['客服', 'Support'],
    'tab-settings':  ['設定', 'Settings'],
  };
  for (const [id, [zh, en]] of Object.entries(navTexts)) {
    const btn = document.getElementById(id); if (!btn) continue;
    const span = btn.querySelector('span:not(.admin-badge)');
    if (span) {
      const badge = span.querySelector('.admin-badge');
      if (badge) badge.remove();
      span.textContent = l==='zh' ? zh : en;
      if (badge) span.appendChild(badge);
    }
  }

  // 4. 登入頁按鈕
  const loginBtn = document.querySelector('#screen-login .btn-primary');
  if (loginBtn) loginBtn.textContent = l==='zh' ? '登入' : 'Sign In';
  const forgotBtn = document.querySelector('.forgot-btn');
  if (forgotBtn) forgotBtn.textContent = l==='zh' ? '忘記密碼？寄送重設郵件' : 'Forgot password? Send reset email';

  // 5. 登出按鈕
  const logoutBtn = document.querySelector('.btn-logout');
  if (logoutBtn) logoutBtn.textContent = l==='zh' ? '登出' : 'Sign Out';

  // 6. 發送按鈕
  const btnSendAnn = document.getElementById('btn-send-ann');
  if (btnSendAnn) btnSendAnn.textContent = l==='zh' ? '📢 發送公告' : '📢 Send Announcement';
  const btnSendBc = document.getElementById('btn-send-bc');
  if (btnSendBc) btnSendBc.textContent = l==='zh' ? '📣 發送廣播' : '📣 Send Broadcast';

  // 7. QR 相關按鈕
  const btnConfirm = document.getElementById('btn-confirm-amount');
  if (btnConfirm) btnConfirm.textContent = l==='zh' ? '確認發點' : 'Confirm Points';
  const btnGen = document.querySelector('#tab-qr-page .btn-primary');
  if (btnGen) btnGen.textContent = l==='zh' ? '產生 QR Code' : 'Generate QR';
  const btnInstall = document.getElementById('btn-shop-install');
  if (btnInstall) btnInstall.innerHTML = `📲 ${l==='zh'?'加入主畫面（BINI Backend）':'Add to Home (BINI Backend)'}`;

  // 8. 設定頁按鈕
  const btnChangePw = document.querySelector('#tab-settings-page .btn-outline');
  if (btnChangePw) btnChangePw.textContent = l==='zh' ? '修改密碼' : 'Change Password';
  const btnConfirmPw = document.querySelector('#pw-section .btn-primary');
  if (btnConfirmPw) btnConfirmPw.textContent = l==='zh' ? '確認修改密碼' : 'Confirm';

  // 9. 獎品表單（標題/按鈕依新增或編輯模式切換語言）
  if (typeof applyRewardFormMode === 'function') applyRewardFormMode();

  // 10. 對話視窗返回按鈕
  const backBtn = document.querySelector('.back-btn');
  if (backBtn) { const svg=backBtn.querySelector('svg'); backBtn.textContent=l==='zh'?'返回':'Back'; if(svg) backBtn.prepend(svg); }

  // 11. 重新載入當前 tab 的動態內容
  const activeTab = document.querySelector('.tab-page.active');
  if (activeTab) {
    const tabId = activeTab.id;
    if (tabId==='tab-rewards-page') loadRewards();
    if (tabId==='tab-announce-page') loadAnnouncements();
  }
}

function t(zh,en){ return shopLang==='zh'?zh:en; }

// ── Auth ──
async function verifyAdmin(user){
  try{ const snap=await getDoc(doc(db,'admins',user.uid)); if(!snap.exists()) return null; const d=snap.data(); return d.disabled===true?null:d; }
  catch(e){ console.error(e); return null; }
}
onAuthStateChanged(auth,async user=>{
  if(user){
    const ad=await verifyAdmin(user);
    if(!ad){ await signOut(auth); showLoginMsg(t('此帳號沒有後台權限','No admin access'),'error'); return; }
    currentAdmin=user;
    document.getElementById('admin-email-display').textContent=user.email||'Admin';
    showApp();
  } else { currentAdmin=null; showLogin(); }
});

function showLogin(){ document.getElementById('screen-login').classList.add('active'); document.getElementById('screen-app').classList.remove('active'); const n=document.getElementById('admin-bnav'); if(n) n.classList.remove('visible'); }

// ── Firebase 真實連線狀態監測 ──
function startConnectionMonitor() {
  const dot  = document.getElementById('admin-status-dot');
  const text = document.getElementById('admin-status-inline')?.querySelector('span:last-child');
  function setOnline()  {
    if(dot)  { dot.style.background='#4caf50'; dot.style.boxShadow='0 0 6px #4caf50'; }
    if(text) text.textContent = shopLang==='zh' ? 'Firebase 已連線' : 'Firebase Connected';
  }
  function setOffline() {
    if(dot)  { dot.style.background='#e53935'; dot.style.boxShadow='0 0 6px #e53935'; }
    if(text) text.textContent = shopLang==='zh' ? 'Firebase 離線' : 'Firebase Offline';
  }
  // 1. 瀏覽器 online/offline 事件（快速回應）
  window.addEventListener('online',  setOnline);
  window.addEventListener('offline', setOffline);
  if(!navigator.onLine) setOffline();

  // 2. 用 onSnapshot 監聽實際 Firestore 連線（真正可靠）
  // 監聽一個必定存在的 admins 文件，成功回調 = 已連線，error = 離線
  try {
    const testRef = doc(db, 'admins', currentAdmin?.uid || 'ping');
    onSnapshot(testRef,
      () => setOnline(),     // 收到任何資料 = 連線正常
      () => setOffline()     // error callback = 連線中斷
    );
  } catch(e) { /* 靜默處理 */ }
}

function showApp(){
  document.getElementById('screen-login').classList.remove('active');
  document.getElementById('screen-app').classList.add('active');
  const todayEl=document.getElementById('today-date'); if(todayEl) todayEl.textContent=new Date().toLocaleDateString('zh-TW',{month:'long',day:'numeric',weekday:'short'});
  applyAdminLang();
  loadMemberCount(); loadStats(); startInbox(); loadRewards(); loadAnnouncements();
  startConnectionMonitor();
  if(window._deferredInstall || (isIOSDevice() && !isStandalonePWA())) document.getElementById('btn-shop-install').style.display='flex';
  switchTab('qr');
  // 登入後同步 shop nav 語言（300ms 等待 admin-shop.js inject 完成）
  setTimeout(() => { if (typeof syncShopNavLang === 'function') syncShopNavLang(); }, 500);
  // 推播初始化：已授權直接初始化，否則顯示按鈕等待手勢（iOS 必須）
  setTimeout(() => {
    const perm = ('Notification' in window) ? Notification.permission : 'unsupported';
    console.log('[AdminPush] Notification.permission =', perm);
    if(perm === 'granted'){
      initAdminPush();
    } else {
      const btn = document.getElementById('btn-admin-enable-push');
      if(btn){ btn.style.display = 'flex'; console.log('[AdminPush] 顯示「開啟推播通知」按鈕'); }
    }
  }, 1000);
}

// ── 管理員推播初始化 ──
window.handleAdminEnablePush = async function() {
  const btn = document.getElementById('btn-admin-enable-push');
  if(btn) btn.style.display = 'none';
  await initAdminPush();
};

// 設定頁的「重新啟用推播」：強制重跑 getToken 並寫回 admin_tokens
// 用於 token 失效（NotRegistered）等狀況下，由店家手動修復
window.reEnableAdminPush = async function() {
  if(!('Notification' in window)) {
    showToast(shopLang==='zh' ? '此裝置不支援推播' : 'Push not supported on this device');
    return;
  }
  if(Notification.permission === 'denied') {
    alert(shopLang==='zh'
      ? '⚠️ 推播權限已被封鎖\n\n請至 iOS「設定 → 通知 → BINI Backend」開啟允許通知，回到 APP 後再試一次。'
      : '⚠️ Push permission is blocked\n\nPlease enable notifications in iOS Settings → Notifications → BINI Backend, then return to the app and try again.');
    return;
  }
  showToast(shopLang==='zh' ? '重新註冊推播中…' : 'Re-registering push…');
  try {
    await initAdminPush();
    if(Notification.permission === 'granted') {
      showToast(shopLang==='zh' ? '✅ 推播已重新啟用' : '✅ Push notifications re-enabled');
    } else {
      showToast(shopLang==='zh' ? '未啟用推播' : 'Push not enabled');
    }
  } catch(e) {
    console.error('reEnableAdminPush:', e);
    showToast(shopLang==='zh' ? '推播啟用失敗，請稍後再試' : 'Failed to re-enable push, please retry');
  }
};

async function initAdminPush() {
  if(!messaging || !currentAdmin) return;
  if(!('Notification' in window)) return;
  try {
    const permission = await Notification.requestPermission();
    console.log('管理員通知權限:', permission);
    if(permission !== 'granted') return;

    let swReg = null;
    try {
      swReg = await navigator.serviceWorker.ready;
      const allRegs = await navigator.serviceWorker.getRegistrations();
      const fcmReg = allRegs.find(r => r.active?.scriptURL?.includes('firebase-messaging-sw'));
      if(fcmReg) swReg = fcmReg;
      console.log('管理員 SW:', swReg?.active?.scriptURL);
    } catch(e) { console.log('管理員 SW ready 失敗:', e.message); }

    try {
      const token = await getToken(messaging, { vapidKey:VAPID_KEY, serviceWorkerRegistration:swReg });
      if(token){
        // 按平台分開存 token，避免手機/桌面互相覆蓋
        const platform = /iPhone|iPad|iPod|Android/.test(navigator.userAgent) ? 'mobile' : 'web';
        // 用 token 前16字當裝置key，支援多支手機同時登入
        const deviceKey = token.substring(0, 16).replace(/[^a-zA-Z0-9_-]/g, '_');
        const adminRef = doc(db, 'admin_tokens', currentAdmin.uid);
        await setDoc(adminRef, { uid: currentAdmin.uid, email: currentAdmin.email||'' }, { merge: true });
        await updateDoc(adminRef, {
          [`devices.${deviceKey}.token`]: token,
          [`devices.${deviceKey}.platform`]: platform,
          [`devices.${deviceKey}.ua`]: navigator.userAgent.substring(0, 100),
          [`devices.${deviceKey}.updatedAt`]: new Date().toISOString(),
          updatedAt: serverTimestamp(),
        });
        console.log(`✅ 管理員推播 Token 已儲存 [${platform}] device:${deviceKey}:`, token.substring(0,20)+'...');
      } else {
        console.log('⚠️ 管理員 getToken 回傳空值');
      }
    } catch(tokenErr) {
      console.log('❌ 管理員 getToken 失敗:', tokenErr.code, tokenErr.message);
    }

    // 前台推播
    try {
      onMessage(messaging, payload => {
        const d = payload.data || {};
        const title = d.title || (payload.notification && payload.notification.title) || 'BINI Backend';
        const body  = d.body  || (payload.notification && payload.notification.body)  || '新訊息';
        showToast('🔔 ' + title + ': ' + body);
        if(d.type === 'chat') startInbox();
      });
    } catch(e) {}
  } catch(e) {
    console.log('管理員推播初始化失敗:', e.message);
  }
}
function showLoginMsg(msg,type){ const el=document.getElementById('login-msg'); el.textContent=msg; el.className='login-msg '+(type||''); }

window.handleAdminSignIn=async function(){
  const email=document.getElementById('admin-email').value.trim();
  const pw=document.getElementById('admin-password').value;
  if(!email){ showLoginMsg(t('請輸入 Email','Enter email'),'error'); return; }
  if(!pw||pw.length<6){ showLoginMsg(t('請輸入密碼','Enter password'),'error'); return; }
  showLoginMsg(t('登入中...','Signing in...'),'');
  try{
    const cred=await signInWithEmailAndPassword(auth,email,pw);
    const ad=await verifyAdmin(cred.user);
    if(!ad){ await signOut(auth); showLoginMsg(t('此帳號沒有後台權限','No admin access'),'error'); }
  } catch(e){
    const m={'auth/invalid-credential':t('Email 或密碼錯誤','Wrong email or password'),'auth/too-many-requests':t('嘗試次數過多','Too many attempts')};
    showLoginMsg(m[e.code]||(t('登入失敗','Failed: ')+e.code),'error');
  }
};
window.handleForgotPw=async function(){
  const email=document.getElementById('admin-email').value.trim();
  if(!email){ showLoginMsg(t('請先輸入 Email','Enter email first'),'error'); return; }
  try{ await sendPasswordResetEmail(auth,email); showLoginMsg(t('重設郵件已發送','Reset email sent'),'success'); }
  catch(e){ showLoginMsg(t('發送失敗','Failed: '+e.code),'error'); }
};
window.handleAdminLogout=async function(){
  if(pendingQRUnsub){pendingQRUnsub();pendingQRUnsub=null;}
  if(inboxUnsub){inboxUnsub();inboxUnsub=null;} if(chatUnsub){chatUnsub();chatUnsub=null;}
  clearInterval(cdTimer); await signOut(auth);
};
window.handleChangePw=async function(){
  const oldPw=document.getElementById('old-password').value;
  const newPw=document.getElementById('new-password').value;
  const newPw2=document.getElementById('new-password2').value;
  if(!oldPw||!newPw||newPw.length<6){ alert(t('請填寫完整資料（新密碼至少6碼）','Fill all fields (6+ chars)')); return; }
  if(newPw!==newPw2){ alert(t('兩次新密碼不一致','Passwords do not match')); return; }
  try{
    const cred=EmailAuthProvider.credential(currentAdmin.email,oldPw);
    await reauthenticateWithCredential(currentAdmin,cred);
    await updatePassword(currentAdmin,newPw);
    document.getElementById('pw-section').style.display='none';
    ['old-password','new-password','new-password2'].forEach(id=>document.getElementById(id).value='');
    alert(t('✅ 密碼已更新！','✅ Password updated!'));
  } catch(e){
    alert(e.code==='auth/wrong-password'?t('舊密碼錯誤','Wrong current password'):t('修改失敗','Failed: '+e.code));
  }
};

// ── Tab 切換 ──
window.switchTab=function(tab){
  // 切換分頁時自動把刪除工具重新上鎖（即使停留在設定頁未操作也回到密碼狀態），避免誤按
  lockClearData();
  const _nav=document.getElementById('admin-bnav'); if(_nav) _nav.classList.add('visible');
  document.querySelectorAll('.tab-btn,.admin-bnav-btn').forEach(b=>b.classList.remove('active'));
  document.querySelectorAll('.tab-page').forEach(p=>{ p.classList.remove('active'); p.scrollTop=0; });
  document.getElementById('tab-'+tab).classList.add('active');
  document.getElementById('tab-'+tab+'-page').classList.add('active');
  if(tab==='announce') loadAnnouncements();
  if(tab==='rewards')  loadRewards();
  if(tab==='analytics') loadAnalytics();
};

// 將刪除工具重設回密碼鎖狀態
function lockClearData(){
  if (_clearDataIdleTimer) { clearTimeout(_clearDataIdleTimer); _clearDataIdleTimer = null; }
  const lock = document.getElementById('clear-data-lock');
  const tools = document.getElementById('clear-data-tools');
  const pw = document.getElementById('clear-data-pw');
  const msg = document.getElementById('clear-data-msg');
  if (lock)  lock.style.display = '';
  if (tools) tools.style.display = 'none';
  if (pw)    pw.value = '';
  if (msg)   msg.textContent = '';
}
// 暴露到 window：admin-shop.js 會覆寫 window.switchTab，那個版本也要能呼叫到此函式
window.lockClearData = lockClearData;

// ── PWA ──
function isIOSDevice(){
  return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform==='MacIntel' && navigator.maxTouchPoints>1);
}
function isIOSSafari(){
  if(!isIOSDevice()) return false;
  const ua=navigator.userAgent;
  return /Safari/i.test(ua) && !/(CriOS|FxiOS|EdgiOS|OPiOS|GSA|Line|FBA[NV]|FBIOS|Instagram|MicroMessenger|DuckDuckGo|YaBrowser)/i.test(ua);
}
function isStandalonePWA(){
  return window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
}
window.addEventListener('beforeinstallprompt',e=>{ e.preventDefault(); window._deferredInstall=e; if(document.getElementById('screen-app').classList.contains('active')) document.getElementById('btn-shop-install').style.display='flex'; });
window.handleShopInstall=async function(){
  if(isStandalonePWA()){ alert(shopLang==='zh'?'已在主畫面！':'Already on home screen!'); return; }
  if(window._deferredInstall){ if(!confirm(shopLang==='zh'?'加入 BINI Backend 到主畫面？':'Add BINI Backend to Home Screen?'))return; window._deferredInstall.prompt(); await window._deferredInstall.userChoice; window._deferredInstall=null; }
  else if(isIOSDevice() && !isIOSSafari()){
    let copied=false;
    try{ await navigator.clipboard?.writeText(location.href.split('#')[0]); copied=true; }catch(e){}
    alert(shopLang==='zh'
      ? '⚠️ 請改用「Safari」開啟本頁\n\niOS 只有 Safari 能「加入主畫面」並啟用推播通知，目前的瀏覽器（如 Chrome）做不到。\n\n'+(copied?'已複製網址，請：\n1. 開啟 Safari 貼上網址前往\n':'1. 用 Safari 開啟本頁網址\n')+'2. 點畫面下方「分享」按鈕 □↑\n3. 往下滑，選「加入主畫面」'
      : '⚠️ Please open this page in Safari\n\nOn iOS, only Safari can Add to Home Screen & enable push. Other browsers (e.g. Chrome) cannot.\n\n'+(copied?'The URL has been copied:\n1. Open Safari and paste the URL\n':'1. Open this page in Safari\n')+'2. Tap Share □↑\n3. Choose "Add to Home Screen"');
  }
  else if(isIOSDevice()){
    alert(shopLang==='zh'
      ? 'iOS 加入主畫面步驟：\n1. 點畫面下方「分享」按鈕 □↑\n2. 往下滑，選「加入主畫面」\n3. 確認名稱「BINI Backend」後點「新增」'
      : 'Add to Home Screen (iOS):\n1. Tap Share □↑\n2. Scroll and tap "Add to Home Screen"\n3. Confirm "BINI Backend" and tap Add');
  }
  else alert(shopLang==='zh'?'請從瀏覽器選單選擇「安裝」或「加入主畫面」':'Use your browser menu: Install / Add to Home Screen');
};

// ── 會員人數 ──
async function loadMemberCount(){
  try{ const snap=await getDocs(collection(db,'members')); document.getElementById('member-count').textContent=snap.size.toLocaleString(); }
  catch(e){ console.error(e); }
}

// ── QR 產生（新流程：只含 token，無金額）──
window.generateQR=async function(){
  try{
    // 清除舊監聽
    if(pendingQRUnsub){pendingQRUnsub();pendingQRUnsub=null;}
    const r=await addDoc(collection(db,'qr_tokens'),{status:'pending',used:false,createdAt:serverTimestamp()});
    const tokenId=r.id;
    // 只把 token 編碼進 QR，不包含金額
    QRCode.toCanvas(document.getElementById('qr-canvas'),JSON.stringify({token:tokenId}),{width:220,margin:1,color:{dark:'#3d0c1a',light:'#ffffff'}});
    document.getElementById('qr-section').classList.add('visible');
    document.getElementById('qr-member-info').textContent=t('等待客人掃描中...','Waiting for customer scan...');
    document.getElementById('qr-amount-form').style.display='none';
    startCd(2*60);
    // 監聽客人掃描
    pendingQRUnsub=onSnapshot(doc(db,'qr_tokens',tokenId),snap=>{
      if(!snap.exists()) return;
      const d=snap.data();
      if(d.status==='scanned'&&d.memberUid){
        document.getElementById('qr-member-info').textContent=shopLang==='zh'?`✅ ${d.memberName||'會員'} 已掃描！請輸入消費金額`:`✅ ${d.memberName||'Member'} scanned! Enter amount`;
        document.getElementById('qr-amount-form').style.display='block';
        document.getElementById('qr-confirm-token').value=tokenId;
        document.getElementById('qr-confirm-uid').value=d.memberUid;
      }
      if(d.status==='completed'){ document.getElementById('qr-member-info').textContent=t('✅ 集點完成！','✅ Points awarded!'); document.getElementById('qr-amount-form').style.display='none'; if(pendingQRUnsub){pendingQRUnsub();pendingQRUnsub=null;} loadStats(); }
    });
  } catch(e){ console.error(e); alert('Error: '+e.message); }
};

// 判斷今天(台北時區)是否為該會員生日；birthday 格式 YYYY-MM-DD
function isTodayBirthday(birthday){
  if(!birthday || typeof birthday!=='string') return false;
  const p=birthday.split('-');
  if(p.length<3) return false;
  const bMonth=p[1].padStart(2,'0'), bDay=p[2].padStart(2,'0');
  const parts=new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Taipei',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
  const tMonth=parts.find(x=>x.type==='month')?.value;
  const tDay=parts.find(x=>x.type==='day')?.value;
  return bMonth===tMonth && bDay===tDay;
}

window.confirmAmount=async function(){
  const amount=parseInt(document.getElementById('inp-confirm-amount').value);
  const tokenId=document.getElementById('qr-confirm-token').value;
  const memberUid=document.getElementById('qr-confirm-uid').value;
  if(!amount||amount<1){ alert(t('請輸入消費金額','Enter amount')); return; }
  if(!tokenId||!memberUid){ alert('Token 或會員 ID 遺失'); return; }
  const btn=document.getElementById('btn-confirm-amount'); btn.disabled=true;
  try{
    // 取得會員資料計算點數
    const mSnap=await getDoc(doc(db,'members',memberUid));
    if(!mSnap.exists()) throw new Error('member_not_found');
    const m=mSnap.data();
    const newTotalSpent=(m.totalSpent||0)+amount;
    const tier=getTierBySpent(newTotalSpent);
    const basePts=calcPoints(amount,tier);
    // 生日當天點數自動加倍
    const isBday=isTodayBirthday(m.birthday);
    const pts=isBday?basePts*2:basePts;
    // 計算到期日（90天後）
    const expiresAt=new Date(); expiresAt.setDate(expiresAt.getDate()+POINTS_EXPIRY_DAYS);

    const batch=writeBatch(db);
    const mRef=doc(db,'members',memberUid);
    // 更新會員點數
    batch.update(mRef,{points:increment(pts),totalSpent:increment(amount),visitCount:increment(1),tier:tier.id});
    // 建立點數批次記錄（含到期日）
    batch.set(doc(collection(db,'point_batches')),{uid:memberUid,points:pts,remaining:pts,amount,tier:tier.id,expiresAt:Timestamp.fromDate(expiresAt),createdAt:serverTimestamp()});
    // 交易記錄
    const earnDesc=(shopLang==='zh'?`消費集點 NT${amount}（${tier.name}）`:`Points earned NT${amount}（${tier.nameEn}）`)+(isBday?(shopLang==='zh'?' 🎂生日加倍':' 🎂Birthday x2'):'');
    batch.set(doc(collection(db,'transactions')),{uid:memberUid,type:'earn',points:pts,amount,desc:earnDesc,tier:tier.id,birthdayBonus:isBday,basePoints:basePts,createdAt:serverTimestamp()});
    // 標記 QR Token 完成
    const newTotalPts=(m.points||0)+pts;
    batch.update(doc(db,'qr_tokens',tokenId),{status:'completed',used:true,amount,pts,memberName:m.name,totalSpent:newTotalSpent,newTotalPts,pointsAwarded:pts,birthdayBonus:isBday,basePoints:basePts,completedAt:serverTimestamp()});
    await batch.commit();
    document.getElementById('inp-confirm-amount').value='';
    document.getElementById('qr-amount-form').style.display='none';
    document.getElementById('qr-member-info').textContent=isBday
      ?(shopLang==='zh'?`🎂 生日加倍！已給予 ${m.name} ${pts} 點（原 ${basePts}）`:`🎂 Birthday x2! ${m.name} earned ${pts} pts (base ${basePts})`)
      :(shopLang==='zh'?`✅ 已給予 ${m.name} ${pts} 點！（${tier.name}）`:`✅ ${m.name} earned ${pts} pts! (${tier.nameEn})`);
    loadStats();
  } catch(e){ console.error(e); alert('Error: '+e.message); }
  finally{ btn.disabled=false; }
};

window.cancelScan=async function(){
  const tokenId=document.getElementById('qr-confirm-token').value;
  if(tokenId){ try{ await updateDoc(doc(db,'qr_tokens',tokenId),{status:'cancelled',cancelledAt:serverTimestamp()}); }catch(e){} }
  document.getElementById('qr-amount-form').style.display='none';
  document.getElementById('qr-member-info').textContent=t('已取消，客人已收到通知','Cancelled, customer notified');
};

window.clearQR=function(){
  clearInterval(cdTimer); if(pendingQRUnsub){pendingQRUnsub();pendingQRUnsub=null;}
  document.getElementById('qr-section').classList.remove('visible');
  document.getElementById('qr-amount-form').style.display='none';
};

function startCd(s){
  clearInterval(cdTimer); let r=s; const el=document.getElementById('countdown');
  const f=()=>{ el.textContent=String(Math.floor(r/60)).padStart(2,'0')+':'+String(r%60).padStart(2,'0'); el.classList.toggle('urgent',r<=30); if(r<=0){clearInterval(cdTimer);el.textContent='已過期';clearQR();} r--; };
  f(); cdTimer=setInterval(f,1000);
}

async function loadStats(){
  try{
    const t0=new Date(); t0.setHours(0,0,0,0);
    const t1=new Date(t0); t1.setDate(t1.getDate()+1);
    // 只用單一 where 避免需要複合索引，前端過濾 type
    const snap=await getDocs(query(
      collection(db,'transactions'),
      where('createdAt','>=',Timestamp.fromDate(t0)),
      where('createdAt','<',Timestamp.fromDate(t1))
    ));
    let tot=0, cnt=0, pts=0;
    snap.forEach(d=>{
      const tx=d.data();
      if(tx.type==='earn'){ tot+=(tx.amount||0); cnt++; pts+=(tx.points||0); }
    });
    const ptsStr=Number.isInteger(pts)?pts.toLocaleString():pts.toFixed(1);
    const set=(id,val)=>{ const el=document.getElementById(id); if(el) el.textContent=val; };
    set('stat-count',cnt);                              // 今日集點（次）
    set('stat-pts',ptsStr);                             // 今日送點（點）
    set('stat-count-card',cnt);                         // 今日統計：集點次數
    set('stat-sales','NT$'+tot.toLocaleString());       // 今日統計：總消費
  } catch(e){ console.error('loadStats:',e); }
}

// ── 資料分析 ──
// 時段選擇：本月為預設，避免數字無止盡累積、失去參考價值
let _analyticsData=null, _analyticsPeriod='month';
function periodStartDate(period){
  const now=new Date();
  switch(period){
    case 'today':{ const d=new Date(now); d.setHours(0,0,0,0); return d; }
    case '7d':   { const d=new Date(now); d.setDate(d.getDate()-6);  d.setHours(0,0,0,0); return d; }
    case '30d':  { const d=new Date(now); d.setDate(d.getDate()-29); d.setHours(0,0,0,0); return d; }
    case 'month':return new Date(now.getFullYear(), now.getMonth(), 1);
    case 'year': return new Date(now.getFullYear(), 0, 1);
    default:     return null; // all：全部，不設起始
  }
}

async function loadAnalytics(){
  window._loadAnalyticsRunning = true;
  const el=document.getElementById('analytics-content'); el.innerHTML=t('<p style="text-align:center;color:#888;padding:20px">載入中...</p>','<p style="text-align:center;color:#888;padding:20px">Loading...</p>');
  try{
    // 一次抓回，後續切換時段都在前端過濾，不需重新查詢
    const [memberSnap,txSnap,batchSnap]=await Promise.all([
      getDocs(collection(db,'members')),
      getDocs(collection(db,'transactions')),
      getDocs(collection(db,'point_batches'))   // 全部取回，前端過濾 remaining > 0
    ]);
    const members=[]; memberSnap.forEach(d=>{ const m=d.data(); members.push({tier:m.tier||'normal', joinedAt:m.joinedAt?.toDate?.()||null}); });
    const txs=[];     txSnap.forEach(d=>{ const tx=d.data(); txs.push({type:tx.type, points:tx.points||0, amount:tx.amount||0, at:tx.createdAt?.toDate?.()||null}); });
    let activePts=0;  batchSnap.forEach(d=>{ const b=d.data(); const rem=(b.points||0)-(b.consumed||0); if(rem>0) activePts+=rem; });
    const tierCount={normal:0,vip:0,vvip:0,vvvip:0};
    members.forEach(m=>{ tierCount[m.tier]=(tierCount[m.tier]||0)+1; });

    _analyticsData={ members, txs, activePts, tierCount, memberCount:memberSnap.size };
    renderAnalytics();
  } catch(e){ console.error(e); el.innerHTML=`<p style="text-align:center;color:#c0392b;padding:20px">載入失敗：${e.message}</p>`; }
}

function renderAnalytics(){
  const el=document.getElementById('analytics-content'); if(!el||!_analyticsData) return;
  const { members, txs, activePts, tierCount, memberCount } = _analyticsData;
  const start = periodStartDate(_analyticsPeriod);
  const inRange = at => !start || (at && at>=start);

  // 本期（依時段過濾）營運數據
  let periodSales=0, periodPts=0, earnCount=0, deductCount=0;
  txs.forEach(tx=>{
    if(!inRange(tx.at)) return;
    if(tx.type==='earn'){ periodSales+=tx.amount; periodPts+=tx.points; earnCount++; }
    else if(tx.type==='deduct') deductCount++;
  });
  periodPts=Math.round(periodPts*10)/10;
  const newMembers = members.filter(m=>inRange(m.joinedAt)).length;

  // 近7天日報表（固定，不受時段影響）
  const daily={}; const now=new Date();
  for(let i=6;i>=0;i--){ const d=new Date(now); d.setDate(d.getDate()-i); d.setHours(0,0,0,0); daily[d.toLocaleDateString('zh-TW')]=0; }
  txs.forEach(tx=>{ if(tx.type!=='earn'||!tx.at) return; const ds=tx.at.toLocaleDateString('zh-TW'); if(ds in daily) daily[ds]+=tx.amount; });

  const periods=[['today','今日','Today'],['7d','近7天','7 Days'],['30d','近30天','30 Days'],['month','本月','This Month'],['year','本年','This Year'],['all','全部','All']];
  const btns=periods.map(([p,zh,en])=>`<button class="period-btn${p===_analyticsPeriod?' active':''}" onclick="setAnalyticsPeriod('${p}')">${shopLang==='zh'?zh:en}</button>`).join('');

  el.innerHTML=`
    <div class="period-selector">${btns}</div>
    <div class="analytics-section-title">${shopLang==='zh'?'本期營運數據':'Period Stats'}</div>
    <div class="analytics-grid">
      <div class="analytics-card"><div class="analytics-label">${shopLang==='zh'?'消費金額':'Sales'}</div><div class="analytics-val">NT$${periodSales.toLocaleString()}</div></div>
      <div class="analytics-card"><div class="analytics-label">${shopLang==='zh'?'發出點數':'Points Issued'}</div><div class="analytics-val">${periodPts.toLocaleString()}</div></div>
      <div class="analytics-card"><div class="analytics-label">${shopLang==='zh'?'集點次數':'Transactions'}</div><div class="analytics-val">${earnCount}</div></div>
      <div class="analytics-card"><div class="analytics-label">${shopLang==='zh'?'折抵次數':'Redemptions'}</div><div class="analytics-val">${deductCount}</div></div>
      <div class="analytics-card"><div class="analytics-label">${shopLang==='zh'?'新增會員':'New Members'}</div><div class="analytics-val">${newMembers}</div></div>
    </div>
    <div class="analytics-section-title">${shopLang==='zh'?'目前狀態（全部）':'Current Status (All)'}</div>
    <div class="analytics-grid">
      <div class="analytics-card"><div class="analytics-label">${shopLang==='zh'?'會員總數':'Members'}</div><div class="analytics-val">${memberCount}</div></div>
      <div class="analytics-card"><div class="analytics-label">${shopLang==='zh'?'流通中點數':'Active Points'}</div><div class="analytics-val">${activePts.toLocaleString()}</div></div>
    </div>
    <div class="analytics-section-title">${shopLang==='zh'?'會員等級分布':'Member Tiers'}</div>
    <div class="analytics-grid">
      ${TIERS.map(ti=>`<div class="analytics-card"><div class="analytics-label">${shopLang==='zh'?ti.name:ti.nameEn}</div><div class="analytics-val">${tierCount[ti.id]||0}</div></div>`).join('')}
    </div>
    <div class="analytics-section-title">${shopLang==='zh'?'近7天消費金額':'Last 7 Days Sales'}</div>
    <table class="analytics-table">
      <tr><th>${shopLang==='zh'?'日期':'Date'}</th><th>${shopLang==='zh'?'消費金額':'Sales'}</th></tr>
      ${Object.entries(daily).map(([d,v])=>`<tr><td>${d}</td><td>NT$${v.toLocaleString()}</td></tr>`).join('')}
    </table>
    <button class="btn btn-primary" onclick="exportExcel()" style="margin-top:14px" data-zh="📊 匯出報表 (CSV)" data-en="📊 Export Report (CSV)">${shopLang==='zh'?'📊 匯出 Excel 報表':'📊 Export Report'}</button>`;
}
window.loadAnalytics = loadAnalytics; // expose 給 admin-shop.js 的 switchTab 覆寫版呼叫
window.setAnalyticsPeriod = function(p){ _analyticsPeriod=p; renderAnalytics(); };

// ── 匯出 Excel ──
window.exportExcel=async function(){
  try{
    showToast(shopLang==='zh'?'準備匯出...':'Preparing export...');
    const [memberSnap,txSnap]=await Promise.all([getDocs(collection(db,'members')),getDocs(collection(db,'transactions'))]);
    // 會員資料
    const members=[];
    memberSnap.forEach(d=>{ const m=d.data(); members.push({UID:d.id,姓名:m.name,手機:m.phone,生日:m.birthday||'',會員等級:TIERS.find(ti=>ti.id===m.tier)?.name||m.tier,累積消費:m.totalSpent||0,目前點數:m.points||0,消費次數:m.visitCount||0,折抵次數:m.redeemCount||0,加入日期:m.joinedAt?m.joinedAt.toDate().toLocaleDateString('zh-TW'):''}); });
    // 交易記錄
    const txs=[];
    txSnap.forEach(d=>{ const tx=d.data(); txs.push({日期:tx.createdAt?tx.createdAt.toDate().toLocaleDateString('zh-TW'):'',時間:tx.createdAt?tx.createdAt.toDate().toLocaleTimeString('zh-TW'):'',類型:tx.type==='earn'?'集點':tx.type==='deduct'?'折抵':'兌換',點數:tx.points,消費金額:tx.amount||'',說明:tx.desc||'',會員等級:tx.tier||''}); });

    // 用純 JS 產生 CSV（不依賴 xlsx 庫）
    const toCSV=(data)=>{
      if(!data.length) return '';
      const header=Object.keys(data[0]).join(',');
      const rows=data.map(row=>Object.values(row).map(v=>`"${String(v).replace(/"/g,'""')}"`).join(','));
      return [header,...rows].join('\n');
    };
    const memberCSV='\uFEFF'+toCSV(members); // BOM for Excel UTF-8
    const txCSV='\uFEFF'+toCSV(txs);
    const date=new Date().toLocaleDateString('zh-TW').replace(/\//g,'-');
    download(`BINI_Members_${date}.csv`, memberCSV, 'text/csv;charset=utf-8');
    setTimeout(()=>download(`BINI_Transactions_${date}.csv`, txCSV, 'text/csv;charset=utf-8'), 500);
    showToast(shopLang==='zh'?'✅ 已匯出兩個 CSV 檔案（可用 Excel 開啟）':'✅ Two CSV files exported');
  } catch(e){ console.error(e); alert((shopLang==='zh'?'匯出失敗：':'Export failed: ')+e.message); }
};
function download(filename,content,mime){
  const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([content],{type:mime})); a.download=filename; document.body.appendChild(a); a.click(); document.body.removeChild(a);
}

// ── 廣播訊息 ──
window.sendBroadcast=async function(){
  const title=document.getElementById('bc-title').value.trim();
  const body=document.getElementById('bc-body').value.trim();
  if(!title||!body){ alert(t('請填寫標題和內容','Fill in title and content')); return; }
  const btn=document.getElementById('btn-send-bc'); btn.disabled=true;
  try{
    await addDoc(collection(db,'broadcasts'),{title,body,createdAt:serverTimestamp(),sentBy:currentAdmin?.email||'admin'});
    document.getElementById('bc-title').value=''; document.getElementById('bc-body').value='';
    // 推播通知所有訂閱用戶
    await sendPushToAll(`📣 ${title}`, body, 'announcement', '/#announce');
    alert(t('✅ 廣播訊息已發送！已推播通知所有會員','✅ Broadcast sent with push notification!'));
  } catch(e){ alert('Error: '+e.message); }
  finally{ btn.disabled=false; }
};

// ── 公告 ──
window.previewAnnImg=function(input){
  annImgFile=input.files[0];
  const preview=document.getElementById('ann-img-preview');
  if(annImgFile){ const url=URL.createObjectURL(annImgFile); preview.innerHTML=`<img src="${url}" style="width:100%;border-radius:10px;max-height:180px;object-fit:cover;margin-bottom:8px">`; }
  else preview.innerHTML='';
};
window.sendAnnouncement=async function(){
  const title=document.getElementById('ann-title').value.trim();
  const body=document.getElementById('ann-body').value.trim();
  if(!title||!body){ alert(t('請填寫標題和內容','Fill title and content')); return; }
  const btn=document.getElementById('btn-send-ann'); btn.disabled=true;
  try{
    let imageUrl='';
    if(annImgFile){ const sRef=ref(storage,`announcements/${Date.now()}_${annImgFile.name}`); await uploadBytes(sRef,annImgFile); imageUrl=await getDownloadURL(sRef); }
    await addDoc(collection(db,'announcements'),{title,body,imageUrl,createdAt:serverTimestamp()});
    document.getElementById('ann-title').value=''; document.getElementById('ann-body').value='';
    document.getElementById('ann-img-preview').innerHTML=''; document.getElementById('ann-img-input').value=''; annImgFile=null;
    // 推播通知所有訂閱用戶
    await sendPushToAll(`📢 ${title}`, body, 'announcement', '/#announce');
    alert(t('✅ 公告已發送！已推播通知所有會員','✅ Sent with push notification!')); loadAnnouncements();
  } catch(e){ alert('Error: '+e.message); }
  finally{ btn.disabled=false; }
};
async function loadAnnouncements(){
  const list=document.getElementById('announce-list-shop'); if(!list) return;
  try{
    const snap=await getDocs(collection(db,'announcements'));
    if(snap.empty){ list.innerHTML=shopLang==='zh'?`<p class="empty-hint">尚未發送任何公告</p>`:`<p class="empty-hint">No announcements yet</p>`; return; }
    const items=[]; snap.forEach(d=>items.push({id:d.id,...d.data()}));
    items.sort((a,b)=>(b.createdAt?.toDate()||0)-(a.createdAt?.toDate()||0));
    list.innerHTML='';
    items.forEach(item=>{
      const dateStr=item.createdAt?item.createdAt.toDate().toLocaleDateString('zh-TW'):'';
      const card=document.createElement('div'); card.className='ann-card';
      card.innerHTML=`<div style="display:flex;justify-content:space-between;align-items:flex-start">
        <div style="flex:1"><div class="ann-date">${dateStr}</div><div class="ann-title-text">${esc(item.title)}</div><div class="ann-body-text">${esc(item.body)}</div>${item.imageUrl?`<img src="${item.imageUrl}" class="ann-img" onclick="window.open('${item.imageUrl}','_blank')">`:''}
        </div>
        <button onclick="deleteAnn('${item.id}')" class="btn-sm btn-danger" style="margin-left:8px;flex-shrink:0">${shopLang==='zh'?'刪除':'Delete'}</button>
      </div>`;
      list.appendChild(card);
    });
  } catch(e){ console.error(e); }
}
window.deleteAnn=async function(id){ if(!confirm(shopLang==='zh'?'確定刪除？':'Delete this announcement?'))return; try{await deleteDoc(doc(db,'announcements',id));loadAnnouncements();}catch(e){alert('Error:'+e.message);} };

// ── 獎品 ──
let _rewardsById={};
async function loadRewards(){
  const wrap=document.getElementById('reward-list-wrap'); wrap.innerHTML='';
  try{
    const snap=await getDocs(collection(db,'rewards'));
    if(snap.empty){ wrap.innerHTML=shopLang==='zh'?'<p class="empty-hint">尚無獎品</p>':'<p class="empty-hint">No rewards yet</p>'; return; }
    const items=[]; snap.forEach(d=>items.push({id:d.id,...d.data()})); items.sort((a,b)=>a.pts-b.pts);
    _rewardsById={};
    items.forEach(r=>{
      _rewardsById[r.id]=r;
      const row=document.createElement('div'); row.className='reward-row';
      const thumb=r.imageUrl
        ? `<img src="${esc(r.imageUrl)}" style="width:46px;height:46px;border-radius:10px;object-fit:cover;flex-shrink:0">`
        : `<div style="font-size:26px">${r.emoji||'🎁'}</div>`;
      row.innerHTML=`${thumb}
        <div class="reward-row-info"><div class="reward-row-name">${esc(r.name_zh||r.name)}</div><div class="reward-row-en">${esc(r.name_en||'')}</div><div class="reward-row-pts">${r.pts.toLocaleString()} ${shopLang==='zh'?'點':'pts'}</div></div>
        <div style="display:flex;flex-direction:column;gap:6px;flex-shrink:0">
          <button class="btn-sm btn-outline" onclick="editReward('${r.id}')">${shopLang==='zh'?'編輯':'Edit'}</button>
          <button class="btn-sm btn-danger" onclick="deleteReward('${r.id}')">${shopLang==='zh'?'刪除':'Delete'}</button>
        </div>`;
      wrap.appendChild(row);
    });
  } catch(e){ console.error(e); }
}
let rwImgFile=null, editingRewardId=null;
window.previewRewardImg=function(input){
  const f=input.files[0];
  if(f && f.size>10*1024*1024){ alert(shopLang==='zh'?'圖片不能超過 10MB':'Image must be under 10MB'); input.value=''; return; }
  rwImgFile=f;
  const preview=document.getElementById('rw-img-preview');
  if(rwImgFile){ const url=URL.createObjectURL(rwImgFile); preview.innerHTML=`<img src="${url}" style="width:100%;border-radius:10px;max-height:180px;object-fit:cover">`; }
  else preview.innerHTML='';
};
// 依目前是「新增」或「編輯」模式更新表單標題/按鈕文字
function applyRewardFormMode(){
  const editing=!!editingRewardId;
  const title=document.getElementById('rw-form-title');
  const save=document.getElementById('rw-save-btn');
  const cancel=document.getElementById('rw-cancel-btn');
  if(title) title.textContent = editing ? (shopLang==='zh'?'✏️ 編輯獎品':'✏️ Edit Reward') : (shopLang==='zh'?'➕ 新增獎品':'➕ Add Reward');
  if(save) save.textContent = editing ? (shopLang==='zh'?'更新獎品':'Update Reward') : (shopLang==='zh'?'新增獎品':'Add Reward');
  if(cancel) cancel.style.display = editing ? '' : 'none';
}
function resetRewardForm(){
  editingRewardId=null; rwImgFile=null;
  ['rw-name-zh','rw-name-en','rw-emoji','rw-pts'].forEach(id=>{ const e=document.getElementById(id); if(e) e.value=''; });
  const p=document.getElementById('rw-img-preview'); if(p) p.innerHTML='';
  const inp=document.getElementById('rw-img-input'); if(inp) inp.value='';
  applyRewardFormMode();
}
window.cancelEditReward=function(){ resetRewardForm(); };
window.editReward=function(id){
  const r=_rewardsById[id]; if(!r) return;
  editingRewardId=id; rwImgFile=null;
  document.getElementById('rw-name-zh').value=r.name_zh||r.name||'';
  document.getElementById('rw-name-en').value=r.name_en||'';
  document.getElementById('rw-emoji').value=r.emoji||'';
  document.getElementById('rw-pts').value=r.pts||'';
  document.getElementById('rw-img-input').value='';
  const preview=document.getElementById('rw-img-preview');
  preview.innerHTML = r.imageUrl ? `<img src="${esc(r.imageUrl)}" style="width:100%;border-radius:10px;max-height:180px;object-fit:cover">` : '';
  applyRewardFormMode();
  document.querySelector('#tab-rewards-page .form-card')?.scrollIntoView({behavior:'smooth',block:'start'});
};
window.saveReward=async function(){
  const nz=document.getElementById('rw-name-zh').value.trim(),ne=document.getElementById('rw-name-en').value.trim(),em=document.getElementById('rw-emoji').value.trim()||'🎁',pts=parseInt(document.getElementById('rw-pts').value);
  if(!nz||!pts||pts<1){ alert(shopLang==='zh'?'請填寫完整資訊':'Please fill all fields'); return; }
  const btn=document.getElementById('rw-save-btn'); if(btn){ btn.disabled=true; btn.textContent=shopLang==='zh'?'處理中…':'Saving…'; }
  try{
    const data={name_zh:nz,name_en:ne||nz,emoji:em,pts};
    if(rwImgFile){ const sRef=ref(storage,`rewards/${Date.now()}_${rwImgFile.name}`); await uploadBytes(sRef,rwImgFile); data.imageUrl=await getDownloadURL(sRef); }
    const wasEdit=!!editingRewardId;
    if(wasEdit){ await updateDoc(doc(db,'rewards',editingRewardId),data); }
    else{ data.imageUrl=data.imageUrl||''; data.createdAt=serverTimestamp(); await addDoc(collection(db,'rewards'),data); }
    resetRewardForm();
    await loadRewards();
    alert(wasEdit ? (shopLang==='zh'?'✅ 獎品已更新！':'✅ Reward updated!') : (shopLang==='zh'?'✅ 獎品已新增！':'✅ Reward added!'));
  }
  catch(e){ alert('Error: '+e.message); }
  finally{ if(btn) btn.disabled=false; applyRewardFormMode(); }
};
window.deleteReward=async function(id){ if(!confirm(shopLang==='zh'?'確定刪除？':'Delete this reward?'))return; try{await deleteDoc(doc(db,'rewards',id)); if(editingRewardId===id) resetRewardForm(); loadRewards();}catch(e){alert('Error:'+e.message);} };

// ── 收件匣 ──
function startInbox(){
  if(inboxUnsub){inboxUnsub();inboxUnsub=null;}
  inboxUnsub=onSnapshot(query(collection(db,'chats'),orderBy('lastMsgAt','desc')),
    snap=>{
      inboxDocs=[]; snap.forEach(d=>inboxDocs.push({id:d.id,...d.data()}));
      renderInbox();
    },err=>console.error('inbox:',err)
  );
}

function renderInbox(){
  const list=document.getElementById('inbox-list'); if(!list) return;
  list.innerHTML='';
  // 未讀徽章只計算「未隱藏」的對話（隱藏對話一收到新訊息就會自動取消隱藏）
  let total=0; inboxDocs.forEach(c=>{ if(c.hidden!==true) total+=(c.unreadAdmin||0); });
  const badge=document.getElementById('msg-badge'); if(badge){ badge.textContent=total>0?total:''; badge.classList.toggle('show',total>0); }
  // 依目前檢視模式過濾：預設只看未隱藏，切換後只看已隱藏
  const view=inboxDocs.filter(c=>(c.hidden===true)===inboxShowHidden);
  if(view.length===0){
    list.innerHTML=inboxShowHidden
      ? (shopLang==='zh'?'<p class="empty-hint">沒有已隱藏的對話</p>':'<p class="empty-hint">No hidden chats</p>')
      : (shopLang==='zh'?'<p class="empty-hint">尚無客服訊息</p>':'<p class="empty-hint">No messages yet</p>');
    return;
  }
  const actFn=inboxShowHidden?'unhideChat':'hideChat';
  const actLabel=inboxShowHidden?(shopLang==='zh'?'取消隱藏':'Unhide'):(shopLang==='zh'?'隱藏':'Hide');
  view.forEach(c=>{
    const u=c.unreadAdmin||0;
    const ts=c.lastMsgAt?c.lastMsgAt.toDate().toLocaleString('zh-TW',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}):'';
    const item=document.createElement('div'); item.className='inbox-item'+(u>0?' unread':'');
    item.innerHTML=`<div class="inbox-top"><div style="display:flex;align-items:center;gap:8px"><span class="inbox-name">${esc(c.memberName||'Unknown')}</span>${u>0?`<span style="background:var(--pink);color:#fff;font-size:10px;padding:1px 7px;border-radius:10px">${u}</span>`:''}</div><span class="inbox-time">${ts}</span></div>
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px"><span class="inbox-preview">${esc(c.lastMsg||'')}</span><span style="display:flex;align-items:center;gap:10px;flex-shrink:0"><span style="font-size:12px;color:#aaa">${c.phone||''}</span><button onclick="event.stopPropagation();${actFn}('${c.id}')" class="inbox-act">${actLabel}</button></span></div>`;
    item.onclick=()=>openChat(c.id,c.memberName||'Unknown',c.phone||'');
    list.appendChild(item);
  });
}

window.toggleInboxHidden=function(){
  inboxShowHidden=!inboxShowHidden;
  const span=document.querySelector('#inbox-toggle-hidden span');
  if(span){
    span.setAttribute('data-zh',inboxShowHidden?'返回收件匣':'顯示已隱藏');
    span.setAttribute('data-en',inboxShowHidden?'Back to Inbox':'Show Hidden');
    span.textContent=shopLang==='zh'?span.getAttribute('data-zh'):span.getAttribute('data-en');
  }
  renderInbox();
};
window.hideChat=async function(uid){
  try{ await setDoc(doc(db,'chats',uid),{hidden:true},{merge:true}); }
  catch(e){ alert('Error: '+e.message); }
};
window.unhideChat=async function(uid){
  try{ await setDoc(doc(db,'chats',uid),{hidden:false},{merge:true}); }
  catch(e){ alert('Error: '+e.message); }
};

// ── 對話 ──
window.openChat=function(uid,name,phone){
  chatUid=uid;
  document.getElementById('chat-member-name').textContent=name;
  document.getElementById('chat-member-phone').textContent=phone;
  document.getElementById('chat-view').classList.add('open');
  document.getElementById('admin-input').value='';
  if(chatUnsub){chatUnsub();chatUnsub=null;}
  const msgs=document.getElementById('chat-msgs'); msgs.innerHTML=''; let lastDate='';
  chatUnsub=onSnapshot(query(collection(db,'chats',uid,'messages'),limit(200)),
    snap=>{
      msgs.innerHTML=''; lastDate='';
      const arr=[]; snap.forEach(d=>arr.push({id:d.id,...d.data()}));
      arr.sort((a,b)=>(a.createdAt?.toDate()||0)-(b.createdAt?.toDate()||0));
      arr.forEach(m=>{
        const ds=m.createdAt?m.createdAt.toDate().toLocaleDateString('zh-TW',{month:'long',day:'numeric',weekday:'short'}):'';
        if(ds&&ds!==lastDate){ lastDate=ds; const sep=document.createElement('div'); sep.className='date-sep'; sep.textContent=ds; msgs.appendChild(sep); }
        const isAdmin=m.sender==='admin',ts=m.createdAt?m.createdAt.toDate().toLocaleTimeString('zh-TW',{hour:'2-digit',minute:'2-digit'}):'';
        const row=document.createElement('div'); row.className='msg-row '+(isAdmin?'mine':'theirs');
        const content=m.imageUrl?`<img src="${m.imageUrl}" class="chat-img" onclick="window.open('${m.imageUrl}','_blank')">`:`<div class="bubble ${isAdmin?'mine':'theirs'}">${esc(m.text||'')}</div>`;
        row.innerHTML=`${!isAdmin?`<div class="msg-av">${name.slice(0,1)}</div>`:''}
          <div>${content}<div class="msg-t">${ts}</div></div>`;
        msgs.appendChild(row);
      });
      msgs.scrollTop=msgs.scrollHeight;
    },err=>console.error(err)
  );
  markRead(uid);
};
window.closeChat=function(){ document.getElementById('chat-view').classList.remove('open'); if(chatUnsub){chatUnsub();chatUnsub=null;} chatUid=''; };
window.adminSend=async function(){
  const input=document.getElementById('admin-input'),text=input.value.trim(); if(!text||!chatUid) return;
  const btn=document.getElementById('admin-send-btn'); btn.disabled=true; const saved=input.value; input.value=''; input.style.height='auto';
  try{
    await addDoc(collection(db,'chats',chatUid,'messages'),{text,sender:'admin',read:false,createdAt:serverTimestamp()});
    await setDoc(doc(db,'chats',chatUid),{lastMsg:text,lastMsgAt:serverTimestamp(),unreadUser:increment(1)},{merge:true});
    // 推播給該會員
    const memberName = document.getElementById('chat-member-name').textContent||'BINI Blooms';
    await sendPushToUser(chatUid,'💬 BINI Blooms 客服回覆',text,'chat','/');
  } catch(e){ input.value=saved; alert('Error: '+e.message); }
  finally{ btn.disabled=false; input.focus(); }
};
window.adminResize=function(el){ el.style.height='auto'; el.style.height=Math.min(el.scrollHeight,100)+'px'; };
window.handleAdminImage=async function(input){
  const file=input.files[0]; if(!file||!chatUid) return;
  if(file.size>5*1024*1024){ alert('圖片不能超過5MB'); return; }
  try{
    const sRef=ref(storage,`chat_images/admin/${chatUid}/${Date.now()}_${file.name}`);
    await uploadBytes(sRef,file); const imageUrl=await getDownloadURL(sRef);
    await addDoc(collection(db,'chats',chatUid,'messages'),{imageUrl,sender:'admin',read:false,createdAt:serverTimestamp()});
    await setDoc(doc(db,'chats',chatUid),{lastMsg:shopLang==='zh'?'[圖片]':'[Image]',lastMsgAt:serverTimestamp(),unreadUser:increment(1)},{merge:true});
  } catch(e){ alert('Upload error: '+e.message); }
  input.value='';
};
async function markRead(uid){
  try{
    // 取全部訊息，前端過濾，避免雙 where 複合索引需求
    const snap=await getDocs(collection(db,'chats',uid,'messages'));
    const batch=writeBatch(db);
    snap.docs.forEach(d=>{
      const m=d.data();
      if(m.sender==='user' && m.read===false) batch.update(d.ref,{read:true});
    });
    batch.update(doc(db,'chats',uid),{unreadAdmin:0});
    await batch.commit();
  } catch(e){ console.error(e); }
}

// ── 推播通知（寫入 notifications → Cloud Function 自動發送 FCM）──
// Cloud Function 監聽 notifications 集合，自動用 Admin SDK 發送推播
// 這樣可以安全地發送推播，不需要在前端暴露 Service Account

let _functions = null;
function getAdminFunctions() {
  if (!_functions) {
    const { initializeApp, getApp } = window._fbApp
      ? { initializeApp: () => window._fbApp, getApp: () => window._fbApp }
      : { initializeApp: null, getApp: null };
    try { _functions = getFunctions(auth.app, 'asia-east1'); } catch(e) { _functions = getFunctions(auth.app); }
  }
  return _functions;
}

async function sendPushToAll(title, body, type='announcement', url='/') {
  try {
    // 寫入 notifications → Cloud Function 觸發推播
    await addDoc(collection(db,'notifications'), {
      title, body, type, url, target: 'all',
      createdAt: serverTimestamp(), read: false,
    });
    console.log('✅ 廣播通知已寫入 Firestore（Cloud Function 將自動推播）');
  } catch(e) { console.error('通知寫入失敗:', e); }
}

async function sendPushToUser(uid, title, body, type='chat', url='/') {
  try {
    await addDoc(collection(db,'notifications'), {
      title, body, type, url,
      target: uid, targetUid: uid,
      createdAt: serverTimestamp(), read: false,
    });
    console.log(`✅ 通知已寫入 Firestore → uid: ${uid}`);
  } catch(e) { console.error('通知寫入失敗:', e); }
}

function showToast(msg){ const el=document.getElementById('admin-toast'); if(!el) return; el.textContent=msg; el.classList.add('show'); setTimeout(()=>el.classList.remove('show'),2500); }
function esc(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/\n/g,'<br>'); }

// ── 設定頁：集點規則 ─────────────────────────
window.updateSettingsPreview = function() {
  const baseUnit = Number(document.getElementById('settings-base-unit')?.value) || 200;
  const rates = {
    normal: Number(document.getElementById('rate-normal')?.value) || 1.0,
    vip:    Number(document.getElementById('rate-vip')?.value)    || 1.3,
    vvip:   Number(document.getElementById('rate-vvip')?.value)   || 1.5,
    vvvip:  Number(document.getElementById('rate-vvvip')?.value)  || 2.0,
  };
  const preview = document.getElementById('settings-preview');
  if (!preview) return;
  const tiers = [
    { key:'normal', label:'🛍️ 一般 / Member' },
    { key:'vip',    label:'⭐ VIP' },
    { key:'vvip',   label:'🌟 VVIP' },
    { key:'vvvip',  label:'💎 VVVIP' },
  ];
  preview.innerHTML = tiers.map(t =>
    `<div>NT$${baseUnit} × ${rates[t.key]}x = <strong>${+(rates[t.key]).toFixed(1)} 點</strong>　${t.label}</div>`
  ).join('');
};

window.savePointSettings = async function() {
  const btn = document.getElementById('btn-save-point-settings');
  const msg = document.getElementById('settings-save-msg');
  btn.disabled = true;
  try {
    const baseUnit = Number(document.getElementById('settings-base-unit')?.value) || 200;
    const rates = {
      normal: Number(document.getElementById('rate-normal')?.value) || 1.0,
      vip:    Number(document.getElementById('rate-vip')?.value)    || 1.3,
      vvip:   Number(document.getElementById('rate-vvip')?.value)   || 1.5,
      vvvip:  Number(document.getElementById('rate-vvvip')?.value)  || 2.0,
    };
    await setDoc(doc(db,'config','point_rules'), { baseUnit, rates, updatedAt: serverTimestamp() }, { merge: true });
    msg.textContent = '✅ 已儲存'; msg.style.color = '#2d8a4e';
    setTimeout(() => { msg.textContent = ''; }, 2500);
  } catch(e) {
    msg.textContent = `❌ 儲存失敗：${e.message}`; msg.style.color = '#c0392b';
  } finally { btn.disabled = false; }
};

async function loadPointSettings() {
  try {
    const snap = await getDoc(doc(db,'config','point_rules'));
    if (!snap.exists()) { updateSettingsPreview(); return; }
    const d = snap.data();
    if (d.baseUnit) { const el = document.getElementById('settings-base-unit'); if(el) el.value = d.baseUnit; }
    if (d.rates) {
      ['normal','vip','vvip','vvvip'].forEach(k => {
        const el = document.getElementById(`rate-${k}`); if(el && d.rates[k] != null) el.value = d.rates[k];
      });
    }
    updateSettingsPreview();
  } catch(e) { console.warn('loadPointSettings:', e.message); }
}

// ── 設定頁：購物規則 ─────────────────────────
async function loadShopRules() {
  try {
    const snap = await getDoc(doc(db,'config','shop_rules'));
    if (!snap.exists()) return;
    const d = snap.data();
    if (d.pointMinOrder != null) {
      const el = document.getElementById('settings-point-min-order'); if(el) el.value = d.pointMinOrder;
    }
    if (d.freeShippingThreshold != null) {
      const el = document.getElementById('settings-free-shipping'); if(el) el.value = d.freeShippingThreshold;
    }
  } catch(e) { console.warn('loadShopRules:', e.message); }
}

window.saveShopRules = async function() {
  const btn = document.getElementById('btn-save-shop-rules');
  const msg = document.getElementById('shop-rules-save-msg');
  btn.disabled = true;
  try {
    const pointMinOrder         = Number(document.getElementById('settings-point-min-order')?.value) || 0;
    const freeShippingThreshold = Number(document.getElementById('settings-free-shipping')?.value)  || 0;
    await setDoc(doc(db,'config','shop_rules'), { pointMinOrder, freeShippingThreshold, updatedAt: serverTimestamp() }, { merge: true });
    msg.textContent = '✅ 已儲存'; msg.style.color = '#2d8a4e';
    setTimeout(() => { msg.textContent = ''; }, 2500);
  } catch(e) {
    msg.textContent = `❌ 儲存失敗：${e.message}`; msg.style.color = '#c0392b';
  } finally { btn.disabled = false; }
};

// 頁面載入時讀取設定
document.addEventListener('DOMContentLoaded', () => {
  loadPointSettings();
  loadShopRules();
});

// ── 清除測試資料 ─────────────────────────────
// 隱藏功能：需輸入密碼才顯示刪除按鈕，避免誤按
const CLEAR_DATA_PASSWORD = 'yellowtaxi328';
// 刪除工具的閒置自動上鎖計時器：解鎖/操作後 15 秒沒按按鈕就自動回鎖
let _clearDataIdleTimer = null;
function armClearDataTimer(){
  if (_clearDataIdleTimer) clearTimeout(_clearDataIdleTimer);
  _clearDataIdleTimer = setTimeout(() => { lockClearData(); }, 15000);
}

window.unlockClearData = function() {
  const input = document.getElementById('clear-data-pw');
  const msg = document.getElementById('clear-data-msg');
  if ((input?.value || '') !== CLEAR_DATA_PASSWORD) {
    if (msg) { msg.textContent = t('密碼錯誤','Wrong password'); msg.style.color = '#c0392b'; }
    return;
  }
  document.getElementById('clear-data-lock').style.display = 'none';
  document.getElementById('clear-data-tools').style.display = '';
  if (input) input.value = '';
  if (msg) msg.textContent = '';
  armClearDataTimer();
};

window.clearTestData = async function(collectionName) {
  // 先停掉閒置計時器，避免 confirm/刪除過程中突然被鎖；完成後再重新計時
  if (_clearDataIdleTimer) { clearTimeout(_clearDataIdleTimer); _clearDataIdleTimer = null; }
  try {
    const msg = document.getElementById('clear-data-msg');
    const label = { announcements:'公告', broadcasts:'廣播', chats:'客服訊息' }[collectionName] || collectionName;
    if (!confirm(`確定要刪除所有「${label}」嗎？此操作不可復原。`)) return;
  msg.textContent = '刪除中…'; msg.style.color = '#888';
  try {
    const snap = await getDocs(collection(db, collectionName));
    let count = 0;
    // chats 需要刪除 subcollection messages
    for (const d of snap.docs) {
      if (collectionName === 'chats') {
        const msgs = await getDocs(collection(db, 'chats', d.id, 'messages'));
        for (const m of msgs.docs) await deleteDoc(m.ref);
      }
      await deleteDoc(d.ref);
      count++;
    }
    msg.textContent = `✅ 已刪除 ${count} 筆${label}`; msg.style.color = '#2d8a4e';
  } catch(e) {
    msg.textContent = `❌ 刪除失敗：${e.message}`; msg.style.color = '#c0392b';
  }
  } finally {
    armClearDataTimer();
  }
};

window.clearTestProducts = async function() {
  if (_clearDataIdleTimer) { clearTimeout(_clearDataIdleTimer); _clearDataIdleTimer = null; }
  try {
    const msg = document.getElementById('clear-data-msg');
    if (!confirm('確定要刪除所有含「測試」字樣的商品嗎？此操作不可復原。')) return;
    msg.textContent = '刪除中…'; msg.style.color = '#888';
    try {
      const snap = await getDocs(collection(db, 'products'));
      let count = 0;
      for (const d of snap.docs) {
        const name = d.data().name || '';
        if (name.includes('測試') || name.toLowerCase().includes('test')) {
          await deleteDoc(d.ref);
          count++;
        }
      }
      msg.textContent = `✅ 已刪除 ${count} 筆測試商品`; msg.style.color = '#2d8a4e';
    } catch(e) {
      msg.textContent = `❌ 刪除失敗：${e.message}`; msg.style.color = '#c0392b';
    }
  } finally {
    armClearDataTimer();
  }
};
