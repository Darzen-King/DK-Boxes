# BINI Blooms 製作工具 — PowerShell 啟動腳本
# 由 start-bini.bat 呼叫；錯誤時視窗不會自動關閉
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

Write-Host ""
Write-Host "════════════════════════════════════"
Write-Host "  🌸 BINI Blooms 宣傳影片製作工具" -ForegroundColor Magenta
Write-Host "════════════════════════════════════"
Write-Host ""

function Fail($msg) {
  Write-Host ""
  Write-Host "[錯誤] $msg" -ForegroundColor Red
  Write-Host ""
  Read-Host "按 Enter 結束"
  exit 1
}

# 1. Node 是否裝好
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Fail "找不到 Node.js。請先到 https://nodejs.org 下載安裝 LTS 版本。"
}
Write-Host "✓ Node.js $(node --version)" -ForegroundColor Green

# 2. 套件是否齊全（檢查 express 是否存在，因為 Phase 4 才加的）
$expressInstalled = Test-Path "node_modules\express\package.json"
$modulesExist = Test-Path "node_modules"

if (-not $modulesExist -or -not $expressInstalled) {
  if (-not $modulesExist) {
    Write-Host "第一次啟動，安裝必要套件中（約 1–2 分鐘）…" -ForegroundColor Yellow
  } else {
    Write-Host "偵測到新套件（express / multer），安裝中…" -ForegroundColor Yellow
  }
  Write-Host ""
  npm install
  if ($LASTEXITCODE -ne 0) {
    Fail "npm install 失敗（exit $LASTEXITCODE）。請檢查網路後重試。"
  }
  Write-Host ""
}
Write-Host "✓ 套件就緒" -ForegroundColor Green

# 3. .env 是否設好
if (-not (Test-Path ".env")) {
  Write-Host ""
  Write-Host "[警告] 沒找到 .env 檔" -ForegroundColor Yellow
  Write-Host "       AI 功能會無法使用，請先複製 .env.example 為 .env 並填入 ANTHROPIC_API_KEY"
  Write-Host ""
  Start-Sleep -Seconds 4
} else {
  Write-Host "✓ .env 存在" -ForegroundColor Green
}

Write-Host ""
Write-Host "──────────────────────────────────────"
Write-Host " 🌸 製作工具運行中"
Write-Host " 瀏覽器將自動開啟 http://localhost:3000"
Write-Host ""
Write-Host " ⚠ 不要關掉這個視窗，要用完才能關"
Write-Host "   （可以把視窗縮到工具列繼續用瀏覽器）"
Write-Host "──────────────────────────────────────"
Write-Host ""

# 啟動 server（阻塞）
try {
  npm run ui
} catch {
  Write-Host ""
  Write-Host "[錯誤] 啟動失敗：$_" -ForegroundColor Red
}

Write-Host ""
Read-Host "服務已停止。按 Enter 關閉視窗"
