import { db, auth } from './firebase-config.js';
import {
  collection, query, where, orderBy, limit,
  getDocs, getDoc, doc, addDoc, updateDoc, deleteDoc,
  onSnapshot, writeBatch, serverTimestamp, increment, Timestamp
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { getFunctions, httpsCallable } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js';

const _adminFunctions = getFunctions(undefined, 'us-central1');

// ─────────────────────────────────────────────
// i18n helper（讀取 admin-app 的語言設定）
// ─────────────────────────────────────────────
function sl() { return localStorage.getItem('shop_lang') || 'zh'; }
function st(zh, en) { return sl() === 'zh' ? zh : en; }

/**
 * BINI Blooms — 店家後台購物管理模組
 * admin-shop.js  v3.0.0
 * 功能：商品管理（CRUD + Excel 匯入）、訂單管理（列表/詳情/狀態更新/出貨）、銷售報表、庫存警示
 */

// ─────────────────────────────────────────────
// 共用呼叫器
// ─────────────────────────────────────────────
const AdminShopAPI = {
  async call(fnName, data = {}) {
    const fn = httpsCallable(_adminFunctions, fnName);
    const result = await fn(data);
    return result.data;
  },
};

// ─────────────────────────────────────────────
// 通知徽章（新訂單即時監聽）
// ─────────────────────────────────────────────
const AdminShopNotify = {
  unsubscribe: null,
  start() {
    this.unsubscribe = onSnapshot(
      query(collection(db, "admin_notifications"), where("read", "==", false)),
      snap => {
        const count = snap.size;
        const badges = document.querySelectorAll(".shop-admin-badge");
        badges.forEach(b => {
          b.textContent = count;
          b.style.display = count > 0 ? "inline-flex" : "none";
        });
      });
  },
  stop() { this.unsubscribe?.(); },
  async markRead() {
    const snap = await getDocs(query(collection(db, "admin_notifications"), where("read", "==", false)));
    const batch = writeBatch(db);
    snap.docs.forEach(d => batch.update(d.ref, { read: true }));
    await batch.commit();
  },
};

// ─────────────────────────────────────────────
// 商品管理
// ─────────────────────────────────────────────
const AdminProducts = {
  currentPage: 1,
  lastDoc: null,
  editingId: null,

  // ── 商品列表 ──────────────────────────────
  async renderList() {
    const container = document.getElementById("admin-product-list");
    if (!container) return;
    container.innerHTML = `<div class="admin-loading">${st('載入中…','Loading…')}</div>`;

    const snap = await getDocs(query(
      collection(db, "products"),
      where("status", "!=", "deleted"),
      orderBy("status"), orderBy("sortWeight", "desc"),
      limit(50)
    ));

    if (snap.empty) {
      container.innerHTML = `<p class="admin-empty">${st('尚無商品，請新增或匯入商品','No products yet. Please add or import.')}</p>`; return;
    }

    container.innerHTML = `
<div style="overflow-x:auto;-webkit-overflow-scrolling:touch">
<table class="admin-table" style="min-width:500px;table-layout:fixed;width:100%">
  <thead>
    <tr>
      <th style="width:40px">${st("圖","Img")}</th>
      <th style="min-width:90px">${st("商品名稱","Product")}</th>
      <th style="min-width:80px">SKU</th>
      <th style="width:58px">${st("售價","Price")}</th>
      <th style="width:44px">${st("庫存","Stock")}</th>
      <th style="width:44px">${st("銷售","Sales")}</th>
      <th style="width:60px">${st("狀態","Status")}</th>
      <th style="width:72px">${st("操作","Actions")}</th>
    </tr>
  </thead>
  <tbody>
    ${snap.docs.map(doc => {
      const p = { id: doc.id, ...doc.data() };
      const statusLabel = sl()==="zh" ? ({ active:"上架中", inactive:"已下架", soldout:"售完" }[p.status] || p.status) : ({ active:"Active", inactive:"Inactive", soldout:"Sold Out" }[p.status] || p.status);
      const statusCls   = { active:"tag-green", inactive:"tag-gray", soldout:"tag-warn" }[p.status] || "";
      return `
    <tr>
      <td><img src="${p.images?.[0] || ""}" class="admin-product-thumb" onerror="this.style.display='none'"></td>
      <td class="product-name-cell" style="word-break:break-word;font-size:12px;max-width:90px">${p.name}</td>
      <td style="font-size:11px;color:#999;word-break:break-all;max-width:80px">${p.sku || "—"}</td>
      <td style="font-size:12px">NT$ ${p.price?.toLocaleString()}</td>
      <td class="${p.stock <= 5 && p.status==="active" ? "low-stock-cell" : ""}">${p.stock}</td>
      <td>${p.salesCount || 0}</td>
      <td><span class="admin-tag ${statusCls}">${statusLabel}</span></td>
      <td class="action-cell">
        <button class="btn-sm" onclick="AdminProducts.openEdit('${p.id}')">${st('編輯','Edit')}</button>
        <button class="btn-sm btn-danger" onclick="AdminProducts.confirmDelete('${p.id}','${p.name.replace(/'/g,"\\'")}')">  ${st('下架','Remove')}</button>
      </td>
    </tr>`;
    }).join("")}
  </tbody>
</table></div>`;
  },

  // ── 新增/編輯商品 Modal ──────────────────
  openAdd() {
    this.editingId = null;
    this._fillModal({});
    showAdminModal("modal-product");
  },

  async openEdit(productId) {
    this.editingId = productId;
    const snap = await getDoc(doc(db, "products", productId));
    this._fillModal({ id: productId, ...snap.data() });
    showAdminModal("modal-product");
  },

  _fillModal(p) {
    document.getElementById("pm-title").textContent = p.id ? st("編輯商品","Edit Product") : st("新增商品","Add Product");
    document.getElementById("pm-name").value = p.name || "";
    document.getElementById("pm-sku").value = p.sku || "";
    document.getElementById("pm-price").value = p.price ?? "";
    document.getElementById("pm-stock").value = p.stock ?? "";
    document.getElementById("pm-category").value = p.category || "";
    document.getElementById("pm-description").value = p.description || "";
    document.getElementById("pm-sort-weight").value = p.sortWeight || 0;
    document.getElementById("pm-status").value = p.status || "active";
    // 圖片 URL 列表
    const imgList = document.getElementById("pm-images-list");
    const imgs = p.images || [""];
    imgList.innerHTML = imgs.map((url, i) => this._imageRow(url, i)).join("");
  },

  _imageRow(url = "", idx) {
    return `
<div class="img-url-row" id="img-row-${idx}">
  <input type="text" placeholder="圖片網址（可為 Firebase Storage URL）" value="${url}"
    class="pm-image-url" data-idx="${idx}">
  <button type="button" onclick="AdminProducts.removeImageRow(${idx})" class="btn-sm btn-danger">移除</button>
</div>`;
  },

  addImageRow() {
    const list = document.getElementById("pm-images-list");
    const idx = list.querySelectorAll(".img-url-row").length;
    list.insertAdjacentHTML("beforeend", this._imageRow("", idx));
  },

  removeImageRow(idx) {
    document.getElementById(`img-row-${idx}`)?.remove();
  },

  async saveProduct() {
    const name        = document.getElementById("pm-name").value.trim();
    const price       = Number(document.getElementById("pm-price").value);
    const stock       = Number(document.getElementById("pm-stock").value);
    const category    = document.getElementById("pm-category").value.trim();
    const description = document.getElementById("pm-description").value.trim();
    const sortWeight  = Number(document.getElementById("pm-sort-weight").value) || 0;
    const status      = document.getElementById("pm-status").value;
    const sku         = document.getElementById("pm-sku").value.trim();
    const images      = [...document.querySelectorAll(".pm-image-url")]
      .map(i => i.value.trim()).filter(Boolean);

    if (!name) { showAdminToast(st("請填寫商品名稱","Product name required"), "error"); return; }
    if (isNaN(price) || price < 0) { showAdminToast(st("售價格式不正確","Invalid price"), "error"); return; }
    if (isNaN(stock) || stock < 0) { showAdminToast(st("庫存格式不正確","Invalid stock"), "error"); return; }

    const btn = document.getElementById("btn-save-product");
    btn.disabled = true; btn.textContent = st("儲存中…","Saving…");
    try {
      await AdminShopAPI.call("adminSaveProduct", {
        productId: this.editingId || null,
        name, sku, price, stock, category, description, sortWeight, status, images,
      });
      closeAdminModal("modal-product");
      showAdminToast(st("商品已儲存 ✅","Product saved ✅"));
      this.renderList();
    } catch (e) {
      showAdminToast(`儲存失敗：${e.message}`, "error");
    } finally {
      btn.disabled = false; btn.textContent = st("儲存","Save");
    }
  },

  async confirmDelete(productId, name) {
    if (!confirm(st(`確定要下架「${name}」？\n（商品將標記為刪除，不再顯示於前台）`,`Remove "${name}"?\n(Product will be hidden from storefront.)`))) return;
    try {
      await AdminShopAPI.call("adminDeleteProduct", { productId });
      showAdminToast(st("已下架商品","Product removed"));
      this.renderList();
    } catch (e) {
      showAdminToast(`操作失敗：${e.message}`, "error");
    }
  },

  // ── Excel 匯入 ───────────────────────────
  openImport() { showAdminModal("modal-import"); },

  async handleImportFile(input) {
    const file = input.files?.[0];
    if (!file) return;
    const preview = document.getElementById("import-preview");
    preview.textContent = `已選擇：${file.name}（${(file.size/1024).toFixed(1)} KB）`;
  },

  async downloadTemplate() {
    // 動態產生 Excel 範本
    const XLSX = window.XLSX;
    const ws = XLSX.utils.aoa_to_sheet([
      ["品名","SKU","售價","庫存","分類","商品描述","圖片1","圖片2","圖片3","狀態","排序權重"],
      ["範例商品A","BLM-001","299","100","美妝","高保濕精華液","https://...","","","active","0"],
      ["範例商品B","BLM-002","599","50","服飾","夏季棉質上衣","https://...","","","active","0"],
    ]);
    ws['!cols'] = [14,8,8,10,20,30,30,30,10,8].map(w=>({wch:w}));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "商品匯入");
    XLSX.writeFile(wb, "BINI_商品匯入範本.xlsx");
  },

  async executeImport() {
    const fileInput = document.getElementById("import-file-input");
    const file = fileInput?.files?.[0];
    if (!file) { showAdminToast("請選擇 Excel 檔案", "error"); return; }

    const btn = document.getElementById("btn-execute-import");
    btn.disabled = true; btn.textContent = st("匯入中…","Importing…");

    try {
      // 讀取 Excel 為 base64
      const base64 = await new Promise((res, rej) => {
        const reader = new FileReader();
        reader.onload = e => res(e.target.result.split(",")[1]);
        reader.onerror = rej;
        reader.readAsDataURL(file);
      });

      const result = await AdminShopAPI.call("adminBulkImportProducts", { xlsxBase64: base64 });

      // 顯示結果
      const resultEl = document.getElementById("import-result");
      resultEl.innerHTML = `
<div class="import-result-box ${result.failed > 0 ? "has-error" : "all-ok"}">
  <p>✅ ${st(`成功匯入：${result.success} 筆`,`Imported: ${result.success} items`)}</p>
  ${result.failed > 0 ? `<p>❌ ${st(`失敗：${result.failed} 筆`,`Failed: ${result.failed} items`)}</p>` : ""}
  ${result.errors?.length > 0 ? `
  <div class="import-errors">
    <p><strong>錯誤明細：</strong></p>
    ${result.errors.slice(0,20).map(e=>`<p>第 ${e.row} 行：${e.reason}</p>`).join("")}
    ${result.errors.length > 20 ? `<p>…以及其他 ${result.errors.length-20} 筆錯誤</p>` : ""}
  </div>` : ""}
</div>`;
      if (result.success > 0) {
        showAdminToast(st(`已匯入 ${result.success} 筆商品`,`Imported ${result.success} products`));
        this.renderList();
      }
    } catch (e) {
      showAdminToast(`匯入失敗：${e.message}`, "error");
    } finally {
      btn.disabled = false; btn.textContent = st("開始匯入","Import");
    }
  },
};

// ─────────────────────────────────────────────
// 訂單管理
// ─────────────────────────────────────────────
const AdminOrders = {
  currentStatus: "all",
  orders: [],
  unsubscribe: null,

  // ── 即時訂單列表（Firestore onSnapshot）──
  startListening() {
    this.stopListening();
    // 用 orderBy createdAt 避免複合 index；status 在前端過濾
    const q = query(collection(db, "orders"), orderBy("createdAt", "desc"), limit(100));

    this.unsubscribe = onSnapshot(q, snap => {
      const all = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      this.orders = this.currentStatus === "all"
        ? all
        : all.filter(o => o.status === this.currentStatus);
      this.renderOrderTable();
    });
  },
  stopListening() { this.unsubscribe?.(); },

  filterStatus(status) {
    this.currentStatus = status;
    document.querySelectorAll(".order-filter-btn").forEach(b => {
      b.classList.toggle("active", b.dataset.status === status);
    });
    this.renderFilterBtnText(); // 重新渲染文字確保語言正確
    this.startListening();
  },

  renderFilterBtnText() {
    const labels = {
      all:             st("全部","All"),
      pending_payment: st("待付款","Pending"),
      paid:            st("已付款","Paid"),
      processing:      st("備貨中","Processing"),
      shipped:         st("已出貨","Shipped"),
      completed:       st("已完成","Done"),
      cancelled:       st("已取消","Cancelled"),
    };
    document.querySelectorAll(".order-filter-btn").forEach(b => {
      if (b.dataset.status && labels[b.dataset.status]) {
        b.textContent = labels[b.dataset.status];
      }
    });
  },

  renderOrderTable() {
    const container = document.getElementById("admin-order-list");
    if (!container) return;
    if (!this.orders.length) {
      container.innerHTML = `<p class="admin-empty">${st('沒有訂單','No orders found')}</p>`; return;
    }

    const statusLabel = sl()==="zh" ? {
      pending_payment:"待付款", paid:"已付款", processing:"備貨中",
      shipped:"已出貨", completed:"已完成", cancelled:"已取消",
      expired:"已逾期", payment_failed:"付款失敗",
    } : {
      pending_payment:"Pending", paid:"Paid", processing:"Processing",
      shipped:"Shipped", completed:"Completed", cancelled:"Cancelled",
      expired:"Expired", payment_failed:"Pay Failed",
    };
    const statusCls = {
      pending_payment:"tag-warn", paid:"tag-blue", processing:"tag-blue",
      shipped:"tag-purple", completed:"tag-green",
      cancelled:"tag-gray", expired:"tag-gray", payment_failed:"tag-red",
    };

    container.innerHTML = `
<table class="admin-table">
  <thead>
    <tr>
      <th>${st("訂單編號","Order ID")}</th><th>${st("會員","Member")}</th><th>${st("商品","Items")}</th>
      <th>${st("金額","Amount")}</th><th>${st("點數折抵","Pts Disc.")}</th><th>${st("狀態","Status")}</th><th>${st("建立時間","Created")}</th><th>${st("操作","Action")}</th>
    </tr>
  </thead>
  <tbody>
    ${this.orders.map(o => {
      const date = o.createdAt?.toDate?.()?.toLocaleString("zh-TW",{
        year:"numeric",month:"2-digit",day:"2-digit",
        hour:"2-digit",minute:"2-digit"}) || "";
      const itemSummary = o.items?.slice(0,2).map(i=>`${i.name}×${i.qty}`).join("、") +
        (o.items?.length > 2 ? `等${o.items.length}件` : "");
      return `
    <tr>
      <td class="order-id-cell">${o.orderId}</td>
      <td>${o.cvs?.name || "—"}</td>
      <td class="order-items-cell">${itemSummary}</td>
      <td>NT$ ${o.totalAmount?.toLocaleString()}</td>
      <td>${o.pointsDiscount > 0 ? `- NT$ ${o.pointsDiscount?.toLocaleString()}` : "—"}</td>
      <td><span class="admin-tag ${statusCls[o.status] || ""}">${statusLabel[o.status] || o.status}</span></td>
      <td>${date}</td>
      <td><button class="btn-sm" onclick="AdminOrders.openDetail('${o.id}')">${st('詳情','Detail')}</button>
          ${o.status === "paid" ? `<button class="btn-sm btn-primary" onclick="AdminOrders.quickShip('${o.id}')">${st('出貨','Ship')}</button>` : ""}
      </td>
    </tr>`;
    }).join("")}
  </tbody>
</table></div>`;
  },

  async quickShip(orderId) {
    const trackNum = prompt(st("請輸入物流單號（若無可留空）：","Enter tracking number (optional):")) ?? null;
    if (trackNum === null) return;
    await this._updateStatus(orderId, "shipped", trackNum, "");
  },

  async openDetail(orderId) {
    const order = this.orders.find(o => o.id === orderId);
    if (!order) return;

    const content = document.getElementById("modal-order-content");
    const statusLabel = sl()==="zh" ? {
      pending_payment:"待付款", paid:"已付款", processing:"備貨中",
      shipped:"已出貨", completed:"已完成", cancelled:"已取消",
      expired:"已逾期", payment_failed:"付款失敗",
    } : {
      pending_payment:"Pending", paid:"Paid", processing:"Processing",
      shipped:"Shipped", completed:"Completed", cancelled:"Cancelled",
      expired:"Expired", payment_failed:"Pay Failed",
    };
    const statusCls = {
      pending_payment:"tag-warn", paid:"tag-blue", processing:"tag-blue",
      shipped:"tag-purple", completed:"tag-green",
      cancelled:"tag-gray", expired:"tag-gray", payment_failed:"tag-red",
    };
    const date = order.createdAt?.toDate?.()?.toLocaleString("zh-TW") || "";

    const cvsLabel = {FAMI:st("全家","FamilyMart"),UNIMART:st("7-11","7-Eleven"),HILIFE:st("萊爾富","Hi-Life"),OKMART:"OK"}[order.cvs?.cvsType] || order.cvs?.cvsType;
    content.innerHTML = `
<div class="order-detail-admin">
  <div class="od-section">
    <div class="od-row"><span class="od-label">${st("訂單編號","Order ID")}</span><strong class="od-val">${order.orderId}</strong></div>
    <div class="od-row"><span class="od-label">${st("建立時間","Created")}</span><span class="od-val">${date}</span></div>
    <div class="od-row"><span class="od-label">${st("狀態","Status")}</span><span class="od-val"><span class="admin-tag ${statusCls[order.status]||""}">${statusLabel[order.status] || order.status}</span></span></div>
    ${order.trackingNumber ? `<div class="od-row"><span class="od-label">${st("物流單號","Tracking")}</span><strong class="od-val">${order.trackingNumber}</strong></div>` : ""}
  </div>

  <h4 class="od-section-title">${st("商品明細","Order Items")}</h4>
  <div class="od-section">
    ${order.items?.map(i => `
    <div class="od-item-row">
      <img src="${i.image || ""}" class="od-item-img" onerror="this.style.display='none'">
      <div class="od-item-info">
        <div class="od-item-name">${i.name}${i.sku ? ` <small style="color:#aaa;font-weight:400">SKU: ${i.sku}</small>` : ""}</div>
        <div class="od-item-sub">× ${i.qty} &nbsp; NT$ ${i.price?.toLocaleString()} / ${st("件","pc")}</div>
      </div>
      <div class="od-item-total">NT$ ${(i.price * i.qty)?.toLocaleString()}</div>
    </div>`).join("")}
    <div class="od-divider"></div>
    <div class="od-row"><span class="od-label">${st("小計","Subtotal")}</span><span class="od-val">NT$ ${order.subtotal?.toLocaleString()}</span></div>
    ${order.pointsDiscount > 0 ? `<div class="od-row"><span class="od-label">${st("點數折抵","Pts Disc.")} (${order.pointsUsed}pts)</span><span class="od-val" style="color:#2d8a4e">- NT$ ${order.pointsDiscount?.toLocaleString()}</span></div>` : ""}
    <div class="od-row od-total-row"><span class="od-label">${st("應付金額","Total Due")}</span><strong class="od-val od-total-val">NT$ ${order.totalAmount?.toLocaleString()}</strong></div>
  </div>

  <h4 class="od-section-title">${st("取貨資訊","Pickup Info")}</h4>
  <div class="od-section">
    <div class="od-row"><span class="od-label">${st("超商","CVS")}</span><span class="od-val">${cvsLabel}</span></div>
    <div class="od-row"><span class="od-label">${st("門市","Store")}</span><span class="od-val">${order.cvs?.storeName || "—"}</span></div>
    <div class="od-row"><span class="od-label">${st("地址","Address")}</span><span class="od-val">${order.cvs?.storeAddress || "—"}</span></div>
    <div class="od-row"><span class="od-label">${st("取件人","Recipient")}</span><span class="od-val">${order.cvs?.name || "—"}</span></div>
    <div class="od-row"><span class="od-label">${st("電話","Phone")}</span><span class="od-val">${order.cvs?.phone || "—"}</span></div>
  </div>

  ${["pending_shipment","paid","processing","shipped"].includes(order.status) ? `
  <h4 class="od-section-title">${st("更新訂單狀態","Update Status")}</h4>
  <div class="od-section">
    <div class="od-form-row">
      <label>${st("狀態","Status")}</label>
      <select id="od-status" style="flex:1;padding:8px 10px;border:1.5px solid #ddd;border-radius:8px;font-size:14px">
        <option value="processing" ${order.status==="processing"?"selected":""}>${st("備貨中","Processing")}</option>
        <option value="shipped" ${order.status==="shipped"?"selected":""}>${st("已出貨","Shipped")}</option>
        <option value="completed" ${order.status==="completed"?"selected":""}>${st("已完成","Completed")}</option>
        <option value="cancelled">${st("取消訂單","Cancel Order")}</option>
      </select>
    </div>
    <div class="od-form-row">
      <label>${st("貨運單號","Tracking No.")}</label>
      <input id="od-tracking" type="text" value="${order.trackingNumber || ""}" placeholder="${st("出貨時請填入","Required when shipped")}" style="flex:1;padding:8px 10px;border:1.5px solid #ddd;border-radius:8px;font-size:14px">
    </div>
    <div class="od-form-row">
      <label>${st("備註","Note")}</label>
      <input id="od-note" type="text" value="${order.note || ""}" placeholder="${st("選填","Optional")}" style="flex:1;padding:8px 10px;border:1.5px solid #ddd;border-radius:8px;font-size:14px">
    </div>
    <button onclick="AdminOrders.saveStatus('${orderId}')" style="width:100%;padding:12px;background:#D4587A;color:#fff;border:none;border-radius:10px;font-size:15px;font-weight:700;cursor:pointer;margin-top:4px">
      ${st("更新狀態","Update Status")}
    </button>
  </div>` : ""}
</div>`;

    showAdminModal("modal-order");
  },

  async saveStatus(orderId) {
    const status = document.getElementById("od-status")?.value;
    const trackingNumber = document.getElementById("od-tracking")?.value?.trim();
    const note = document.getElementById("od-note")?.value?.trim();
    if (status === "shipped" && !trackingNumber) {
      if (!confirm(st("尚未填入貨運單號，確定要標記為已出貨嗎？","No tracking number entered. Mark as shipped anyway?"))) return;
    }
    if (status === "cancelled" && !confirm(st("確定要取消此訂單？庫存與點數將自動回補。","Cancel this order? Stock and points will be restored."))) return;
    await this._updateStatus(orderId, status, trackingNumber, note);
    closeAdminModal("modal-order");
  },

  async _updateStatus(orderId, status, trackingNumber, note) {
    try {
      await AdminShopAPI.call("adminUpdateOrderStatus", { orderId, status, trackingNumber, note });
      showAdminToast(st(`訂單狀態已更新為：${status}`,`Order status updated: ${status}`));
    } catch (e) {
      showAdminToast(`更新失敗：${e.message}`, "error");
    }
  },

  // ── 匯出訂單 Excel ───────────────────────
  async exportExcel() {
    const XLSX = window.XLSX;
    const headers = ["訂單編號","狀態","取件人","電話","超商","門市","商品明細(含SKU)","小計","點數折抵","應付金額","物流單號","建立時間"];
    const rows = this.orders.map(o => [
      o.orderId,
      o.status,
      o.cvs?.name || "",
      o.cvs?.phone || "",
      {FAMI:"全家",UNIMART:"7-11",HILIFE:"萊爾富",OKMART:"OK"}[o.cvs?.cvsType] || "",
      o.cvs?.storeName || "",
      o.items?.map(i=>`${i.name}${i.sku?"["+i.sku+"]":""}x${i.qty}`).join("；") || "",
      o.subtotal || 0,
      o.pointsDiscount || 0,
      o.totalAmount || 0,
      o.trackingNumber || "",
      o.createdAt?.toDate?.()?.toLocaleString("zh-TW") || "",
    ]);
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    ws["!cols"] = [14,10,8,12,6,16,40,8,8,8,12,18].map(w=>({wch:w}));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "訂單列表");
    XLSX.writeFile(wb, `BINI_訂單_${new Date().toLocaleDateString("zh-TW").replace(/\//g,"")}.xlsx`);
  },
};

// ─────────────────────────────────────────────
// 銷售報表
// ─────────────────────────────────────────────
const AdminShopStats = {
  async render() {
    const container = document.getElementById("admin-shop-stats");
    if (!container) return;
    container.innerHTML = `<div class="admin-loading">${st('統計中…','Loading stats…')}</div>`;

    try {
      // 最近 30 天訂單
      const since = new Date();
      since.setDate(since.getDate() - 30);
      // 只用單一 where 避免複合 index，前端再過濾
      const snap = await getDocs(query(
        collection(db, "orders"),
        where("createdAt", ">=", Timestamp.fromDate(since)),
        orderBy("createdAt", "desc"),
        limit(200)
      ));

      const validStatuses = new Set(["paid","processing","shipped","completed"]);
      const orders = snap.docs.map(d => d.data()).filter(o => validStatuses.has(o.status));
      const totalRevenue = orders.reduce((s, o) => s + (o.totalAmount || 0), 0);
      const totalOrders  = orders.length;
      const avgOrder     = totalOrders ? Math.round(totalRevenue / totalOrders) : 0;
      const totalPointsUsed = orders.reduce((s, o) => s + (o.pointsUsed || 0), 0);

      // 商品銷售排行
      const itemCount = {};
      orders.forEach(o => o.items?.forEach(i => {
        itemCount[i.name] = (itemCount[i.name] || 0) + i.qty;
      }));
      const topItems = Object.entries(itemCount)
        .sort((a, b) => b[1] - a[1]).slice(0, 10);

      // 每日訂單量（折線）
      const dailyMap = {};
      orders.forEach(o => {
        const day = o.createdAt?.toDate?.()?.toLocaleDateString("zh-TW") || "";
        if (day) dailyMap[day] = (dailyMap[day] || 0) + 1;
      });

      container.innerHTML = `
<div class="stats-cards">
  <div class="stat-card">
    <div class="stat-value">NT$ ${totalRevenue.toLocaleString()}</div>
    <div class="stat-label">${st("近 30 天營收","Revenue (30d)")}</div>
  </div>
  <div class="stat-card">
    <div class="stat-value">${totalOrders}</div>
    <div class="stat-label">${st("近 30 天訂單數","Orders (30d)")}</div>
  </div>
  <div class="stat-card">
    <div class="stat-value">NT$ ${avgOrder.toLocaleString()}</div>
    <div class="stat-label">${st("平均客單價","Avg. Order Value")}</div>
  </div>
  <div class="stat-card">
    <div class="stat-value">${totalPointsUsed}</div>
    <div class="stat-label">${st("點數折扣使用總計","Total Points Used")}</div>
  </div>
</div>

<div class="stats-section">
  <h4>🏆 ${st("商品銷售排行（近30天）","Top Products (30d)")}</h4>
  <div class="rank-list">
    ${topItems.map(([name, qty], i) => `
    <div class="rank-row">
      <span class="rank-num rank-${i < 3 ? i+1 : "other"}">${i+1}</span>
      <span class="rank-name">${name}</span>
      <span class="rank-qty">${qty} ${st("件","pcs")}</span>
    </div>`).join("")}
    ${topItems.length === 0 ? `<p>${st("無資料","No data")}</p>` : ""}
  </div>
</div>

<div class="stats-section">
  <h4>📅 ${st("近7天每日訂單量","Daily Orders (7d)")}</h4>
  <div class="daily-chart">
    ${Object.entries(dailyMap).slice(-7).map(([day, count]) => `
    <div class="daily-bar-wrap">
      <div class="daily-bar" style="height:${Math.max(4, count * 20)}px"></div>
      <div class="daily-label">${day.slice(5)}</div>
      <div class="daily-count">${count}</div>
    </div>`).join("")}
  </div>
</div>`;
    } catch (e) {
      container.innerHTML = `<p class="admin-error">統計失敗：${e.message}</p>`;
    }
  },
};

// ─────────────────────────────────────────────
// 庫存管理（低庫存列表）
// ─────────────────────────────────────────────
const AdminInventory = {
  async render() {
    const container = document.getElementById("admin-inventory-list");
    if (!container) return;
    // 只用單一 where，前端排序過濾，避免複合 index
    const snap = await getDocs(query(
      collection(db, "products"),
      where("status", "==", "active"),
      limit(200)
    ));
    const lowStock = snap.docs
      .filter(d => d.data().stock <= 10)
      .sort((a, b) => a.data().stock - b.data().stock)
      .slice(0, 30);
    if (!lowStock.length) {
      container.innerHTML = `<p class="admin-empty">✅ ${st('目前沒有低庫存商品','No low-stock products')}</p>`; return;
    }
    container.innerHTML = `
<table class="admin-table">
  <thead><tr><th>${st("商品名稱","Product")}</th><th>${st("分類","Category")}</th><th>${st("當前庫存","Stock")}</th><th>${st("銷售數","Sales")}</th><th>${st("操作","Actions")}</th></tr></thead>
  <tbody>
    ${lowStock.map(doc => {
      const p = { id: doc.id, ...doc.data() };
      return `
    <tr class="${p.stock === 0 ? "row-danger" : p.stock <= 5 ? "row-warn" : ""}">
      <td>${p.name}</td><td>${p.category || "—"}</td>
      <td><strong>${p.stock}</strong></td>
      <td>${p.salesCount || 0}</td>
      <td><button class="btn-sm" onclick="AdminProducts.openEdit('${p.id}')">${st('補貨/編輯','Restock/Edit')}</button></td>
    </tr>`;
    }).join("")}
  </tbody>
</table></div>`;
  },
};

// ─────────────────────────────────────────────
// 後台 UI 工具（和 admin index.html 整合）
// ─────────────────────────────────────────────
function showAdminModal(modalId) {
  const el = document.getElementById(modalId);
  if (el) el.style.display = 'flex';
}
function closeAdminModal(modalId) {
  const el = document.getElementById(modalId);
  if (el) el.style.display = 'none';
}
function showAdminToast(msg, type = "success") {
  const el = document.createElement("div");
  el.className = `admin-toast admin-toast-${type}`;
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.classList.add("show"), 10);
  setTimeout(() => { el.classList.remove("show"); setTimeout(() => el.remove(), 300); }, 2800);
}

// 全域掛載
window.AdminProducts   = AdminProducts;
window.AdminOrders     = AdminOrders;
window.AdminShopStats  = AdminShopStats;
window.AdminInventory  = AdminInventory;
window.AdminShopNotify = AdminShopNotify;
window.showAdminModal  = showAdminModal;
window.closeAdminModal = closeAdminModal;
window.showAdminToast  = showAdminToast;

// ─────────────────────────────────────────────
// 動態插入購物後台 UI（v2 - 修正插入位置）
// ─────────────────────────────────────────────
function injectShopAdminUI() {
  const screenApp = document.getElementById('screen-app');
  const bnav = document.getElementById('admin-bnav');
  if (!screenApp || !bnav) {
    setTimeout(injectShopAdminUI, 200);
    return;
  }

  // ── 1. 插入導覽按鈕（在設定按鈕前）──
  const settingsBtn = document.getElementById('tab-settings');
  if (settingsBtn && !document.getElementById('tab-products')) {
    const btns = document.createRange().createContextualFragment(`
      <button class="admin-bnav-btn" id="tab-products" onclick="window.switchTab('products',this);AdminProducts.renderList()">
        <svg width="26" height="26" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z"/></svg>
        <span class="shop-nav-label" data-zh="商品" data-en="Products">商品</span>
      </button>
      <button class="admin-bnav-btn" id="tab-orders" onclick="window.switchTab('orders',this);AdminOrders.startListening()">
        <svg width="26" height="26" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"/></svg>
        <span class="shop-nav-label" data-zh="訂單" data-en="Orders">訂單</span>
      </button>
      <button class="admin-bnav-btn" id="tab-shopstats" onclick="window.switchTab('shopstats',this)">
        <svg width="26" height="26" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
        <span class="shop-nav-label" data-zh="報表" data-en="Stats">報表</span>
      </button>
    `);
    settingsBtn.parentNode.insertBefore(btns, settingsBtn);
  }

  // ── 2. 插入 tab 頁面到 screen-app（在 admin-bnav 前）──
  if (!document.getElementById('tab-products-page')) {
    const pages = document.createRange().createContextualFragment(`
      <div class="tab-page" id="tab-products-page">
        <div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap;padding:14px 14px 0">
          <button id="btn-add-product" class="btn btn-primary" onclick="AdminProducts.openAdd()" style="flex:1">+新增商品</button>
          <button id="btn-excel-import" class="btn btn-outline" onclick="AdminProducts.openImport()" style="flex:1">📥 Excel 匯入</button>
          <button id="btn-dl-template" class="btn btn-outline" onclick="AdminProducts.downloadTemplate()">📄 範本</button>
        </div>
        <div style="padding:0 14px;overflow-y:auto;flex:1" id="admin-product-list"><p style="text-align:center;color:#888;padding:20px">\u8f09\u5165\u4e2d\u2026</p></div>
      </div>
      <div class="tab-page" id="tab-orders-page">
        <div style="display:flex;gap:6px;overflow-x:auto;padding:14px 14px 8px;scrollbar-width:none">
          <button class="order-filter-btn active" data-status="all" onclick="AdminOrders.filterStatus('all')">${st('全部','All')}</button>
          <button class="order-filter-btn" data-status="pending_payment" onclick="AdminOrders.filterStatus('pending_payment')">${st('待付款','Pending')}</button>
          <button class="order-filter-btn" data-status="paid" onclick="AdminOrders.filterStatus('paid')">${st('已付款','Paid')}</button>
          <button class="order-filter-btn" data-status="processing" onclick="AdminOrders.filterStatus('processing')">${st('備貨中','Processing')}</button>
          <button class="order-filter-btn" data-status="shipped" onclick="AdminOrders.filterStatus('shipped')">${st('已出貨','Shipped')}</button>
          <button class="order-filter-btn" data-status="completed" onclick="AdminOrders.filterStatus('completed')">${st('已完成','Done')}</button>
          <button class="order-filter-btn" data-status="cancelled" onclick="AdminOrders.filterStatus('cancelled')">${st('已取消','Cancelled')}</button>
        </div>
        <div style="padding:0 14px 8px">
          <button id="btn-export-orders" class="btn btn-outline" onclick="AdminOrders.exportExcel()" style="width:100%">📊 匯出 Excel</button>
        </div>
        <div style="padding:0 14px;overflow-y:auto;flex:1" id="admin-order-list"><p style="text-align:center;color:#888;padding:20px">\u8f09\u5165\u4e2d\u2026</p></div>
      </div>
      <div class="tab-page" id="tab-shopstats-page">
        <div style="padding:14px;overflow-y:auto;flex:1">
          <div id="admin-shop-stats"><p style="text-align:center;color:#888;padding:20px">${st("點擊下方載入","Click below to load")}</p></div>
          <button id="btn-load-stats" class="btn btn-outline" onclick="AdminShopStats.render()" style="width:100%;margin-top:8px">📈 載入銷售報表</button>
          <div style="margin-top:16px">
            <p style="font-size:14px;font-weight:700;margin-bottom:8px">${st("⚠️ 低庫存商品","⚠️ Low Stock")}</p>
            <div id="admin-inventory-list"><p style="text-align:center;color:#888">${st("點擊下方載入","Click below to load")}</p></div>
            <button id="btn-load-inventory" class="btn btn-outline" onclick="AdminInventory.render()" style="width:100%;margin-top:8px">載入庫存狀況</button>
          </div>
        </div>
      </div>
    `);
    screenApp.insertBefore(pages, bnav);
  }

  // ── 3. 修正 switchTab 支援新頁面 ──
  const _origSwitchTab = window.switchTab;
  window.switchTab = function(tab, btn) {
    // 隱藏所有 tab-page（包含動態插入的）
    document.querySelectorAll('.tab-page').forEach(p => {
      p.classList.remove('active');
      p.scrollTop = 0;
    });
    document.querySelectorAll('.tab-btn,.admin-bnav-btn').forEach(b => b.classList.remove('active'));
    const bnav = document.getElementById('admin-bnav');
    if (bnav) bnav.classList.add('visible');

    const page = document.getElementById('tab-' + tab + '-page');
    if (page) {
      page.classList.add('active');
      // 確保動態插入的頁面有正確的 flex 佈局
      if (!page.style.flexDirection) {
        page.style.flexDirection = 'column';
      }
    }
    const tabBtn = btn || document.getElementById('tab-' + tab);
    if (tabBtn) tabBtn.classList.add('active');

    // 原有邏輯
    if (tab === 'announce') { if (typeof loadAnnouncements === 'function') loadAnnouncements(); }
    if (tab === 'rewards')  { if (typeof loadRewards === 'function') loadRewards(); }
    if (tab === 'analytics'){ if (typeof window.loadAnalytics === 'function') window.loadAnalytics(); }
    if (tab === 'products') { AdminProducts.renderList(); }
    if (tab === 'orders')   { AdminOrders.startListening(); }
  };

  // ── 4. 插入 Modals ──
  if (!document.getElementById('modal-product')) {
    const modals = document.createRange().createContextualFragment(`
      <div id="modal-product" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:1000;align-items:center;justify-content:center;padding:16px" onclick="if(event.target===this)closeAdminModal('modal-product')">
        <div style="background:#fff;border-radius:16px;width:100%;max-width:480px;max-height:90vh;display:flex;flex-direction:column">
          <div style="display:flex;justify-content:space-between;align-items:center;padding:16px 20px;border-bottom:1px solid #eee;font-weight:700;font-size:16px">
            <span id="pm-title">\u65b0\u589e\u5546\u54c1</span>
            <button onclick="closeAdminModal('modal-product')" style="background:none;border:none;font-size:20px;cursor:pointer">\u00d7</button>
          </div>
          <div style="overflow-y:auto;padding:16px 20px;flex:1">
            <div style="margin-bottom:12px"><label style="display:block;font-size:13px;font-weight:600;color:#666;margin-bottom:5px">\u5546\u54c1\u540d\u7a31 *</label>
              <input type="text" id="pm-name" style="width:100%;padding:9px 12px;border:1.5px solid #ddd;border-radius:8px;font-size:14px;box-sizing:border-box"></div>
            <div style="margin-bottom:12px"><label style="display:block;font-size:13px;font-weight:600;color:#666;margin-bottom:5px">SKU <small style="color:#aaa;font-weight:400">(\u5167\u90e8\u7de8\u865f\uff0c\u4e0d\u986f\u793a\u65bc\u524d\u53f0)</small></label>
              <input type="text" id="pm-sku" placeholder="\u4f8b: BLM-001" style="width:100%;padding:9px 12px;border:1.5px solid #ddd;border-radius:8px;font-size:14px;box-sizing:border-box"></div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px">
              <div><label style="display:block;font-size:13px;font-weight:600;color:#666;margin-bottom:5px">\u552e\u50f9\uff08NT$\uff09*</label>
                <input type="number" id="pm-price" min="0" style="width:100%;padding:9px 12px;border:1.5px solid #ddd;border-radius:8px;font-size:14px;box-sizing:border-box"></div>
              <div><label style="display:block;font-size:13px;font-weight:600;color:#666;margin-bottom:5px">\u5eab\u5b58\u6578\u91cf *</label>
                <input type="number" id="pm-stock" min="0" style="width:100%;padding:9px 12px;border:1.5px solid #ddd;border-radius:8px;font-size:14px;box-sizing:border-box"></div>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px">
              <div><label style="display:block;font-size:13px;font-weight:600;color:#666;margin-bottom:5px">\u5206\u985e</label>
                <input type="text" id="pm-category" style="width:100%;padding:9px 12px;border:1.5px solid #ddd;border-radius:8px;font-size:14px;box-sizing:border-box"></div>
              <div><label style="display:block;font-size:13px;font-weight:600;color:#666;margin-bottom:5px">\u6392\u5e8f\u6b0a\u91cd</label>
                <input type="number" id="pm-sort-weight" value="0" style="width:100%;padding:9px 12px;border:1.5px solid #ddd;border-radius:8px;font-size:14px;box-sizing:border-box"></div>
            </div>
            <div style="margin-bottom:12px"><label style="display:block;font-size:13px;font-weight:600;color:#666;margin-bottom:5px">\u5546\u54c1\u63cf\u8ff0</label>
              <textarea id="pm-description" rows="3" style="width:100%;padding:9px 12px;border:1.5px solid #ddd;border-radius:8px;font-size:14px;box-sizing:border-box;resize:vertical"></textarea></div>
            <div style="margin-bottom:12px"><label style="display:block;font-size:13px;font-weight:600;color:#666;margin-bottom:5px">\u72c0\u614b</label>
              <select id="pm-status" style="width:100%;padding:9px 12px;border:1.5px solid #ddd;border-radius:8px;font-size:14px">
                <option value="active">\u4e0a\u67b6\u4e2d</option>
                <option value="inactive">\u5df2\u4e0b\u67b6</option>
                <option value="soldout">\u552e\u5b8c</option>
              </select></div>
            <div style="margin-bottom:12px"><label style="display:block;font-size:13px;font-weight:600;color:#666;margin-bottom:5px">\u5716\u7247\u7db2\u5740\uff08\u6700\u591a5\u5f35\uff09</label>
              <div id="pm-images-list"></div>
              <button type="button" onclick="AdminProducts.addImageRow()" style="margin-top:6px;width:100%;padding:8px;background:#fff;border:1.5px solid #ddd;border-radius:8px;cursor:pointer">\uff0b \u65b0\u589e\u5716\u7247\u7db2\u5740</button></div>
          </div>
          <div style="display:flex;gap:10px;padding:14px 20px;border-top:1px solid #eee;justify-content:flex-end">
            <button class="btn btn-outline" onclick="closeAdminModal('modal-product')">\u53d6\u6d88</button>
            <button class="btn btn-primary" id="btn-save-product" onclick="AdminProducts.saveProduct()">\u5132\u5b58</button>
          </div>
        </div>
      </div>
      <div id="modal-import" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:1000;align-items:center;justify-content:center;padding:16px" onclick="if(event.target===this)closeAdminModal('modal-import')">
        <div style="background:#fff;border-radius:16px;width:100%;max-width:480px;max-height:90vh;display:flex;flex-direction:column">
          <div style="display:flex;justify-content:space-between;align-items:center;padding:16px 20px;border-bottom:1px solid #eee;font-weight:700;font-size:16px">
            <span>Excel \u5927\u91cf\u532f\u5165</span>
            <button onclick="closeAdminModal('modal-import')" style="background:none;border:none;font-size:20px;cursor:pointer">\u00d7</button>
          </div>
          <div style="overflow-y:auto;padding:16px 20px;flex:1">
            <p style="font-size:13px;color:#888;margin-bottom:12px">\u5fc5\u586b\uff1a\u54c1\u540d\u3001\u552e\u50f9\u3001\u5eab\u5b58</p>
            <button class="btn btn-outline" onclick="AdminProducts.downloadTemplate()" style="width:100%;margin-bottom:12px">\ud83d\udcc4 \u4e0b\u8f09\u7bc4\u672c</button>
            <div style="margin-bottom:12px"><label style="display:block;font-size:13px;font-weight:600;color:#666;margin-bottom:5px">\u9078\u64c7 .xlsx \u6a94\u6848</label>
              <input type="file" id="import-file-input" accept=".xlsx,.xls" onchange="AdminProducts.handleImportFile(this)"></div>
            <div id="import-preview" style="font-size:13px;color:#888"></div>
            <div id="import-result" style="margin-top:12px"></div>
          </div>
          <div style="display:flex;gap:10px;padding:14px 20px;border-top:1px solid #eee;justify-content:flex-end">
            <button class="btn btn-outline" onclick="closeAdminModal('modal-import')">\u95dc\u9589</button>
            <button class="btn btn-primary" id="btn-execute-import" onclick="AdminProducts.executeImport()">\u958b\u59cb\u532f\u5165</button>
          </div>
        </div>
      </div>
      <div id="modal-order" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:1000;align-items:center;justify-content:center;padding:16px" onclick="if(event.target===this)closeAdminModal('modal-order')">
        <div style="background:#fff;border-radius:16px;width:100%;max-width:600px;max-height:90vh;display:flex;flex-direction:column">
          <div style="display:flex;justify-content:space-between;align-items:center;padding:16px 20px;border-bottom:1px solid #eee;font-weight:700;font-size:16px">
            <span>\u8a02\u55ae\u8a73\u60c5</span>
            <button onclick="closeAdminModal('modal-order')" style="background:none;border:none;font-size:20px;cursor:pointer">\u00d7</button>
          </div>
          <div style="overflow-y:auto;padding:16px 20px;flex:1" id="modal-order-content">\u8f09\u5165\u4e2d\u2026</div>
          <div style="display:flex;gap:10px;padding:14px 20px;border-top:1px solid #eee;justify-content:flex-end">
            <button class="btn btn-outline" onclick="closeAdminModal('modal-order')">\u95dc\u9589</button>
          </div>
        </div>
      </div>
    `);
    document.body.appendChild(modals);
  }

  // ── 5. CSS ──
  if (!document.getElementById('shop-admin-css')) {
    const style = document.createElement('style');
    style.id = 'shop-admin-css';
    style.textContent = `
      .order-filter-btn{flex-shrink:0;padding:5px 12px;font-size:12px;border-radius:20px;border:1.5px solid #ddd;background:#fff;cursor:pointer;white-space:nowrap}
      .order-filter-btn.active{background:#D4587A;color:#fff;border-color:#D4587A}
      .admin-table{width:100%;border-collapse:collapse;font-size:13px;background:#fff;border-radius:8px;overflow:hidden}
      .admin-table th{background:#f8f0f2;color:#5B1F00;padding:10px 8px;text-align:left;font-weight:700;font-size:12px;white-space:nowrap}
      .admin-table td{padding:9px 8px;border-top:1px solid #eee;vertical-align:middle}
      .admin-table tr:hover td{background:#fafafa}
      .admin-product-thumb{width:40px;height:40px;object-fit:cover;border-radius:6px}
      .btn-sm{padding:4px 10px;font-size:12px;border-radius:6px;border:1px solid #ddd;background:#fff;cursor:pointer}
      .btn-sm.btn-danger{color:#c0392b;border-color:#c0392b}
      .admin-tag{font-size:11px;padding:2px 8px;border-radius:20px;font-weight:600}
      .tag-green{background:#e6f6ec;color:#2d8a4e}.tag-blue{background:#e3f0ff;color:#1a5fa3}
      .tag-warn{background:#fff8e1;color:#b47d00}.tag-gray{background:#f5f5f5;color:#888}
      .tag-red{background:#fde8e7;color:#c0392b}.tag-purple{background:#eeedfe;color:#3c3489}
      .stats-cards{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:16px}
      .stat-card{background:#fff;border-radius:10px;padding:14px;border:1px solid #eee;text-align:center}
      .stat-value{font-size:22px;font-weight:700;color:#5B1F00}.stat-label{font-size:12px;color:#888;margin-top:4px}
      .admin-toast{position:fixed;bottom:90px;left:50%;transform:translateX(-50%) translateY(10px);background:#2C1F18;color:#fff;padding:10px 22px;border-radius:24px;font-size:14px;white-space:nowrap;opacity:0;transition:all .25s;z-index:9999;pointer-events:none}
      .admin-toast.show{opacity:1;transform:translateX(-50%) translateY(0)}
      .admin-toast.admin-toast-error{background:#c0392b}
      .img-url-row{display:flex;gap:8px;margin-bottom:6px}
      .img-url-row input{flex:1;padding:8px 10px;border:1.5px solid #ddd;border-radius:8px;font-size:13px}
    
      /* 訂單詳情樣式 */
      .od-section{background:#fafafa;border-radius:10px;padding:12px 14px;margin-bottom:12px;border:1px solid #eee}
      .od-section-title{font-size:13px;font-weight:700;color:#5B1F00;margin:14px 0 6px;padding-left:2px;letter-spacing:.3px}
      .od-row{display:flex;justify-content:space-between;align-items:center;padding:5px 0;font-size:13px;gap:8px}
      .od-label{color:#888;flex-shrink:0;min-width:72px}
      .od-val{color:#1a1a1a;text-align:right;word-break:break-all}
      .od-divider{border-top:1px dashed #ddd;margin:8px 0}
      .od-total-row{border-top:2px solid #eee;margin-top:4px;padding-top:8px}
      .od-total-val{font-size:16px;color:#D4587A}
      .od-item-row{display:flex;align-items:center;gap:10px;padding:6px 0;border-bottom:1px solid #f0f0f0}
      .od-item-img{width:44px;height:44px;object-fit:cover;border-radius:8px;flex-shrink:0}
      .od-item-info{flex:1;min-width:0}
      .od-item-name{font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .od-item-sub{font-size:12px;color:#888;margin-top:2px}
      .od-item-total{font-size:13px;font-weight:700;flex-shrink:0;color:#333}
      .od-form-row{display:flex;align-items:center;gap:8px;margin-bottom:10px;font-size:13px}
      .od-form-row label{min-width:72px;color:#666;font-weight:600;flex-shrink:0}
      /* 銷售報表 rank */
      .rank-list{display:flex;flex-direction:column;gap:6px}
      .rank-row{display:flex;align-items:center;gap:10px;padding:8px 10px;background:#fafafa;border-radius:8px;font-size:13px}
      .rank-num{width:22px;height:22px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;flex-shrink:0}
      .rank-1{background:#FFD700;color:#7a5a00}.rank-2{background:#C0C0C0;color:#444}.rank-3{background:#CD7F32;color:#fff}.rank-other{background:#eee;color:#666}
      .rank-name{flex:1;font-weight:600}.rank-qty{color:#D4587A;font-weight:700}
      /* 日報表 */
      .daily-chart{display:flex;gap:6px;align-items:flex-end;padding:10px 0;overflow-x:auto}
      .daily-bar-wrap{display:flex;flex-direction:column;align-items:center;gap:3px;min-width:36px}
      .daily-bar{width:28px;background:#D4587A;border-radius:4px 4px 0 0;min-height:4px;transition:height .3s}
      .daily-label{font-size:10px;color:#888}.daily-count{font-size:11px;font-weight:700;color:#5B1F00}
      #tab-products-page,#tab-orders-page,#tab-shopstats-page{flex-direction:column!important;overflow-y:auto}
      #tab-products-page.active,#tab-orders-page.active,#tab-shopstats-page.active{display:flex!important}
      /* 電腦版導覽列：顯示水平滾動條 */
      @media (hover: hover) and (pointer: fine) {
        .admin-bnav { scrollbar-width: thin !important; scrollbar-color: #D4587A #f0e8ea !important; overflow-x: auto !important; }
        .admin-bnav::-webkit-scrollbar { display: block !important; height: 4px !important; }
        .admin-bnav::-webkit-scrollbar-track { background: #f0e8ea; }
        .admin-bnav::-webkit-scrollbar-thumb { background: #D4587A; border-radius: 4px; }
      }`;
    document.head.appendChild(style);
  }
}

// 同步語言到動態注入的 span[data-zh/data-en]
function syncShopNavLang() {
  const lang = sl();
  document.querySelectorAll('.shop-nav-label[data-zh]').forEach(el => {
    el.textContent = lang === 'zh' ? el.dataset.zh : el.dataset.en;
  });
  // 訂單篩選按鈕
  if (window.AdminOrders) AdminOrders.renderFilterBtnText?.();
  // 重新 render 目前開啟的頁面內容
  if (document.getElementById('tab-products-page')?.classList.contains('active')) {
    AdminProducts.renderList();
  }
  if (document.getElementById('tab-orders-page')?.classList.contains('active')) {
    AdminOrders.renderOrderTable();
  }
  // 報表頁靜態文字（inject 時已寫死，需手動更新）
  const statsHint = document.querySelector('#admin-shop-stats p');
  if (statsHint && !statsHint.dataset.dynamic) {
    statsHint.textContent = lang === 'zh' ? '點擊下方載入' : 'Click below to load';
  }
  const invHint = document.querySelector('#admin-inventory-list p');
  if (invHint && !invHint.dataset.dynamic) {
    invHint.textContent = lang === 'zh' ? '點擊下方載入' : 'Click below to load';
  }
  const lowStockTitle = document.querySelector('#tab-shopstats-page p[style*="font-weight:700"]');
  if (lowStockTitle) {
    lowStockTitle.textContent = lang === 'zh' ? '⚠️ 低庫存商品' : '⚠️ Low Stock';
  }
  // 商品/訂單/報表頁面按鈕
  const btnMap = {
    'btn-add-product':    ['+新增商品','+Add Product'],
    'btn-excel-import':   ['📥 Excel 匯入','📥 Excel Import'],
    'btn-dl-template':    ['📄 範本','📄 Template'],
    'btn-export-orders':  ['📊 匯出 Excel','📊 Export Excel'],
    'btn-load-stats':     ['📈 載入銷售報表','📈 Load Sales Report'],
    'btn-load-inventory': ['載入庫存狀況','Load Inventory'],
  };
  Object.entries(btnMap).forEach(([id,[zh,en]])=>{
    const el = document.getElementById(id);
    if (el) el.textContent = lang==='zh' ? zh : en;
  });
}
window.syncShopNavLang = syncShopNavLang;

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => { injectShopAdminUI(); setTimeout(syncShopNavLang, 300); });
} else {
  injectShopAdminUI();
  setTimeout(syncShopNavLang, 300);
}
