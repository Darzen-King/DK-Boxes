# CLAUDE.md — BINI Blooms / promo-video-tool 專案備忘

此檔由 Claude Code 在每次 session 開始時自動讀取，用來保存使用者偏好與已踩過的雷。

---

## 環境

- **使用者主要工作平台**：Windows 11 + PowerShell
- **店家用途**：BINI Blooms 花店/禮盒，主打菲律賓客群
- **目標社群**：FB Reels / TikTok，雙語（英文 + 他加祿語 Tagalog）
- **介面語言偏好**：繁體中文回覆

## 已踩過的雷（避免再犯）

### 1. Anthropic Billing 付款卡住 → 先建議「換裝置」而不是深挖前端

**事件**：使用者要儲值 USD 5 API credits，桌面 Chrome 的「Buy USD 5 of credits」按鈕一直灰色不能按。
我花了大量篇幅猜測：翻譯擴充、Billing address 收合、Stripe token 壞掉、Anthropic 風控…全部都不是。

**真實解法**：使用者改用 **iPhone Safari** 開同一頁，**直接付款成功**。

**下次遇到付款卡關，第一個建議就是**：
> 「先用手機（Safari/Chrome）開同一個 billing 頁試試。手機行動瀏覽器繞過桌面端常見的 cookie / 擴充 / Stripe iframe 相容性問題，多半 30 秒解決。」

排序原則：**換裝置 > 換瀏覽器 > 無痕模式 > 排查表單 > 聯絡客服**。
不要再從表單欄位開始猜。

### 2. 使用者只有「影片連結」時的處理方式

- 影片連結要先用 `yt-dlp` 下載到本機才能處理
- FB / TikTok / IG **沒有自動字幕** → 必須下載影片 + Whisper 轉文字
- YouTube 才能 `--write-auto-sub` 直接抓字幕
- Whisper `small` 模型對他加祿語+英文夾雜的辨識足以歸納風格，要逐字引用才升 `medium`

### 3. 語音克隆是法律敏感區

「旁白聲音像某人」= voice cloning。動工前**必須確認那個聲音是使用者本人、或有明確授權**。
不能在沒問清楚的狀況下就直接接 ElevenLabs cloning API。

### 4. git 操作環境

- 開發分支：`claude/photo-to-video-ai-evaluation-S8ENK`
- 使用者本機之前是手動複製檔案，沒 git clone → 不能 `git pull`
- 已導引改成正式 clone repo（在 `D:\Download\Claude Code\Claude Code原始程式檔\暫存檔\dk-boxes\`）

## 專案進度

- ✅ Phase 1：照片 → 雙語腳本（`src/generateScript.js`）
- ✅ Phase 1.5：風格學習（`src/buildStyleProfile.js` + `style-profile.json` 自動套用）
- ✅ Phase 2：腳本 → 旁白語音（`src/synthesize.js`，預設 edge-tts，可切 ElevenLabs）
- ✅ Phase 3：照片 + 音檔 + 字幕 → 9:16 直式 MP4（`src/composeVideo.js`，ffmpeg + Ken Burns + ASS 字幕 + Logo + BGM）
- ✅ 一鍵流程（`src/produce.js`）：三個 Phase 串接，Phase 1 後跳審稿閘門讓使用者確認/修改腳本
- ✅ 網路搜尋輔助（`generateScript.js --web`）：Claude 可選用 web_search 找趨勢/熱門 hashtag/季節梗
- ⏳ Phase 4：包成 localhost 小工具 UI
