const $ = sel => document.querySelector(sel);
const $$ = sel => document.querySelectorAll(sel);

const form = $("#produce-form");
const photoInput = $("#photos");
const dropzone = $("#dropzone");
const preview = $("#photo-preview");
const submitBtn = $("#submit-btn");
const logEl = $("#log");

let currentJobId = null;
let currentScript = null;
let currentVideos = null;

// 從後端傳來的 Phase label → 穩定 key（不受 UI 語言影響）
const PHASE_KEY = {
  "下載連結": "download",
  "Phase 1：腳本": "phase1",
  "Phase 2：旁白": "phase2",
  "Phase 3：影片": "phase3",
};

// ── 照片拖曳 / 預覽 ─────────────────────────────────────
$("#pick-photos").addEventListener("click", () => photoInput.click());
dropzone.addEventListener("click", e => { if (e.target === dropzone) photoInput.click(); });
["dragover", "dragenter"].forEach(ev =>
  dropzone.addEventListener(ev, e => { e.preventDefault(); dropzone.classList.add("dragover"); })
);
["dragleave", "drop"].forEach(ev =>
  dropzone.addEventListener(ev, e => { e.preventDefault(); dropzone.classList.remove("dragover"); })
);
dropzone.addEventListener("drop", e => {
  const dt = new DataTransfer();
  [...e.dataTransfer.files].filter(f => f.type.startsWith("image/")).forEach(f => dt.items.add(f));
  photoInput.files = dt.files;
  renderPreview();
});
photoInput.addEventListener("change", renderPreview);

function renderPreview() {
  preview.innerHTML = "";
  [...photoInput.files].forEach(f => {
    const isVid = f.type.startsWith("video/");
    const node = document.createElement(isVid ? "video" : "img");
    node.src = URL.createObjectURL(f);
    node.title = f.name;
    if (isVid) {
      node.muted = true;
      node.playsInline = true;
      node.preload = "metadata";
    }
    preview.appendChild(node);
  });
}

// ── 提交 ──────────────────────────────────────────────
form.addEventListener("submit", async e => {
  e.preventDefault();
  const urlsField = form.elements["urls"];
  const hasUrls = urlsField && urlsField.value.trim().length > 0;
  if (photoInput.files.length === 0 && !hasUrls) return alert(t("err_no_photo"));

  const fd = new FormData(form);
  submitBtn.disabled = true;
  submitBtn.textContent = t("submit_uploading");

  try {
    const res = await fetch("/api/produce", { method: "POST", body: fd });
    const raw = await res.text();
    let json;
    try { json = JSON.parse(raw); }
    catch { throw new Error(`伺服器回應非 JSON (HTTP ${res.status})：${raw.slice(0, 200)}`); }
    if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
    currentJobId = json.jobId;
    $("#form-section").hidden = true;
    $("#progress-section").hidden = false;
    connectStream(currentJobId);
  } catch (err) {
    alert(t("err_prefix") + err.message);
    submitBtn.disabled = false;
    submitBtn.textContent = t("submit");
  }
});

// ── SSE：即時進度 ────────────────────────────────────
function connectStream(jobId) {
  const es = new EventSource(`/api/jobs/${jobId}/stream`);
  es.onmessage = e => handleEvent(JSON.parse(e.data));
  es.onerror = () => { /* 自動重連 */ };
}

function appendLog(line) {
  logEl.textContent += line + "\n";
  logEl.scrollTop = logEl.scrollHeight;
}

function handleEvent(ev) {
  if (ev.type === "log") {
    appendLog(ev.data);
  } else if (ev.type === "phase") {
    const key = PHASE_KEY[ev.data.label] || ev.data.label;
    const el = [...$$(".phase")].find(p => p.dataset.phase === key);
    if (!el) return;
    el.hidden = false;
    el.classList.remove("running", "done", "error");
    if (ev.data.status === "start") el.classList.add("running");
    if (ev.data.status === "done") el.classList.add("done");
    if (ev.data.status === "error") el.classList.add("error");
  } else if (ev.type === "review") {
    showReview(ev.data.script);
  } else if (ev.type === "done") {
    showDone(ev.data.videos);
  } else if (ev.type === "error") {
    appendLog("❌ " + ev.data.message);
    $("#progress-actions").hidden = false;
    // 同時把審稿/完成區域藏起來，免得殘留
    $("#review-section").hidden = true;
  }
}

$("#back-btn").addEventListener("click", () => location.reload());

// ── 審稿閘門 ─────────────────────────────────────────
function showReview(scriptObj) {
  currentScript = scriptObj;
  $("#review-section").hidden = false;
  $("#review-section").scrollIntoView({ behavior: "smooth" });
  renderReviewPreview(scriptObj);
  $("#review-json").value = JSON.stringify(scriptObj, null, 2);
}

function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") e.className = v;
    else if (k === "contentEditable") e.contentEditable = v;
    else if (k.startsWith("data-")) e.setAttribute(k, v);
    else e[k] = v;
  }
  for (const c of children) e.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
  return e;
}

function editableSpan(text, onUpdate) {
  const s = el("span", { class: "editable", contentEditable: "true", spellcheck: false }, text || "");
  s.addEventListener("blur", () => onUpdate(s.textContent.trim()));
  return s;
}

function renderReviewPreview(s) {
  const wrap = $("#review-preview");
  wrap.innerHTML = "";
  wrap.appendChild(el("p", {}, t("summary_prefix") + (s.product_summary || "")));

  for (const [lang, labelKey] of [["en", "lbl_english"], ["tl", "lbl_tagalog"]]) {
    const sc = s.scripts?.[lang];
    if (!sc) continue;
    wrap.appendChild(el("h4", {}, t(labelKey)));
    const hookSpan = editableSpan(s.hook?.[lang], v => { s.hook[lang] = v; syncTextarea(s); });
    wrap.appendChild(el("p", {}, t("hook_label"), hookSpan));
    const ul = el("ul", { class: "lines" });
    (sc.lines || []).forEach((line, i) => {
      const li = el("li");
      li.appendChild(editableSpan(line, v => { sc.lines[i] = v; sc.full = sc.lines.join(" "); syncTextarea(s); }));
      ul.appendChild(li);
    });
    wrap.appendChild(ul);
    const ctaSpan = editableSpan(s.cta?.[lang], v => { s.cta[lang] = v; syncTextarea(s); });
    wrap.appendChild(el("p", {}, t("cta_label"), ctaSpan));
  }

  const tags = (s.hashtags || []).join(" ");
  wrap.appendChild(el("p", { class: "hashtags" }, tags));
}

function syncTextarea(scriptObj) {
  $("#review-json").value = JSON.stringify(scriptObj, null, 2);
}

$("#approve-btn").addEventListener("click", async () => {
  let scriptToSend = currentScript;
  try {
    scriptToSend = JSON.parse($("#review-json").value);
  } catch {
    if (!confirm(t("confirm_invalid_json"))) return;
  }
  $("#approve-btn").disabled = true;
  $("#approve-btn").textContent = t("approve_sent");
  await fetch(`/api/jobs/${currentJobId}/approve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ script: scriptToSend }),
  });
  $("#review-section").hidden = true;
});

$("#cancel-btn").addEventListener("click", async () => {
  if (!confirm(t("confirm_cancel"))) return;
  await fetch(`/api/jobs/${currentJobId}/cancel`, { method: "POST" });
  location.reload();
});

// ── 完成畫面 ─────────────────────────────────────────
function showDone(videos) {
  currentVideos = videos;
  $("#done-section").hidden = false;
  renderDownloads(videos);
  $("#done-section").scrollIntoView({ behavior: "smooth" });
}

function renderDownloads(videos) {
  const dl = $("#downloads");
  dl.innerHTML = "";
  for (const v of videos) {
    const a = el("a", { href: `/output/${encodeURIComponent(v)}`, download: v }, `⬇ ${v}`);
    dl.appendChild(a);
  }
}

$("#restart-btn").addEventListener("click", () => location.reload());

// 切換語言時，重畫動態內容
window.addEventListener("i18n:changed", () => {
  if (currentScript) renderReviewPreview(currentScript);
  if (currentVideos) renderDownloads(currentVideos);
  if (!submitBtn.disabled) submitBtn.textContent = t("submit");
  loadStyleBadge();
});

// 主頁標頭的「風格檔已啟用」狀態提示
async function loadStyleBadge() {
  try {
    const res = await fetch("/api/style/status");
    const data = await res.json();
    const badge = $("#style-status-badge");
    if (!badge) return;
    if (data.exists) {
      const n = (data.sources || []).length;
      badge.innerHTML = `🎨 ${t("badge_style_on").replace("{n}", n)} <a href="/style.html">${t("badge_change")}</a>`;
      badge.hidden = false;
    } else {
      badge.innerHTML = `⚪ ${t("badge_style_off")} <a href="/style.html">${t("badge_setup")}</a>`;
      badge.hidden = false;
    }
  } catch {}
}
document.addEventListener("DOMContentLoaded", loadStyleBadge);
