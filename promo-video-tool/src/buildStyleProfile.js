#!/usr/bin/env node
/**
 * 風格學習 — 把參考影片的逐字稿濃縮成一份可重複使用的「風格檔」
 *
 * 流程：20 支影片 → 逐字稿(.txt/.srt/.vtt) → 本工具 → style-profile.json
 * 之後 generateScript.js 會自動套用這份風格檔，模仿你的用詞與口吻。
 *
 * 取得逐字稿（在你自己電腦執行）：
 *   yt-dlp --write-auto-sub --sub-lang "tl,en" --skip-download <影片連結>   # 抓自動字幕
 *   # 或先下載影片再用 Whisper 轉：
 *   yt-dlp -o "transcripts/%(title)s.%(ext)s" <影片連結>
 *   whisper transcripts/xxx.mp4 --language Tagalog --output_format txt
 *
 * 用法：
 *   node src/buildStyleProfile.js [逐字稿資料夾]   （預設 ./transcripts）
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";

const MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-4-6";
const TRANSCRIPT_EXTS = new Set([".txt", ".srt", ".vtt"]);

// 把 srt/vtt 的序號、時間軸、標籤清掉，只留下講的內容
function cleanCaption(raw) {
  return raw
    .split(/\r?\n/)
    .map(l => l.replace(/<[^>]+>/g, "").trim())          // 去 <c> 等標籤
    .filter(l => l && l !== "WEBVTT")
    .filter(l => !/^\d+$/.test(l))                        // 去純序號
    .filter(l => !/-->/.test(l))                          // 去時間軸
    .filter((l, i, arr) => l !== arr[i - 1])              // 去連續重複
    .join(" ");
}

function loadTranscripts(dir) {
  if (!fs.existsSync(dir)) {
    console.error(`找不到逐字稿資料夾：${dir}`);
    console.error(`請建立 ${dir}/ 並放入 .txt/.srt/.vtt 逐字稿（見檔頭 yt-dlp 說明）。`);
    process.exit(1);
  }
  const files = fs.readdirSync(dir).filter(f => TRANSCRIPT_EXTS.has(path.extname(f).toLowerCase()));
  if (files.length === 0) {
    console.error(`${dir} 裡沒有 .txt/.srt/.vtt 逐字稿。`);
    process.exit(1);
  }
  return files.map(f => ({
    name: f,
    text: cleanCaption(fs.readFileSync(path.join(dir, f), "utf8")),
  })).filter(t => t.text.length > 0);
}

function buildPrompt(transcripts) {
  const corpus = transcripts
    .map((t, i) => `── 影片 ${i + 1}（${t.name}）──\n${t.text}`)
    .join("\n\n");

  return `以下是 BINI Blooms 參考影片的逐字稿（${transcripts.length} 支）。請分析它們，歸納出一份「說話風格檔」，之後會用來指導 AI 寫出語氣一致的新腳本。

請特別抓出「習慣用語」「口頭禪」「開場與收尾的固定套路」「情緒與節奏」。

只輸出 JSON，不要任何其他文字、不要 markdown 圍欄。格式如下：
{
  "tone": "整體語氣描述（繁中）",
  "register": "正式/口語/親密程度（繁中）",
  "signature_phrases": { "en": ["..."], "tl": ["..."] },
  "opening_patterns": ["常見開場 hook 套路（繁中說明 + 例句）"],
  "closing_cta_patterns": ["常見收尾 CTA 套路（繁中說明 + 例句）"],
  "vocabulary_notes": "常用詞彙、語碼轉換(中英菲夾雜)習慣（繁中）",
  "rhythm": "句子長短、停頓、語速感（繁中）",
  "emoji_usage": "表情符號/標點使用習慣（繁中）",
  "avoid": ["不符合此風格、應避免的講法"],
  "example_snippets": ["最能代表此風格的 3-5 句原文摘錄"]
}

逐字稿：
${corpus}`;
}

function extractJson(text) {
  let t = text.trim();
  if (t.startsWith("```")) t = t.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("回應中找不到 JSON");
  return JSON.parse(t.slice(start, end + 1));
}

async function main() {
  const dir = path.resolve(process.argv[2] || "transcripts");

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("❌ 缺少 ANTHROPIC_API_KEY。請複製 .env.example 為 .env 並填入金鑰。");
    process.exit(1);
  }

  const transcripts = loadTranscripts(dir);
  console.log(`🧠 用 ${MODEL} 分析 ${transcripts.length} 份逐字稿，歸納風格檔…`);

  const client = new Anthropic();
  const resp = await client.messages.create({
    model: MODEL,
    max_tokens: 2000,
    messages: [{ role: "user", content: buildPrompt(transcripts) }],
  });

  const text = resp.content.filter(b => b.type === "text").map(b => b.text).join("");
  let profile;
  try {
    profile = extractJson(text);
  } catch (e) {
    console.error("⚠️ 無法解析 JSON，原始回應如下：\n");
    console.error(text);
    process.exit(1);
  }

  const outPath = path.resolve("style-profile.json");
  fs.writeFileSync(outPath, JSON.stringify({
    meta: { model: MODEL, sources: transcripts.map(t => t.name), createdAt: new Date().toISOString() },
    ...profile,
  }, null, 2));

  console.log(`\n✅ 風格檔已產生：${path.relative(process.cwd(), outPath)}`);
  console.log(`   語氣：${profile.tone}`);
  console.log(`   代表句：${(profile.example_snippets || [])[0] || ""}`);
  console.log(`\n之後執行 generateScript.js 會自動套用這份風格檔。`);
}

main().catch(err => {
  console.error("❌ 執行失敗：", err.message || err);
  process.exit(1);
});
