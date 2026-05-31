const $ = sel => document.querySelector(sel);
const $$ = sel => document.querySelectorAll(sel);

const form = $("#style-form");
const submitBtn = $("#submit-btn");
const logEl = $("#log");
let currentJobId = null;

// ── 狀態卡片：顯示目前 style-profile.json 的概況 ───────
async function loadStatus() {
  try {
    const res = await fetch("/api/style/status");
    const data = await res.json();
    const card = $("#status-card");
    if (!data.exists) {
      card.innerHTML = `<strong>⚪ ${t("status_none")}</strong>`;
      return;
    }
    const date = data.createdAt ? new Date(data.createdAt).toLocaleString() : "?";
    const srcLines = (data.sources || []).slice(0, 3).map(s => `• ${escapeHtml(s)}`).join("<br>");
    const more = data.sources && data.sources.length > 3 ? `<br>… ${t("and_more").replace("{n}", data.sources.length - 3)}` : "";
    card.innerHTML =
      `<strong>✅ ${t("status_ok")}</strong><br>` +
      `<small>${t("based_on").replace("{n}", data.sources?.length || 0)}</small><br>` +
      `<small>${t("created_at")}: ${date}</small><br>` +
      `<details><summary>${t("show_sources")}</summary>${srcLines}${more}</details>` +
      `<p style="margin:8px 0 0; font-size:13px; color:#6a4c43;">${t("tone")}: ${escapeHtml(data.tone || "")}</p>`;
  } catch (e) {
    $("#status-card").textContent = "（無法載入狀態）";
  }
}
function escapeHtml(s) { return String(s).replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;"})[c]); }

// ── 表單送出 ──────────────────────────────────────
form.addEventListener("submit", async e => {
  e.preventDefault();
  const urls = form.elements["urls"].value.trim();
  if (!urls) return alert(t("style_err_no_urls"));

  submitBtn.disabled = true;
  submitBtn.textContent = t("submit_uploading");

  try {
    const res = await fetch("/api/style/build", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        urls,
        model: form.elements["model"].value,
        language: form.elements["language"].value,
      }),
    });
    const raw = await res.text();
    let json;
    try { json = JSON.parse(raw); } catch { throw new Error(`伺服器回應非 JSON (HTTP ${res.status})：${raw.slice(0, 200)}`); }
    if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
    currentJobId = json.jobId;
    $("#form-section").hidden = true;
    $("#progress-section").hidden = false;
    connectStream(currentJobId);
  } catch (err) {
    alert(t("err_prefix") + err.message);
    submitBtn.disabled = false;
    submitBtn.textContent = t("style_submit");
  }
});

// ── SSE 進度 ────────────────────────────────────
function connectStream(jobId) {
  const es = new EventSource(`/api/jobs/${jobId}/stream`);
  es.onmessage = e => handleEvent(JSON.parse(e.data));
}
function appendLog(line) { logEl.textContent += line + "\n"; logEl.scrollTop = logEl.scrollHeight; }

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
  } else if (ev.type === "done") {
    showDone(ev.data);
  } else if (ev.type === "error") {
    appendLog("❌ " + ev.data.message);
    $("#progress-actions").hidden = false;
  }
}

function showDone(data) {
  $("#done-section").hidden = false;
  const date = data.createdAt ? new Date(data.createdAt).toLocaleString() : "?";
  $("#done-detail").innerHTML =
    `<strong>📊 ${t("based_on").replace("{n}", data.sources || 0)}</strong><br>` +
    `<small>${t("created_at")}: ${date}</small>` +
    (data.tone ? `<p style="margin:8px 0 0; font-size:13px; color:#6a4c43;">${t("tone")}: ${escapeHtml(data.tone)}</p>` : "");
  $("#done-section").scrollIntoView({ behavior: "smooth" });
}

$("#back-btn")?.addEventListener("click", () => location.reload());
$("#restart-btn")?.addEventListener("click", () => location.reload());
$("#goto-main")?.addEventListener("click", () => { location.href = "/"; });

window.addEventListener("i18n:changed", loadStatus);
document.addEventListener("DOMContentLoaded", loadStatus);
