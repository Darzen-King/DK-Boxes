@echo off
REM 產品圖片搜尋工具啟動腳本（Windows）

setlocal enabledelayedexpansion

echo 🔍 檢查 Python 環境...

python --version >nul 2>&1
if errorlevel 1 (
    echo ❌ 未找到 Python。請先安裝 Python 3.8+
    echo 📥 下載地址: https://www.python.org/downloads/
    pause
    exit /b 1
)

echo ✅ Python 環境檢查通過

REM 檢查虛擬環境
if not exist "venv" (
    echo 📦 創建虛擬環境...
    python -m venv venv
)

REM 激活虛擬環境
echo 🔧 激活虛擬環境...
call venv\Scripts\activate.bat

REM 安裝依賴
echo 📥 安裝依賴套件...
pip install -r requirements.txt

REM 啟動應用
echo.
echo 🚀 啟動產品圖片搜尋工具...
echo 📌 訪問地址: http://localhost:5000
echo 🛑 按 Ctrl+C 停止應用
echo.

python app.py

pause
