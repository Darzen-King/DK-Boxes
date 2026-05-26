import { db, auth } from './firebase-config.js';
import {
  collection, query, where, orderBy, limit,
  startAfter, getDocs, getDoc, doc
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import {
  getFunctions, httpsCallable
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js';

const _functions = getFunctions(undefined, 'us-central1');

// ─────────────────────────────────────────────
// i18n helper（讀取 app.js 的語言設定）
// ─────────────────────────────────────────────
function lang() { return localStorage.getItem('bini_lang') || 'zh'; }
function t(zh, en) { return lang() === 'zh' ? zh : en; }

/**
 * BINI Blooms — 客戶端購物模組
 * shop.js  v3.0.0
 * 功能：商品瀏覽、購物車、結帳流程（超商取貨付款 + 點數折扣）、訂單查詢
 */

// ─────────────────────────────────────────────
// 購物車狀態（存 localStorage，登入後合併）
// ─────────────────────────────────────────────
const CART_KEY = "bini_cart_v3";

const ShopCart = {
  get() {
    try { return JSON.parse(localStorage.getItem(CART_KEY)) || {}; }
    catch { return {}; }
  },
  save(cart) { localStorage.setItem(CART_KEY, JSON.stringify(cart)); },
  add(productId, qty = 1, meta = {}) {
    const cart = this.get();
    if (cart[productId]) {
      cart[productId].qty += qty;
    } else {
      cart[productId] = { qty, ...meta };
    }
    this.save(cart);
    ShopUI.updateCartBadge();
  },
  remove(productId) {
    const cart = this.get();
    delete cart[productId];
    this.save(cart);
    ShopUI.updateCartBadge();
  },
  setQty(productId, qty) {
    const cart = this.get();
    if (qty <= 0) { delete cart[productId]; }
    else { cart[productId] = { ...(cart[productId] || {}), qty }; }
    this.save(cart);
    ShopUI.updateCartBadge();
  },
  clear() { localStorage.removeItem(CART_KEY); ShopUI.updateCartBadge(); },
  count() { return Object.values(this.get()).reduce((s, i) => s + i.qty, 0); },
  toArray() {
    return Object.entries(this.get()).map(([productId, v]) => ({ productId, ...v }));
  },
};

// ─────────────────────────────────────────────
// Firebase Functions 呼叫器
// ─────────────────────────────────────────────
const ShopAPI = {
  async call(fnName, data = {}) {
    const fn = httpsCallable(_functions, fnName);
    const result = await fn(data);
    return result.data;
  },
  async getProducts(category = null, lastDoc = null) {
    const constraints = [
      where("status", "==", "active"),
      orderBy("sortWeight", "desc"),
      limit(24),
    ];
    if (category) constraints.push(where("category", "==", category));
    if (lastDoc)  constraints.push(startAfter(lastDoc));
    return getDocs(query(collection(db, "products"), ...constraints));
  },
  async getProduct(productId) {
    return getDoc(doc(db, "products", productId));
  },
  async getMyOrders(limitCount = 20) {
    const uid = auth.currentUser?.uid;
    if (!uid) return [];
    const q = query(
      collection(db, "orders"),
      where("uid", "==", uid),
      orderBy("createdAt", "desc"),
      limit(limitCount)
    );
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  },
  async getOrder(orderId) {
    const snap = await getDoc(doc(db, "orders", orderId));
    return snap.exists() ? { id: snap.id, ...snap.data() } : null;
  },
};

// ─────────────────────────────────────────────
// UI 渲染工具
// ─────────────────────────────────────────────
const ShopUI = {
  updateCartBadge() {
    const count = ShopCart.count();
    const badges = document.querySelectorAll(".cart-badge");
    badges.forEach(b => {
      b.textContent = count;
      b.style.display = count > 0 ? "flex" : "none";
    });
  },

  // 商品卡片 HTML
  productCard(p) {
    const inCart = ShopCart.get()[p.id];
    const img = p.images?.[0] || "icons/placeholder.png";
    const soldOut = p.stock <= 0 || p.status === "soldout";
    return `
<div class="product-card ${soldOut ? "soldout" : ""}" data-id="${p.id}" onclick="ShopPage.openProductDetail('${p.id}')">
  <div class="product-img-wrap">
    <img src="${img}" alt="${p.name}" loading="lazy" onerror="this.src='icons/placeholder.png'">
    ${soldOut ? '<div class="soldout-overlay">售完補貨中</div>' : ""}
    ${p.stock > 0 && p.stock <= 5 ? `<div class="low-stock-tag">僅剩 ${p.stock} 件</div>` : ""}
  </div>
  <div class="product-info">
    <div class="product-name">${p.name}</div>
    <div class="product-price-row">
      <span class="product-price">NT$ ${p.price.toLocaleString()}</span>
      ${inCart ? `<span class="in-cart-badge"><i class="icon-cart-small"></i>${inCart.qty}</span>` : ""}
    </div>
    ${!soldOut ? `
    <button class="btn-add-cart" onclick="event.stopPropagation();ShopCart.add('${p.id}',1,{name:'${p.name}',price:${p.price},image:'${img}',stock:${p.stock}});ShopUI.toast(t('已加入購物車 🛍️','Added to Cart 🛍️'))">
      ${t('+ 加入購物車','+ Add to Cart')}
    </button>` : `<button class="btn-add-cart disabled" disabled>補貨中</button>`}
  </div>
</div>`;
  },

  // 訂單狀態標籤
  orderStatusBadge(status) {
    const map = {
      pending_shipment:{ label: t("待出貨","Pending Shipment"), cls: "status-warn" },
      pending_payment: { label: t("待付款","Pending Payment"),  cls: "status-warn" },
      paid:            { label: t("已付款","Paid"),             cls: "status-info" },
      processing:      { label: t("備貨中","Processing"),       cls: "status-info" },
      shipped:         { label: t("已出貨","Shipped"),          cls: "status-primary" },
      completed:       { label: t("已完成","Completed"),        cls: "status-success" },
      cancelled:       { label: t("已取消","Cancelled"),        cls: "status-gray" },
      expired:         { label: t("已逾期","Expired"),          cls: "status-gray" },
      logistics_failed:{ label: t("建立失敗","Failed"),         cls: "status-danger" },
    };
    const s = map[status] || { label: status, cls: "status-gray" };
    return `<span class="order-status-badge ${s.cls}">${s.label}</span>`;
  },

  // CVS 類型名稱（僅支援 7-11 和全家）
  cvsName(type) {
    const zh = { FAMI: "全家", UNIMART: "7-11" };
    const en = { FAMI: "FamilyMart", UNIMART: "7-Eleven" };
    const map = lang() === 'zh' ? zh : en;
    return map[type] || type;
  },

  toast(msg, type = "success") {
    const el = document.createElement("div");
    el.className = `shop-toast shop-toast-${type}`;
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => el.classList.add("show"), 10);
    setTimeout(() => { el.classList.remove("show"); setTimeout(() => el.remove(), 300); }, 2500);
  },

  showLoading(show) {
    const el = document.getElementById("shop-loading");
    if (el) el.style.display = show ? "flex" : "none";
  },
};

// ─────────────────────────────────────────────
// 頁面控制器
// ─────────────────────────────────────────────
const ShopPage = {
  currentPage: "shop-list",
  productCache: {},
  lastProductDoc: null,
  currentCategory: null,
  checkoutData: null,   // 暫存結帳驗證結果
  _activePage: "shop-list",  // 追蹤目前 shop 子頁面，供語言切換重新 render

  // 語言切換時重新 render 目前頁面
  rerenderCurrentPage() {
    const page = this._activePage;
    if (page === "shop-list")         { this.init(); }
    else if (page === "shop-cart")    { this.renderCart(); }
    else if (page === "shop-checkout"){ this.startCheckout(); }
    else if (page === "shop-my-orders"){ this.openMyOrders(); }
    // shop-detail / shop-order-result / shop-order-detail 的文字已用 t() 動態產生，不需重新 render
  },

  init() {
    this._activePage = "shop-list";  // 回到商品列表時重設，避免語言切換誤跳到我的訂單
    const si = document.getElementById("shop-search-input"); if (si) si.placeholder = t("搜尋商品…","Search products…");
    ShopUI.updateCartBadge();
    // 必須登入後才能讀取商品
    if (!auth.currentUser) {
      const grid = document.getElementById("shop-product-grid");
      if (grid) grid.innerHTML = '<p class="shop-empty">請先登入以瀏覽商品 🔐</p>';
      return;
    }
    this.renderShopList();
    this.renderCategoryTabs();
  },

  // ── 商品列表頁 ──────────────────────────────
  async renderShopList(reset = true) {
    const container = document.getElementById("shop-product-grid");
    if (!container) return;
    if (reset) {
      container.innerHTML = '<div class="shop-skeleton-grid">' +
        Array(8).fill('<div class="skeleton-card"></div>').join("") + "</div>";
      this.lastProductDoc = null;
    }
    ShopUI.showLoading(true);
    try {
      const snap = await ShopAPI.getProducts(this.currentCategory, this.lastProductDoc);
      if (reset) container.innerHTML = "";
      if (snap.empty && reset) {
        container.innerHTML = `<p class="shop-empty">${t("目前沒有商品","No products available")}</p>`;
        return;
      }
      snap.docs.forEach(doc => {
        const p = { id: doc.id, ...doc.data() };
        this.productCache[p.id] = p;
        container.insertAdjacentHTML("beforeend", ShopUI.productCard(p));
      });
      this.lastProductDoc = snap.docs[snap.docs.length - 1];

      // 載入更多按鈕
      const loadMoreBtn = document.getElementById("shop-load-more");
      if (loadMoreBtn) {
        loadMoreBtn.style.display = snap.docs.length < 24 ? "none" : "block";
      }
    } catch (e) {
      container.innerHTML = `<p class="shop-error">載入失敗：${e.message}</p>`;
    } finally {
      ShopUI.showLoading(false);
    }
  },

  async renderCategoryTabs() {
    const snap = await getDocs(query(collection(db, "products"), where("status", "==", "active")));
    const cats = [...new Set(snap.docs.map(d => d.data().category).filter(Boolean))].sort();
    const bar = document.getElementById("shop-category-bar");
    if (!bar) return;
    bar.innerHTML = `
<button class="cat-tab ${!this.currentCategory ? "active" : ""}" onclick="ShopPage.filterCategory(null)">${t("全部","All")}</button>
${cats.map(c => `<button class="cat-tab ${this.currentCategory===c?"active":""}" onclick="ShopPage.filterCategory('${c}')">${c}</button>`).join("")}`;
  },

  filterCategory(category) {
    this.currentCategory = category;
    document.querySelectorAll(".cat-tab").forEach(b => b.classList.remove("active"));
    event.target.classList.add("active");
    this.renderShopList(true);
  },

  // ── 商品詳細頁 ──────────────────────────────
  async openProductDetail(productId) {
    window.switchPage && window.switchPage("shop-detail", document.getElementById("bnav-shop") || document.querySelector(".bnav-btn"));
    this._activePage = "shop-detail";   // app.js 的 showPage
    const container = document.getElementById("shop-detail-content");
    container.innerHTML = '<div class="detail-skeleton"></div>';

    let p = this.productCache[productId];
    if (!p) {
      const doc = await ShopAPI.getProduct(productId);
      p = doc.exists ? { id: doc.id, ...doc.data() } : null;
    }
    if (!p) { container.innerHTML = "<p>商品不存在</p>"; return; }

    const inCart = ShopCart.get()[productId];
    const soldOut = p.stock <= 0 || p.status === "soldout";

    container.innerHTML = `
<div class="detail-imgs">
  <div class="detail-img-main">
    <img id="detail-main-img" src="${p.images?.[0] || "icons/placeholder.png"}" alt="${p.name}">
  </div>
  ${p.images?.length > 1 ? `
  <div class="detail-img-thumbs">
    ${p.images.map((img, i) => `
    <img src="${img}" class="thumb${i===0?" active":""}" onclick="document.getElementById('detail-main-img').src='${img}';this.parentElement.querySelectorAll('img').forEach(x=>x.classList.remove('active'));this.classList.add('active')">`).join("")}
  </div>` : ""}
</div>
<div class="detail-body">
  <div class="detail-category">${p.category || ""}</div>
  <h2 class="detail-name">${p.name}</h2>
  <div class="detail-price">NT$ ${p.price.toLocaleString()}</div>
  <div class="detail-stock ${p.stock<=5&&p.stock>0?"low":""}">${
    soldOut ? "補貨中" : p.stock <= 5 ? `僅剩 ${p.stock} 件` : `庫存充足`
  }</div>
  ${p.description ? `<div class="detail-desc">${p.description.replace(/\n/g,"<br>")}</div>` : ""}
  <div class="detail-qty-row">
    <label>數量</label>
    <div class="qty-ctrl">
      <button onclick="ShopPage.changeDetailQty(-1)">−</button>
      <input type="number" id="detail-qty" value="${inCart?.qty || 1}" min="1" max="${p.stock}">
      <button onclick="ShopPage.changeDetailQty(1)">+</button>
    </div>
  </div>
  ${soldOut ? `
  <button class="btn-primary w-full" disabled>補貨中</button>` : `
  <button class="btn-primary w-full" onclick="ShopPage.addToCartFromDetail('${productId}',${p.price},'${p.name.replace(/'/g,"\\'")}','${p.images?.[0]||""}',${p.stock})">
    🛍️ ${t('加入購物車','Add to Cart')}
  </button>
  <button class="btn-outline w-full mt-8" onclick="ShopPage.buyNow('${productId}',${p.price},'${p.name.replace(/'/g,"\\'")}','${p.images?.[0]||""}',${p.stock})">
    立即購買
  </button>`}
</div>`;
  },

  changeDetailQty(delta) {
    const input = document.getElementById("detail-qty");
    const max = Number(input.max) || 99;
    input.value = Math.max(1, Math.min(max, Number(input.value) + delta));
  },

  addToCartFromDetail(productId, price, name, image, stock) {
    const qty = Number(document.getElementById("detail-qty")?.value) || 1;
    const cart = ShopCart.get();
    const existQty = cart[productId]?.qty || 0;
    if (existQty + qty > stock) {
      ShopUI.toast("超出庫存數量", "error"); return;
    }
    ShopCart.add(productId, qty, { name, price, image, stock });
    ShopUI.toast(t(`已加入購物車 (${qty} 件) 🛍️`,`Added to Cart (${qty}) 🛍️`));
  },

  buyNow(productId, price, name, image, stock) {
    ShopCart.add(productId, 1, { name, price, image, stock });
    this.openCart();
  },

  // ── 購物車頁 ──────────────────────────────
  openCart() {
    window.switchPage && window.switchPage("shop-cart", document.getElementById("bnav-shop") || document.querySelector(".bnav-btn"));
    this._activePage = "shop-cart";
    this.renderCart();
  },

  renderCart() {
    const container = document.getElementById("cart-items");
    const cart = ShopCart.get();
    const items = Object.entries(cart);

    if (!items.length) {
      container.innerHTML = `<div class="cart-empty"><p>${t("購物車是空的 🛒","Cart is empty 🛒")}</p><button class="btn-outline" onclick="window.switchPage&&window.switchPage('shop',document.getElementById('bnav-shop'))">${t("去逛逛","Browse")}</button></div>`;
      document.getElementById("cart-summary")?.style && (document.getElementById("cart-summary").style.display = "none");
      return;
    }

    let subtotal = 0;
    container.innerHTML = items.map(([productId, item]) => {
      const total = item.price * item.qty;
      subtotal += total;
      return `
<div class="cart-item" id="cart-item-${productId}">
  <img src="${item.image || "icons/placeholder.png"}" alt="${item.name}" onerror="this.src='icons/placeholder.png'">
  <div class="cart-item-info">
    <div class="cart-item-name">${item.name}</div>
    <div class="cart-item-price">NT$ ${item.price.toLocaleString()}</div>
    <div class="cart-item-qty">
      <button onclick="ShopPage.cartQtyChange('${productId}', -1)">−</button>
      <span>${item.qty}</span>
      <button onclick="ShopPage.cartQtyChange('${productId}', 1)">+</button>
    </div>
  </div>
  <div class="cart-item-right">
    <div class="cart-item-total">NT$ ${total.toLocaleString()}</div>
    <button class="btn-remove" onclick="ShopCart.remove('${productId}');ShopPage.renderCart()">✕</button>
  </div>
</div>`;
    }).join("");

    const summary = document.getElementById("cart-summary");
    if (summary) {
      summary.style.display = "block";
      summary.innerHTML = `
<div class="cart-subtotal">
  <span>${t("小計","Subtotal")}（${ShopCart.count()} ${t("件","items")}）</span>
  <span>NT$ ${subtotal.toLocaleString()}</span>
</div>
<button class="btn-primary w-full" onclick="ShopPage.startCheckout()">
  ${t("前往結帳 →","Checkout →")}
</button>`;
    }
  },

  cartQtyChange(productId, delta) {
    const cart = ShopCart.get();
    const item = cart[productId];
    if (!item) return;
    const newQty = item.qty + delta;
    if (newQty <= 0) {
      if (confirm(`確定要移除「${item.name}」？`)) ShopCart.remove(productId);
    } else {
      ShopCart.setQty(productId, newQty);
    }
    this.renderCart();
  },

  // ── 結帳流程 ──────────────────────────────
  async startCheckout() {
    const user = auth.currentUser;
    if (!user) { ShopUI.toast("請先登入", "error"); window.switchPage && window.switchPage("home", document.querySelector(".bnav-btn")); return; }

    const items = ShopCart.toArray();
    if (!items.length) return;

    window.switchPage && window.switchPage("shop-checkout", document.getElementById("bnav-shop") || document.querySelector(".bnav-btn"));
    this._activePage = "shop-checkout";
    const container = document.getElementById("checkout-content");
    container.innerHTML = `<div class="loading-spinner">${t('驗證中…','Validating…')}</div>`;

    try {
      const result = await ShopAPI.call("validateCart", { items });
      this.checkoutData = result;

      if (!result.allOk) {
        const failedItems = result.results.filter(r => !r.ok);
        container.innerHTML = `
<div class="checkout-error-box">
  <h3>⚠️ 部分商品無法結帳</h3>
  ${failedItems.map(r => `<p>・${r.reason}</p>`).join("")}
  <button class="btn-outline" onclick="window.switchPage&&window.switchPage('shop-cart',document.getElementById('bnav-shop'))">${t('返回購物車','Back to Cart')}</button>
</div>`;
        return;
      }

      this.renderCheckoutForm(result);
    } catch (e) {
      container.innerHTML = `<p class="shop-error">${t('驗證失敗','Validation failed')}：${e.message}</p>`;
    }
  },

  renderCheckoutForm(validData) {
    const container = document.getElementById("checkout-content");
    const { subtotal, pointsBalance, maxPointsDiscount, results,
            pointMinOrder = 300, freeShippingThreshold = 0 } = validData;
    const cvsType = "FAMI"; // 預設全家，切換超商後由 radio 控制

    container.innerHTML = `
<!-- Step 1: 訂單明細 -->
<div class="checkout-section">
  <h3 class="checkout-section-title">🛍️ ${t('訂單明細','Order Items')}</h3>
  <div class="checkout-items">
    ${results.map(r => {
      const cartItem = ShopCart.get()[r.productId];
      return `
    <div class="checkout-item">
      <img src="${r.image || "icons/placeholder.png"}" alt="${r.name}">
      <span class="checkout-item-name">${r.name} × ${cartItem?.qty || 1}</span>
      <span class="checkout-item-price">NT$ ${(r.price * (cartItem?.qty||1)).toLocaleString()}</span>
    </div>`;
    }).join("")}
  </div>
</div>

<!-- Step 2: 取貨超商選擇 -->
<div class="checkout-section">
  <h3 class="checkout-section-title">🏪 ${t("選擇取貨超商","Select CVS Store")}</h3>
  <div class="cvs-type-selector">
    ${["FAMI","UNIMART"].map(type => `
    <label class="cvs-type-option">
      <input type="radio" name="cvsType" value="${type}" ${type==="FAMI"?"checked":""}>
      <span>${ShopUI.cvsName(type)}</span>
    </label>`).join("")}
  </div>
  <button class="btn-outline w-full mt-8" id="btn-select-store" onclick="ShopPage.openCvsMap()">
    📍 ${t("選擇門市","Select Store")}
  </button>
  <div id="selected-store-info" class="selected-store-info" style="display:none"></div>
</div>

<!-- Step 3: 取件人資料 -->
<div class="checkout-section">
  <h3 class="checkout-section-title">👤 ${t("取件人資料","Recipient Info")}</h3>
  <div class="form-group">
    <label>${t("取件人姓名","Recipient Name")} <span class="required">*</span></label>
    <input type="text" id="cvs-name" placeholder="${t("請輸入真實姓名（限10字）","Full name (max 10 chars)")}" maxlength="10">
  </div>
  <div class="form-group">
    <label>${t("聯絡電話","Phone")} <span class="required">*</span></label>
    <input type="tel" id="cvs-phone" placeholder="0912345678" maxlength="10">
  </div>
</div>

<!-- Step 4: 點數折扣 -->
${maxPointsDiscount > 0 ? `
<div class="checkout-section">
  <h3 class="checkout-section-title">⭐ ${t("點數折扣","Points Discount")}</h3>
  <div class="points-info">
    <span>${t("您目前有","You have")} <strong>${pointsBalance}</strong> ${t("點（最多可折抵","pts (max disc.")} NT$ ${maxPointsDiscount}）</span>
  </div>
  <div class="points-input-row">
    <label>${t("使用點數：","Use Points:")}</label>
    <input type="number" id="points-to-use" value="0" min="0" max="${maxPointsDiscount}"
      oninput="ShopPage.updatePointsPreview(${subtotal})">
    <button onclick="document.getElementById('points-to-use').value=${maxPointsDiscount};ShopPage.updatePointsPreview(${subtotal})">${t("全部使用","Use All")}</button>
  </div>
  <div id="points-preview" class="points-preview"></div>
</div>` : `
<div class="checkout-section">
  <h3 class="checkout-section-title">⭐ ${t("點數折扣","Points Discount")}</h3>
  ${subtotal < pointMinOrder ? `<p class="hint-text">${t(`消費滿 NT$${pointMinOrder} 才可使用點數折扣`,`Min. NT$${pointMinOrder} order required to use points`)}</p>` :
    `<p class="hint-text">${t("點數餘額不足，無法使用折扣","Insufficient points balance")}</p>`}
</div>`}

<!-- 金額摘要 -->
<div class="checkout-summary" id="checkout-summary">
  <div class="summary-row"><span>${t("商品小計","Subtotal")}</span><span>NT$ ${subtotal.toLocaleString()}</span></div>
  <div class="summary-row" id="summary-shipping-row">
    <span>${t("運費","Shipping")}</span>
    <span id="summary-shipping">NT$ ${cvsType === "UNIMART" ? "65" : "75"}</span>
  </div>
  ${freeShippingThreshold > 0 ? `
  <div id="summary-free-shipping-hint" style="font-size:12px;color:${subtotal >= freeShippingThreshold ? '#2d8a4e' : '#888'};text-align:right;margin-top:-6px;margin-bottom:4px">
    ${subtotal >= freeShippingThreshold
      ? `🎉 ${t("已達免運費！","Free shipping applied!")}`
      : `${t(`再消費 NT$${freeShippingThreshold - subtotal} 可免運費`,`Spend NT$${freeShippingThreshold - subtotal} more for free shipping`)}`}
  </div>` : ""}
  <div class="summary-row" id="summary-discount-row" style="display:none">
    <span>${t("點數折抵","Points Disc.")}</span><span id="summary-discount" class="discount-text">- NT$ 0</span>
  </div>
  <div class="summary-row summary-total">
    <span>${t("應付金額","Total Due")}</span><span id="summary-total">NT$ ${(subtotal + (freeShippingThreshold > 0 && subtotal >= freeShippingThreshold ? 0 : (cvsType === "UNIMART" ? 65 : 75))).toLocaleString()}</span>
  </div>
  <p class="checkout-note">📦 ${t("下單後我們將出貨至您選擇的超商，商品到店後請攜帶身分證件取貨並付款（貨到付款）。","We'll ship to your selected CVS store. Please bring your ID to pick up and pay upon delivery.")}</p>
</div>

<button class="btn-primary w-full btn-submit-order" id="btn-place-order" onclick="ShopPage.placeOrder(${subtotal})">
  ${t("確認下單","Place Order")}
</button>`;

    // 初始化門市資料
    this._selectedStore = null;
  },

  updatePointsPreview(subtotal) {
    const cvsType  = document.querySelector("input[name='cvsType']:checked")?.value || "FAMI";
    const freeShippingThreshold = this.checkoutData?.freeShippingThreshold || 0;
    const baseShipping = cvsType === "UNIMART" ? 65 : 75;
    const shipping = freeShippingThreshold > 0 && subtotal >= freeShippingThreshold ? 0 : baseShipping;
    const pts      = Number(document.getElementById("points-to-use")?.value) || 0;
    const discount = Math.min(pts, this.checkoutData?.maxPointsDiscount || 0);
    const total    = subtotal + shipping - discount;

    const preview = document.getElementById("points-preview");
    if (preview) preview.innerHTML = discount > 0
      ? `${t("使用","Use")} ${discount} ${t("點，折抵","pts = -")} NT$ ${discount}` : "";

    const discountRow = document.getElementById("summary-discount-row");
    if (discountRow) discountRow.style.display = discount > 0 ? "flex" : "none";
    const discountEl = document.getElementById("summary-discount");
    if (discountEl) discountEl.textContent = `- NT$ ${discount.toLocaleString()}`;

    const shippingEl = document.getElementById("summary-shipping");
    if (shippingEl) shippingEl.textContent = shipping === 0 ? `${t("免運費","Free")} 🎉` : `NT$ ${shipping}`;

    const totalEl = document.getElementById("summary-total");
    if (totalEl) totalEl.textContent = `NT$ ${Math.max(1, total).toLocaleString()}`;
  },

  // 選擇門市：輸入店號
  openCvsMap() {
    const cvsType = document.querySelector("input[name='cvsType']:checked")?.value || "FAMI";
    const info = document.getElementById("selected-store-info");
    if (!info) return;

    info.style.display = "block";
    info.innerHTML = `
<div class="store-manual-input">
  <p style="font-size:13px;color:#666;margin-bottom:8px;">
    🧾 ${t("請輸入門市店號（發票上的數字）","Enter store number (found on your receipt)")}
  </p>
  <div style="display:flex;gap:8px;align-items:center">
    <input type="text" id="manual-store-id" inputmode="numeric" maxlength="7"
      placeholder="${cvsType === "UNIMART" ? "e.g. 243351" : "e.g. 024249"}"
      style="flex:1;padding:10px;border:1px solid #ddd;border-radius:8px;font-size:15px;letter-spacing:2px"
      onkeydown="if(event.key==='Enter')ShopPage.confirmStoreId()">
    <button onclick="ShopPage.confirmStoreId()"
      style="padding:10px 16px;background:var(--color-primary,#6b1e2e);color:#fff;border:none;border-radius:8px;font-size:14px;cursor:pointer;white-space:nowrap">
      ✅ ${t("確認","Confirm")}
    </button>
  </div>
</div>`;
    document.querySelectorAll("input[name='cvsType']").forEach(r => {
      r.onchange = () => {
        this.openCvsMap();
        // 更新運費和總金額
        if (this.checkoutData?.subtotal) this.updatePointsPreview(this.checkoutData.subtotal);
      };
    });
    setTimeout(() => document.getElementById("manual-store-id")?.focus(), 100);
  },

  // 確認店號
  confirmStoreId() {
    const cvsType = document.querySelector("input[name='cvsType']:checked")?.value || "FAMI";
    const storeId = document.getElementById("manual-store-id")?.value?.trim();
    const btn     = document.getElementById("btn-select-store");
    if (!storeId || !/^\d{4,7}$/.test(storeId)) {
      ShopUI.toast(t("請輸入正確的店號（4-7碼數字）","Please enter a valid store number (4-7 digits)"), "error");
      return;
    }
    const prefix    = cvsType === "UNIMART" ? "7-11" : "全家";
    this._selectedStore = { CVSStoreID: storeId, CVSStoreName: `${prefix} #${storeId}`, CVSAddress: "", cvsType };
    this._showSelectedStore(this._selectedStore, btn);
  },

  // 顯示已選門市資訊
  _showSelectedStore(storeData, btn) {
    const info = document.getElementById("selected-store-info");
    if (info) {
      info.style.display = "block";
      info.innerHTML = `
<div class="store-selected">
  <i class="icon-check-circle"></i>
  <div>
    <strong>${storeData.CVSStoreName}</strong><br>
    <small>${storeData.CVSAddress}</small>
  </div>
</div>`;
    }
    if (btn) btn.textContent = t("✅ 已選擇門市（點擊重新選擇）","✅ Store Selected (click to change)");
    ShopUI.toast(t(`已選擇：${storeData.CVSStoreName}`, `Selected: ${storeData.CVSStoreName}`));
  },

  async placeOrder(subtotal) {
    // 驗證表單
    const name = document.getElementById("cvs-name")?.value?.trim();
    const phone = document.getElementById("cvs-phone")?.value?.trim();
    const cvsType = document.querySelector("input[name='cvsType']:checked")?.value || "FAMI";

    if (!name) { ShopUI.toast(t("請輸入取件人姓名","Please enter recipient name"), "error"); return; }
    if (!phone || !/^09\d{8}$/.test(phone)) { ShopUI.toast(t("請輸入正確的手機號碼","Please enter a valid phone number"), "error"); return; }
    if (!this._selectedStore) { ShopUI.toast(t("請選擇取貨門市","Please select a CVS store"), "error"); return; }

    const pointsToUse = Number(document.getElementById("points-to-use")?.value) || 0;
    const shippingFee = cvsType === "UNIMART" ? 65 : 75;

    const btn = document.getElementById("btn-place-order");
    btn.disabled = true;
    btn.textContent = "建立訂單中…";

    try {
      const items = ShopCart.toArray();
      const cvsData = {
        name, phone, cvsType,
        storeId:      this._selectedStore.CVSStoreID || this._selectedStore.storeId,
        storeName:    this._selectedStore.CVSStoreName || this._selectedStore.storeName,
        storeAddress: this._selectedStore.CVSAddress || this._selectedStore.storeAddress,
      };

      // 統一呼叫 createOrder（不再有 ECPay 物流，直接存 Firestore）
      const result = await ShopAPI.call("createOrder", { items, pointsToUse, cvs: cvsData, shippingFee });

      if (!result.success) throw new Error(result.message || "下單失敗");

      // 清空購物車
      ShopCart.clear();

      // 跳至訂單完成頁
      window.switchPage && window.switchPage("shop-order-result", document.getElementById("bnav-shop") || document.querySelector(".bnav-btn"));
      this._activePage = "shop-order-result";
      this.renderOrderResult(
        result.orderId,
        result.totalAmount,
        result.pointsDiscount,
        {
          storeName:    result.storeName    || cvsData.storeName,
          storeAddress: result.storeAddress || cvsData.storeAddress,
          shippingFee:  result.shippingFee,
        }
      );

    } catch (e) {
      ShopUI.toast(`下單失敗：${e.message}`, "error");
      btn.disabled = false;
      btn.textContent = (typeof t === "function") ? t("確認下單","Place Order") : "確認下單";
    }
  },

  // ── 訂單完成頁 ──────────────────────────────
  renderOrderResult(orderId, totalAmount, pointsDiscount, extra = {}) {
    const container = document.getElementById("order-result-content");
    if (!container) return;
    const { storeName, storeAddress, shippingFee } = extra;
    container.innerHTML = `
<div class="order-result-success">
  <div class="result-icon">🎉</div>
  <h2>${t("訂單建立成功！","Order Confirmed!")}</h2>
  <div class="order-result-box">
    <div class="result-row"><span>${t("訂單編號","Order ID")}</span><strong>${orderId}</strong></div>
    ${pointsDiscount > 0 ? `<div class="result-row"><span>${t("點數折抵","Points Disc.")}</span><strong>- NT$ ${pointsDiscount.toLocaleString()}</strong></div>` : ""}
    ${shippingFee ? `<div class="result-row"><span>${t("運費","Shipping")}</span><span>NT$ ${shippingFee}</span></div>` : ""}
    <div class="result-row"><span>${t("應付金額","Amount Due")}</span><strong class="total-amount">NT$ ${totalAmount.toLocaleString()}</strong></div>
  </div>
  <div class="result-notice" style="text-align:left">
    ${storeName ? `<p>🏪 ${t("取貨門市","Pickup Store")}：<strong>${storeName}</strong></p>` : ""}
    ${storeAddress ? `<p>📍 ${storeAddress}</p>` : ""}
    <p>💳 ${t("請攜帶身分證件至超商取貨並付款","Please bring your ID to the store to pickup and pay")}</p>
    <p>⏰ ${t("請於商品送達後 3 天內取貨，逾期商品將退回。","Please pick up within 3 days of arrival, or the item will be returned.")}</p>
  </div>
  <div class="result-actions">
    <button class="btn-primary" onclick="ShopPage.openMyOrders()">${t("查看我的訂單","My Orders")}</button>
    <button class="btn-outline" onclick="window.switchPage&&window.switchPage('shop',document.getElementById('bnav-shop'))">${t("繼續購物","Continue Shopping")}</button>
  </div>
</div>`;
  },

  // ── 我的訂單頁 ──────────────────────────────
  async openMyOrders() {
    window.switchPage && window.switchPage("shop-my-orders", document.getElementById("bnav-shop") || document.querySelector(".bnav-btn"));
    this._activePage = "shop-my-orders";
    const container = document.getElementById("my-orders-list");
    container.innerHTML = window.skeletonList ? window.skeletonList(3) : '<div class="loading-spinner">載入中…</div>';
    try {
      const orders = await ShopAPI.getMyOrders(30);
      if (!orders.length) {
        container.innerHTML = `<div class="order-empty"><p>${t("還沒有訂單","No orders yet")}</p><button class="btn-outline" onclick="window.switchPage&&window.switchPage('shop',document.getElementById('bnav-shop'))">${t("去購物","Shop Now")}</button></div>`;
        return;
      }
      container.innerHTML = orders.map(o => {
        const date = o.createdAt?.toDate?.()?.toLocaleDateString("zh-TW") || "";
        const itemSummary = o.items?.slice(0, 2).map(i => i.name).join("、") +
          (o.items?.length > 2 ? ` 等 ${o.items.length} 件` : "");
        return `
<div class="order-card" onclick="ShopPage.openOrderDetail('${o.id}')">
  <div class="order-card-header">
    <span class="order-id">${o.orderId}</span>
    ${ShopUI.orderStatusBadge(o.status)}
  </div>
  <div class="order-card-items">${itemSummary}</div>
  <div class="order-card-footer">
    <span class="order-date">${date}</span>
    <span class="order-amount">NT$ ${o.totalAmount?.toLocaleString()}</span>
  </div>
</div>`;
      }).join("");
    } catch (e) {
      container.innerHTML = `<p class="shop-error">載入失敗：${e.message}</p>`;
    }
  },

  async openOrderDetail(orderId) {
    window.switchPage && window.switchPage("shop-order-detail", document.getElementById("bnav-shop") || document.querySelector(".bnav-btn"));
    this._activePage = "shop-order-detail";
    const container = document.getElementById("order-detail-content");
    container.innerHTML = window.skeletonList ? window.skeletonList(2) : '<div class="loading-spinner">載入中…</div>';
    const order = await ShopAPI.getOrder(orderId);
    if (!order) { container.innerHTML = "<p>訂單不存在</p>"; return; }

    const date = order.createdAt?.toDate?.()?.toLocaleString("zh-TW") || "";
    const shippedAt  = order.shippedAt?.toDate?.()?.toLocaleString("zh-TW") || "";
    const completedAt= order.completedAt?.toDate?.()?.toLocaleString("zh-TW") || "";
    container.innerHTML = `
<div class="order-detail">
  <div class="detail-header">
    <h3>${t("訂單詳情","Order Detail")}</h3>
    ${ShopUI.orderStatusBadge(order.status)}
  </div>

  ${order.status === "shipped" ? `
  <div style="background:#f0faf4;border:1px solid #52c07a;border-radius:10px;padding:14px;margin-bottom:12px;text-align:center">
    <div style="font-size:28px">🚚</div>
    <div style="font-weight:700;color:#2d8a4e;margin:4px 0">${t("商品已出貨！","Your order has been shipped!")}</div>
    ${order.trackingNumber ? `<div style="font-size:13px;color:#555">${t("貨運單號","Tracking No.")}：<strong>${order.trackingNumber}</strong></div>` : ""}
    <div style="font-size:12px;color:#888;margin-top:4px">${t("請至取貨超商憑身分證領取並付款","Please pick up at your selected CVS store with ID")}</div>
  </div>` : ""}

  ${order.status === "pending_shipment" ? `
  <div style="background:#fff8e1;border:1px solid #ffc107;border-radius:10px;padding:12px;margin-bottom:12px;text-align:center">
    <div style="font-size:22px">📦</div>
    <div style="font-weight:700;color:#856404;margin:4px 0">${t("訂單已確認，等待出貨中","Order confirmed, preparing shipment")}</div>
    <div style="font-size:12px;color:#888">${t("店家備貨後將通知您","You'll be notified once shipped")}</div>
  </div>` : ""}

  <div class="detail-section">
    <div class="detail-row"><span>${t("訂單編號","Order ID")}</span><strong style="font-size:12px">${order.orderId}</strong></div>
    <div class="detail-row"><span>${t("建立時間","Created")}</span><span>${date}</span></div>
    ${shippedAt  ? `<div class="detail-row"><span>${t("出貨時間","Shipped At")}</span><span>${shippedAt}</span></div>` : ""}
    ${completedAt? `<div class="detail-row"><span>${t("完成時間","Completed At")}</span><span>${completedAt}</span></div>` : ""}
    ${order.trackingNumber ? `<div class="detail-row"><span>${t("貨運單號","Tracking No.")}</span><strong style="color:#2d8a4e">${order.trackingNumber}</strong></div>` : ""}
    ${order.note ? `<div class="detail-row"><span>${t("備註","Note")}</span><span>${order.note}</span></div>` : ""}
  </div>
  <div class="detail-section">
    <h4>${t("商品明細","Order Items")}</h4>
    ${order.items?.map(i => `
    <div class="detail-item">
      <img src="${i.image || "icons/placeholder.png"}" alt="${i.name}">
      <div style="flex:1"><div>${i.name} × ${i.qty}</div>${i.sku ? `<div style="font-size:11px;color:#aaa">SKU: ${i.sku}</div>` : ""}</div>
      <span>NT$ ${(i.price * i.qty).toLocaleString()}</span>
    </div>`).join("")}
  </div>
  <div class="detail-section">
    <h4>${t("取貨資訊","Pickup Info")}</h4>
    <div class="detail-row"><span>${t("超商","CVS")}</span><span>${ShopUI.cvsName(order.cvs?.cvsType)} ${order.cvs?.storeName}</span></div>
    ${order.cvs?.storeAddress ? `<div class="detail-row"><span>${t("地址","Address")}</span><span>${order.cvs.storeAddress}</span></div>` : ""}
    <div class="detail-row"><span>${t("取件人","Recipient")}</span><span>${order.cvs?.name}</span></div>
    <div class="detail-row"><span>${t("聯絡電話","Phone")}</span><span>${order.cvs?.phone}</span></div>
  </div>
  <div class="detail-section summary-section">
    <div class="detail-row"><span>${t("商品小計","Subtotal")}</span><span>NT$ ${order.subtotal?.toLocaleString()}</span></div>
    ${order.shippingFee ? `<div class="detail-row"><span>${t("運費","Shipping")}</span><span>NT$ ${order.shippingFee}</span></div>` : ""}
    ${order.pointsDiscount > 0 ? `<div class="detail-row discount"><span>${t("點數折抵","Pts Disc.")} (${order.pointsUsed} pts)</span><span>- NT$ ${order.pointsDiscount?.toLocaleString()}</span></div>` : ""}
    <div class="detail-row total"><span>${t("應付金額","Amount Due")}</span><strong>NT$ ${order.totalAmount?.toLocaleString()}</strong></div>
  </div>
  <div style="padding:0 0 16px">
    <button class="btn-outline w-full" onclick="ShopPage.openMyOrders()">← ${t("返回訂單列表","Back to Orders")}</button>
  </div>
</div>`;
  },
};

// ─────────────────────────────────────────────
// 搜尋功能
// ─────────────────────────────────────────────
const ShopSearch = {
  async search(keyword) {
    if (!keyword.trim()) return ShopPage.renderShopList();
    const snap = await getDocs(query(
      collection(db, "products"),
      where("status", "==", "active"),
      orderBy("name"),
      limit(30)
    ));
    const container = document.getElementById("shop-product-grid");
    if (!container) return;
    if (snap.empty) { container.innerHTML = `<p class="shop-empty">找不到「${keyword}」相關商品</p>`; return; }
    container.innerHTML = snap.docs.map(doc => ShopUI.productCard({ id: doc.id, ...doc.data() })).join("");
  },
};

// ─────────────────────────────────────────────
// 全域掛載，供 HTML onclick 使用
// ─────────────────────────────────────────────
window.ShopCart   = ShopCart;
window.ShopPage   = ShopPage;
window.ShopSearch = ShopSearch;
window.ShopUI     = ShopUI;

// 通知 app.js：shop 模組已就緒
window.dispatchEvent(new CustomEvent('shopModuleReady'));

// 如果目前已在購物頁，立即初始化
const _shopPage = document.getElementById('page-shop');
if (_shopPage && _shopPage.classList.contains('active')) {
  ShopPage.init();
}
