/**
 * BINI Blooms — Firebase Cloud Functions
 * Version: 3.0.5  (firebase-functions v2 / Node 22)
 */

const { onCall, onRequest, HttpsError } = require("firebase-functions/v2/https");
const { onSchedule }                    = require("firebase-functions/v2/scheduler");
const { onDocumentCreated }             = require("firebase-functions/v2/firestore");
const { defineString, defineBoolean }   = require("firebase-functions/params");
const admin  = require("firebase-admin");
// Node 22 內建 fetch，不需要 node-fetch
const crypto = require("crypto");
const XLSX   = require("xlsx");

admin.initializeApp();
const db = admin.firestore();

// ─────────────────────────────────────────────
// 環境變數定義（params）
// ─────────────────────────────────────────────
const APP_BASE_URL               = defineString("APP_BASE_URL",               { default: "https://bini-blooms-client.web.app" });
// 寄件人資訊

// ─────────────────────────────────────────────
// 業務規則常數
// ─────────────────────────────────────────────
const RULES = {
  PPD: 0.005,
  POINT_TO_NTD: 1,
  POINTS_EXPIRE_MONTHS: 3,
  QR_EXPIRE_SECONDS: 120,
  TIER_RATES: { normal:1.0, vip:1.3, vvip:1.5, vvvip:2.0 },
  TIER_THRESHOLDS: [0, 10000, 15000, 20000],
  TIER_NAMES: ["normal", "vip", "vvip", "vvvip"],
  SHOP_POINT_MIN_ORDER: 300,
  SHOP_POINT_MAX_RATIO: 0.3,
  CVS_EXPIRE_HOURS: 72,
  REFERRAL_REWARD_CAP: 10, // 每位推薦人最多回饋的成功推薦人數
};

// ─────────────────────────────────────────────
// FCM 錯誤碼：代表此 token 已失效（裝置移除 PWA、清快取、token 過期等），
// 應從資料庫移除，避免之後每次推播都對同一個壞 token 重複失敗。
const STALE_FCM_CODES = new Set([
  "messaging/registration-token-not-registered",
  "messaging/invalid-registration-token",
]);

async function sendPush(uid, title, body, data = {}) {
  try {
    const snap = await db.collection("push_tokens").doc(uid).get();
    if (!snap.exists) return;
    const d = snap.data();

    // 收集 token 並記住來源欄位路徑，以便失效時精準清除該欄位
    const entries = []; // [{ token, path }]，path 為 doc 內的欄位路徑
    if (d.tokens && typeof d.tokens === "object") {
      Object.entries(d.tokens).forEach(([k, t]) => {
        if (t) entries.push({ token: t, path: `tokens.${k}` });
      });
    } else if (d.token) {
      entries.push({ token: d.token, path: "token" });
    }
    if (!entries.length) return;

    // ⚠️ 純 data 訊息：不帶 notification 欄位，避免 FCM 自動顯示 + SW 各顯示一次（重複推播）
    // SW 的 onBackgroundMessage 統一負責顯示通知
    const msg = {
      data: {
        ...Object.fromEntries(Object.entries(data).map(([k,v])=>[k,String(v)])),
        title, body,
        click_action: "FLUTTER_NOTIFICATION_CLICK",
      },
      webpush: { fcmOptions: { link: "https://bini-blooms-dev-client.web.app" } },
      android: { priority: "high" },
      apns: {
        headers: { "apns-priority": "10" },
        payload: { aps: { sound: "default", "content-available": 1 } },
      },
    };

    const stalePaths = [];

    if (entries.length === 1) {
      try {
        await admin.messaging().send({ ...msg, token: entries[0].token });
      } catch (sendErr) {
        if (STALE_FCM_CODES.has(sendErr.code)) {
          stalePaths.push(entries[0].path);
        } else {
          console.warn("Push failed:", sendErr.message);
        }
      }
    } else {
      const resp = await admin.messaging().sendEachForMulticast({ ...msg, tokens: entries.map(e => e.token) });
      resp.responses.forEach((r, i) => {
        if (r.success) return;
        const code = r.error?.code;
        if (STALE_FCM_CODES.has(code)) stalePaths.push(entries[i].path);
        else if (code) console.warn(`[push] uid=${uid} send error: ${code}`);
      });
    }

    // 自動清除失效 token
    if (stalePaths.length) {
      const updates = {};
      stalePaths.forEach(p => { updates[p] = admin.firestore.FieldValue.delete(); });
      try {
        await db.collection("push_tokens").doc(uid).update(updates);
        console.log(`[push] 已清除 ${stalePaths.length} 個失效 token (uid=${uid})`);
      } catch (cleanErr) {
        console.warn(`[push] 清除失效 token 失敗 uid=${uid}:`, cleanErr.message);
      }
    }

    if (entries.length - stalePaths.length > 0) {
      console.log(`✅ Push sent to ${uid}: ${title}`);
    }
  } catch (e) {
    console.warn("Push failed:", e.message);
  }
}

// ── 更新所有會員本月排名（每次集點後背景執行）──
async function updateMonthlyRanks() {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  console.log(`[updateMonthlyRanks] 開始，monthStart=${monthStart.toISOString()}`);

  // 查本月所有 earn 交易
  const txSnap = await db.collection("transactions")
    .where("type", "==", "earn")
    .where("createdAt", ">=", admin.firestore.Timestamp.fromDate(monthStart))
    .get();

  console.log(`[updateMonthlyRanks] 查到 ${txSnap.size} 筆本月 earn 交易`);

  // 加總每位會員本月點數
  const monthPts = {};
  txSnap.forEach(doc => {
    const { uid, points } = doc.data();
    if (uid) monthPts[uid] = Math.round(((monthPts[uid] || 0) + (points || 0)) * 10) / 10;
  });

  console.log(`[updateMonthlyRanks] 涉及 ${Object.keys(monthPts).length} 位會員`);

  // 依點數排序，計算名次（同分同名）
  const sorted = Object.entries(monthPts).sort((a, b) => b[1] - a[1]);
  const rankMap = {};
  let rank = 1;
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0 && sorted[i][1] < sorted[i-1][1]) rank = i + 1;
    rankMap[sorted[i][0]] = { rank, monthPts: sorted[i][1], total: sorted.length };
  }

  // 批次寫入每位會員的排名（每批最多 400 筆）
  const uids = Object.keys(rankMap);
  console.log(`[updateMonthlyRanks] 準備寫入 ${uids.length} 位會員排名`);
  for (let i = 0; i < uids.length; i += 400) {
    const batch = db.batch();
    uids.slice(i, i + 400).forEach(uid => {
      batch.set(db.collection("members").doc(uid), {
        monthlyRank:   rankMap[uid].rank,
        monthlyPts:    rankMap[uid].monthPts,
        monthlyTotal:  rankMap[uid].total,
        rankUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
    });
    await batch.commit();
    console.log(`[updateMonthlyRanks] 寫入第 ${i+1}~${Math.min(i+400, uids.length)} 筆完成`);
  }
  console.log(`✅ [updateMonthlyRanks] 完成，共更新 ${uids.length} 位會員`);
}

async function checkAdmin(uid) {
  const doc = await db.collection("admins").doc(uid).get();
  return doc.exists && doc.data()?.active === true;
}

// 推播給所有店家端（讀 admin_tokens 集合）
async function sendPushToAdmins(title, body, data = {}, adminWebUrl = "https://bini-blooms-dev-admin.web.app") {
  try {
    const adminSnap = await db.collection("admin_tokens").get();
    // 記下每個 token 來自哪位 admin 的哪個裝置鍵，以便失效時精準清除
    const entries = []; // [{ token, adminUid, deviceKey }]
    adminSnap.forEach(doc => {
      const d = doc.data();
      if (d.devices && typeof d.devices === "object") {
        Object.entries(d.devices).forEach(([k, device]) => {
          if (device?.token) entries.push({ token: device.token, adminUid: doc.id, deviceKey: k });
        });
      }
    });
    if (!entries.length) { console.log("sendPushToAdmins: 沒有 admin token"); return; }

    const msg = {
      data: {
        ...Object.fromEntries(Object.entries(data).map(([k,v])=>[k,String(v)])),
        title, body,
      },
      webpush: { fcmOptions: { link: adminWebUrl } },
      android: { priority: "high" },
      apns: {
        headers: { "apns-priority": "10" },
        payload: { aps: { sound: "default", "content-available": 1 } },
      },
      tokens: entries.map(e => e.token),
    };
    const result = await admin.messaging().sendEachForMulticast(msg);

    // 收集失效 token，依 adminUid 分組清除（一個 admin 可能有多裝置）
    const staleByAdmin = {}; // { adminUid: [deviceKey, ...] }
    result.responses.forEach((r, i) => {
      if (r.success) return;
      const code = r.error?.code;
      if (STALE_FCM_CODES.has(code)) {
        const e = entries[i];
        (staleByAdmin[e.adminUid] = staleByAdmin[e.adminUid] || []).push(e.deviceKey);
      }
    });
    for (const [adminUid, keys] of Object.entries(staleByAdmin)) {
      const updates = {};
      keys.forEach(k => { updates[`devices.${k}`] = admin.firestore.FieldValue.delete(); });
      try {
        await db.collection("admin_tokens").doc(adminUid).update(updates);
        console.log(`[adminPush] 已清除 ${keys.length} 個失效 token (adminUid=${adminUid})`);
      } catch (cleanErr) {
        console.warn(`[adminPush] 清除失敗 adminUid=${adminUid}:`, cleanErr.message);
      }
    }

    console.log(`✅ sendPushToAdmins: ${title}，成功 ${result.successCount}，失敗 ${result.failureCount}`);
  } catch (e) {
    console.warn("sendPushToAdmins failed:", e.message);
  }
}

// ═══════════════════════════════════════════
//  既有功能：集點、兌換
// ═══════════════════════════════════════════

exports.confirmPoints = onCall({ region: "us-central1" }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "需要登入");
  const { tokenId, amount } = request.data;
  if (!tokenId || !amount || amount <= 0)
    throw new HttpsError("invalid-argument", "參數錯誤");

  const tokenRef = db.collection("qr_tokens").doc(tokenId);
  const memberUid = await db.runTransaction(async t => {
    const tokenDoc = await t.get(tokenRef);
    if (!tokenDoc.exists) throw new HttpsError("not-found", "Token 不存在");
    const td = tokenDoc.data();
    if (td.used) throw new HttpsError("already-exists", "Token 已使用");
    if (td.expiresAt.toDate() < new Date())
      throw new HttpsError("deadline-exceeded", "Token 已過期");
    t.update(tokenRef, { used: true, confirmedAt: admin.firestore.FieldValue.serverTimestamp() });
    return td.usedBy;
  });

  const memberRef = db.collection("members").doc(memberUid);
  const memberDoc = await memberRef.get();
  const member = memberDoc.data();
  const rate = RULES.TIER_RATES[member.tier] || 1.0;
  const rawPoints = Math.floor(amount * RULES.PPD * rate);

  const now = new Date();
  const expiresAt = new Date(now);
  expiresAt.setMonth(expiresAt.getMonth() + RULES.POINTS_EXPIRE_MONTHS);

  const txRef = db.collection("transactions").doc();
  const batchRef = db.collection("point_batches").doc();
  const newTotal = (member.points || 0) + rawPoints;
  const newSpent = (member.totalSpent || 0) + amount;
  const newTier = RULES.TIER_NAMES[RULES.TIER_THRESHOLDS.filter(t=>newSpent>=t).length - 1] || "normal";

  await db.batch().set(txRef, {
    uid: memberUid, amount, points: rawPoints, tier: member.tier,
    rate, type: "earn", createdAt: admin.firestore.FieldValue.serverTimestamp(),
  }).set(batchRef, {
    uid: memberUid, points: rawPoints, consumed: 0,
    earnedAt: admin.firestore.FieldValue.serverTimestamp(),
    expiresAt: admin.firestore.Timestamp.fromDate(expiresAt),
    txId: txRef.id,
  }).update(memberRef, {
    points: newTotal, totalSpent: newSpent, tier: newTier,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }).commit();

  await sendPush(memberUid, "🎉 Points Earned! | 集點成功",
    `You earned ${rawPoints} point(s)! Balance: ${newTotal}. | 您獲得 ${rawPoints} 點，目前共 ${newTotal} 點。`);

  // 更新本月排名
  try {
    await updateMonthlyRanks();
  } catch(e) {
    console.error("[confirmPoints] updateMonthlyRanks FAILED:", e.message, e.stack);
  }

  return { success: true, points: rawPoints, total: newTotal };
});

exports.redeemReward = onCall({ region: "us-central1" }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "需要登入");
  const { rewardId } = request.data;
  const uid = request.auth.uid;

  const [rewardDoc, memberDoc] = await Promise.all([
    db.collection("rewards").doc(rewardId).get(),
    db.collection("members").doc(uid).get(),
  ]);
  if (!rewardDoc.exists) throw new HttpsError("not-found", "獎品不存在");
  const reward = rewardDoc.data();
  const member = memberDoc.data();
  if (!reward.available) throw new HttpsError("failed-precondition", "獎品已下架");
  if (member.points < reward.pointsCost)
    throw new HttpsError("failed-precondition", "點數不足");

  const batches = await db.collection("point_batches")
    .where("uid","==",uid).where("consumed","<","points")
    .orderBy("expiresAt","asc").get();
  let remaining = reward.pointsCost;
  const batchOps = db.batch();
  for (const b of batches.docs) {
    if (remaining <= 0) break;
    const bd = b.data();
    const available = bd.points - bd.consumed;
    const deduct = Math.min(available, remaining);
    batchOps.update(b.ref, { consumed: admin.firestore.FieldValue.increment(deduct) });
    remaining -= deduct;
  }
  const txRef = db.collection("transactions").doc();
  batchOps.set(txRef, {
    uid, type: "redeem", rewardId, rewardName: reward.name_zh,
    points: -reward.pointsCost, createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  batchOps.update(db.collection("members").doc(uid), {
    points: admin.firestore.FieldValue.increment(-reward.pointsCost),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  await batchOps.commit();
  await sendPush(uid, "🎁 Redeemed! | 兌換成功", `Redeemed: ${reward.name_en || reward.name_zh} | 已兌換：${reward.name_zh}`);
  return { success: true };
});

// ═══════════════════════════════════════════
//  推薦碼（好友推薦）
//  - 每位會員有專屬推薦碼
//  - 新會員輸入推薦碼即 +10（後端發放，繞過前端規則）
//  - 推薦人於「被推薦人首次集點」後 +10 並收到推播（見 onEarnTransaction）
// ═══════════════════════════════════════════

function genReferralCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // 去除易混淆字元 0/O/1/I
  let s = "";
  for (let i = 0; i < 6; i++) s += chars[crypto.randomInt(chars.length)];
  return s;
}

// 取得（必要時產生）自己的推薦碼
exports.getOrCreateReferralCode = onCall({ region: "us-central1" }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "需要登入");
  const uid = request.auth.uid;
  const memberRef = db.collection("members").doc(uid);
  const snap = await memberRef.get();
  if (!snap.exists) throw new HttpsError("not-found", "會員不存在");
  if (snap.data().referralCode) return { code: snap.data().referralCode };

  for (let attempt = 0; attempt < 8; attempt++) {
    const code = genReferralCode();
    const dup = await db.collection("members").where("referralCode", "==", code).limit(1).get();
    if (!dup.empty) continue;
    await memberRef.update({ referralCode: code });
    return { code };
  }
  throw new HttpsError("internal", "產生推薦碼失敗，請重試");
});

// 新會員套用推薦碼：新人 +10，記錄推薦人並標記待回饋
exports.applyReferralCode = onCall({ region: "us-central1" }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "需要登入");
  const uid = request.auth.uid;
  const code = String(request.data?.code || "").trim().toUpperCase();
  if (!code) throw new HttpsError("invalid-argument", "請輸入推薦碼");

  const memberRef = db.collection("members").doc(uid);
  const memberSnap = await memberRef.get();
  if (!memberSnap.exists) throw new HttpsError("not-found", "會員不存在");
  const member = memberSnap.data();
  if (member.referredBy) throw new HttpsError("already-exists", "您已使用過推薦碼");
  if (member.referralCode === code) throw new HttpsError("failed-precondition", "不能使用自己的推薦碼");

  const refSnap = await db.collection("members").where("referralCode", "==", code).limit(1).get();
  if (refSnap.empty) throw new HttpsError("not-found", "推薦碼不存在");
  const referrerUid = refSnap.docs[0].id;
  if (referrerUid === uid) throw new HttpsError("failed-precondition", "不能使用自己的推薦碼");

  // 只記錄推薦關係，不發點給新會員（新人只拿原本的歡迎贈點）；
  // 推薦人的 +10 待被推薦人首次集點時才發放（見 maybePayReferralReward）。
  await memberRef.update({
    referredBy: referrerUid,
    referralPending: true,
  });

  return { success: true };
});

// 被推薦人首次集點後，回饋推薦人 +10（由 onEarnTransaction 觸發；以 referralPending 旗標保證只發一次）
async function maybePayReferralReward(memberUid) {
  if (!memberUid) return;
  const memberRef = db.collection("members").doc(memberUid);
  const REWARD = 10;
  const CAP = RULES.REFERRAL_REWARD_CAP; // 推薦回饋人數上限
  const result = await db.runTransaction(async (t) => {
    const m = await t.get(memberRef);
    if (!m.exists) return null;
    const md = m.data();
    if (!md.referralPending || !md.referredBy) return null;
    const referrerRef = db.collection("members").doc(md.referredBy);
    const refDoc = await t.get(referrerRef);
    // 不論是否達上限，都先清掉 pending（此被推薦人只結算一次）
    t.update(memberRef, { referralPending: false });
    if (!refDoc.exists) return null;
    const count = refDoc.data().referralRewardCount || 0;
    if (count >= CAP) return { capped: true }; // 已達上限，不再發放
    const expiresAt = new Date();
    expiresAt.setMonth(expiresAt.getMonth() + RULES.POINTS_EXPIRE_MONTHS);
    const txRef = db.collection("transactions").doc();
    const batchRef = db.collection("point_batches").doc();
    t.update(referrerRef, {
      points: admin.firestore.FieldValue.increment(REWARD),
      referralRewardCount: admin.firestore.FieldValue.increment(1),
    });
    t.set(txRef, {
      uid: md.referredBy, type: "referral_reward", points: REWARD,
      desc: "好友推薦獎勵", descEn: "Referral reward",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    t.set(batchRef, {
      uid: md.referredBy, points: REWARD, remaining: REWARD,
      earnedAt: admin.firestore.FieldValue.serverTimestamp(),
      expiresAt: admin.firestore.Timestamp.fromDate(expiresAt), txId: txRef.id,
    });
    return { referrerUid: md.referredBy, paid: true };
  });
  if (result?.paid) {
    await sendPush(result.referrerUid, "🎉 Referral Reward | 推薦獎勵到帳",
      `Your friend made their first purchase — you earned ${REWARD} points! | 您推薦的好友完成首次集點，獲得 ${REWARD} 點回饋！`);
  }
}

// ═══════════════════════════════════════════
//  v3 新增：線上購物模組
// ═══════════════════════════════════════════

// ── 商品管理 ─────────────────────────────────

exports.adminSaveProduct = onCall({ region: "us-central1" }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "需要登入");
  const isAdmin = await checkAdmin(request.auth.uid);
  if (!isAdmin) throw new HttpsError("permission-denied", "無權限");

  const { productId, name, price, description, stock, category, images, status, sortWeight, sku } = request.data;
  if (!name || price == null || stock == null)
    throw new HttpsError("invalid-argument", "必填欄位缺漏");

  const payload = {
    name: name.trim(),
    sku: (sku || "").trim(),
    price: Number(price),
    description: description || "",
    stock: Number(stock),
    category: category || "其他",
    images: images || [],
    status: status || "active",
    sortWeight: Number(sortWeight) || 0,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  if (productId) {
    await db.collection("products").doc(productId).update(payload);
    return { success: true, productId };
  } else {
    payload.createdAt = admin.firestore.FieldValue.serverTimestamp();
    payload.salesCount = 0;
    const ref = await db.collection("products").add(payload);
    return { success: true, productId: ref.id };
  }
});

exports.adminDeleteProduct = onCall({ region: "us-central1" }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "需要登入");
  const isAdmin = await checkAdmin(request.auth.uid);
  if (!isAdmin) throw new HttpsError("permission-denied", "無權限");
  await db.collection("products").doc(request.data.productId).update({
    status: "deleted",
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  return { success: true };
});

exports.adminBulkImportProducts = onCall(
  { region: "us-central1", timeoutSeconds: 300, memory: "512MiB" },
  async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "需要登入");
    const isAdmin = await checkAdmin(request.auth.uid);
    if (!isAdmin) throw new HttpsError("permission-denied", "無權限");

    const { xlsxBase64 } = request.data;
    if (!xlsxBase64) throw new HttpsError("invalid-argument", "缺少檔案資料");

    const buf = Buffer.from(xlsxBase64, "base64");
    const wb = XLSX.read(buf, { type: "buffer" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { defval: "" });

    const REQUIRED = ["品名","售價","庫存"];
    const results = { success: 0, failed: 0, errors: [] };
    const batchSize = 400;
    let batch = db.batch();
    let count = 0;

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNum = i + 2;
      const missing = REQUIRED.filter(f => !row[f] && row[f] !== 0);
      if (missing.length > 0) {
        results.failed++;
        results.errors.push({ row: rowNum, reason: `缺少必填欄位：${missing.join("、")}` });
        continue;
      }
      const price = Number(row["售價"]);
      const stock = Number(row["庫存"]);
      if (isNaN(price) || price < 0) { results.failed++; results.errors.push({ row: rowNum, reason: "售價必須為非負數字" }); continue; }
      if (isNaN(stock) || stock < 0) { results.failed++; results.errors.push({ row: rowNum, reason: "庫存必須為非負整數" }); continue; }

      const images = [];
      for (let n = 1; n <= 5; n++) {
        const imgUrl = row[`圖片${n}`] || row[`image${n}`] || "";
        if (imgUrl.trim()) images.push(imgUrl.trim());
      }

      const ref = db.collection("products").doc();
      batch.set(ref, {
        name: String(row["品名"]).trim(),
        sku: String(row["SKU"] || row["sku"] || "").trim(), price, stock: Math.floor(stock),
        description: String(row["商品描述"] || row["description"] || "").trim(),
        category: String(row["分類"] || row["category"] || "其他").trim(),
        images, status: String(row["狀態"] || "active").trim(),
        sortWeight: Number(row["排序權重"] || 0), salesCount: 0,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      count++;
      results.success++;
      if (count >= batchSize) { await batch.commit(); batch = db.batch(); count = 0; }
    }
    if (count > 0) await batch.commit();
    return results;
  }
);

// ── 購物車驗證 ────────────────────────────────

exports.validateCart = onCall({ region: "us-central1" }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "需要登入");
  const { items } = request.data;
  if (!items || !items.length) throw new HttpsError("invalid-argument", "購物車為空");

  // 讀取購物規則（有設定用 Firestore，否則用預設值）
  let pointMinOrder = RULES.SHOP_POINT_MIN_ORDER;
  let freeShippingThreshold = 0;
  try {
    const rulesDoc = await db.collection("config").doc("shop_rules").get();
    if (rulesDoc.exists) {
      const r = rulesDoc.data();
      if (r.pointMinOrder != null)         pointMinOrder         = r.pointMinOrder;
      if (r.freeShippingThreshold != null) freeShippingThreshold = r.freeShippingThreshold;
    }
  } catch {}

  const results = [];
  let subtotal = 0;

  for (const item of items) {
    const doc = await db.collection("products").doc(item.productId).get();
    if (!doc.exists || doc.data().status !== "active") {
      results.push({ productId: item.productId, ok: false, reason: "商品已下架" });
      continue;
    }
    const p = doc.data();
    if (p.stock < item.qty) {
      results.push({ productId: item.productId, ok: false,
        reason: `庫存不足（剩餘 ${p.stock} 件）`, stock: p.stock });
      continue;
    }
    subtotal += p.price * item.qty;
    results.push({ productId: item.productId, ok: true, price: p.price,
      name: p.name, image: p.images?.[0] || "" });
  }

  const allOk = results.every(r => r.ok);
  let pointsBalance = 0;
  let maxPointsDiscount = 0;
  if (allOk && request.auth.uid) {
    const memberDoc = await db.collection("members").doc(request.auth.uid).get();
    if (memberDoc.exists) {
      pointsBalance = memberDoc.data().points || 0;
      if (subtotal >= pointMinOrder) {
        const maxByRatio = Math.floor(subtotal * RULES.SHOP_POINT_MAX_RATIO);
        maxPointsDiscount = Math.min(pointsBalance, maxByRatio);
      }
    }
  }
  return { allOk, results, subtotal, pointsBalance, maxPointsDiscount, pointMinOrder, freeShippingThreshold };
});

// ── 建立訂單（正式，含 ECPay）────────────────────

exports.createOrder = onCall({ region: "us-central1" }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "需要登入");
  try {
  const uid = request.auth.uid;
  const { items, pointsToUse, cvs, shippingFee: rawShipping } = request.data;

  // 讀取購物規則
  let pointMinOrder = RULES.SHOP_POINT_MIN_ORDER;
  let freeShippingThreshold = 0;
  try {
    const rulesDoc = await db.collection("config").doc("shop_rules").get();
    if (rulesDoc.exists) {
      const r = rulesDoc.data();
      if (r.pointMinOrder != null)         pointMinOrder         = r.pointMinOrder;
      if (r.freeShippingThreshold != null) freeShippingThreshold = r.freeShippingThreshold;
    }
  } catch {}

  if (!items?.length) throw new HttpsError("invalid-argument", "購物車為空");
  if (!cvs?.storeName) throw new HttpsError("invalid-argument", "請選擇取貨超商");

  const orderId = genOrderId();
  let subtotal = 0;
  const orderItems = [];

  // ── Phase 1 & 2 & 3: 鎖庫存（讀後寫）──
  await db.runTransaction(async t => {
    const refs = items.map(item => db.collection("products").doc(item.productId));
    const docs = await Promise.all(refs.map(ref => t.get(ref)));
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const doc = docs[i];
      if (!doc.exists || doc.data().status !== "active")
        throw new HttpsError("failed-precondition", `商品 ${item.productId} 已下架`);
      const p = doc.data();
      if (p.stock < item.qty)
        throw new HttpsError("failed-precondition", `${p.name} 庫存不足（剩餘 ${p.stock} 件）`);
      subtotal += p.price * item.qty;
      orderItems.push({ productId: item.productId, name: p.name,
        price: p.price, qty: item.qty, image: p.images?.[0] || "", sku: p.sku || "" });
    }
    for (let i = 0; i < items.length; i++) {
      t.update(refs[i], {
        stock: admin.firestore.FieldValue.increment(-items[i].qty),
        salesCount: admin.firestore.FieldValue.increment(items[i].qty),
      });
    }
  });

  // ── 點數折扣 ──
  const usePoints = Math.max(0, Number(pointsToUse) || 0);
  let pointsDiscount = 0;
  let pointsUsed = 0;
  if (usePoints > 0) {
    if (subtotal < pointMinOrder)
      throw new HttpsError("failed-precondition", "未達使用點數最低消費門檻");
    const memberDoc = await db.collection("members").doc(uid).get();
    const member = memberDoc.data();
    const maxDiscount = Math.floor(subtotal * RULES.SHOP_POINT_MAX_RATIO);
    const canUse = Math.min(member.points, usePoints, maxDiscount);
    pointsDiscount = canUse * RULES.POINT_TO_NTD;
    pointsUsed = canUse;
    await db.collection("members").doc(uid).update({
      points: admin.firestore.FieldValue.increment(-canUse),
      pointsPending: admin.firestore.FieldValue.increment(canUse),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  }

  const totalAmount = Math.max(1, subtotal - pointsDiscount);
  // 運費：7-11=65，全家=75；達免運門檻則免運
  const shippingFeeMap = { UNIMART: 65, FAMI: 75 };
  const baseShipping = shippingFeeMap[cvs.cvsType] ?? 65;
  const isFreeShipping = freeShippingThreshold > 0 && subtotal >= freeShippingThreshold;
  const shippingFee = isFreeShipping ? 0 : baseShipping;
  const totalWithShipping = totalAmount + shippingFee;

  // ── 寫入 Firestore 訂單（pending_shipment = 等待店主出貨）──
  const orderRef = db.collection("orders").doc(orderId);
  await orderRef.set({
    orderId, uid, items: orderItems, subtotal,
    pointsUsed, pointsDiscount, shippingFee,
    totalAmount: totalWithShipping,
    cvs,
    status: "pending_shipment",
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  // 通知後台新訂單
  await db.collection("admin_notifications").add({
    type: "new_order",
    orderId,
    totalAmount: totalWithShipping,
    message: `New order ${orderId} · NT$${totalWithShipping} (incl. shipping NT$${shippingFee}) · Pickup: ${cvs.storeName} | 新訂單 ${orderId}，NT$${totalWithShipping}（含運費 NT$${shippingFee}），取貨門市：${cvs.storeName}`,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    read: false,
  });

  // 推播通知店家端（新訂單）
  await sendPushToAdmins(
    "🛍️ New Order! | 新訂單",
    `NT$${totalWithShipping}｜${cvs.storeName}｜${cvs.name}`,
    { type: "new_order", orderId }
  );

  // 推播通知客戶
  await sendPush(uid, "✅ 訂單建立成功！ | Order Confirmed",
    `訂單 ${orderId} 已建立，店家已收到您的訂單，謝謝您選擇 BINI Blooms。\nOrder ${orderId} has been placed. Thank you for choosing BINI Blooms!`,
    { type: "order_created", orderId }
  );

  return {
    success: true,
    orderId,
    totalAmount: totalWithShipping,
    pointsDiscount,
    shippingFee,
    storeName: cvs.storeName,
    storeAddress: cvs.storeAddress,
  };
  } catch (e) {
    if (e instanceof HttpsError) throw e;
    console.error("createOrder 未預期錯誤:", e.message, e.stack);
    throw new HttpsError("internal", `系統錯誤：${e.message}`);
  }
});


// ── 訂單管理

exports.adminUpdateOrderStatus = onCall({ region: "us-central1" }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "需要登入");
  const isAdmin = await checkAdmin(request.auth.uid);
  if (!isAdmin) throw new HttpsError("permission-denied", "無權限");

  const { orderId, status, trackingNumber, note } = request.data;
  const validStatuses = ["processing","shipped","completed","cancelled"];
  if (!validStatuses.includes(status))
    throw new HttpsError("invalid-argument", "無效的訂單狀態");

  const orderRef = db.collection("orders").doc(orderId);
  const orderDoc = await orderRef.get();
  if (!orderDoc.exists) throw new HttpsError("not-found", "訂單不存在");
  const order = orderDoc.data();

  const updateData = {
    status, note: note || "",
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };
  if (trackingNumber) updateData.trackingNumber = trackingNumber;
  if (status === "shipped")   updateData.shippedAt   = admin.firestore.FieldValue.serverTimestamp();
  if (status === "completed") updateData.completedAt = admin.firestore.FieldValue.serverTimestamp();

  if (status === "cancelled" && order.status !== "cancelled") {
    await db.runTransaction(async t => {
      t.update(orderRef, updateData);
      for (const item of order.items) {
        const ref = db.collection("products").doc(item.productId);
        t.update(ref, { stock: admin.firestore.FieldValue.increment(item.qty) });
      }
      if (order.pointsUsed > 0 && order.status === "paid") {
        const memberRef = db.collection("members").doc(order.uid);
        t.update(memberRef, {
          points: admin.firestore.FieldValue.increment(order.pointsUsed),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        const txRef = db.collection("transactions").doc();
        t.set(txRef, {
          uid: order.uid, orderId, type: "shop_refund",
          points: order.pointsUsed, note: `訂單 ${orderId} 取消點數回補`,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }
    });
  } else {
    await orderRef.update(updateData);
  }

  const pushMessages = {
    processing: {
      title: "📦 正在備貨中 | Preparing Your Order",
      body:  `訂單 ${orderId} 正在備貨中，即將出貨。\nOrder ${orderId} is being prepared and will ship soon.`,
    },
    shipped: {
      title: "🚚 已出貨 | Your Order Has Been Shipped",
      body:  `訂單 ${orderId}${trackingNumber ? `，貨運單號：${trackingNumber}，` : "，"}已出貨，請收到簡訊通知後到取件超商領取。\nOrder ${orderId} has been shipped.${trackingNumber ? ` Tracking No.: ${trackingNumber}.` : ""} Please pick it up at your selected convenience store after receiving the SMS notification.`,
    },
    completed: {
      title: "✅ 取貨完成 | Order Completed",
      body:  `訂單 ${orderId} 已完成，感謝您的購物！\nOrder ${orderId} completed. Thank you for shopping with us! by Bini Blooms`,
    },
    cancelled: {
      title: "❌ 訂單已取消 | Order Cancelled",
      body:  `訂單 ${orderId} 已取消${order.pointsUsed > 0 ? `，${order.pointsUsed} 點數已回補` : ""}。\nOrder ${orderId} has been cancelled.${order.pointsUsed > 0 ? ` Your ${order.pointsUsed} points have been refunded.` : ""}`,
    },
  };
  const msg = pushMessages[status];
  if (msg) await sendPush(order.uid, msg.title, msg.body, { type:"order_status", orderId, status });
  return { success: true };
});

exports.adminGetOrderList = onCall({ region: "us-central1" }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "需要登入");
  const isAdmin = await checkAdmin(request.auth.uid);
  if (!isAdmin) throw new HttpsError("permission-denied", "無權限");

  const { status, limit = 50, startAfter } = request.data;
  let q = db.collection("orders").orderBy("createdAt","desc");
  if (status && status !== "all") q = q.where("status","==",status);
  if (startAfter) {
    const cursor = await db.collection("orders").doc(startAfter).get();
    q = q.startAfter(cursor);
  }
  q = q.limit(Math.min(Number(limit), 100));
  const snap = await q.get();
  const orders = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  return { orders, hasMore: orders.length === limit };
});

// ── 🧪 測試專用：直接寫入 paid 訂單 ─────────────


// ── 定時任務 ─────────────────────────────────

exports.scheduledOrderTimeout = onSchedule(
  { schedule: "every 60 minutes", region: "us-central1" },
  async () => {
    const now = admin.firestore.Timestamp.now();
    const snap = await db.collection("orders")
      .where("status","==","pending_payment")
      .where("paymentExpireAt","<=",now)
      .get();
    for (const doc of snap.docs) {
      const order = doc.data();
      await db.runTransaction(async t => {
        t.update(doc.ref, { status: "expired", updatedAt: admin.firestore.FieldValue.serverTimestamp() });
        for (const item of order.items) {
          const ref = db.collection("products").doc(item.productId);
          t.update(ref, { stock: admin.firestore.FieldValue.increment(item.qty) });
        }
        if (order.pointsUsed > 0) {
          const memberRef = db.collection("members").doc(order.uid);
          t.update(memberRef, {
            points: admin.firestore.FieldValue.increment(order.pointsUsed),
            pointsPending: admin.firestore.FieldValue.increment(-order.pointsUsed),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          });
        }
      });
      await sendPush(order.uid, "⏰ 訂單已自動取消 | Order Cancelled",
        `訂單 ${order.orderId} 因逾時未取，訂單已自動取消。\nOrder ${order.orderId} was automatically cancelled due to non-pickup.`);
    }
    console.log(`處理了 ${snap.size} 筆逾期訂單`);
  }
);

exports.scheduledLowStockAlert = onSchedule(
  { schedule: "every day 09:00", timeZone: "Asia/Taipei", region: "us-central1" },
  async () => {
    const snap = await db.collection("products")
      .where("status","==","active")
      .where("stock","<=",5)
      .get();
    if (snap.size === 0) return;
    const items = snap.docs.map(d => `${d.data().name} (${d.data().stock})`).join("\n");
    await db.collection("admin_notifications").add({
      type: "low_stock",
      message: `Low stock items | 低庫存商品：\n${items}`,
      count: snap.size,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      read: false,
    });
    console.log(`低庫存商品：${snap.size} 件`);
  }
);

// ── 每日點數到期：到期扣點 + 到期前 7 天提醒 ──────────
// 未使用點數以批次(point_batches)的未用量為準；扣除時以會員餘額為上限夾擠，避免負值。
exports.scheduledPointsExpiry = onSchedule(
  { schedule: "every day 10:00", timeZone: "Asia/Taipei", region: "us-central1" },
  async () => {
    const FieldValue = admin.firestore.FieldValue;
    const Timestamp = admin.firestore.Timestamp;
    const now = Timestamp.now();
    // 批次未用量（相容兩種欄位慣例：remaining 或 points-consumed）
    const unspentOf = (b) => (b.remaining != null ? b.remaining : (b.points || 0) - (b.consumed || 0));

    // ── 1. 到期扣點（含現有早已過期的舊點）──
    const expiredSnap = await db.collection("point_batches").where("expiresAt", "<=", now).get();
    const byUser = {};
    expiredSnap.forEach((doc) => {
      const b = doc.data();
      if (b.uid && unspentOf(b) > 0) (byUser[b.uid] = byUser[b.uid] || []).push(doc.ref);
    });
    for (const [uid, refs] of Object.entries(byUser)) {
      try {
        const removed = await db.runTransaction(async (t) => {
          const memberRef = db.collection("members").doc(uid);
          const batchDocs = await Promise.all(refs.map((r) => t.get(r)));
          const memberDoc = await t.get(memberRef);
          if (!memberDoc.exists) return 0;
          let totalExpire = 0;
          batchDocs.forEach((bd) => {
            if (!bd.exists) return;
            const b = bd.data();
            const unspent = unspentOf(b);
            if (unspent > 0) {
              totalExpire += unspent;
              t.update(bd.ref, { remaining: 0, consumed: b.points || 0, expiredAt: now });
            }
          });
          if (totalExpire <= 0) return 0;
          const cur = memberDoc.data().points || 0;
          const deduct = Math.min(cur, totalExpire); // 夾擠：不可扣成負數
          if (deduct > 0) {
            t.update(memberRef, { points: cur - deduct });
            t.set(db.collection("transactions").doc(), {
              uid, type: "expire", points: deduct, // 正值，前端以類型判斷為扣除
              desc: "點數到期", descEn: "Points expired",
              createdAt: FieldValue.serverTimestamp(),
            });
          }
          return deduct;
        });
        if (removed > 0) {
          await sendPush(uid, "⏰ Points Expired | 點數到期",
            `${Number.isInteger(removed) ? removed : removed.toFixed(1)} point(s) have expired. | 您有 ${Number.isInteger(removed) ? removed : removed.toFixed(1)} 點已到期失效。`);
        }
      } catch (e) {
        console.error("[pointsExpiry] 扣點失敗 uid=" + uid, e.message);
      }
    }

    // ── 2. 到期前 7 天提醒（每筆批次只提醒一次）──
    const in7 = Timestamp.fromMillis(now.toMillis() + 7 * 24 * 60 * 60 * 1000);
    const soonSnap = await db.collection("point_batches")
      .where("expiresAt", ">", now).where("expiresAt", "<=", in7).get();
    const remind = {};
    soonSnap.forEach((doc) => {
      const b = doc.data();
      if (b.uid && !b.expiryReminded && unspentOf(b) > 0) {
        const e = (remind[b.uid] = remind[b.uid] || { total: 0, refs: [] });
        e.total += unspentOf(b);
        e.refs.push(doc.ref);
      }
    });
    for (const [uid, info] of Object.entries(remind)) {
      try {
        await sendPush(uid, "⏰ Points Expiring Soon | 點數即將到期",
          `You have ${Number.isInteger(info.total) ? info.total : info.total.toFixed(1)} point(s) expiring within 7 days — use them soon! | 您有 ${Number.isInteger(info.total) ? info.total : info.total.toFixed(1)} 點將於 7 天內到期，把握使用！`);
        const wb = db.batch();
        info.refs.forEach((r) => wb.update(r, { expiryReminded: true }));
        await wb.commit();
      } catch (e) {
        console.error("[pointsExpiry] 提醒失敗 uid=" + uid, e.message);
      }
    }
  }
);

// ── 每日生日推播：當天生日的會員收到祝賀 + 雙倍點提醒 ──────────
// 生日當天消費集點本來就會自動加倍（見店家端 confirmAmount），這裡只負責主動提醒。
exports.scheduledBirthdayGreeting = onSchedule(
  { schedule: "every day 08:00", timeZone: "Asia/Taipei", region: "us-central1" },
  async () => {
    // 台北時區「今天」的月、日（與店家端 isTodayBirthday 判斷一致）
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Taipei", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
    const tMonth = parts.find(x => x.type === "month")?.value;
    const tDay = parts.find(x => x.type === "day")?.value;
    if (!tMonth || !tDay) return;

    const snap = await db.collection("members").get();
    let count = 0;
    for (const doc of snap.docs) {
      const bday = doc.data().birthday;
      if (!bday || typeof bday !== "string") continue;
      const p = bday.split("-");
      if (p.length < 3) continue;
      if (p[1].padStart(2, "0") === tMonth && p[2].padStart(2, "0") === tDay) {
        try {
          await sendPush(doc.id, "🎂 Happy Birthday! | 生日快樂",
            "Happy Birthday from BINI Blooms! Earn DOUBLE points on all purchases today 🎉 | 今天消費集點享雙倍點數！");
          count++;
        } catch (e) {
          console.error("[birthday] 推播失敗 uid=" + doc.id, e.message);
        }
      }
    }
    console.log(`[birthday] 生日推播完成，共 ${count} 位`);
  }
);

// ── Firestore Trigger：notifications 新文件 → 自動推播 ──────────
exports.onNotificationCreated = onDocumentCreated(
  { document: "notifications/{notifId}", region: "us-central1" },
  async (event) => {
    const data = event.data?.data();
    if (!data) return;

    const { title, body, target, targetUid, type, url } = data;

    try {
      if (target === "all") {
        // 廣播：推播給所有有 token 的用戶
        const snap = await db.collection("push_tokens").get();
        const tokens = [];
        snap.forEach(doc => {
          const d = doc.data();
          if (d.tokens && typeof d.tokens === "object") {
            Object.values(d.tokens).forEach(t => { if (t) tokens.push(t); });
          } else if (d.token) {
            tokens.push(d.token);
          }
        });

        if (!tokens.length) { console.log("沒有任何推播 token"); return; }

        // ⚠️ 純 data 訊息：SW 統一顯示，避免重複推播
        const msg = {
          data: { type: type || "announcement", url: url || "/", title: title || "BINI Blooms", body: body || "" },
          webpush: { fcmOptions: { link: url || "https://bini-blooms-dev-client.web.app" } },
          android: { priority: "high" },
          apns: {
            headers: { "apns-priority": "10" },
            payload: { aps: { sound: "default", "content-available": 1 } },
          },
          tokens,
        };

        const result = await admin.messaging().sendEachForMulticast(msg);
        console.log(`✅ 廣播推播：成功 ${result.successCount}，失敗 ${result.failureCount}`);

      } else if (target) {
        // 個人推播
        const uid = targetUid || target;
        await sendPush(uid, title || "BINI Blooms", body || "",
          { type: type || "notification", url: url || "/" });
        console.log(`✅ 個人推播 → ${uid}`);
      }
    } catch (e) {
      console.error("推播失敗:", e.message);
    }
  }
);

// ── Firestore Trigger：客戶新訊息 → 推播給所有 Admin ────────────
exports.onChatMessageCreated = onDocumentCreated(
  { document: "chats/{chatId}/messages/{msgId}", region: "us-central1" },
  async (event) => {
    const data = event.data?.data();
    if (!data || data.sender !== "user") return; // 只處理用戶訊息

    const chatId = event.params.chatId;

    try {
      // 取得聊天室資訊
      const chatDoc = await db.collection("chats").doc(chatId).get();
      const memberName = chatDoc.data()?.memberName || "Member";
      const msgText = data.text || (data.imageUrl ? "[Image | 圖片]" : "New message | 新訊息");

      // 讀取所有 admin tokens
      const adminSnap = await db.collection("admin_tokens").get();
      const tokens = [];
      adminSnap.forEach(doc => {
        const d = doc.data();
        if (d.devices && typeof d.devices === "object") {
          Object.values(d.devices).forEach(device => {
            if (device.token) tokens.push(device.token);
          });
        }
      });

      if (!tokens.length) { console.log("沒有 admin 推播 token"); return; }

      await sendPushToAdmins(
        `💬 ${memberName}`,
        msgText.slice(0, 100),
        { type: "chat", chatId, url: "/" }
      );
      console.log(`✅ Admin 推播：${memberName} 的新訊息`);
    } catch (e) {
      console.error("Admin 推播失敗:", e.message);
    }
  }
);

// ── 監聽新集點交易 → 自動更新排行榜 ──
exports.onEarnTransaction = onDocumentCreated(
  { document: "transactions/{txId}", region: "us-central1", database: "(default)" },
  async (event) => {
    const data = event.data?.data();
    if (!data || data.type !== "earn") return;
    console.log(`[onEarnTransaction] 偵測到新集點，uid=${data.uid}，points=${data.points}`);
    try {
      await updateMonthlyRanks();
    } catch (e) {
      console.error("[onEarnTransaction] updateMonthlyRanks FAILED:", e.message, e.stack);
    }
    try {
      await maybePayReferralReward(data.uid); // 被推薦人首次集點 → 回饋推薦人
    } catch (e) {
      console.error("[onEarnTransaction] referral reward FAILED:", e.message, e.stack);
    }
  }
);
