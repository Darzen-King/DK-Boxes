@echo off
chcp 65001 >nul
title BINI Blooms 製作工具
cd /d "%~dp0"

echo.
echo ════════════════════════════════════
echo   🌸 BINI Blooms 宣傳影片製作工具
echo ════════════════════════════════════
echo.

REM 偵測 node
where node >nul 2>&1
if errorlevel 1 (
  echo [錯誤] 找不到 Node.js
  echo.
  echo 請先到 https://nodejs.org 下載安裝 LTS 版本，再執行本檔案。
  echo.
  pause
  exit /b 1
)

REM 第一次跑：安裝套件
if not exist "node_modules" (
  echo 第一次啟動，安裝必要套件中（約 1–2 分鐘，請耐心等候）…
  echo.
  call npm install
  if errorlevel 1 (
    echo.
    echo [錯誤] npm install 失敗。請檢查網路連線後重試。
    pause
    exit /b 1
  )
  echo.
)

REM 提醒沒設定金鑰
if not exist ".env" (
  echo [警告] 沒找到 .env 檔，AI 功能會無法使用。
  echo        請先複製 .env.example 為 .env 並填入 ANTHROPIC_API_KEY。
  echo.
  timeout /t 5 >nul
)

echo 啟動中… 瀏覽器會自動開啟 http://localhost:3000
echo.
echo ──────────────────────────────────────
echo  關掉這個視窗就會停止服務。
echo  使用中請保持視窗開啟。
echo ──────────────────────────────────────
echo.

call npm run ui

echo.
echo 服務已停止。按任意鍵關閉視窗…
pause >nul
