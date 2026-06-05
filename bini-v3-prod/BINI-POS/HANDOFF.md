# BINI POS — 接手交接說明（HANDOFF）

> 目的：讓**新 Claude Code session**（綁定到 `Darzen-King/BINI-BLOOMS` 後）能無縫接續開發。
> 最後更新：2026-06-05

---

## 0. 一句話現況

BINI POS 已完成**第 0 階段「地基 + 登入系統」**並通過驗證，程式碼在 `bini-v3-prod/BINI-POS/`。
下一步依總整合藍圖第 8 節往「地基 1/2/3 的 Cloud Functions」與「D 庫存模組」推進。

---

## 1. 專案背景與目標

- 為 BINI Blooms（零售）打造**網頁版 POS**，搭配既有手機會員 App（`public-client`）與後台（`public-admin`），共用同一 Firebase 後端。
- **測試策略**：整套（手機版 + POS）先在 **`bini-blooms-dev`** 做封閉測試（Close Test），**不影響正式專案 `bini-blooms`**；全部測完再做專案轉移。
- **權威規格文件**（在 repo 根 `bini-v3-prod/`）：
  - `BINIPOS_____.md` — 總整合藍圖（**唯一實作主文件**，遇差異以它為準）
  - `BINIPOS__________.md` — 跨模組一致性檢查報告（7 衝突統一方案）
  - `POS_INTEGRATION.md` — 手機端對接技術規格（資料模型、Cloud Functions、雷區）
  - `BINI-POS/README.md` — POS 前端說明（設定/部署/權限/路線圖）

---

## 2. Repo / 分支 / 搬遷狀態

- 開發 repo：`Darzen-King/DK-Boxes`，分支 `claude/bini-pos-system-design-orPZk`
- PR：`Darzen-King/DK-Boxes#2`（含手機版同步 + POS 地基）
- **搬遷計畫**：要把整個專案搬到 `Darzen-King/BINI-BLOOMS`（同帳號、Private、清乾淨重來）
  - 搬遷指令（在本機執行）：
    ```bash
    git clone https://github.com/Darzen-King/DK-Boxes.git
    cd DK-Boxes
    git checkout claude/bini-pos-system-design-orPZk
    git remote add bini https://github.com/Darzen-King/BINI-BLOOMS.git
    git push bini claude/bini-pos-system-design-orPZk:main --force
    ```
  - Claude GitHub App 已設定為 All repositories（需確認已 Save + 核准 Review request）。
  - ⚠️ session 的 repo 範圍在建立當下鎖定；要在 BINI-BLOOMS 開發須**新開 session 指定該 repo**。

---

## 3. 已完成（第 0 階段：地基 + 登入系統）

### 3.1 同步手機版至最新（commit `da34228`）
repo 內的 `bini-v3-prod` 原本比附檔舊，已更新為最新版（附檔 v3.0.6）：
`functions/index.js`、client `app.js`、`admin-app.js`、`admin-shop.js`，並新增 `POS_INTEGRATION.md` 與最新圖片。

### 3.2 BINI POS 前端（commit `a99eb5c`，資料夾改名 commit `5dbf66f`）
新增 `bini-v3-prod/BINI-POS/`（純原生 JS PWA，無框架，沿用 client/admin 風格）：

| 檔案 | 職責 |
|------|------|
| `index.html` | 三段式 SPA：登入 → (首次強制改密碼) → 主畫面 |
| `js/firebase-config.js` | **bini-blooms-dev 佔位設定（待填）**；偵測佔位值切換離線/線上模式 |
| `js/i18n.js` | 雙語系（繁中/English），登入畫面與全 App 可切換、記憶於 localStorage |
| `js/permissions.js` | 6 項權限框架 + 模組進入規則 `MODULE_ACCESS` |
| `js/store.js` | 資料存取層：Firestore（`pos_users`/`pos_roles`）↔ localStorage 自動切換 |
| `js/auth.js` | 登入/登出/改密碼/帳號管理；SHA-256+salt 雜湊；種子 admin/admin |
| `js/app.js` | UI 流程編排（登入、改密碼、模組導覽、帳號管理頁） |
| `css/pos.css` | 樣式（品牌粉紅 #e6447a） |
| `manifest.json` / `sw.js` | PWA |

**已實作功能**
- ✅ 雙語登入畫面（中/EN 切換、記憶）
- ✅ 預設帳號 `admin/admin`，首次登入**強制改密碼且不可取消**
- ✅ 密碼 SHA-256 + 隨機 salt 雜湊（不存明碼）
- ✅ 6 項權限：`inventory / cost / member_manage / settings / reports / order_discount`，超管全權
- ✅ 模組進入規則（如：分析報表需 `reports`+`cost`；帳號權限僅超管）
- ✅ 帳號權限管理頁（超管）：新增/編輯/重設密碼/停用、勾選權限；防呆（不可停用自己/最後一位超管）
- ✅ 主畫面殼 + A~H 模組導覽（依權限顯示，未開發者顯示「開發中」佔位）
- ✅ 離線測試模式：未填 dev 設定時走 localStorage，可立即測登入流程

**驗證狀態**：6 個 JS 檔 `node --check` 通過；JSON 有效；權限解析+模組進入 8 項斷言通過；WebCrypto 雜湊測試通過。⚠️ 環境無瀏覽器，未做真實 UI 端對端點擊測試。

---

## 4. 待辦：填入 bini-blooms-dev 設定

`BINI-POS/js/firebase-config.js` 目前是佔位值（`REPLACE_WITH_*`）。
取得 `bini-blooms-dev` 的 Web App 設定後替換六欄，POS 會自動從 localStorage 切到 Firestore。
dev 專案需啟用：**Authentication → 匿名登入**、**Firestore**，並對 `pos_users`/`pos_roles` 設測試規則（見 `README.md` §5）。

---

## 5. 資料模型（POS 新增；既有見 POS_INTEGRATION.md §4）

```
pos_users/{username}
  username, displayName, passwordHash, salt
  isSuperAdmin, roleId|null
  customPermissions{ inventory,cost,member_manage,settings,reports,order_discount }
  active, mustChangePassword, createdAt, updatedAt

pos_roles/{roleId}          （預留，本階段以 customPermissions 為主）
  name, permissions{ …6項… }
```
> 藍圖另定義了大量 collection（pos_transactions、pos_refunds、categories、inventory_logs、
> point_batches.remaining、held_orders、cash_sessions 等），於後續階段實作，見藍圖 §3。

---

## 6. 三大地基（最關鍵，務必先做，藍圖 §2）

1. **costSnapshot**：結帳/下單當下凍結 `avgCost` 進交易品項，獲利用它算（不用現在的 avgCost）。
2. **realProfit（折扣攤回）**：`allocatedDiscount = 折扣 × (品項小計/商品小計)`；
   `netRevenue = subtotal − allocatedDiscount`；`realProfit = netRevenue − costSnapshot×qty`。報表一律用 realProfit。
3. **point_batches.remaining**：新增欄位（= points − consumed），所有建立/消耗批次處同步維護；
   既有資料需 migration 補 remaining。`members.points` 必須恆等於 Σ(remaining)。

---

## 7. 下一步實作順序（藍圖第 8 節）

- [x] **第 0 階段 地基**：權限框架、雙語登入、admin/admin+改密碼、帳號管理、模組殼 ← **已完成**
- [ ] 第 0 階段（後端）：`point_batches.remaining` + migration、products 擴充欄位、交易品項欄位定案
- [ ] 第 1 階段 修現有 bug + 核心 Function：
  - `adminUpdateOrderStatus`（退點 bug、returned 回庫、pointsPending 結清）
  - `createOrder`（onlineStock 分流、costSnapshot、realProfit、remaining）
  - `confirmPoints`（tierLocked、remaining）
  - `posConfirmPoints`（結帳主邏輯，地基 1+2+3 全用）
- [ ] 第 2 階段 **D 庫存**：categories+SKU 自動產生、商品 CRUD（等級價/多條碼/標籤）、進貨/出貨/盤點、Excel 匯入匯出
- [ ] 第 3 階段 **A 銷售**：搜尋/購物車/掃碼/折扣/付款/結帳/收據/掛單/取消/退貨 + 交班/離線/快捷鍵
- [ ] 第 4 階段 **B 會員 / C 網購訂單**
- [ ] 第 5 階段 **E 今日銷售 / F 分析報表** + daily_summary
- [ ] 第 6 階段 **G 客戶端配合 / H 後台相容**
- [ ] 第 7 階段 整合測試（帳務一致性、成本獲利準確性、權限邊界、離線/併發）

---

## 8. 開發鐵則（藍圖 §9）

- **帳務一致性最高優先**：所有點數操作用 Firestore transaction；`members.points == Σ(batches.remaining)`。
- **既有相容**：改既有 Function 前先讀現有邏輯；編輯既有 doc 用 `merge:true`；client/admin 兩端都測。
- **權限雙重驗證**：前端隱藏 UI + 後端每個受控 Function 開頭 `checkPermission`。
- **時區**：一律 Asia/Taipei；營業日午夜換日；生日比對月+日。
- **Firestore 限制**：不可兩欄位互比（用 remaining 解）；array-contains 查 barcodes 需建 index。

---

## 9. 新 session 接手檢查清單

1. 確認 session 綁定 `Darzen-King/BINI-BLOOMS`（且 Claude GitHub App 已授權該 repo）。
2. 讀本檔 + 藍圖三文件（`BINIPOS_____.md`、`BINIPOS__________.md`、`POS_INTEGRATION.md`）。
3. 確認 `bini-blooms-dev` 設定是否已填入 `firebase-config.js`。
4. 從「第 0 階段（後端）」或使用者指定的模組開始，地基先行。
5. 沿用既有 commit 訊息風格（繁中、清楚描述），開發在指定分支，完成才 push。
