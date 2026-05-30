#!/usr/bin/env node
/**
 * Phase 3 — 照片 + 旁白音檔 + 字幕 → 9:16 直式 MP4
 *
 * 自動讀取 Phase 1 的腳本 JSON 與 Phase 2 的音檔，做：
 *   - 1080×1920 直式畫面
 *   - 照片 Ken Burns 緩慢縮放（多張會交叉淡入）
 *   - 燒錄字幕（ASS 格式，line 陣列自動均分時間軸）
 *   - 右上角 logo 浮水印（選用）
 *   - 背景音樂壓低到 15%、與旁白混音（選用）
 *
 * 用法：
 *   node src/composeVideo.js                                  # 取 output/ 最新一份
 *   node src/composeVideo.js output/xxx.json --lang tl        # 只做他加祿語版
 *   node src/composeVideo.js --music music/bgm.mp3 --logo LOGO.png
 *   node src/composeVideo.js --photos a.jpg b.jpg c.jpg       # 覆寫 Phase 1 用的照片
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const V = { w: 1080, h: 1920, fps: 30 };
const KEN_BURNS_ZOOM = 0.08;     // 影片結束時放大到 1.08x
const CROSSFADE = 0.8;           // 照片交叉淡入秒數
const LOGO_W_RATIO = 0.18;       // logo 寬度 = 影片寬 × 0.18
const LOGO_MARGIN = 40;          // logo 邊距 (px)
const BGM_VOL = 0.15;            // 背景音樂音量比例
const NARR_VOL = 1.0;            // 旁白音量比例
const SUB_FONT = process.env.SUBTITLE_FONT || "Noto Sans";
const SUB_FONTSIZE = 60;

function usage() {
  console.log(`
BINI Blooms 宣傳影片工具 — Phase 3（影片合成）

用法：
  node src/composeVideo.js [腳本 JSON] [選項]

選項：
  --lang <en|tl|all>     做哪個語言版本（預設 all = 兩個都做）
  --photos <p1 p2 ...>   覆寫照片清單（預設用 Phase 1 紀錄的 meta.images）
  --music <path>         背景音樂 mp3/wav（預設 music/bgm.mp3 若存在）
  --logo <path>          浮水印 PNG（預設 LOGO.png 若存在）
  --no-music             明確不要背景音樂
  --no-logo              明確不要浮水印

範例：
  node src/composeVideo.js
  node src/composeVideo.js --lang tl --music music/bgm.mp3 --logo LOGO.png
`);
  process.exit(0);
}

function parseArgs(argv) {
  const opts = { lang: "all" };
  let jsonPath = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-h" || a === "--help") usage();
    else if (a === "--lang") opts.lang = argv[++i];
    else if (a === "--music") opts.music = argv[++i];
    else if (a === "--logo") opts.logo = argv[++i];
    else if (a === "--no-music") opts.noMusic = true;
    else if (a === "--no-logo") opts.noLogo = true;
    else if (a === "--photos") {
      opts.photos = [];
      while (i + 1 < argv.length && !argv[i + 1].startsWith("--")) opts.photos.push(argv[++i]);
    }
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

async function ffprobe(file) {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v", "error", "-show_entries", "format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1", file,
  ]);
  return parseFloat(stdout.trim());
}

function assTime(t) {
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = (t % 60).toFixed(2);
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(5, "0")}`;
}

function buildAss(lines, totalDur) {
  const per = totalDur / lines.length;
  const head = `[Script Info]
ScriptType: v4.00+
PlayResX: ${V.w}
PlayResY: ${V.h}
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,${SUB_FONT},${SUB_FONTSIZE},&H00FFFFFF,&H00FFFFFF,&H00000000,&H80000000,1,0,0,0,100,100,0,0,1,5,2,2,80,80,360,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
  const body = lines.map((line, i) => {
    const start = assTime(i * per);
    const end = assTime(Math.min((i + 1) * per, totalDur));
    const text = String(line).replace(/\n/g, "\\N").replace(/,/g, "\\,");
    return `Dialogue: 0,${start},${end},Default,,0,0,0,,${text}`;
  }).join("\n");
  return head + body + "\n";
}

function escapeFilterPath(p) {
  // ffmpeg subtitles filter on Windows needs forward slashes + escaped colon
  return p.replace(/\\/g, "/").replace(/:/g, "\\:");
}

function buildFilter(photoCount, durSec, hasLogo, hasMusic, subsPath) {
  const fps = V.fps;
  const per = (durSec + CROSSFADE * (photoCount - 1)) / photoCount;
  const dFrames = Math.ceil(per * fps);

  // 每張照片：放大 → 裁切到 9:16 → Ken Burns（zoompan）
  const slides = [];
  for (let i = 0; i < photoCount; i++) {
    slides.push(
      `[${i}:v]scale=${V.w * 4}:${V.h * 4}:force_original_aspect_ratio=increase,` +
      `crop=${V.w * 4}:${V.h * 4},` +
      `zoompan=z='min(zoom+${(KEN_BURNS_ZOOM / dFrames).toFixed(6)},${1 + KEN_BURNS_ZOOM})':` +
      `d=${dFrames}:s=${V.w}x${V.h}:fps=${fps},setsar=1,format=yuv420p[v${i}]`
    );
  }

  // 串接 xfade
  const chains = [];
  let last = "v0";
  if (photoCount > 1) {
    let acc = per;
    for (let i = 1; i < photoCount; i++) {
      const out = `vc${i}`;
      chains.push(`[${last}][v${i}]xfade=transition=fade:duration=${CROSSFADE}:offset=${(acc - CROSSFADE).toFixed(3)}[${out}]`);
      last = out;
      acc += per - CROSSFADE;
    }
  }

  // 字幕（一定有）
  chains.push(`[${last}]subtitles='${escapeFilterPath(subsPath)}'[vsub]`);
  last = "vsub";

  // Logo（選用）
  const logoIdx = 1 + (hasMusic ? 2 : 1); // narration 是 photoCount，BGM 是 photoCount+1，logo 是後面
  if (hasLogo) {
    const lw = Math.round(V.w * LOGO_W_RATIO);
    chains.push(`[${logoIdx}:v]scale=${lw}:-1[logo]`);
    chains.push(`[${last}][logo]overlay=W-w-${LOGO_MARGIN}:${LOGO_MARGIN}[vout]`);
    last = "vout";
  } else {
    chains.push(`[${last}]copy[vout]`);
  }

  // 音訊
  const narrIdx = photoCount;
  let audioChain;
  if (hasMusic) {
    const bgmIdx = photoCount + 1;
    audioChain = `[${narrIdx}:a]volume=${NARR_VOL}[narr];` +
                 `[${bgmIdx}:a]volume=${BGM_VOL},aloop=loop=-1:size=2e9[bgmloop];` +
                 `[narr][bgmloop]amix=inputs=2:duration=first:dropout_transition=0[aout]`;
  } else {
    audioChain = `[${narrIdx}:a]volume=${NARR_VOL}[aout]`;
  }

  return slides.concat(chains).concat([audioChain]).join(";");
}

async function compose({ jsonPath, lang, opts }) {
  const script = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
  const base = path.join(path.dirname(jsonPath), path.basename(jsonPath, ".json"));

  const audioPath = `${base}-${lang}.mp3`;
  if (!fs.existsSync(audioPath)) throw new Error(`找不到 ${lang} 音檔：${audioPath}（請先跑 synthesize.js）`);

  const photos = (opts.photos && opts.photos.length)
    ? opts.photos
    : (script.meta?.images || []);
  if (!photos.length) throw new Error("找不到照片，請用 --photos 指定");
  for (const p of photos) if (!fs.existsSync(p)) throw new Error(`找不到照片：${p}`);

  const lines = script.scripts?.[lang]?.lines;
  if (!lines?.length) throw new Error(`腳本沒有 ${lang}.lines`);

  const durSec = await ffprobe(audioPath);

  // 寫字幕到暫存檔
  const subsPath = `${base}-${lang}.ass`;
  fs.writeFileSync(subsPath, buildAss(lines, durSec), "utf8");

  const hasLogo = !!opts.logo;
  const hasMusic = !!opts.music;
  const filter = buildFilter(photos.length, durSec, hasLogo, hasMusic, subsPath);

  // ffmpeg 輸入：照片 ×N、narration、(BGM)、(logo)
  const args = ["-y"];
  for (const p of photos) args.push("-loop", "1", "-t", String(durSec / photos.length + CROSSFADE), "-i", p);
  args.push("-i", audioPath);
  if (hasMusic) args.push("-stream_loop", "-1", "-i", opts.music);
  if (hasLogo) args.push("-i", opts.logo);

  args.push(
    "-filter_complex", filter,
    "-map", "[vout]", "-map", "[aout]",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "medium", "-crf", "20",
    "-c:a", "aac", "-b:a", "192k",
    "-r", String(V.fps), "-shortest", "-movflags", "+faststart",
  );

  const outPath = `${base}-${lang}.mp4`;
  args.push(outPath);

  console.log(`   ⏳ ffmpeg 合成 ${lang}（${photos.length} 張照片，${durSec.toFixed(1)} 秒）…`);
  try {
    await execFileAsync("ffmpeg", args, { maxBuffer: 50 * 1024 * 1024 });
  } catch (e) {
    if (e.code === "ENOENT") throw new Error("找不到 ffmpeg 指令。請先 `winget install Gyan.FFmpeg` 並重開終端機。");
    const tail = (e.stderr || "").split("\n").slice(-15).join("\n");
    throw new Error(`ffmpeg 執行失敗：\n${tail}`);
  }
  const sizeMb = (fs.statSync(outPath).size / 1024 / 1024).toFixed(1);
  console.log(`   ✅ ${path.basename(outPath)}（${sizeMb} MB）`);
  fs.unlinkSync(subsPath);
  return outPath;
}

async function main() {
  const { jsonPath: cliPath, opts } = parseArgs(process.argv.slice(2));
  const jsonPath = cliPath || pickLatestJson();
  if (!jsonPath) { console.error("❌ 找不到腳本 JSON。先跑 generateScript.js。"); process.exit(1); }
  if (!fs.existsSync(jsonPath)) { console.error(`❌ 找不到 ${jsonPath}`); process.exit(1); }

  // 預設找 music/bgm.mp3 與 LOGO.png
  if (!opts.music && !opts.noMusic) {
    const def = path.resolve("music/bgm.mp3");
    if (fs.existsSync(def)) opts.music = def;
  }
  if (!opts.logo && !opts.noLogo) {
    const def = path.resolve("LOGO.png");
    if (fs.existsSync(def)) opts.logo = def;
  }

  const langs = opts.lang === "all" ? ["en", "tl"] : [opts.lang];
  console.log(`🎬 Phase 3：${path.relative(process.cwd(), jsonPath)}`);
  console.log(`   bgm  = ${opts.music ? path.relative(process.cwd(), opts.music) : "(無，純旁白)"}`);
  console.log(`   logo = ${opts.logo ? path.relative(process.cwd(), opts.logo) : "(無浮水印)"}`);

  for (const lang of langs) {
    await compose({ jsonPath, lang, opts });
  }
  console.log(`\n🎉 完成！上傳 FB Reels / TikTok 前可以先用任一播放器預覽。`);
}

main().catch(err => {
  console.error("❌ 執行失敗：", err.message || err);
  process.exit(1);
});
