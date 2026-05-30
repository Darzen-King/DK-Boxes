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
  const template = path.join(destDir, "%(title).80s.%(ext)s");
  const args = [
    "--no-playlist",
    "--no-warnings",
    "--no-progress",
    "-f", "mp4/best[ext=mp4]/best",
    "-o", template,
    "--print", "after_move:filepath",
    url,
  ];
  const cookies = process.env.YTDLP_COOKIES;
  if (cookies && fs.existsSync(cookies)) args.unshift("--cookies", cookies);

  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let child;
    try {
      child = spawn("yt-dlp", args, { stdio: ["ignore", "pipe", "pipe"] });
    } catch (e) {
      if (e.code === "ENOENT") return reject(new Error("找不到 yt-dlp 指令。請先安裝：winget install yt-dlp.yt-dlp"));
      return reject(e);
    }
    child.stdout.on("data", b => { const s = b.toString("utf8"); stdout += s; if (onLog) onLog(s.trim()); });
    child.stderr.on("data", b => { const s = b.toString("utf8"); stderr += s; if (onLog) onLog(s.trim()); });
    child.on("error", err => {
      if (err.code === "ENOENT") return reject(new Error("找不到 yt-dlp 指令。請先安裝：winget install yt-dlp.yt-dlp"));
      reject(err);
    });
    child.on("close", code => {
      if (code !== 0) {
        const tail = stderr.split(/\r?\n/).filter(Boolean).slice(-5).join("\n");
        return reject(new Error(`yt-dlp 結束碼 ${code}\n${tail || stdout.slice(-300)}`));
      }
      const finalPath = stdout.trim().split(/\r?\n/).filter(Boolean).pop();
      if (finalPath && fs.existsSync(finalPath)) resolve(path.resolve(finalPath));
      else reject(new Error("yt-dlp 沒輸出檔案路徑，可能需要 cookies（私人/需登入的影片）"));
    });
  });
}
