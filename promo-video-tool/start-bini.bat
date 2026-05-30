@echo off
REM 此 .bat 只是 PowerShell 啟動腳本的薄包裝
REM 真正邏輯在 start-bini.ps1，錯誤時視窗不會自動消失
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -NoExit -File "%~dp0start-bini.ps1"
