#!/usr/bin/env node
/**
 * Phase 4 — localhost 小工具 UI
 *
 * 用法：
 *   npm install        # 首次安裝會多裝 express + multer
 *   npm run ui
 *   開瀏覽器 → http://localhost:3000
 *
 * 流程：上傳照片 + 填資訊 → 即時顯示 Phase 1 進度 → 審稿（可即時編輯）→ 一鍵繼續做 Phase 2 + 3 → 下載 MP4
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import express from "express";
import multer from "multer";
import { isUrl, downloadVideo } from "./ytdl.js";

const PORT = Number(process.env.PORT) || 3000;
const ROOT = path.resolve(".");
const UPLOAD_DIR = path.join(ROOT, "uploads");
const OUTPUT_DIR = path.join(ROOT, "output");
const PUBLIC_DIR = path.join(ROOT, "public");
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
fs.mkdirSync(OUTPUT_DIR, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (_req, file, cb) => {
      const safe = file.originalname.replace(/[^\w.\-]/g, "_");
      cb(null, `${Date.now()}-${randomUUID().slice(0, 8)}-${safe}`);
    },
  }),
  limits: { fileSize: 500 * 1024 * 1024 },   // 500MB（允許影片）
});

// ── 任務狀態：記憶體即可（單機單使用者）───────────────────────────────
const jobs = new Map();

function emit(job, type, data) {
  const event = { type, data, t: Date.now() };
  job.events.push(event);
  for (const res of job.listeners) {
    try { res.write(`data: ${JSON.stringify(event)}\n\n`); } catch {}
  }
}

function runPhase(job, label, scriptPath, args) {
  return new Promise((resolve, reject) => {
    emit(job, "phase", { label, status: "start" });
    const child = spawn(process.execPath, [scriptPath, ...args], { cwd: ROOT });
    job.child = child;
    const onLine = chunk => {
      for (const line of chunk.toString("utf8").split(/\r?\n/)) {
        if (line.trim()) emit(job, "log", line);
      }
    };
    child.stdout.on("data", onLine);
    child.stderr.on("data", onLine);
    child.on("close", code => {
      job.child = null;
      if (code === 0) { emit(job, "phase", { label, status: "done" }); resolve(); }
      else { emit(job, "phase", { label, status: "error", code }); reject(new Error(`${label} 結束碼 ${code}`)); }
    });
    child.on("error", err => { job.child = null; reject(err); });
  });
}

function findLatestScriptJson() {
  if (!fs.existsSync(OUTPUT_DIR)) return null;
  const files = fs.readdirSync(OUTPUT_DIR)
    .filter(f => f.endsWith(".json") && !f.endsWith("-audio.json"))
    .map(f => ({ f, m: fs.statSync(path.join(OUTPUT_DIR, f)).mtimeMs }))
    .sort((a, b) => b.m - a.m);
  return files[0] ? path.join(OUTPUT_DIR, files[0].f) : null;
}

// ── 啟動一個任務 ─────────────────────────────────────────────────────
async function startJob(job, body) {
  try {
    // 0. 先下載 URLs（若有）
    const urls = (body.urls || "").split(/[\n,]/).map(s => s.trim()).filter(Boolean);
    for (const url of urls) {
      if (!isUrl(url)) { emit(job, "log", `⚠️ 跳過非法連結：${url}`); continue; }
      emit(job, "phase", { label: "下載連結", status: "start" });
      emit(job, "log", `🔗 下載：${url}`);
      try {
        const dlPath = await downloadVideo(url, UPLOAD_DIR, line => emit(job, "log", `   ${line}`));
        job.photos.push(dlPath);
        emit(job, "log", `✅ 下載完成：${path.basename(dlPath)}`);
        emit(job, "phase", { label: "下載連結", status: "done" });
      } catch (e) {
        emit(job, "phase", { label: "下載連結", status: "error" });
        throw new Error(`下載失敗：${e.message}`);
      }
    }
    if (job.photos.length === 0) throw new Error("沒有可用素材：請上傳照片/影片，或貼一條有效連結。");

    // Phase 1 參數
    const p1Args = [...job.photos];
    if (body.name) p1Args.push("--name", body.name);
    if (body.price) p1Args.push("--price", body.price);
    if (body.notes) p1Args.push("--notes", body.notes);
    if (body.seconds) p1Args.push("--seconds", String(body.seconds));
    if (body.web === "true" || body.web === true) p1Args.push("--web");

    await runPhase(job, "Phase 1：腳本", path.join(ROOT, "src/generateScript.js"), p1Args);

    job.scriptPath = findLatestScriptJson();
    if (!job.scriptPath) throw new Error("找不到剛產出的腳本 JSON");
    const scriptObj = JSON.parse(fs.readFileSync(job.scriptPath, "utf8"));
    emit(job, "review", { jsonPath: path.relative(ROOT, job.scriptPath), script: scriptObj });

    // 等待前端 approve
    job.approvedResolver = null;
    const approved = await new Promise((res, rej) => {
      job.approvedResolver = res;
      job.cancelResolver = () => rej(new Error("使用者取消"));
    });
    if (!approved) throw new Error("使用者取消");

    // Phase 2
    await runPhase(job, "Phase 2：旁白", path.join(ROOT, "src/synthesize.js"), [job.scriptPath]);

    // Phase 3
    const p3Args = [job.scriptPath];
    if (body.lang) p3Args.push("--lang", body.lang);
    if (job.music) p3Args.push("--music", job.music);
    else p3Args.push("--no-music");
    if (job.logo) p3Args.push("--logo", job.logo);
    else if (!fs.existsSync(path.join(ROOT, "LOGO.png"))) p3Args.push("--no-logo");
    await runPhase(job, "Phase 3：影片", path.join(ROOT, "src/composeVideo.js"), p3Args);

    // 列出產出
    const base = path.basename(job.scriptPath, ".json");
    const videos = fs.readdirSync(OUTPUT_DIR)
      .filter(f => f.startsWith(base) && f.endsWith(".mp4"));
    emit(job, "done", { videos });
    job.status = "done";
  } catch (err) {
    emit(job, "error", { message: err.message });
    job.status = "error";
  }
}

// ── HTTP API ─────────────────────────────────────────────────────────
const app = express();
app.use(express.json({ limit: "5mb" }));
app.use(express.static(PUBLIC_DIR));
app.use("/output", express.static(OUTPUT_DIR));

app.post("/api/produce",
  upload.any(),   // 接受任何欄位名，下面手動分流；比 .fields() 嚴格白名單穩定
  (req, res) => {
    const byField = {};
    for (const f of (req.files || [])) (byField[f.fieldname] ||= []).push(f);
    const photos = (byField.photos || []).map(f => f.path);
    const music = byField.music?.[0]?.path;
    const logo = byField.logo?.[0]?.path;
    const hasUrls = (req.body.urls || "").split(/[\n,]/).map(s => s.trim()).filter(Boolean).length > 0;
    if (photos.length === 0 && !hasUrls) return res.status(400).json({ error: "至少要上傳 1 張照片/影片，或貼一條連結" });
    const jobId = randomUUID();
    const job = {
      id: jobId, status: "running", photos, music, logo,
      events: [], listeners: new Set(), scriptPath: null,
    };
    jobs.set(jobId, job);
    startJob(job, req.body);
    res.json({ jobId });
  }
);

app.get("/api/jobs/:id/stream", (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).end();
  res.set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "Connection": "keep-alive" });
  res.flushHeaders();
  for (const ev of job.events) res.write(`data: ${JSON.stringify(ev)}\n\n`);
  job.listeners.add(res);
  req.on("close", () => job.listeners.delete(res));
});

app.post("/api/jobs/:id/approve", (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job || !job.approvedResolver) return res.status(400).json({ error: "找不到待審稿任務" });
  // 接受編輯過的腳本：覆寫檔案
  if (req.body?.script && job.scriptPath) {
    fs.writeFileSync(job.scriptPath, JSON.stringify(req.body.script, null, 2));
    emit(job, "log", "✏️  已套用編輯後的腳本");
  }
  job.approvedResolver(true);
  res.json({ ok: true });
});

app.post("/api/jobs/:id/cancel", (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).end();
  if (job.child) { try { job.child.kill(); } catch {} }
  if (job.cancelResolver) job.cancelResolver();
  job.status = "cancelled";
  emit(job, "error", { message: "已取消" });
  res.json({ ok: true });
});

// JSON 錯誤處理：API 路徑出錯統一回 JSON，不要落到 Express 預設的 HTML 錯誤頁
app.use("/api", (err, req, res, next) => {
  const detail = err.field ? ` (欄位: ${err.field})` : "";
  console.error("[API error]", err.message + detail);
  res.status(err.status || 500).json({ error: (err.message || "Server error") + detail });
});

function openBrowser(url) {
  if (process.env.NO_AUTO_OPEN) return;
  const cmd = process.platform === "win32" ? "cmd"
            : process.platform === "darwin" ? "open"
            : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  try {
    const child = spawn(cmd, args, { detached: true, stdio: "ignore" });
    child.unref();
  } catch { /* 開不起來就算了 */ }
}

const server = app.listen(PORT, () => {
  console.log(`\n🌸 BINI Blooms 製作工具已啟動`);
  console.log(`   開瀏覽器 → http://localhost:${PORT}\n`);
  openBrowser(`http://localhost:${PORT}`);
});

server.on("error", err => {
  if (err.code === "EADDRINUSE") {
    console.error(`\n❌ Port ${PORT} 已被占用。`);
    console.error(`   多半是上一次的服務還沒關。處理方式（擇一）：`);
    console.error(`   1) 開瀏覽器 → http://localhost:${PORT}（很可能已經有工具在跑）`);
    console.error(`   2) PowerShell 執行：Stop-Process -Name node -Force（殺掉殘留 node 後再重跑）\n`);
    process.exit(1);
  }
  throw err;
});
