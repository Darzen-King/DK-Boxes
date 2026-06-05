# BINI-BLOOMS

BINI Blooms 的應用程式集合（同屬性 App 放在一起）。本 repo 包含兩個子專案：

| 資料夾 | 專案 | 說明 |
|--------|------|------|
| [`bini-v3-prod/`](bini-v3-prod/) | **手機會員 App** | 客戶端 PWA（`public-client`）、後台 PWA（`public-admin`）、Cloud Functions（`functions`）。集點、兌換、購物、客服、推播等。 |
| [`bini-pos/`](bini-pos/) | **門市銷售系統 POS** | 網頁版 POS（純原生 JS PWA）。雙語登入、權限、收銀、庫存、會員、報表等。詳見 [`bini-pos/README.md`](bini-pos/README.md)。 |

兩者**各自獨立**部署，但**共用同一個 Firebase 後端**：
- 測試環境：`bini-blooms-dev`（封閉測試 Close Test）
- 正式環境：`bini-blooms`

## 規劃文件（POS）

- `bini-v3-prod/BINIPOS_____.md` — 總整合藍圖（POS 唯一實作主文件）
- `bini-v3-prod/BINIPOS__________.md` — 跨模組一致性檢查報告
- `bini-v3-prod/POS_INTEGRATION.md` — 手機端對接技術規格
- `bini-pos/HANDOFF.md` — POS 接手交接說明（目前進度與路線圖）

## ⚠️ Firestore 規則只有一份（共用專案）

`bini-pos` 與 `bini-v3-prod` 共用同一個 Firebase 專案，Firestore 規則是**整個專案唯一一份**。
規則的單一真實來源為 `bini-v3-prod/firestore.rules`；`bini-pos` 只部署 hosting，不部署 firestore 規則，
以免互相覆蓋。POS 用到的 `pos_users` / `pos_roles` 規則請併入 `bini-v3-prod/firestore.rules`。
