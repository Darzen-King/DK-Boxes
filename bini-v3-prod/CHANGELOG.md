# BINI Blooms 版本記錄

## v3.0.6（2026-05-24）
### 修正（補）
- **後台公告圖片上傳失敗**：Storage rules 的 `isAdmin()` 呼叫 `firestore.get()` 在某些條件下會誤判導致 `storage/unauthorized`，改為 `request.auth != null`（JS 層已有 `verifyAdmin()` 把關）

### 修正
- **推播重複問題**：修正 iOS/Android 每次推播收到兩則的問題
  - 根本原因：FCM 訊息同時帶 `notification` + `data` 欄位，導致 FCM SDK 自動顯示一次、SW `onBackgroundMessage` 又顯示一次
  - 修法：`sendPush`、`onNotificationCreated`、`onChatMessageCreated` 三處全改為純 `data` 訊息，由 SW 統一負責顯示通知
  - `apns` 加上 `apns-priority: 10` 確保 iOS 即時送達

## v3.0.4（2026-05-23）
### 測試輔助功能（待 ECPay 申請完成後可移除）
- **客戶端**：結帳頁加入「🧪 測試模式 — 快速填入假門市」按鈕，可跳過 ECPay 地圖選門市
- **Cloud Functions**：新增 `createTestOrder`，測試訂單直接寫入 Firestore `paid` 狀態（不打 ECPay）
- 測試訂單 ID 前綴為 `TEST`，`isTest: true` 欄位標記
- 測試訂單同樣觸發 `admin_notifications`，後台可即時收到新訂單通知

### 待處理（Backlog）
- ECPay 超商取貨付款正式串接（需先取得加密金鑰 — 錯誤：找不到加密金鑰）
- 正式上線前移除或保護 `createTestOrder`

## v3.0.3（2026-05-23）
### 後台修正
- 新增商品、Excel 匯入 Modal 正常開啟（修正 display 方式）
- 商品列表表格重新設計（固定欄寬、可水平滾動、名稱欄完整顯示）
- 訂單管理 Modal 正常顯示

### 客戶端修正
- 購物車 icon 加大（28px）並加入圓形背景，hover/active 顏色變深
- 購物車 badge 加入白色邊框和陰影，更清楚醒目
- 移除 inline style 干擾，讓 CSS 正確控制購物車按鈕樣式
- 修正訂單完成頁「繼續購物」按鈕跳轉

## v3.0.2（2026-05-23）
### 修正
- 後台底部導覽列超過7個按鈕改為左右滑動
- 切換後台分頁時 icon 跑位問題修正
- 客戶端購物車 icon 加大並加入按壓深色效果
- 商品管理列表加入水平滾動

## v3.0.1（2026-05-23）
### 新增功能
- 線上購物模組完整整合
- 超商取貨付款（ECPay）
- 店家後台商品/訂單/報表管理
- 開發環境 bini-blooms-dev 建立

## v2.3.9（正式環境穩定版）
- 會員集點、QR Code、兌換獎品
- 公告、廣播、客服訊息、推播通知

### v3.0.3 額外修正（2026-05-23 下午）
- 修正 shop.js 兩處引號衝突語法錯誤（購物車空白頁、我的訂單頁）
- 客戶端購物頁面正式恢復正常顯示

## v3.0.7（2026-05-24）
### 修正
- **廣播/公告推播點擊後跳到首頁而非公告頁**：
  - 後台廣播/公告的推播 `url` 改為 `/#announce`
  - 客戶端 `showApp()` 加入 hash 偵測，登入後自動切換到對應頁面
  - SW `notificationclick` 改用 `postMessage` 通知已開啟的 PWA 切換頁面（不需重新載入）
- **公告圖片 storage/unauthorized**（Storage rules 尚未 deploy，需執行 `firebase deploy --only storage`）

## v3.0.8（2026-05-24）
### 修正
- **下單後停留在結帳頁（未跳到成功頁）**：`placeOrder()` 中 `cvs.storeName` 應為 `cvsData.storeName`，變數名稱錯誤導致 `renderOrderResult` 拋錯
- **`t is not defined`**：catch 裡的 `t()` 呼叫改為安全 fallback `(typeof t === "function") ? t(...) : "確認下單"`
- **`createOrder` 加外層 try-catch**：捕捉 ECPay 回應解析時的未預期錯誤，改為回傳具體錯誤訊息而非 500
- **ECPay 診斷 log 強化**：送出 Request 前記錄關鍵參數，方便追蹤 logistics_failed 原因

## v3.0.9（2026-05-24）
### 重大變更
- **移除 ECPay 物流整合**：改為店主自行到便利商店寄貨（貨到付款）模式
  - `createOrder` 拿掉 ECPay API 呼叫，直接寫入 Firestore `pending_shipment` 狀態
  - 移除 `getLogisticsMapForm`、`cvsReply`、`logisticsCallback`、`ecpayCallback`、`createTestOrder` 五個 function
  - 客戶端門市選擇改為直接開官方地圖（7-11: emap.pcsc.com.tw / 全家: mfme.map.com.tw）
  - 移除測試模式按鈕（`fillTestStore`）
  - 移除萊爾富（HILIFE）和 OK 超商選項，僅保留 7-11 和全家
  - 訂單成功頁移除物流單號欄位和測試標籤
  - 手機號碼格式驗證（`^09\d{8}$`）保留

## v3.0.10（2026-05-24）
### 新增
- **新訂單店家端推播**：客戶完成下單後，自動推播通知店家（`🛍️ 新訂單！｜金額｜門市｜取件人`）
- **抽出 `sendPushToAdmins()` 共用函數**：`onChatMessageCreated` 同步改用，減少重複程式碼

## v3.0.11（2026-05-24）
### 修正
- **門市選擇無法確認**：7-11/全家官方地圖均為 ECPay 物流合作專用，無法直接嵌入回傳
- **改為手動輸入門市**：點「選擇門市」→ 開啟官方查詢頁供參考 → 手動填入門市名稱和地址 → 按「確認門市」
- `createOrder` 的門市驗證從 `storeId` 改為 `storeName` 必填（storeId 非必填）

## v3.0.12（2026-05-24）
### 改善
- **門市選擇改為店號查詢**：客戶輸入店號（發票上的 6 碼）→ 自動查詢驗證 → 顯示門市名稱和地址確認
  - 新增 `lookupStore` Cloud Function：server side 呼叫 7-11 EMapSDK 和全家 API，避免 CORS
  - 7-11 查詢：`emap.pcsc.com.tw/EMapSDK.aspx`
  - 全家查詢：`api.map.com.tw/net/familyShop.aspx`
  - 查到後顯示確認卡片，避免輸入錯誤

## v3.0.13（2026-05-24）
### 修正
- **lookupStore 查詢回傳 404**：function 未部署，v3.0.12 只部署了 hosting
- **加強 API 相容性**：7-11 加上 User-Agent header；全家改用 ajax_familyShop_new.aspx；response 加 log 方便除錯

## v3.0.14（2026-05-24）
### 修正
- **lookupStore API 格式修正**
  - 7-11：加上正確的 headers（Origin, X-Requested-With），修正 `Invalid request` 問題
  - 全家：改用 `mfme.map.com.tw/api/store/{id}`，原 family.com.tw API 回傳 Busy HTML
  - 加強 XML/JSON 解析相容性，同時支援大小寫 tag
  - 加強 error log 方便後續診斷

## v3.0.15（2026-05-24）
### 修正
- **7-11 選擇按鈕無反應**：改回官方地圖選取，定義 MapCallback/StoreCallback/postMessage 三層 callback 攔截
- **全家查詢失敗**：加備用 endpoint 和 HTML scraping 解析，應對 API 回傳 Busy/404 頁面

## v3.0.16（2026-05-24）
### 重大變更
- **移除門市 API 查詢**：7-11 EMapSDK 和全家 API 均需要 session/cookie，從 Cloud Function 無法穩定呼叫
- **改為直接輸入門市名稱**：客戶輸入門市名稱後按確認，店家收到訂單後自行核對
- 移除 `lookupStore` Cloud Function
- 移除 `verifyStoreId`、`confirmVerifiedStore` 前端函數

## v3.0.17（2026-05-24）
### 修改
- **門市選擇改回輸入店號**：客戶直接輸入發票上的數字店號（4-7碼），不需輸入中文店名
- 店號格式驗證（純數字 4-7 碼），訂單存入格式：`全家 #024249` / `7-11 #243351`

## v3.0.18（2026-05-24）
### 修正
- **下單失敗：now is not defined**：移除 createOrder 裡 ECPay 移除時遺留的 `logisticsTradeNo`、`tradeDate`、`now` 殘留程式碼

## v3.0.19（2026-05-24）
### 修正與新增
- **後台訂單更新區塊消失**：狀態判斷加入 `pending_shipment`，新訂單現在可以看到「更新狀態」區塊
- **欄位名稱**：「物流單號」改為「貨運單號」，並加入出貨時的填寫提示
- **出貨推播帶貨運單號**：`shipped` 狀態推播訊息自動帶入貨運單號
- **客戶端狀態標籤**：加入 `pending_shipment`（待出貨）和 `logistics_failed` 標籤，支援雙語

## v3.0.20（2026-05-24）
### 新增
- **購物頁加入「我的訂單」入口**：top bar 右上角加入訂單圖示按鈕
- **訂單詳情頁強化**：
  - 已出貨狀態顯示綠色橫幅 + 貨運單號突出顯示
  - 待出貨狀態顯示黃色說明橫幅
  - 加入出貨時間、完成時間欄位
  - 加入「返回訂單列表」按鈕
- **前景推播自動刷新**：收到訂單狀態推播時，若訂單列表頁開著自動重新載入

## v3.0.21（2026-05-24）
### 新增
- **運費計算**：7-11 NT$65、全家 NT$75，超商切換時自動更新金額
- 結帳摘要加入運費列，應付金額 = 商品小計 + 運費 - 點數折抵
- functions createOrder 後端驗證運費（依 cvsType 決定），防止前端竄改
- 訂單成功頁、訂單詳情頁均顯示運費欄位
- 通知和推播金額改為含運費的總金額

## v3.0.22（2026-05-24）
### 新增
- **後台可設定點數折抵門檻**：設定頁「購物規則」→ 點數折抵最低消費門檻，儲存至 Firestore `config/shop_rules`
- **後台可設定免運費門檻**：滿額免運，設為 0 表示不提供免運費
- 結帳頁動態顯示：達免運費門檻時顯示「🎉 已達免運費！」，未達時顯示距離免運還差多少
- functions `validateCart` / `createOrder` 改從 Firestore 讀取規則（fallback 到預設值）
- 後台設定頁開啟時自動載入目前設定值

## v3.0.23（2026-05-24）
### 修正
- **購物規則設定儲存失敗**：Firestore rules 缺少 `config` 集合的規則，補上 admin 可讀寫、登入用戶唯讀

## v3.0.24（2026-05-24）
### 修正
- **結帳失敗：cvsType is not defined**：renderCheckoutForm 函數內加入 cvsType 初始宣告
- **我的訂單返回到「我的」頁面**：改為返回「購物」頁
- **訂單圖示大小**：與購物車圖示統一為 28px

## v3.0.25（2026-05-24）
### 修改
- **訂單推播訊息全面中英雙語**（因 90% 客戶為菲律賓籍）
- 下單成功文案改為：「店家已收到您的訂單，謝謝您選擇 BINI Blooms。」
- 已出貨文案改為：「請收到簡訊通知後到取貨超商領取。」（移除舊的模糊描述）
- 備貨中、已完成、已取消、逾期訂單均補上英文版本

## v3.0.26（2026-05-24）
### 修改
- 英文推播文案修正：
  - 備貨中：The order is being prepared...
  - 已出貨：The order is shipped!!
  - 已完成：...by Bini Blooms
  - 取消：The order has been cancelled, the points have been refunded.
  - 逾期：The order automatically cancelled due to non-pickup.

## v3.0.27（2026-05-24）
### 修改
- 全面修正推播文案為專業版本（中英雙語）

## v3.0.28（2026-05-24）
### 修正與改善
- **購物頁語言切換誤觸訂單按鈕**：在購物頁 top bar 加入專屬語言切換按鈕，不再共用下層元素
- **訂單圖示改為圓圈樣式**：與購物車圖示統一使用 cart-btn-wrap（圓圈 + tap 動畫）
- **購物頁標題設計感**：改為斜體、加寬字距、靠左對齊，視覺更有品牌感

## v3.0.29（2026-05-24）— 正式版前最終清理
### 修正
- **購物頁標題顯示 Support**：移除藝術字和語言切換按鈕，恢復標準 top bar 樣式
- **top bar 標題置中**：購物頁標題改為置中，與其他頁面一致

### 清理
- 移除 functions 中所有 ECPay 殘留（ECPAY 常數、getLogisticsConfig、getSenderInfo、ecpayCheckMacValue）
- 移除 admin-shop.js 的 isTest 標籤殘留
- 移除 app.js 中不再使用的 shop-lbtn 語言按鈕邏輯

### 新增
- 後台設定頁加入「清除測試資料」工具：可一鍵清除公告、廣播、客服訊息、測試商品
