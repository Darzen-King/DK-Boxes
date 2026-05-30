#!/usr/bin/env node
/**
 * Phase 1 — 照片 + 商品資訊 → 英文 + 他加祿語社群宣傳腳本
 *
 * 用法：
 *   node src/generateScript.js <照片...> [--name 名稱] [--price 價格] [--notes 賣點] [--seconds 20]
 *
 * 範例：
 *   node src/generateScript.js ./photos/rose.jpg --name "永生玫瑰禮盒" --price "NT$1280" --notes "情人節熱賣、可保存3年"
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";

const MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-4-6";

const MIME_BY_EXT = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

function printUsageAndExit() {
  console.log(`
BINI Blooms 宣傳影片工具 — Phase 1（AI 文案）

用法：
  node src/generateScript.js <照片路徑...> [選項]

選項：
  --name   <文字>   商品名稱
  --price  <文字>   價格（例 "NT$1280"）
  --notes  <文字>   賣點／補充（例 "情人節熱賣、可保存3年"）
  --seconds <數字>  目標影片秒數（預設 20）
  --web             開啟網路搜尋（讓 Claude 找趨勢/熱門 hashtag/季節梗，多 ~$0.01–0.03）

範例：
  node src/generateScript.js ./photos/rose.jpg --name "永生玫瑰禮盒" --price "NT$1280" --notes "情人節熱賣"
`);
  process.exit(0);
}

function parseArgs(argv) {
  const images = [];
  const opts = { seconds: 20 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") printUsageAndExit();
    else if (a === "--name") opts.name = argv[++i];
    else if (a === "--price") opts.price = argv[++i];
    else if (a === "--notes") opts.notes = argv[++i];
    else if (a === "--seconds") opts.seconds = Number(argv[++i]) || 20;
    else if (a === "--web") opts.web = true;
    else if (a.startsWith("--")) { console.error(`未知選項：${a}`); process.exit(1); }
    else images.push(a);
  }
  return { images, opts };
}

function loadImageBlock(filePath) {
  if (!fs.existsSync(filePath)) {
    console.error(`找不到照片：${filePath}`);
    process.exit(1);
  }
  const ext = path.extname(filePath).toLowerCase();
  const mediaType = MIME_BY_EXT[ext];
  if (!mediaType) {
    console.error(`不支援的圖片格式：${ext}（支援 jpg/png/webp/gif）`);
    process.exit(1);
  }
  const data = fs.readFileSync(filePath).toString("base64");
  return { type: "image", source: { type: "base64", media_type: mediaType, data } };
}

function loadStyleProfile() {
  const p = path.resolve("style-profile.json");
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    console.warn("⚠️ style-profile.json 解析失敗，將忽略風格檔。");
    return null;
  }
}

function buildPrompt(opts, style) {
  const info = [
    opts.name ? `商品名稱：${opts.name}` : null,
    opts.price ? `價格：${opts.price}` : null,
    opts.notes ? `賣點／補充：${opts.notes}` : null,
  ].filter(Boolean).join("\n") || "（店家未提供文字資訊，請只依照片判斷）";

  const styleBlock = style ? `

【務必嚴格模仿以下「說話風格檔」——這是從參考影片歸納出的口吻與習慣用語，新腳本要聽起來像同一個人講的】
${JSON.stringify(style, null, 2)}
` : "";

  const webBlock = opts.web ? `

【先做網路調查再寫】請先用 web_search 工具搜尋（最多 3 次）下列資訊，再依結果寫腳本：
1. 此商品/品類目前在 FB Reels / TikTok 上的**熱門 hook 用法、流行語**（含菲律賓在地用語）
2. **季節性關鍵字**（例如此商品的銷售旺季、相關節日）
3. 目前菲律賓社群熱用的 **hashtag 趨勢**（Tagalog 與英文皆可）
搜尋時優先用菲律賓在地觀點（site:tiktok.com、Philippines, OFW, Pinoy 等關鍵字）。
` : "";

  return `你是 BINI Blooms（一家主打菲律賓客群的花店/禮盒品牌）的社群行銷文案專家。${styleBlock}${webBlock}
請依照附上的商品照片與下列資訊，產出一支約 ${opts.seconds} 秒的「直式短影音」宣傳腳本，用於 Facebook Reels 與 TikTok，目標是帶動網路銷售。

商品資訊：
${info}

要求：
1. 同時產出「英文(en)」與「他加祿語 Tagalog(tl)」兩個版本，兩者語意對應但各自要自然道地，不要逐字硬翻。
2. 社群觀眾多半靜音滑過 → 開頭前 3 秒必須是強力 hook，結尾要有明確 CTA（引導下單/私訊/連結）。
3. 語氣親切、有情緒、口語化，適合配音與字幕。
4. 把腳本切成數行短句（每行適合當一張字幕，約 5–12 字），方便之後對齊字幕。
5. 附上 5–8 個適合的社群 hashtag（中英菲混用皆可）。

只輸出 JSON，不要任何其他文字、不要 markdown 圍欄。格式如下：
{
  "product_summary": "你從照片看到的商品描述（繁體中文，給店家確認用）",
  "hook": { "en": "...", "tl": "..." },
  "scripts": {
    "en": { "full": "完整旁白英文", "lines": ["第一句", "第二句", "..."] },
    "tl": { "full": "完整旁白他加祿語", "lines": ["...", "..."] }
  },
  "cta": { "en": "...", "tl": "..." },
  "hashtags": ["#...", "#..."]
}`;
}

function extractJson(text) {
  let t = text.trim();
  if (t.startsWith("```")) t = t.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("回應中找不到 JSON");
  return JSON.parse(t.slice(start, end + 1));
}

function printResult(r) {
  const sep = "─".repeat(48);
  console.log(`\n${sep}\n📸 商品判讀：${r.product_summary}\n${sep}`);
  for (const [lang, label] of [["en", "🇬🇧 English"], ["tl", "🇵🇭 Tagalog"]]) {
    const s = r.scripts?.[lang];
    if (!s) continue;
    console.log(`\n${label}`);
    console.log(`  HOOK: ${r.hook?.[lang] ?? ""}`);
    (s.lines || []).forEach((line, i) => console.log(`  ${String(i + 1).padStart(2)}. ${line}`));
    console.log(`  CTA : ${r.cta?.[lang] ?? ""}`);
  }
  console.log(`\n#️⃣  ${(r.hashtags || []).join("  ")}\n${sep}`);
}

async function main() {
  const { images, opts } = parseArgs(process.argv.slice(2));

  if (images.length === 0) printUsageAndExit();
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("❌ 缺少 ANTHROPIC_API_KEY。請複製 .env.example 為 .env 並填入金鑰。");
    process.exit(1);
  }

  const client = new Anthropic();
  const imageBlocks = images.map(loadImageBlock);
  const style = loadStyleProfile();

  const flags = [style ? "風格檔" : null, opts.web ? "網路搜尋" : null].filter(Boolean).join("、");
  console.log(`🧠 使用 ${MODEL} 分析 ${images.length} 張照片${flags ? `（已啟用：${flags}）` : ""}…`);
  const resp = await client.messages.create({
    model: MODEL,
    max_tokens: 4000,
    tools: opts.web ? [{ type: "web_search_20250305", name: "web_search", max_uses: 3 }] : undefined,
    messages: [{
      role: "user",
      content: [...imageBlocks, { type: "text", text: buildPrompt(opts, style) }],
    }],
  });

  if (opts.web) {
    const searches = resp.content.filter(b => b.type === "server_tool_use" && b.name === "web_search").length;
    if (searches > 0) console.log(`🔎 已執行 ${searches} 次網路搜尋`);
  }

  const text = resp.content.filter(b => b.type === "text").map(b => b.text).join("");
  let result;
  try {
    result = extractJson(text);
  } catch (e) {
    console.error("⚠️ 無法解析 JSON，原始回應如下：\n");
    console.error(text);
    process.exit(1);
  }

  printResult(result);

  const outDir = path.resolve("output");
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outPath = path.join(outDir, `${stamp}.json`);
  fs.writeFileSync(outPath, JSON.stringify({ meta: { model: MODEL, images, opts, createdAt: stamp }, ...result }, null, 2));
  console.log(`💾 已存檔：${path.relative(process.cwd(), outPath)}（供 Phase 2 TTS 使用）`);
}

main().catch(err => {
  console.error("❌ 執行失敗：", err.message || err);
  process.exit(1);
});
