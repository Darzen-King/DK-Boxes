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
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";

const execFileAsync = promisify(execFile);

const MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-4-6";

const MIME_BY_EXT = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

const VIDEO_EXTS = new Set([".mp4", ".mov", ".avi", ".mkv", ".webm", ".m4v", ".mpg", ".mpeg"]);
const DEFAULT_FRAMES = 6;

function isVideo(p) {
  return VIDEO_EXTS.has(path.extname(p).toLowerCase());
}

async function ffprobeDuration(videoPath) {
  try {
    const { stdout } = await execFileAsync("ffprobe", [
      "-v", "error", "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1", videoPath,
    ]);
    return parseFloat(stdout.trim());
  } catch (e) {
    if (e.code === "ENOENT") throw new Error("找不到 ffprobe（屬於 ffmpeg）。請先安裝 ffmpeg。");
    throw e;
  }
}

async function extractFrames(videoPath, count) {
  const dur = await ffprobeDuration(videoPath);
  if (!dur || dur <= 0) throw new Error(`無法讀取影片長度：${videoPath}`);

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const baseName = path.basename(videoPath, path.extname(videoPath)).replace(/[^\w.-]/g, "_").slice(0, 40);
  const dir = path.resolve("output", `frames-${stamp}-${baseName}`);
  fs.mkdirSync(dir, { recursive: true });

  // 等距：fps = N / 影片總秒數；scale 縮成寬 1280（限縮上傳大小但保留細節）
  const fps = count / dur;
  await execFileAsync("ffmpeg", [
    "-y", "-hide_banner", "-loglevel", "error",
    "-i", videoPath,
    "-vf", `fps=${fps.toFixed(6)},scale=1280:-2`,
    "-frames:v", String(count),
    "-q:v", "3",
    path.join(dir, "frame_%03d.jpg"),
  ]);

  const frames = fs.readdirSync(dir)
    .filter(f => /^frame_\d+\.jpg$/i.test(f))
    .sort()
    .map(f => path.join(dir, f));
  if (frames.length === 0) throw new Error(`從影片擷取畫面失敗：${videoPath}`);
  return frames;
}

async function expandInputs(inputs, framesPerVideo) {
  const out = [];
  const fromVideo = [];
  for (const p of inputs) {
    if (!fs.existsSync(p)) { console.error(`找不到檔案：${p}`); process.exit(1); }
    if (isVideo(p)) {
      console.log(`🎞 從影片擷取 ${framesPerVideo} 個關鍵畫面：${path.basename(p)}`);
      const frames = await extractFrames(p, framesPerVideo);
      out.push(...frames);
      fromVideo.push({ source: p, frames });
    } else {
      out.push(p);
    }
  }
  return { paths: out, fromVideo };
}

function printUsageAndExit() {
  console.log(`
BINI Blooms 宣傳影片工具 — Phase 1（AI 文案）

用法：
  node src/generateScript.js <照片或影片...> [選項]

選項：
  --name   <文字>   商品名稱
  --price  <文字>   價格（例 "NT$1280"）
  --notes  <文字>   賣點／補充（例 "情人節熱賣、可保存3年"）
  --seconds <數字>  目標影片秒數（預設 20）
  --frames <數字>   影片要擷取幾張關鍵畫面餵給 AI（預設 6，每張 ~$0.003–0.01）
  --web             開啟網路搜尋（讓 Claude 找趨勢/熱門 hashtag/季節梗，多 ~$0.01–0.03）

範例：
  node src/generateScript.js ./photos/rose.jpg --name "永生玫瑰禮盒" --price "NT$1280" --notes "情人節熱賣"
  node src/generateScript.js ./videos/demo.mp4 --name "婚禮鮮花佈置" --notes "新人最愛"
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
    else if (a === "--frames") opts.frames = Number(argv[++i]) || DEFAULT_FRAMES;
    else if (a === "--web") opts.web = true;
    else if (a.startsWith("--")) { console.error(`未知選項：${a}`); process.exit(1); }
    else images.push(a);
  }
  return { images, opts };
}

function sniffMime(buf) {
  if (buf.length < 12) return null;
  if (buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return "image/jpeg";
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) return "image/png";
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return "image/gif";
  if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46
      && buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50) return "image/webp";
  return null;
}

function loadImageBlock(filePath) {
  if (!fs.existsSync(filePath)) {
    console.error(`找不到照片：${filePath}`);
    process.exit(1);
  }
  const buf = fs.readFileSync(filePath);
  const sniffed = sniffMime(buf);
  const ext = path.extname(filePath).toLowerCase();
  const fromExt = MIME_BY_EXT[ext];
  const mediaType = sniffed || fromExt;
  if (!mediaType) {
    console.error(`不支援的圖片格式：${filePath}（支援 jpg/png/webp/gif）`);
    process.exit(1);
  }
  if (sniffed && fromExt && sniffed !== fromExt) {
    console.warn(`⚠️  ${path.basename(filePath)} 副檔名是 ${ext} 但實際是 ${sniffed}，已自動修正`);
  }
  return { type: "image", source: { type: "base64", media_type: mediaType, data: buf.toString("base64") } };
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

function buildPrompt(opts, style, videoContext) {
  const info = [
    opts.name ? `商品名稱：${opts.name}` : null,
    opts.price ? `價格：${opts.price}` : null,
    opts.notes ? `賣點／補充：${opts.notes}` : null,
  ].filter(Boolean).join("\n") || "（店家未提供文字資訊，請只依照片判斷）";

  const videoBlock = videoContext && videoContext.length ? `

【重要】以下 ${videoContext.reduce((n, v) => n + v.frames.length, 0)} 張畫面是從 ${videoContext.length} 支影片按時間順序等距擷取的關鍵畫面，請**整體理解影片內容**（畫面之間有時間關係，可能是動作流程、情境變化、人物互動），不要把每張當成獨立商品。腳本應反映影片的「故事感」與「動態感」。
` : "";

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

  return `你是 BINI Blooms（一家主打菲律賓客群的花店/禮盒品牌）的社群行銷文案專家。${styleBlock}${webBlock}${videoBlock}
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
  const { paths: imagePaths, fromVideo } = await expandInputs(images, opts.frames || DEFAULT_FRAMES);
  const imageBlocks = imagePaths.map(loadImageBlock);
  const style = loadStyleProfile();

  const flagBits = [
    style ? "風格檔" : null,
    opts.web ? "網路搜尋" : null,
    fromVideo.length ? `影片→${imagePaths.length}張畫面` : null,
  ].filter(Boolean).join("、");
  console.log(`🧠 使用 ${MODEL} 分析 ${imagePaths.length} 張畫面${flagBits ? `（${flagBits}）` : ""}…`);
  const resp = await client.messages.create({
    model: MODEL,
    max_tokens: 4000,
    tools: opts.web ? [{ type: "web_search_20250305", name: "web_search", max_uses: 3 }] : undefined,
    messages: [{
      role: "user",
      content: [...imageBlocks, { type: "text", text: buildPrompt(opts, style, fromVideo) }],
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
  // meta.images：給 Phase 3 用的真實影像路徑（影片已展開成擷取的畫面）
  // meta.sources：使用者原始上傳（可能含影片），meta.videos：影片→畫面的對應
  fs.writeFileSync(outPath, JSON.stringify({
    meta: {
      model: MODEL,
      images: imagePaths,
      sources: images,
      videos: fromVideo,
      opts,
      createdAt: stamp,
    },
    ...result,
  }, null, 2));
  console.log(`💾 已存檔：${path.relative(process.cwd(), outPath)}（供 Phase 2 TTS 使用）`);
}

main().catch(err => {
  console.error("❌ 執行失敗：", err.message || err);
  process.exit(1);
});
