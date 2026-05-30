# transcripts/ — 參考影片逐字稿

放在這個資料夾的 `.txt` / `.srt` / `.vtt` 檔，會被 `src/buildStyleProfile.js` 讀進去，
歸納成 `style-profile.json`（說話口吻、習慣用語、開場/收尾套路），讓 Phase 1 的
`generateScript.js` 在寫新腳本時自動模仿。

> 建議：丟 15–30 支代表性影片，太少風格抓不準、太多重複貢獻有限。

---

## 前置：裝工具（Windows PowerShell，一次性）

```powershell
winget install yt-dlp.yt-dlp        # 下載影片/字幕
winget install Gyan.FFmpeg          # Whisper 需要
pip install -U openai-whisper       # 本機轉逐字稿（需 Python）
```

裝完關掉再開新 PowerShell，確認：

```powershell
yt-dlp --version
ffmpeg -version
whisper --help
```

---

## 取得逐字稿（依平台選一條路）

### A) YouTube：直接抓自動字幕（最快，不用 Whisper）

```powershell
yt-dlp --write-auto-sub --sub-lang "tl,en" --skip-download `
       --sub-format "vtt" `
       -o "transcripts/%(title).80s.%(ext)s" `
       "<YouTube 連結>"
```

→ 直接在 `transcripts/` 產生 `.vtt`，工具會自動清掉時間軸再分析。

### B) Facebook / TikTok / Instagram：下載影片 → Whisper 轉文字

這些平台**沒有自動字幕**，所以要先下載再本機轉。

```powershell
# 1) 下載影片（FB Reel / TikTok / IG 公開貼文都可以）
yt-dlp -o "transcripts/%(title).80s.%(ext)s" "<影片連結>"

# 私人/不公開影片 → 從瀏覽器擴充 "Get cookies.txt LOCALLY" 匯出 cookies.txt
yt-dlp --cookies cookies.txt -o "transcripts/%(title).80s.%(ext)s" "<影片連結>"

# 2) 轉成他加祿語逐字稿（檔名有空白/特殊字元務必加雙引號）
whisper "transcripts\xxx.mp4" `
        --language Tagalog `
        --model small `
        --output_format txt `
        --output_dir transcripts
```

模型選擇：

| 模型 | 速度 | 用途 |
|---|---|---|
| `tiny` | 最快 | 試水溫 |
| `small` | 平衡 | **學風格夠用**（推薦） |
| `medium` | 慢、吃 ~5GB RAM | 需要逐字引用內容時再用 |

---

## 批次處理 20 支影片

```powershell
# 1) 把所有連結寫進 urls.txt（一行一個），然後一次抓完
yt-dlp -a urls.txt -o "transcripts/%(title).80s.%(ext)s"

# 2) 對整個資料夾跑 Whisper
whisper transcripts\*.mp4 `
        --language Tagalog `
        --model small `
        --output_format txt `
        --output_dir transcripts
```

---

## 跑風格檔

逐字稿就位後，回到專案根目錄：

```powershell
node src/buildStyleProfile.js
```

→ 產出 `style-profile.json`。之後 `node src/generateScript.js ...` 會自動套用。

---

## 注意事項

- **版權**：自己的影片最安全；他人影片學「用詞口吻」風險低，但**重製畫面或克隆人聲**有法律與平台條款風險。
- **影片檔可刪**：跑完 Whisper 拿到 `.txt` 後，`.mp4` 就不再需要，可清掉省空間。
- **準度誤差不致命**：Whisper 對他加祿語+英文夾雜偶爾會拼錯字，但句構/語碼轉換/口頭禪都會保留，風格歸納仍準確。
