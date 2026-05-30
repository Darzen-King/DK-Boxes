#!/usr/bin/env node
/**
 * Phase 2 — 把 Phase 1 的腳本 JSON 合成英文 + 他加祿語旁白音檔
 *
 * 自動選 provider：
 *   - 若 .env 有 ELEVENLABS_API_KEY → 用 ElevenLabs（品質最佳，未來可接 voice cloning）
 *   - 否則 → 用 edge-tts（免費，需先 `pip install edge-tts`）
 *
 * 用法：
 *   node src/synthesize.js                              # 自動取 output/ 最新一份 JSON
 *   node src/synthesize.js output/2026-01-15T....json   # 指定 JSON
 *   node src/synthesize.js --provider edge              # 強制使用 edge-tts
 *   node src/synthesize.js --provider elevenlabs        # 強制使用 ElevenLabs
 *   node src/synthesize.js --lang en                    # 只合成英文（預設兩種都做）
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import "dotenv/config";

const execFileAsync = promisify(execFile);

const DEFAULTS = {
  edgeVoiceEn: process.env.EDGE_VOICE_EN || "en-US-AvaMultilingualNeural",
  edgeVoiceTl: process.env.EDGE_VOICE_TL || "fil-PH-BlessicaNeural",
  elevenVoiceEn: process.env.ELEVENLABS_VOICE_ID_EN || process.env.ELEVENLABS_VOICE_ID || "21m00Tcm4TlvDq8ikWAM",
  elevenVoiceTl: process.env.ELEVENLABS_VOICE_ID_TL || process.env.ELEVENLABS_VOICE_ID || "21m00Tcm4TlvDq8ikWAM",
  elevenModel: process.env.ELEVENLABS_MODEL || "eleven_multilingual_v2",
};

function printUsageAndExit() {
  console.log(`
BINI Blooms 宣傳影片工具 — Phase 2（旁白語音合成）

用法：
  node src/synthesize.js [腳本 JSON] [選項]

選項：
  --provider <edge|elevenlabs>   指定服務（預設：有 ELEVENLABS_API_KEY 就用 ElevenLabs，否則 edge-tts）
  --lang <en|tl|en,tl>           只合成指定語言（預設兩種都做）
  --voice-en <名稱或 ID>          覆寫英文配音
  --voice-tl <名稱或 ID>          覆寫他加祿語配音

範例：
  node src/synthesize.js
  node src/synthesize.js output/2026-05-30T....json --provider elevenlabs
  node src/synthesize.js --lang tl --voice-tl fil-PH-AngeloNeural
`);
  process.exit(0);
}

function parseArgs(argv) {
  const opts = { langs: ["en", "tl"] };
  let jsonPath = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") printUsageAndExit();
    else if (a === "--provider") opts.provider = argv[++i];
    else if (a === "--lang") opts.langs = argv[++i].split(",").map(s => s.trim()).filter(Boolean);
    else if (a === "--voice-en") opts.voiceEn = argv[++i];
    else if (a === "--voice-tl") opts.voiceTl = argv[++i];
    else if (a.startsWith("--")) { console.error(`未知選項：${a}`); process.exit(1); }
    else jsonPath = a;
  }
  return { jsonPath, opts };
}

function pickLatestJson() {
  const dir = path.resolve("output");
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir)
    .filter(f => f.endsWith(".json") && !f.endsWith("-audio.json"))
    .map(f => ({ f, mtime: fs.statSync(path.join(dir, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  return files[0] ? path.join(dir, files[0].f) : null;
}

function selectProvider(cliProvider) {
  if (cliProvider === "edge" || cliProvider === "elevenlabs") return cliProvider;
  return process.env.ELEVENLABS_API_KEY ? "elevenlabs" : "edge";
}

// ── edge-tts（免費，呼叫 Python CLI）─────────────────────────────────────────
async function edgeSynth(text, voice, outPath) {
  const tmpTxt = outPath + ".tmp.txt";
  fs.writeFileSync(tmpTxt, text, "utf8");
  try {
    await execFileAsync("edge-tts", ["--voice", voice, "--file", tmpTxt, "--write-media", outPath]);
  } catch (e) {
    if (e.code === "ENOENT") {
      throw new Error("找不到 edge-tts 指令。請先在終端機執行：pip install edge-tts");
    }
    throw new Error(`edge-tts 執行失敗：${e.stderr || e.message}`);
  } finally {
    if (fs.existsSync(tmpTxt)) fs.unlinkSync(tmpTxt);
  }
}

// ── ElevenLabs（付費，REST API）─────────────────────────────────────────────
async function elevenSynth(text, voiceId, outPath) {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) throw new Error("ElevenLabs 需要 ELEVENLABS_API_KEY 環境變數");

  const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`;
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
      "Content-Type": "application/json",
      "accept": "audio/mpeg",
    },
    body: JSON.stringify({
      text,
      model_id: DEFAULTS.elevenModel,
      voice_settings: { stability: 0.5, similarity_boost: 0.75 },
    }),
  });
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`ElevenLabs API ${resp.status}：${body}`);
  }
  const buf = Buffer.from(await resp.arrayBuffer());
  fs.writeFileSync(outPath, buf);
}

async function synthesize(provider, lang, text, opts, outPath) {
  if (provider === "edge") {
    const voice = lang === "en"
      ? (opts.voiceEn || DEFAULTS.edgeVoiceEn)
      : (opts.voiceTl || DEFAULTS.edgeVoiceTl);
    await edgeSynth(text, voice, outPath);
    return voice;
  }
  const voice = lang === "en"
    ? (opts.voiceEn || DEFAULTS.elevenVoiceEn)
    : (opts.voiceTl || DEFAULTS.elevenVoiceTl);
  await elevenSynth(text, voice, outPath);
  return voice;
}

async function main() {
  const { jsonPath: cliPath, opts } = parseArgs(process.argv.slice(2));
  const jsonPath = cliPath || pickLatestJson();
  if (!jsonPath) {
    console.error("❌ 找不到腳本 JSON。請先跑 generateScript.js，或提供路徑。");
    process.exit(1);
  }
  if (!fs.existsSync(jsonPath)) {
    console.error(`❌ 找不到檔案：${jsonPath}`);
    process.exit(1);
  }

  const script = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
  const provider = selectProvider(opts.provider);

  console.log(`🎙  Phase 2：${path.relative(process.cwd(), jsonPath)}`);
  console.log(`   provider = ${provider}${provider === "edge" ? "（免費）" : "（ElevenLabs）"}`);

  const base = path.join(path.dirname(jsonPath), path.basename(jsonPath, ".json"));
  const manifest = { source: jsonPath, provider, model: provider === "elevenlabs" ? DEFAULTS.elevenModel : "edge", tracks: {} };

  for (const lang of opts.langs) {
    const text = script.scripts?.[lang]?.full;
    if (!text) { console.warn(`   ⚠️ 腳本沒有 ${lang} 內容，略過`); continue; }
    const outPath = `${base}-${lang}.mp3`;
    process.stdout.write(`   ⏳ 合成 ${lang}…`);
    const voice = await synthesize(provider, lang, text, opts, outPath);
    const sizeKb = Math.round(fs.statSync(outPath).size / 1024);
    console.log(` ✅ ${path.basename(outPath)}（${sizeKb} KB，voice=${voice}）`);
    manifest.tracks[lang] = { file: path.basename(outPath), voice, chars: text.length };
  }

  const manifestPath = `${base}-audio.json`;
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  console.log(`💾 音檔索引：${path.relative(process.cwd(), manifestPath)}（供 Phase 3 影片合成使用）`);
}

main().catch(err => {
  console.error("❌ 執行失敗：", err.message || err);
  process.exit(1);
});
