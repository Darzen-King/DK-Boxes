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
    const img = document.createElement("img");
    img.src = URL.createObjectURL(f);
    img.title = f.name;
    preview.appendChild(img);
  });
}

// ── 提交 ──────────────────────────────────────────────
form.addEventListener("submit", async e => {
  e.preventDefault();
  if (photoInput.files.length === 0) return alert("至少要上傳 1 張照片");

  const fd = new FormData(form);
  submitBtn.disabled = true;
  submitBtn.textContent = "上傳中…";

  try {
    const res = await fetch("/api/produce", { method: "POST", body: fd });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || "啟動失敗");
    currentJobId = json.jobId;
    $("#form-section").hidden = true;
    $("#progress-section").hidden = false;
    connectStream(currentJobId);
  } catch (err) {
    alert("錯誤：" + err.message);
    submitBtn.disabled = false;
    submitBtn.textContent = "🚀 開始製作";
  }
});

// ── SSE：即時進度 ────────────────────────────────────
function connectStream(jobId) {
  const es = new EventSource(`/api/jobs/${jobId}/stream`);
  es.onmessage = e => {
    const ev = JSON.parse(e.data);
    handleEvent(ev);
  };
  es.onerror = () => { /* 連線會自動重連 */ };
}

function appendLog(line) {
  logEl.textContent += line + "\n";
  logEl.scrollTop = logEl.scrollHeight;
}

function handleEvent(ev) {
  if (ev.type === "log") {
    appendLog(ev.data);
  } else if (ev.type === "phase") {
    const el = [...$$(".phase")].find(p => p.dataset.phase === ev.data.label);
    if (!el) return;
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
  }
}

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
  wrap.appendChild(el("p", {}, `📸 ${s.product_summary || ""}`));

  for (const [lang, label] of [["en", "🇬🇧 English"], ["tl", "🇵🇭 Tagalog"]]) {
    const sc = s.scripts?.[lang];
    if (!sc) continue;
    wrap.appendChild(el("h4", {}, label));
    const hookSpan = editableSpan(s.hook?.[lang], v => { s.hook[lang] = v; syncTextarea(s); });
    wrap.appendChild(el("p", {}, "HOOK: ", hookSpan));
    const ul = el("ul", { class: "lines" });
    (sc.lines || []).forEach((line, i) => {
      const li = el("li");
      li.appendChild(editableSpan(line, v => { sc.lines[i] = v; sc.full = sc.lines.join(" "); syncTextarea(s); }));
      ul.appendChild(li);
    });
    wrap.appendChild(ul);
    const ctaSpan = editableSpan(s.cta?.[lang], v => { s.cta[lang] = v; syncTextarea(s); });
    wrap.appendChild(el("p", {}, "CTA: ", ctaSpan));
  }

  const tags = (s.hashtags || []).join(" ");
  wrap.appendChild(el("p", { class: "hashtags" }, tags));
}

function syncTextarea(scriptObj) {
  $("#review-json").value = JSON.stringify(scriptObj, null, 2);
}

$("#approve-btn").addEventListener("click", async () => {
  // 以 textarea 內容為準（覆蓋 inline 編輯）
  let scriptToSend = currentScript;
  try {
    scriptToSend = JSON.parse($("#review-json").value);
  } catch {
    if (!confirm("進階 JSON 格式有誤，是否改用上面的可編輯預覽內容繼續？")) return;
  }
  $("#approve-btn").disabled = true;
  $("#approve-btn").textContent = "已送出，繼續做語音與影片…";
  await fetch(`/api/jobs/${currentJobId}/approve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ script: scriptToSend }),
  });
  $("#review-section").hidden = true;
});

$("#cancel-btn").addEventListener("click", async () => {
  if (!confirm("確定取消？")) return;
  await fetch(`/api/jobs/${currentJobId}/cancel`, { method: "POST" });
  location.reload();
});

// ── 完成畫面 ─────────────────────────────────────────
function showDone(videos) {
  $("#done-section").hidden = false;
  const dl = $("#downloads");
  dl.innerHTML = "";
  for (const v of videos) {
    const a = el("a", { href: `/output/${encodeURIComponent(v)}`, download: v }, `⬇ ${v}`);
    dl.appendChild(a);
  }
  $("#done-section").scrollIntoView({ behavior: "smooth" });
}

$("#restart-btn").addEventListener("click", () => location.reload());
