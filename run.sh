#!/bin/bash

# 產品圖片搜尋工具啟動腳本

# 檢查 Python 版本
python_version=$(python3 --version 2>&1 | grep -oP '\d+\.\d+')
required_version="3.8"

if (( $(echo "$python_version < $required_version" | bc -l) )); then
    echo "❌ Python 版本過低。需要 3.8+，當前版本：$python_version"
    exit 1
fi

echo "✅ Python 版本檢查通過：$python_version"

# 檢查虛擬環境
if [ ! -d "venv" ]; then
    echo "📦 創建虛擬環境..."
    python3 -m venv venv
fi

# 激活虛擬環境
echo "🔧 激活虛擬環境..."
source venv/bin/activate

# 安裝依賴
echo "📥 安裝依賴套件..."
pip install -r requirements.txt

# 啟動應用
echo ""
echo "🚀 啟動產品圖片搜尋工具..."
echo "📌 訪問地址: http://localhost:5000"
echo "🛑 按 Ctrl+C 停止應用"
echo ""

python3 app.py
