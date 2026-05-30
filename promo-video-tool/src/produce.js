#!/usr/bin/env node
/**
 * 一鍵流程：照片 → 腳本 → 旁白 → 影片
 *
 * 流程中段「審稿閘門」讓你**確認/修改**腳本後才繼續做語音與影片，
 * 避免錯誤的文案連帶浪費 TTS 與影片合成的時間。
 *
 * 用法：跟 generateScript.js 完全一樣，把參數透給它：
 *   node src/produce.js .\photos\rose.jpg --name "永生玫瑰禮盒" --price "NT$1280" --notes "情人節熱賣"
 *   node src/produce.js .\photos\rose.jpg --web                     # 加開網路搜尋
 *   node src/produce.js .\photos\rose.jpg --lang tl                 # 只做他加祿語版影片
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import readline from "node:readline";
import { spawn } from "node:child_process";

function runNode(scriptPath, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath, ...args], { stdio: "inherit" });
    child.on("close", code => code === 0 ? resolve() : reject(new Error(`${path.basename(scriptPath)} 結束碼 ${code}`)));
  });
}

function findLatestJson() {
  const dir = path.resolve("output");
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir)
    .filter(f => f.endsWith(".json") && !f.endsWith("-audio.json"))
    .map(f => ({ f, m: fs.statSync(path.join(dir, f)).mtimeMs }))
    .sort((a, b) => b.m - a.m);
  return files[0] ? path.join(dir, files[0].f) : null;
}

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(r => rl.question(question, ans => { rl.close(); r(ans.trim().toLowerCase()); }));
}

function openEditor(filePath) {
  return new Promise(resolve => {
    const platform = process.platform;
    const [cmd, args] = platform === "win32"
      ? ["notepad", [filePath]]
      : platform === "darwin"
      ? ["open", ["-W", "-t", filePath]]
      : [process.env.EDITOR || "nano", [filePath]];
    const child = spawn(cmd, args, { stdio: "inherit" });
    child.on("close", () => resolve());
    child.on("error", () => resolve());
  });
}

// 把參數切兩段：Phase 1 用的 (圖片、--name 等) vs Phase 3 用的 (--lang、--music、--logo、--photos、--no-music、--no-logo)
function partitionArgs(argv) {
  const p3Keys = new Set(["--lang", "--music", "--logo", "--no-music", "--no-logo", "--photos"]);
  const p1 = [], p3 = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--lang" || a === "--music" || a === "--logo") { p3.push(a, argv[++i]); }
    else if (a === "--no-music" || a === "--no-logo") { p3.push(a); }
    else if (a === "--photos") {
      p3.push(a);
      while (i + 1 < argv.length && !argv[i + 1].startsWith("--")) p3.push(argv[++i]);
    }
    else p1.push(a);
  }
  return { p1, p3 };
}

async function reviewGate(jsonPath) {
  console.log("\n" + "━".repeat(56));
  console.log(`📝 審稿閘門：${path.relative(process.cwd(), jsonPath)}`);
  console.log("━".repeat(56));
  console.log("  上面終端機已印出腳本內容。看完之後選擇：");
  console.log("    [Enter] 接受，繼續做旁白 + 影片");
  console.log("    [e]     用記事本開啟 JSON 修改後再繼續");
  console.log("    [q]     結束（保留 JSON，之後可手動執行下游）");
  while (true) {
    const ans = await ask("\n> ");
    if (ans === "" || ans === "y") return true;
    if (ans === "q" || ans === "n") return false;
    if (ans === "e") {
      console.log(`  📂 開啟編輯器（關閉視窗後會繼續）…`);
      await openEditor(jsonPath);
      console.log(`  ✅ 已存檔。再按 Enter 繼續，或 [e] 再開一次，或 [q] 結束。`);
    } else {
      console.log("  （未知指令，請按 Enter / e / q）");
    }
  }
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv.includes("-h") || argv.includes("--help")) {
    console.log(`
BINI Blooms 一鍵製作：照片 → 腳本 → 旁白 → 9:16 MP4

用法：node src/produce.js <照片...> [選項]

Phase 1 選項（傳給 generateScript.js）：
  --name <文字>  --price <文字>  --notes <文字>  --seconds <數字>
  --web                          開啟網路搜尋（多 ~$0.01–0.03）

Phase 3 選項（傳給 composeVideo.js）：
  --lang <en|tl|all>  --music <path>  --logo <path>
  --no-music  --no-logo  --photos <p1 p2 ...>

範例：
  node src/produce.js .\\photos\\rose.jpg --name "永生玫瑰禮盒" --price "NT$1280" --notes "情人節熱賣" --web
`);
    process.exit(0);
  }

  const { p1, p3 } = partitionArgs(argv);

  console.log("🎬 一鍵流程啟動\n");
  console.log("━━━ Phase 1：照片 → 雙語腳本 ━━━");
  await runNode(path.resolve("src/generateScript.js"), p1);

  const jsonPath = findLatestJson();
  if (!jsonPath) { console.error("\n❌ 沒找到剛產出的腳本 JSON"); process.exit(1); }

  if (!await reviewGate(jsonPath)) {
    console.log(`\n👋 已停在 Phase 1。腳本檔：${path.relative(process.cwd(), jsonPath)}`);
    console.log("   想單獨繼續：node src/synthesize.js && node src/composeVideo.js");
    return;
  }

  console.log("\n━━━ Phase 2：腳本 → 旁白語音（英文 + 他加祿語）━━━");
  await runNode(path.resolve("src/synthesize.js"), [jsonPath]);

  console.log("\n━━━ Phase 3：照片 + 音檔 + 字幕 → 9:16 MP4 ━━━");
  await runNode(path.resolve("src/composeVideo.js"), [jsonPath, ...p3]);

  console.log("\n🎉 全部完成！可以上傳 FB Reels / TikTok 了。");
}

main().catch(err => { console.error("\n❌ 失敗：", err.message); process.exit(1); });
