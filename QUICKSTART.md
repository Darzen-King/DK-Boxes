# 🚀 快速開始指南

## 最快速啟動方式（推薦）

### Windows 用戶
1. 在項目根目錄找到 `run.bat`
2. 雙擊 `run.bat` 文件
3. 等待應用啟動（約 30-60 秒）
4. 自動打開 `http://localhost:5000`

### macOS/Linux 用戶
```bash
./run.sh
```

---

## 詳細步驟

### 1️⃣ 準備工作

**要求：**
- Python 3.8 或更高版本
- 至少 500MB 自由磁盤空間

**檢查 Python 版本：**
```bash
python3 --version
```

### 2️⃣ 下載項目

```bash
git clone https://github.com/Darzen-King/DK-Boxes.git
cd DK-Boxes
```

### 3️⃣ 選擇啟動方式

#### 方式 A：使用啟動腳本（推薦）

**Windows:**
```bash
run.bat
```

**macOS/Linux:**
```bash
chmod +x run.sh
./run.sh
```

#### 方式 B：手動啟動

```bash
# 1. 建立虛擬環境
python3 -m venv venv

# 2. 激活虛擬環境
# Windows:
venv\Scripts\activate
# macOS/Linux:
source venv/bin/activate

# 3. 安裝依賴
pip install -r requirements.txt

# 4. 啟動應用
python3 app.py
```

### 4️⃣ 訪問應用

打開瀏覽器，訪問：**http://localhost:5000**

---

## 基本使用

### 📌 單一搜尋

1. 點擊「單一搜尋」標籤
2. 在搜尋框輸入產品名稱
   - 例如：`Apple iPhone 15 Pro`
   - 或：`Sony WH-1000XM5 無線耳機`
3. 點擊「🔍 搜尋」按鈕
4. 等待結果加載（通常 5-15 秒）
5. 查看搜尋結果中的圖片 URL

**💡 提示：**
- 使用具體的產品名稱會獲得更好的結果
- 可以包含品牌、型號等信息

### 📊 批量搜尋

#### 準備 Excel 文件

1. **自動生成模板：**
   ```bash
   python3 create_template.py
   ```
   這將創建一個示例 Excel 文件 `product_template.xlsx`

2. **或手動創建：**
   - 在 Excel 中新建文件
   - 第一行標題：`產品名稱`
   - 後續行添加產品名稱

   **示例內容：**
   ```
   產品名稱
   Apple iPhone 15 Pro
   Samsung Galaxy S24 Ultra
   Sony WH-1000XM5
   Apple MacBook Pro 14
   ```

3. **保存為 Excel 格式** (.xlsx 或 .xls)

#### 執行批量搜尋

1. 點擊「批量搜尋」標籤
2. 拖拽或點擊上傳您的 Excel 文件
3. 確認產品列表
4. 點擊「🔍 批量搜尋」
5. 等待所有搜尋完成（通常 1-5 分鐘）
6. 點擊「📊 匯出結果」下載結果 Excel 文件

### 💾 導出結果

搜尋完成後，點擊「📊 匯出結果」：
- 將自動下載 Excel 文件
- 文件名格式：`product_images_YYYYMMDD_HHMMSS.xlsx`
- 包含所有搜尋結果和圖片 URL

**Excel 文件結構：**
| 產品名稱 | 序號 | 圖片 URL | 來源 | 是否含水印 |
|---------|------|---------|------|---------|
| iPhone | 1 | https://... | Bing | 否 |
| iPhone | 2 | https://... | Google | 否 |

### 📜 搜尋記錄

1. 點擊「搜尋記錄」標籤
2. 查看所有之前的搜尋記錄
3. 點擊任何記錄快速重新搜尋
4. 點擊「🗑️ 清空記錄」清除所有歷史

---

## 常見問題解決

### ❓ 應用無法啟動

**症狀：** 運行 `run.bat` 或 `run.sh` 後沒有反應

**解決方案：**
1. 檢查 Python 版本：`python3 --version`（需要 3.8+）
2. 確保所有依賴已安裝：`pip install -r requirements.txt`
3. 嘗試手動啟動：`python3 app.py`
4. 查看錯誤信息並根據提示安裝缺失的模塊

### ❓ 搜尋很慢或無結果

**症狀：** 搜尋 15 秒後仍無結果

**解決方案：**
1. 檢查網絡連接
2. 嘗試使用更通用的產品名稱
3. 某些搜尋引擎可能有地區限制或速率限制
4. 耐心等待，首次搜尋可能較慢

### ❓ Excel 上傳失敗

**症狀：** 「讀取文件失敗」錯誤

**解決方案：**
1. 確保文件是 `.xlsx` 或 `.xls` 格式
2. 確保第一列有產品名稱
3. 文件不超過 50MB
4. 不要在 Excel 中打開文件時上傳

### ❓ URL 無法打開

**症狀：** 複製的圖片 URL 無法訪問

**解決方案：**
1. 某些 URL 可能已過期或被刪除
2. 嘗試其他搜尋結果
3. 某些圖片可能需要登錄才能訪問
4. 檢查標記為「含水印」的圖片，質量可能較低

---

## 快速技巧

### 🎯 獲得最佳搜尋結果

1. **使用具體名稱：**
   - ✅ 好：`Apple iPhone 15 Pro Max 金色`
   - ❌ 差：`手機`

2. **包含型號/規格：**
   - ✅ `Sony PS5 遊戲機 黑色款`
   - ✅ `Dell XPS 13 筆記本電腦`

3. **中英文都可以：**
   - ✅ `MacBook Pro 16 2023`
   - ✅ `蘋果 MacBook Pro 16 2023`

### 📋 批量搜尋技巧

1. **使用模板：** 運行 `python3 create_template.py` 生成模板
2. **分類分批：** 相同類別的產品搜尋結果更佳
3. **定期導出：** 定期導出結果以防丟失

### 🔄 循環使用

1. 搜尋後點擊「📊 匯出結果」
2. 在 Excel 中編輯或添加備註
3. 稍後可以再上傳更新的列表進行新搜尋

---

## 下一步

- 📚 查看 [README.md](README.md) 了解詳細功能
- 👨‍💻 查看 [DEVELOPMENT.md](DEVELOPMENT.md) 進行二次開發
- 🐛 遇到問題？檢查 [README.md](README.md) 的常見問題部分

---

## 需要幫助？

如果遇到問題：

1. **查看日誌：** 檢查控制台輸出中的錯誤信息
2. **重新啟動：** 停止應用（Ctrl+C）並重新運行
3. **清除緩存：** 在瀏覽器中按 `Ctrl+Shift+Delete` 清除本地數據
4. **提交 Issue：** 在 GitHub 上提交詳細的 issue 說明

---

## 享受使用！ 🎉

現在你已經準備好使用產品圖片搜尋工具了。祝你使用愉快！

**需要生成 Excel 模板？**
```bash
python3 create_template.py
```

**快速訪問應用：**
http://localhost:5000

---

**版本：** 1.0.0  
**最後更新：** 2026-05-24
