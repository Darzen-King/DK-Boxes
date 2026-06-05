# bini-pos — BINI Blooms 門市銷售系統

BINI Blooms 的網頁版 POS（純原生 JS PWA，無框架）。本專案為**獨立的 standalone 專案**，
與手機會員 App（`bini-membership`）各自獨立、但**共用同一個 Firebase 後端**
（測試期 `bini-blooms-dev`，正式 `bini-blooms`）。

> 本階段交付：**地基 ＋ 登入系統**
> （雙語登入、6 項權限框架、`admin/admin` 預設帳號＋首次強制改密碼、帳號權限管理、模組殼）
> A~H 八大模組依總整合藍圖「第 8 節實作順序」於後續版本逐步補上。
>
> 規劃文件（藍圖／一致性報告／手機端對接規格）目前位於 `bini-membership`（原 DK-Boxes）的
> `bini-v3-prod/` 內：`BINIPOS_____.md`、`BINIPOS__________.md`、`POS_INTEGRATION.md`。

---

## 1. 目錄結構

```
bini-pos/
├── .firebaserc             Firebase 專案別名（dev=bini-blooms-dev / prod=bini-blooms）
├── firebase.json           Hosting 設定（★只含 hosting，不含 firestore，見 §6 說明）
├── .gitignore
├── README.md
├── HANDOFF.md              接手交接說明
└── public/                 ← Firebase Hosting 對外目錄
    ├── index.html          登入 / 改密碼 / 主畫面 三段式 SPA
    ├── manifest.json       PWA manifest
    ├── sw.js               Service Worker（網路優先快取殼）
    ├── css/pos.css         樣式（品牌粉紅 #e6447a）
    ├── icons/              PWA 圖示
    └── js/
        ├── firebase-config.js  ⚠️ bini-blooms-dev 設定（目前為佔位，需填入）
        ├── i18n.js             雙語系（繁中 / English）
        ├── permissions.js      6 項權限框架 + 模組進入規則
        ├── store.js            資料存取層（Firestore ↔ localStorage 自動切換）
        ├── auth.js             登入 / 改密碼 / 帳號管理（SHA-256 + salt）
        └── app.js              UI 流程編排
```

---

## 2. 登入系統規格

| 項目 | 說明 |
|------|------|
| **雙語** | 登入畫面右上角可切換「中文 / EN」，選擇記在 `localStorage`，全 App 共用 |
| **預設帳號** | `admin` / `admin`（首次啟動自動建立，超級管理員） |
| **首次強制改密碼** | `admin` 首次登入會被導到「變更密碼」且不可取消 |
| **密碼儲存** | SHA-256 + 每帳號隨機 salt，**不存明碼**（`auth.js`） |
| **權限** | 由軟體內部設定（見下方 6 項），超級管理員永遠全權 |
| **Session** | 存於 `sessionStorage`，重新整理保留登入（測試方便），登出即清除 |

### 6 項權限（對應總整合藍圖 §4）

| 權限 | 涵蓋 |
|------|------|
| `inventory` | 庫存操作（改數量、進貨、出貨、盤點、上下架、分類管理） |
| `cost` | 成本查看（成本價、獲利、毛利、進價）★與 inventory 分離 |
| `member_manage` | 會員管理（編輯、刪除、點數調整、改等級） |
| `settings` | 系統設定（集點規則、購物規則、快捷鍵） |
| `reports` | 報表查看（今日銷售、分析報表進入） |
| `order_discount` | 整單折扣 |

### 模組進入規則（`permissions.js` → `MODULE_ACCESS`）

| 模組 | 進入條件 |
|------|----------|
| 銷售收銀 / 網購訂單 | 登入即可 |
| 會員管理 | `member_manage` |
| 庫存操作 | `inventory` |
| 今日銷售 | `reports`（獲利數字另需 `cost`） |
| 分析報表 | `reports` + `cost`（整頁鎖） |
| 系統設定 | `settings` |
| 帳號權限 | 僅超級管理員 |

> ⚠️ 前端依權限隱藏/禁用 UI 只是「體驗層」。待後端 Cloud Functions 上線後，
> 每個受控動作仍須在後端 `checkPermission`（雙重驗證，防繞過）。

---

## 3. 資料模型（Firestore）

POS 帳號與角色存於 dev 專案的兩個 collection：

```
pos_users/{username}
  username, displayName, passwordHash, salt
  isSuperAdmin: bool
  roleId: string|null
  customPermissions: { inventory, cost, member_manage, settings, reports, order_discount }
  active: bool
  mustChangePassword: bool
  createdAt, updatedAt

pos_roles/{roleId}            （預留；本階段以 customPermissions 為主）
  name, permissions{ …6項… }
```

---

## 4. 兩種執行模式（自動切換）

`store.js` 會依 `firebase-config.js` 是否仍為佔位設定，自動選擇後端：

| 模式 | 觸發條件 | 行為 |
|------|----------|------|
| **離線測試模式** | `firebase-config.js` 仍是佔位值 | 帳號資料存 `localStorage`，**不連 Firebase**。可立即測試登入/權限/改密碼，畫面頂端會顯示黃色提示條 |
| **線上模式** | 已填入 `bini-blooms-dev` 真實設定 | 帳號資料走 Firestore（`pos_users`/`pos_roles`），以匿名登入取得讀寫權 |

> 這讓你在拿到 dev 設定前就能先把登入流程跑起來，拿到設定後填入即可無痛切到 Firestore。

---

## 5. 設定 bini-blooms-dev（封閉測試）

整套系統（手機版 + POS）先在 **bini-blooms-dev** 做 Close Test，**不影響正式專案 bini-blooms**。

### 5.1 填入 dev Web 設定

1. Firebase Console → 專案 `bini-blooms-dev` → 專案設定 ⚙️ → 一般 → 你的應用程式 → Web App → SDK 設定與配置 → **Config**
2. 把六個欄位填進 `public/js/firebase-config.js` 的 `firebaseConfig`（取代 `REPLACE_WITH_*`）
3. （`bini-membership` 手機版若也要在 dev 測試，於該專案各自替換其 `firebase-config.js`）

### 5.2 啟用所需服務（dev 專案）

- **Authentication → 登入方式 → 匿名**：啟用（POS 以匿名身分讀寫 `pos_users`）
- **Firestore**：建立資料庫（測試期可用測試規則）

### 5.3 dev Firestore 規則（封閉測試用，建議）

為避免改動正式共用的 `firestore.rules`，**dev 測試期**可在 dev 專案直接套用以下規則
（或先用 Console 的「測試模式」）：

```
match /pos_users/{username} {
  allow read, write: if request.auth != null;   // 封閉測試：已（匿名）登入即可
}
match /pos_roles/{roleId} {
  allow read, write: if request.auth != null;
}
```

> 正式轉移到 bini-blooms 時，再收斂成「僅超級管理員可寫」的嚴格規則。

---

## 6. 本機預覽 / 部署

### 本機預覽
```bash
# 任一靜態伺服器即可（需 http，因使用 ES module / SW）
cd bini-pos/public
python -m http.server 5500       # Windows 用 python；macOS/Linux 用 python3
# 開 http://localhost:5500
```
首次開啟即可用 `admin` / `admin` 登入（離線模式也可）。

### 部署到 dev
```bash
cd bini-pos
firebase use dev                      # 切到 bini-blooms-dev（.firebaserc 已設別名）
firebase deploy --only hosting        # 部署 POS 站台（pos target）
```
> 需先在 dev 專案建立 Hosting site `bini-blooms-dev-pos`（對應 `.firebaserc` 的 target）：
> `firebase hosting:sites:create bini-blooms-dev-pos`

### ⚠️ 重要：本專案只部署 Hosting，不要部署 Firestore 規則
`firebase.json` **刻意不含 `firestore` 區塊**。原因：POS 與 `bini-membership` 共用同一個
Firebase 專案，而 Firestore 規則是**整個專案唯一一份**——若兩個 repo 各自帶 `firestore.rules`
互相部署會**覆蓋**對方的規則。

因此：
- **POS 站台部署**：`bini-pos` 只負責 `firebase deploy --only hosting`。
- **`pos_users` / `pos_roles` 的 Firestore 規則**：請加進**擁有該專案規則的那個 repo**
  （即 `bini-membership` 的 `firestore.rules`），或於封閉測試期直接用 Console 測試模式 / §5.3 規則。

---

## 7. 後續路線圖（依總整合藍圖第 8 節）

- [x] **地基**：權限框架（6 項）、雙語登入、`admin/admin`＋首次改密碼、帳號權限管理、模組殼
- [ ] 地基 1/2/3：`point_batches.remaining`、`costSnapshot`、`realProfit`（Cloud Functions）
- [ ] 修現有 bug：`adminUpdateOrderStatus` 退點、`createOrder` onlineStock、`confirmPoints` tierLocked
- [ ] D 庫存：分類 / SKU / 商品 CRUD / 進貨盤點
- [ ] A 銷售：搜尋 / 購物車 / 掃碼 / 折扣 / 付款 / 結帳 / 退貨 / 掛單 / 交班 / 離線
- [ ] B 會員、C 網購訂單
- [ ] E 今日銷售、F 分析報表
- [ ] G 客戶端配合、H 後台相容

詳見 `bini-membership`（原 DK-Boxes）`bini-v3-prod/` 內三份規劃文件與 `POS_INTEGRATION.md`。
