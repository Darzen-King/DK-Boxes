/**
 * yt-dlp 包裝：把 URL 下載成本機 mp4，提供 server 與 CLI 共用。
 */
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

export function isUrl(s) {
  return typeof s === "string" && /^https?:\/\//i.test(s.trim());
}

/**
 * 下載一個 URL 到 destDir，回傳最終檔案絕對路徑。
 * @param {string} url
 * @param {string} destDir
 * @param {(line: string) => void} [onLog]  逐行回報 yt-dlp 進度（給 SSE 用）
 */
export function downloadVideo(url, destDir, onLog) {
  fs.mkdirSync(destDir, { recursive: true });

  // 用「下載前後 uploads/ 多了什麼檔」的方式偵測產出，不依賴 stdout 文字
  // （Windows 上 yt-dlp 中文/全形字元的 stdout 編碼跟 Node 讀的常對不上）
  const before = new Set(fs.readdirSync(destDir));

  const template = path.join(destDir, "%(title).80s.%(ext)s");
  const args = [
    "--no-playlist",
    "--no-warnings",
    "-f", "mp4/best[ext=mp4]/best",
    "-o", template,
    url,
  ];
  const cookies = process.env.YTDLP_COOKIES;
  if (cookies && fs.existsSync(cookies)) args.unshift("--cookies", cookies);

  return new Promise((resolve, reject) => {
    let stderr = "";
    let child;
    try {
      child = spawn("yt-dlp", args, { stdio: ["ignore", "pipe", "pipe"] });
    } catch (e) {
      if (e.code === "ENOENT") return reject(new Error("找不到 yt-dlp 指令。請先安裝：winget install yt-dlp.yt-dlp"));
      return reject(e);
    }
    child.stdout.on("data", b => { if (onLog) onLog(b.toString("utf8").trim()); });
    child.stderr.on("data", b => {
      const s = b.toString("utf8");
      stderr += s;
      if (onLog) onLog(s.trim());
    });
    child.on("error", err => {
      if (err.code === "ENOENT") return reject(new Error("找不到 yt-dlp 指令。請先安裝：winget install yt-dlp.yt-dlp"));
      reject(err);
    });
    child.on("close", code => {
      if (code !== 0) {
        const tail = stderr.split(/\r?\n/).filter(Boolean).slice(-5).join("\n");
        return reject(new Error(`yt-dlp 結束碼 ${code}\n${tail || "（無錯誤輸出）"}`));
      }
      // 比對 destDir 多了哪些媒體檔，挑最大的當結果
      const after = fs.readdirSync(destDir);
      const newMedia = after
        .filter(f => !before.has(f))
        .filter(f => /\.(mp4|webm|mkv|mov|m4a|avi|flv)$/i.test(f))
        .map(f => {
          const full = path.join(destDir, f);
          return { full, size: fs.statSync(full).size };
        })
        .sort((a, b) => b.size - a.size);
      if (newMedia.length === 0) {
        return reject(new Error("下載完成但 uploads/ 沒有新影片檔，可能需要 cookies（私人/需登入的影片）"));
      }
      resolve(path.resolve(newMedia[0].full));
    });
  });
}
