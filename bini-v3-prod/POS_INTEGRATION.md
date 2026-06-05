# BINI Blooms — POS 整合技術文件

> 本文件目的：為新製作的 POS 系統提供完整、精確的技術規格，避免整合時產生 bug。
> 文件涵蓋會員、集點、兌換、訂單、推播、認證等所有可能與 POS 對接的子系統。
> 文件版本：v1.0（對應 bini-blooms-functions v3.0.5 / client v3.0.44-prod）
> 最後更新：2026-06-02

---

## 目錄

1. [系統總覽](#1-系統總覽)
2. [技術堆疊與專案資訊](#2-技術堆疊與專案資訊)
3. [業務規則（核心常數）](#3-業務規則核心常數)
4. [Firestore 資料模型](#4-firestore-資料模型)
5. [Cloud Functions API](#5-cloud-functions-api)
6. [排程與觸發器](#6-排程與觸發器)
7. [認證機制](#7-認證機制)
8. [Firebase Storage 結構](#8-firebase-storage-結構)
9. [FCM 推播機制](#9-fcm-推播機制)
10. [QR 集點流程（POS 重點）](#10-qr-集點流程pos-重點)
11. [POS 整合方案建議](#11-pos-整合方案建議)
12. [已知問題與雷區](#12-已知問題與雷區)
13. [檔案位置索引](#13-檔案位置索引)

---

## 1. 系統總覽

### 三層架構

```
┌──────────────────┐   ┌──────────────────┐
│  客戶端 PWA       │   │  後台 PWA         │
│  (public-client) │   │  (public-admin)  │
│  會員、集點、購物  │   │  店家、出貨、客服  │
└─────────┬────────┘   └─────────┬────────┘
          │                       │
          └──────────┬────────────┘
                     ▼
          ┌──────────────────────┐
          │   Firebase 後端      │
          │  - Firestore (DB)    │
          │  - Auth              │
          │  - Storage           │
          │  - Cloud Functions   │
          │  - FCM (推播)        │
          └──────────────────────┘
```

### Hosting URLs

| 用途 | URL | Hosting Target |
|------|-----|----------------|
| 客戶端 | https://bini-blooms-client.web.app | `client` |
| 後台 | https://bini-blooms-admin.web.app | `admin` |

### Firebase 專案
- **Project ID**：`bini-blooms`
- **Region**：`us-central1`（所有 Cloud Functions）
- **預設時區**：`Asia/Taipei`（所有排程任務）
- **Messaging Sender ID**：`870226740523`

---

## 2. 技術堆疊與專案資訊

| 元件 | 技術 / 版本 |
|------|------------|
| 前端 | 原生 JS（無框架）+ Firebase Web SDK v10.12.0 |
| Cloud Functions | firebase-functions v6（v2 API）/ Node 22 |
| Firestore | Native mode |
| Auth | Phone Auth + Email/Password（手機號轉 email 格式） |
| 推播 | FCM Web Push（純 data 訊息 + Service Worker） |
| Storage Bucket | `bini-blooms.firebasestorage.app` |

### Cloud Functions 主要依賴
```json
{
  "firebase-admin": "^12.0.0",
  "firebase-functions": "^6.0.0",
  "xlsx": "^0.18.5"
}
```

---

## 3. 業務規則（核心常數）

### 集點公式

```
基礎點數 = floor(消費金額 / BASE_UNIT) × BASE_POINTS × 等級倍率
```

| 常數 | 預設值 | 說明 |
|------|--------|------|
| `BASE_UNIT` | 200 (NTD) | 每 NT$200 給點 |
| `BASE_POINTS` | 1 | 基礎 1 點 |
| `POINT_TO_NTD` | 1 | 1 點 = NT$1 折抵 |
| `POINTS_EXPIRE_MONTHS` | 3（或 90 天） | 點數有效期 |

⚠️ **這三個值（BASE_UNIT、BASE_POINTS、TIER_RATES）可被店家在後台動態修改**，儲存於 Firestore `config/point_rules`，請 POS 動態讀取，**勿在 POS 內 hardcode**。

### 會員等級門檻（依「累積消費」計算）

| 等級 ID | 名稱 | 累積消費門檻 | 點數倍率（預設） |
|---------|------|-------------|------------------|
| `normal` | 一般會員 / Regular | 0 ~ 10,000 | 1.0× |
| `vip` | VIP 會員 / VIP | 10,001 ~ 15,000 | 1.3× |
| `vvip` | VVIP 會員 / VVIP | 15,001 ~ 25,000 | 1.5× |
| `vvvip` | VVVIP 會員 / VVVIP | 25,001+ | 2.0× |

### 生日加倍

- 客人生日當天集點 → 系統自動 `pts = basePts × 2`
- 判定方式：比對 `member.birthday`（`YYYY-MM-DD`）的月日與台北時區當天月日
- 函式：`isTodayBirthday(birthday)` (admin-app.js:507)
- **此加倍會被計入週排行**

### 點數有效期

- 集點當下記錄 `expiresAt = 今天 + 90 天`
- 每日 10:00 台北時間自動扣除過期點數（FIFO，依 `expiresAt` 升冪排序）
- 過期前 7 天會推播提醒一次

### 點數折抵規則（線上購物）

| 項目 | 值 | 說明 |
|------|----|----|
| `SHOP_POINT_MIN_ORDER` | 300 (NTD) | 滿 NT$300 才可用點數 |
| `SHOP_POINT_MAX_RATIO` | 0.3 | 最多折抵商品總額的 30% |
| `POINT_TO_NTD` | 1 | 1 點 = NT$1 |

可在後台 `config/shop_rules` 動態修改：
- `pointMinOrder`
- `freeShippingThreshold`（免運門檻，0 = 不啟用）

### 推薦碼

- 每位會員可呼叫 `getOrCreateReferralCode` 取得專屬 6 碼推薦碼
- 字元集：`ABCDEFGHJKLMNPQRSTUVWXYZ23456789`（排除 0/O/1/I）
- 新會員填寫推薦碼 → 推薦人在新會員**首次集點**後 +10 點
- 每位推薦人最多回饋 `REFERRAL_REWARD_CAP = 10` 位

### 週排行頒獎

- 每週五 22:00 台北時間結算
- 區間：上週五 22:00 ~ 本週五 22:00（不含端點）
- 前 5 名加贈點數（預設 5/4/3/2/1，可在後台 `config/point_rules.rankPrizes` 修改）
- 加贈交易 `type='rank_bonus'`，**不會被下週排行重複計入**

---

## 4. Firestore 資料模型

### 4.1 `members/{uid}` — 會員主檔

| 欄位 | 型別 | 說明 |
|------|------|------|
| `uid` | string | 同文件 ID（Firebase Auth UID） |
| `phone` | string | 手機號碼（台灣格式 09XXXXXXXX） |
| `email` | string | `{phone}@biniblooms.com`（用於 Email/Password 登入） |
| `name` | string | 會員姓名 |
| `birthday` | string | `YYYY-MM-DD` |
| `points` | number | 目前可用點數（即時餘額） |
| `pointsPending` | number | 已凍結待出貨點數（下單時扣，出貨後消化） |
| `totalSpent` | number | 累積消費金額（決定等級） |
| `visitCount` | number | 集點次數 |
| `redeemCount` | number | 兌換次數 |
| `deductedPts` | number | 累計已折抵點數 |
| `tier` | string | `normal` / `vip` / `vvip` / `vvvip` |
| `joinedAt` | Timestamp | 加入時間 |
| `updatedAt` | Timestamp | 最後更新 |
| `welcomeBonus` | bool | true 表示已收到歡迎贈點 |
| `referralCode` | string\|null | 此會員的專屬推薦碼 |
| `referredBy` | string\|null | 是誰推薦進來的（uid） |
| `referralPending` | bool | true 表示等待首次集點觸發推薦回饋 |
| `referralRewardCount` | number | 已累計推薦成功幾位（上限 10） |
| `monthlyRank` | number | 本月排名（由 `updateMonthlyRanks` 維護） |
| `monthlyPts` | number | 本月累積點數 |
| `monthlyTotal` | number | 本月參與排名總人數 |
| `rankUpdatedAt` | Timestamp | 排名最後更新時間 |
| `birthdayPushSentDate` | string | `YYYY-MM-DD`，已送過生日推播當天 |

#### 安全規則重點
- 本人可讀；admin 全部可讀
- 本人僅能改 `name`/`birthday`/`points`/`redeemCount`/`deductedPts`/`updatedAt`
- 本人**只能讓 points 減少**，不能增加（防灌點）
- 集點與後台給點走 Cloud Function 或 Admin SDK

### 4.2 `transactions/{txId}` — 點數交易紀錄

| 欄位 | 型別 | 說明 |
|------|------|------|
| `uid` | string | 會員 UID |
| `type` | string | `earn` / `redeem` / `welcome` / `deduct` / `expire` / `rank_bonus` / `referral_reward` / `shop_refund` |
| `points` | number | 點數變動值（正值；type 決定方向） |
| `amount` | number | 消費金額（earn 才有） |
| `tier` | string | 集點當下等級 |
| `rate` | number | 點數倍率 |
| `desc` / `descEn` | string | 中英文說明 |
| `birthdayBonus` | bool | true 表示有生日加倍 |
| `basePoints` | number | 加倍前的原始點數 |
| `rank` | number | 週排行名次（rank_bonus 才有） |
| `weekTotalPts` | number | 上週總點數 |
| `orderId` | string | 退款回補點數（shop_refund） |
| `rewardId` | string | 兌換的獎品 ID（redeem） |
| `rewardName` | string | 獎品名稱 |
| `createdAt` | Timestamp | 建立時間 |

#### 安全規則重點
- 本人可讀自己的、admin 可讀全部、`earn` 類型公開可讀（為了排行榜）
- 本人僅能新增 `welcome` 與 `deduct` 兩類
- `earn` / `redeem` / `rank_bonus` / `referral_reward` 必須由 Cloud Function 或 Admin SDK 建立
- 不可更新或刪除

### 4.3 `point_batches/{batchId}` — 點數批次（FIFO 到期管理）

| 欄位 | 型別 | 說明 |
|------|------|------|
| `uid` | string | 會員 UID |
| `points` | number | 此批次原始點數 |
| `consumed` | number | 已折抵點數 |
| `remaining` | number | 剩餘可用（**新版用這個，舊版用 `points - consumed`**） |
| `amount` | number | 對應消費金額 |
| `tier` | string | 集點當下等級 |
| `earnedAt` | Timestamp | 取得時間 |
| `expiresAt` | Timestamp | 到期時間（earnedAt + 90 天） |
| `expiredAt` | Timestamp | 實際過期時間（過期當下寫入） |
| `expiryReminded` | bool | 是否已發過到期前 7 天提醒 |
| `txId` | string | 關聯的 transactions doc ID |
| `source` | string | 來源（如 `rank_bonus`） |

⚠️ **欄位不一致警告**：早期版本用 `points - consumed` 計算剩餘量；新版直接寫 `remaining`。後端兼容兩種：
```js
const unspentOf = (b) => (b.remaining != null ? b.remaining : (b.points || 0) - (b.consumed || 0));
```
POS 讀取此 collection 時請同樣寫兼容邏輯。

### 4.4 `qr_tokens/{tokenId}` — QR 集點 token

| 欄位 | 型別 | 說明 |
|------|------|------|
| `status` | string | `pending` → `scanned` → `completed` / `cancelled` |
| `used` | bool | true 表示已使用，不可重複 |
| `memberUid` | string | 客人掃 QR 後寫入 |
| `memberName` | string | 同上 |
| `amount` | number | 店家輸入的消費金額 |
| `pts` | number | 計算後給出的點數 |
| `pointsAwarded` | number | 同 `pts` |
| `basePoints` | number | 加倍前的點數 |
| `birthdayBonus` | bool | 是否生日加倍 |
| `totalSpent` | number | 集點後累計消費 |
| `newTotalPts` | number | 集點後總點數 |
| `expiresAt` | Timestamp | 過期時間（120 秒，僅 Cloud Functions 流程用） |
| `createdAt` / `completedAt` / `cancelledAt` / `confirmedAt` | Timestamp | 對應狀態時間戳 |

⚠️ **安全規則完全開放讀寫**（`allow read, write: if true`）— 因為店家掃 QR 流程需要無認證寫入。POS 對接時請當作公開 collection 處理。

### 4.5 `products/{productId}` — 商品

| 欄位 | 型別 | 說明 |
|------|------|------|
| `name` | string | 商品名稱 |
| `sku` | string | 內部編號（建議 POS 用此欄與庫存系統對齊） |
| `price` | number | 售價 NTD |
| `stock` | number | 庫存（線上訂單建立會 `increment(-qty)`，取消會回補） |
| `salesCount` | number | 累計銷量 |
| `description` | string | 商品描述 |
| `category` | string | 分類 |
| `images` | array<string> | 圖片 URL 陣列 |
| `status` | string | `active` / `deleted` |
| `sortWeight` | number | 排序權重（大 → 前） |
| `createdAt` / `updatedAt` | Timestamp | |

### 4.6 `orders/{orderId}` — 訂單

> ⚠️ **重大 Bug**：`orderId` 由 `genOrderId()` 產生，但此函式**未在 functions/index.js 定義**（line 647 呼叫但無實作）。目前線上下單會直接拋 `ReferenceError`。POS 整合前必須先修 — 見 §12。

| 欄位 | 型別 | 說明 |
|------|------|------|
| `orderId` | string | 同文件 ID |
| `uid` | string | 下單會員 |
| `items` | array | `[{productId, name, price, qty, image, sku}]` |
| `subtotal` | number | 商品小計 |
| `pointsUsed` | number | 使用點數數量 |
| `pointsDiscount` | number | 點數折抵金額（NTD） |
| `shippingFee` | number | 運費（7-11=65 / 全家=75 / 達免運門檻=0） |
| `totalAmount` | number | 總計（含運） |
| `cvs` | object | `{storeName, storeAddress, cvsType, name, phone}` |
| `status` | string | `pending_shipment` → `processing` → `shipped` → `completed` / `cancelled` / `expired` |
| `trackingNumber` | string | 物流單號 |
| `note` | string | 備註 |
| `createdAt` / `updatedAt` / `shippedAt` / `completedAt` / `paymentExpireAt` | Timestamp | |

### 4.7 其他 Collection（摘要）

| Collection | 用途 | 寫權限 |
|------------|------|--------|
| `admins/{uid}` | 後台管理員清單，`{active: true}` 才視為有效 admin | 僅 Admin SDK |
| `rewards/{rewardId}` | 兌換獎品 `{name_zh, name_en, pointsCost, available, imageUrl, emoji}` | admin |
| `announcements/{annId}` | 公告 | admin |
| `broadcasts/{id}` | 廣播訊息 | admin |
| `notifications/{id}` | 通知（建立此 doc 會自動觸發推播） | admin |
| `admin_notifications/{id}` | 後台內部通知（新訂單、低庫存） | 僅 Cloud Function |
| `push_tokens/{uid}` | 客戶 FCM token，欄位 `tokens: {deviceKey: token}` | 本人 |
| `admin_tokens/{uid}` | 後台 FCM token，欄位 `devices: {deviceKey: {token, ua, updatedAt}}` | 本人 |
| `chats/{uid}` + `chats/{uid}/messages/{msgId}` | 客服聊天室 | 本人+admin |
| `config/{docId}` | 系統設定（`point_rules` / `shop_rules`） | admin 寫 |
| `settings/{docId}` | 其他系統設定 | admin 寫 |

### 4.8 Firestore 索引

已建立的複合索引（`firestore.indexes.json`）：
- `products`：3 組（status+sortWeight、category+status+sortWeight、status+stock）
- `orders`：3 組（uid+createdAt、status+createdAt × 2）
- `transactions`：3 組（type+createdAt、uid+type+createdAt × 2）

POS 若做新查詢需要新增索引，請更新 `firestore.indexes.json` 並 `firebase deploy --only firestore:indexes`。

---

## 5. Cloud Functions API

所有 callable functions 部署在 `us-central1`，前端用 Firebase SDK 呼叫：
```js
import { getFunctions, httpsCallable } from 'firebase/functions';
const fn = httpsCallable(getFunctions(app, 'us-central1'), 'confirmPoints');
await fn({ tokenId, amount });
```

POS（Node.js 後端）建議改用 **Admin SDK 直接寫 Firestore**（見 §11），不必透過 callable。

### 5.1 集點 / 兌換

#### `confirmPoints(tokenId, amount)`
**用途**：客戶端用，憑 QR token 完成集點（**注意：實際線上後台目前用 `confirmAmount` 直接寫 Firestore，沒走這支**）

| 參數 | 型別 | 必填 |
|------|------|------|
| `tokenId` | string | ✅ |
| `amount` | number > 0 | ✅ |

**回傳**：`{success, points, total}`

**權限**：需登入

**副作用**：
- 標記 `qr_tokens/{tokenId}.used = true`
- 建立 `transactions` (type=earn) + `point_batches`
- 更新會員 `points` / `totalSpent` / `tier`
- 推播給會員
- 觸發 `updateMonthlyRanks`

#### `redeemReward(rewardId)`
**用途**：兌換獎品

| 參數 | 型別 | 必填 |
|------|------|------|
| `rewardId` | string | ✅ |

**回傳**：`{success}`

**副作用**：FIFO 從 `point_batches` 扣點，建立 redeem 交易，推播

### 5.2 推薦碼

#### `getOrCreateReferralCode()`
**回傳**：`{code: "AB12CD"}`

#### `applyReferralCode(code)`
**用途**：新會員首次套用推薦碼（**僅能用一次**）

| 參數 | 型別 |
|------|------|
| `code` | string |

**回傳**：`{success: true}`

**錯誤碼**：
- `already-exists`：已用過
- `not-found`：推薦碼不存在
- `failed-precondition`：用了自己的

### 5.3 商品管理（admin only）

| Function | 參數 | 說明 |
|----------|------|------|
| `adminSaveProduct` | `{productId?, name, sku, price, stock, category, description, images, status, sortWeight}` | productId 有值=更新，無值=新增 |
| `adminDeleteProduct` | `{productId}` | 軟刪除（`status='deleted'`） |
| `adminBulkImportProducts` | `{xlsxBase64}` | 批次匯入，超時 300s / 512MiB |

### 5.4 購物 / 訂單

#### `validateCart(items)`
**用途**：結帳前驗證庫存、計算可折抵點數上限

| 參數 | 型別 |
|------|------|
| `items` | `[{productId, qty}]` |

**回傳**：
```js
{
  allOk: bool,
  results: [{productId, ok, reason?, stock?, price, name, image}],
  subtotal: number,
  pointsBalance: number,
  maxPointsDiscount: number,  // 滿 pointMinOrder 才有；上限 = subtotal × 0.3
  pointMinOrder: number,
  freeShippingThreshold: number,
}
```

#### `createOrder(items, pointsToUse, cvs, shippingFee?)`
**用途**：建立線上訂單

| 參數 | 型別 |
|------|------|
| `items` | `[{productId, qty}]` |
| `pointsToUse` | number |
| `cvs` | `{storeName, storeAddress, cvsType, name, phone}` |
| `cvsType` | `"UNIMART"`（7-11）/ `"FAMI"`（全家） |

**重要副作用**：
1. Transaction：檢查並 `stock -= qty`，`salesCount += qty`
2. 從會員 `points` 扣 → 加到 `pointsPending`（出貨後變實扣）
3. 寫入 `orders` 文件，status=`pending_shipment`
4. 寫入 `admin_notifications` + 推播給所有 admin
5. 推播給客戶

#### `adminUpdateOrderStatus(orderId, status, trackingNumber?, note?)`

| 狀態 | 副作用 |
|------|--------|
| `processing` | 推播「正在備貨」 |
| `shipped` | 推播「已出貨」（含 trackingNumber） |
| `completed` | 推播「取貨完成」 |
| `cancelled` | 庫存回補；若已使用點數則 `points += pointsUsed`；建立 `shop_refund` 交易 |

#### `adminGetOrderList(status?, limit?, startAfter?)`
分頁讀取訂單。

### 5.5 生日推播

#### `adminTriggerBirthdayGreeting()`
店家端手動觸發今日生日推播（補發用）

---

## 6. 排程與觸發器

### 排程任務（onSchedule）

| 函式 | 排程 | 用途 |
|------|------|------|
| `scheduledOrderTimeout` | every 60 minutes | 處理 `pending_payment` 且 `paymentExpireAt` 已過的訂單，回補庫存與點數 |
| `scheduledLowStockAlert` | 每日 09:00 | 列出 stock ≤ 5 的商品，寫入 `admin_notifications` |
| `scheduledPointsExpiry` | 每日 10:00 | 過期點數扣除 + 7 天前提醒（FIFO） |
| `scheduledBirthdayGreeting` | 每日 08:00 | 對當天生日會員推播 |
| `scheduledWeeklyRankPrize` | 每週五 22:00 | 前 5 名加贈點 + 推播（讀 `config/point_rules.rankPrizes`，預設 [5,4,3,2,1]） |

### Firestore 觸發器（onDocumentCreated / onDocumentWritten）

| 函式 | 觸發 | 用途 |
|------|------|------|
| `onNotificationCreated` | `notifications/{notifId}` create | 廣播或個人推播（`target='all'` or `targetUid`） |
| `onChatMessageCreated` | `chats/{chatId}/messages/{msgId}` create | 客戶訊息 → 推播所有 admin |
| `onEarnTransaction` | `transactions/{txId}` create | 若 type=earn：(1) 更新本月排名；(2) 處理推薦人回饋 |
| `onPushTokenWritten_BirthdayCheck` | `push_tokens/{uid}` write | 生日當天才開通知 → 立即補發生日推播 |

---

## 7. 認證機制

### 7.1 客戶端註冊流程

```
1. 輸入手機號 (09XXXXXXXX)
2. Firebase Phone Auth 傳 OTP
3. 輸入 OTP → signInWithPhoneNumber
4. 新用戶填姓名、生日、密碼 + 推薦碼(選)
5. linkWithCredential(EmailAuthProvider.credential(phoneToEmail(phone), pw))
6. 建立 members/{uid} 文件
```

**Email 格式轉換**：`phoneToEmail(phone)` 將手機 `09XXXXXXXX` 轉成 `09XXXXXXXX@biniblooms.com`，供之後 Email/Password 登入。

### 7.2 後台認證

- 用 Email/Password 登入
- 必須在 `admins/{uid}` 有對應文件且 `active === true`
- Cloud Functions 透過 `checkAdmin(uid)` 驗證
- ⚠️ Firestore rules 用 `disabled != true` 判斷；Cloud Functions 用 `active === true` 判斷。**邏輯不一致**：rules 預設「沒設 disabled = 通過」，functions 預設「沒設 active = 不通過」。建立 admin 文件時兩個欄位都要設清楚。

### 7.3 POS 認證選項

| 方案 | 適用 | 說明 |
|------|------|------|
| Service Account | POS 後端伺服器 | 推薦。下載 service account JSON，用 Admin SDK |
| Custom Token | POS 移動端/桌面 | 後端產 custom token，前端用 `signInWithCustomToken` |
| Email/Password | POS 是「另一個前端」 | 建立 admin 帳號讓 POS 登入 |

---

## 8. Firebase Storage 結構

Bucket：`bini-blooms.firebasestorage.app`

| 路徑 | 用途 | 寫權限 | 大小限制 |
|------|------|--------|----------|
| `/chat_images/{anyPath}` | 客服聊天圖片 | 登入即可 | 5 MB |
| `/announcements/{anyPath}` | 公告圖片 | 登入即可 | 10 MB |
| `/rewards/{anyPath}` | 獎品圖片 | 登入即可 | 10 MB |

⚠️ **`announcements` 與 `rewards` 寫權限只檢查「已登入」**，不檢查 admin（註解寫到：rules 的 `firestore.get()` 不穩定，已在前端 JS 驗證）。POS 整合時請注意：**任何登入用戶都能寫這兩個目錄**。

商品圖片目前沒有規範的 Storage 路徑（`products.images` 是任意 URL 陣列），可使用任意路徑或外部 CDN。

---

## 9. FCM 推播機制

### 推播流程

```
1. 用戶授權通知 → SW 取得 FCM token
2. 寫入 push_tokens/{uid}.tokens[deviceKey] = token
3. Cloud Function 或 admin 寫 notifications 文件
4. onNotificationCreated 或 sendPush() 呼叫 admin.messaging().send()
5. SW (firebase-messaging-sw.js) 接收並顯示通知
```

### 關鍵設計

- 推播訊息**只用 `data` 欄位**，不用 `notification`，避免 FCM 自動顯示 + SW 各顯示一次（重複推播）
- SW 的 `onBackgroundMessage` 統一負責顯示
- Token 失效碼（`messaging/registration-token-not-registered`、`messaging/invalid-registration-token`）會被 `sendPush()` 自動清除

### iOS 限制

- 必須將 PWA「加到主畫面」才能收推播（Safari 16.4+）
- iOS 非 Safari 瀏覽器（Chrome、Firefox）目前**不支援 PWA 推播**

---

## 10. QR 集點流程（POS 重點）

POS 最常見的整合場景是「店員結帳完成後，自動觸發集點」。以下是現行流程：

### 現行（透過 PWA 後台 + 客戶 PWA）

```
店員端                       客戶端                    後端
   │                            │                       │
   ├─ generateQR() ─────────────┼──────────────────────►│ 寫 qr_tokens(status=pending)
   │  顯示 QR (內含 tokenId)    │                       │
   │                            │                       │
   │                            ├─ 掃 QR ──────────────►│ 更新 qr_tokens
   │                            │  (status=scanned,     │
   │                            │   memberUid, name)    │
   │                            │                       │
   │ onSnapshot 偵測 scanned    │                       │
   │ 顯示「請輸入金額」         │                       │
   │                            │                       │
   ├─ confirmAmount(amount) ────┼──────────────────────►│ batch:
   │                            │                       │  - update member
   │                            │                       │  - add transaction(earn)
   │                            │                       │  - add point_batch
   │                            │                       │  - update qr_token
   │                            │                       │ 觸發 onEarnTransaction
   │                            │                       │  → updateMonthlyRanks
   │                            │                       │  → maybePayReferralReward
   │                            │                       │
   │ 顯示「✅ 已給予 N 點」     │                       │
```

### POS 直接整合（建議）

POS 系統可以**繞過 PWA 後台**，由 POS 主程式直接寫 Firestore。流程：

```
POS 結帳完成
   │
   ├─ Option A：產生 QR 給客人掃
   │     寫 qr_tokens(status=pending) → 等客人掃 → 一樣的後續
   │
   ├─ Option B：店員直接輸入手機號 / 掃會員 barcode
   │     查 members where phone == X → 拿到 uid
   │     直接寫 transaction + point_batch + 更新 member
   │     （需 service account 或讓 POS 登入成 admin）
   │
   └─ Option C：呼叫自定的 Cloud Function
         寫一支 confirmPointsByPhone(phone, amount)
         POS 只負責 call，所有邏輯在後端
```

**強烈建議 Option C**，理由：
1. 業務邏輯集中（生日加倍、等級判定、排行更新都在後端）
2. POS 不需要 service account（用 admin 帳號 callable 即可）
3. 後端規則改了，POS 不用跟著改

詳見 §11。

---

## 11. POS 整合方案建議

### 11.1 建議架構

```
POS 系統 (前端)
   │
   ├─ Firebase Auth：以 admin 帳號登入（Email/Password）
   │
   ├─ 結帳完成 → call confirmPointsByPhone({phone, amount})
   │             或 confirmPointsByUid({uid, amount})
   │
   └─ 商品同步：call adminBulkImportProducts({xlsxBase64})
                 或 batch write products collection
```

### 11.2 需要新增的 Cloud Function（建議）

POS 整合最缺的是「以手機號直接集點」的 endpoint，目前必須走 QR。建議新增：

```js
// functions/index.js
exports.confirmPointsByPhone = onCall({ region: "us-central1" }, async (request) => {
  if (!await checkAdmin(request.auth?.uid)) {
    throw new HttpsError("permission-denied", "需 admin 權限");
  }
  const { phone, amount } = request.data;
  if (!phone || !amount || amount <= 0) {
    throw new HttpsError("invalid-argument", "參數錯誤");
  }
  // 查會員
  const snap = await db.collection("members").where("phone", "==", phone).limit(1).get();
  if (snap.empty) throw new HttpsError("not-found", "查無此手機號會員");
  const memberDoc = snap.docs[0];
  // 後續邏輯同 admin-app.js 的 confirmAmount，但搬到後端執行
  // ... (computeTier + birthdayBonus + batch write + sendPush)
});
```

### 11.3 商品/庫存同步

如果 POS 已有自己的庫存系統，建議將 Firestore `products` 視為**前台展示鏡像**，由 POS 定期 push 更新：

```js
// POS 端（Node.js + Admin SDK）
const admin = require('firebase-admin');
admin.initializeApp({ credential: admin.credential.cert(serviceAccountJson) });
const db = admin.firestore();

async function syncProduct(posProduct) {
  // 用 SKU 當主鍵，從 Firestore 找對應 doc
  const snap = await db.collection('products').where('sku', '==', posProduct.sku).limit(1).get();
  const data = {
    name: posProduct.name,
    sku: posProduct.sku,
    price: posProduct.price,
    stock: posProduct.stock,
    category: posProduct.category,
    status: posProduct.active ? 'active' : 'deleted',
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };
  if (snap.empty) {
    data.createdAt = admin.firestore.FieldValue.serverTimestamp();
    data.salesCount = 0;
    await db.collection('products').add(data);
  } else {
    await snap.docs[0].ref.update(data);
  }
}
```

### 11.4 訂單回流（線上訂單 → POS）

線上訂單建立時會在 `admin_notifications` 寫一筆。POS 可以：

```js
// 訂閱新訂單
db.collection('orders')
  .where('status', '==', 'pending_shipment')
  .onSnapshot(snap => {
    snap.docChanges().forEach(change => {
      if (change.type === 'added') {
        const order = change.doc.data();
        // 進 POS 系統的「待出貨」列表
        importToPOS(order);
      }
    });
  });
```

### 11.5 推薦的開發環境

1. **本機開發**：用 Firebase Emulator Suite
   ```bash
   firebase emulators:start --only firestore,auth,functions
   ```
2. **測試環境**：可建立 `bini-blooms-dev` 專案（目前 client 程式碼有看到 dev 的 URL `bini-blooms-dev-client.web.app`，但 `.firebaserc` 只指 `bini-blooms`）
3. **正式環境**：`bini-blooms`

---

## 12. 已知問題與雷區

### 12.1 ⚠️ Critical：`genOrderId()` 未定義

`functions/index.js:647` 呼叫 `genOrderId()`，但全檔案沒有此函式定義。
**目前線上下單會 throw ReferenceError → 訂單建立失敗**。

修補建議：
```js
function genOrderId() {
  const d = new Date();
  const ymd = d.toISOString().slice(0,10).replace(/-/g,'');
  const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `BB${ymd}${rand}`;  // 例：BB20260602AB3C9F
}
```

### 12.2 ⚠️ `qr_tokens` 完全公開

安全規則：`allow read, write: if true`。任何人都能讀寫此 collection。
- 風險：惡意用戶可窺探所有店內掃碼活動、可建立假 token
- 緩解：tokenId 是 Firestore 隨機 ID，難以猜測；且金額由店家端輸入，假 token 騙不到點數
- POS 整合建議：QR token 流程改走 Cloud Function（需 admin），把這條規則改成 `if isAdmin()` 後就會壞 — 需要先改流程才能改規則

### 12.3 ⚠️ `point_batches` 欄位不一致

舊版用 `points - consumed`，新版用 `remaining`。POS 必須兼容：
```js
const unspent = b.remaining != null ? b.remaining : (b.points || 0) - (b.consumed || 0);
```

### 12.4 ⚠️ `BASE_UNIT` / `BASE_POINTS` / `TIER_RATES` 是動態

不要在 POS hardcode。每次計算前先讀 `config/point_rules`：
```js
const rules = (await db.collection('config').doc('point_rules').get()).data() || {};
const baseUnit = rules.baseUnit || 200;
const basePoints = rules.basePoints || 1;
const tierRates = rules.rates || { normal:1.0, vip:1.3, vvip:1.5, vvvip:2.0 };
```

### 12.5 ⚠️ Admin 認證欄位不一致

- `firestore.rules`：用 `data.disabled != true`
- `functions/index.js`：用 `data.active === true`

建立 admin doc 時兩個都要設：
```js
{ active: true, disabled: false, email: '...', name: '...' }
```

### 12.6 ⚠️ `pointsPending` 邏輯只在訂單流程

- 線上下單時：`points -= pointsUsed`，`pointsPending += pointsUsed`
- 訂單取消時：`points += pointsUsed`，但 `pointsPending` **不會減回**
- 這欄位目前未在任何地方讀取，可視為「凍結用點歷史」，POS 整合先忽略即可

### 12.7 ⚠️ FCM token 失效後自動清除有延遲

第一次推播失敗才會清除 token。POS 推播後不能立刻假設「對方一定收到」。

### 12.8 ⚠️ 排行榜的時區與計算窗口

- 月排行：`new Date(now.getFullYear(), now.getMonth(), 1)`（伺服器時區，預期 UTC）
- 週排行：明確處理為台北時區的週五 22:00
- 同月份內，會員看到的 `monthlyRank` 是「上次有人集點時計算的」，不是即時 — POS 主動觸發 `confirmPoints` 或寫 `transactions(type=earn)` 才會更新

### 12.9 推薦碼回饋條件

- 推薦人 +10 點的觸發點：**被推薦人首次有 `transactions(type=earn)` 寫入**
- 條件：`member.referralPending === true && member.referredBy 存在`
- 即使後來歡迎贈點走 type=welcome 也不算
- 每位被推薦人只算一次（不論首次集點多少）

### 12.10 Service Worker 快取版本

每次部署 Hosting 後若有更新 `index.html` / 重要 JS / banner 圖片：
- 同步更新 `sw.js` 內 `const CACHE = 'bini-vX.Y.Z-YYYYMMDD'`
- 否則舊 PWA 不會更新

---

## 13. 檔案位置索引

```
bini-v3-prod/
├── firebase.json                  # Hosting + Functions + Firestore + Storage 設定
├── .firebaserc                    # 專案別名（bini-blooms）
├── firestore.rules                # Firestore 安全規則
├── firestore.indexes.json         # 複合索引
├── storage.rules                  # Storage 安全規則
│
├── functions/
│   ├── package.json
│   └── index.js                   # 所有 Cloud Functions（1311 行）
│
├── public-client/                 # 客戶端 PWA (bini-blooms-client.web.app)
│   ├── index.html                 # 主畫面（含登入、註冊、首頁、排行榜、購物、客服）
│   ├── manifest.json              # PWA manifest
│   ├── sw.js                      # 快取 Service Worker
│   ├── firebase-messaging-sw.js   # FCM Service Worker
│   ├── js/app.js                  # 主邏輯（1730 行）
│   ├── css/app.css
│   └── icons/                     # PWA 圖示 + banner.jpg
│
└── public-admin/                  # 後台 PWA (bini-blooms-admin.web.app)
    ├── index.html                 # 主畫面（集點、公告、廣播、獎品、客服、分析、推廣、設定）
    ├── manifest.json
    ├── sw.js
    ├── firebase-messaging-sw.js
    ├── firebase-config.js         # 後台 Firebase 設定
    ├── admin-app.js               # 主邏輯（1295 行）
    ├── admin-shop.js              # 購物模組（978 行）
    └── banner.jpg
```

### 關鍵程式碼定位

| 功能 | 檔案:行 |
|------|---------|
| 等級與點數常數（admin） | `public-admin/admin-app.js:22-39` |
| 業務常數（functions） | `functions/index.js:27-39` |
| QR 產生 | `public-admin/admin-app.js:479` |
| 集點寫入（admin） | `public-admin/admin-app.js:518` (`confirmAmount`) |
| 集點 callable（functions） | `functions/index.js:249` (`confirmPoints`) |
| 兌換獎品 | `functions/index.js:309` |
| 推薦碼套用 | `functions/index.js:386` |
| 訂單建立 | `functions/index.js:626` (`createOrder`) ⚠️ 有 bug |
| 訂單狀態更新 | `functions/index.js:757` |
| 點數到期 | `functions/index.js:905` |
| 生日推播 | `functions/index.js:1036, 1056` |
| 週排行頒獎 | `functions/index.js:1125` |
| 月排行更新 | `functions/index.js:132` (`updateMonthlyRanks`) |
| 推播工具 | `functions/index.js:49` (`sendPush`), `:188` (`sendPushToAdmins`) |
| 設定鎖（admin） | `public-admin/admin-app.js:382-413` |

---

## 附錄 A：建立 POS 用 Admin 帳號（步驟）

1. **Firebase Console → Authentication → Add user**
   - Email：`pos@biniblooms.internal`（或任意）
   - Password：自設強密碼
   - 取得 UID（記下）

2. **Firestore Console → admins collection → Add document**
   - Document ID = 上述 UID
   - Fields：
     ```
     active: true (bool)
     disabled: false (bool)
     email: "pos@biniblooms.internal"
     name: "POS System"
     createdAt: (timestamp, 當下)
     ```

3. **POS 程式使用此帳號登入**
   ```js
   import { signInWithEmailAndPassword } from 'firebase/auth';
   await signInWithEmailAndPassword(auth, POS_EMAIL, POS_PASSWORD);
   ```

## 附錄 B：建立 Service Account（POS 後端）

1. Firebase Console → Project settings → Service accounts → Generate new private key
2. 下載 JSON，**勿提交到 git**
3. POS 後端：
   ```js
   const admin = require('firebase-admin');
   const serviceAccount = require('./bini-blooms-service-account.json');
   admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
   const db = admin.firestore();
   // 所有寫入都繞過 firestore.rules（admin SDK 是 superuser）
   ```

## 附錄 C：常用 Firestore 查詢範例

```js
// 1. 用手機號查會員
const snap = await db.collection('members').where('phone', '==', '0912345678').limit(1).get();

// 2. 列出某會員本月集點交易
const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
const txs = await db.collection('transactions')
  .where('uid', '==', uid).where('type', '==', 'earn')
  .where('createdAt', '>=', admin.firestore.Timestamp.fromDate(monthStart))
  .orderBy('createdAt', 'desc').get();

// 3. 列出某會員所有未過期點數批次
const batches = await db.collection('point_batches')
  .where('uid', '==', uid)
  .where('expiresAt', '>', admin.firestore.Timestamp.now())
  .orderBy('expiresAt', 'asc').get();
const totalUnspent = batches.docs.reduce((sum, b) => {
  const d = b.data();
  return sum + (d.remaining != null ? d.remaining : (d.points || 0) - (d.consumed || 0));
}, 0);

// 4. 列出待出貨訂單
const orders = await db.collection('orders')
  .where('status', '==', 'pending_shipment')
  .orderBy('createdAt', 'desc').limit(50).get();
```

---

**文件結束。如需更新請改本檔案並 commit。**
