# 📷 產品圖片搜尋工具 (Product Image Search Tool)

一個強大的 Web 應用，可自動在網絡上搜尋高清產品圖片，支援批量處理和 Excel 導入/導出。

## ✨ 功能特性

- **單一搜尋**: 輸入產品名稱，快速搜尋高清圖片
- **批量搜尋**: 支援 Excel 文件導入，一次搜尋多個產品
- **多平台搜尋**: 整合 Bing 和 Google 圖片搜尋結果
- **水印檢測**: 自動檢測並標記含水印的圖片
- **URL 匯出**: 將搜尋結果匯出為 Excel 文件
- **搜尋記錄**: 自動保存搜尋歷史記錄
- **響應式設計**: 完美支援桌面和移動設備

## 🚀 快速開始

### 1. 環境要求
- Python 3.8+
- pip 套件管理器

### 2. 安裝依賴
```bash
pip install -r requirements.txt
```

### 3. 執行應用
```bash
python app.py
```

應用將在 `http://localhost:5000` 啟動

## 📖 使用指南

### 單一搜尋
1. 選擇「單一搜尋」標籤
2. 輸入產品名稱（如：「Apple iPhone 15 Pro」）
3. 點擊「搜尋」按鈕
4. 查看搜尋結果和圖片 URL

### 批量搜尋
1. 選擇「批量搜尋」標籤
2. 拖拽或點擊上傳 Excel 文件
3. 確認產品列表
4. 點擊「批量搜尋」開始搜尋
5. 搜尋完成後點擊「匯出結果」下載 Excel

### Excel 文件格式
Excel 文件應包含以下格式：
- 第一列：產品名稱
- 範例：
  ```
  產品名稱
  Apple iPhone 15 Pro
  Samsung Galaxy S24
  Sony WH-1000XM5
  ```

## 🏗️ 項目結構

```
DK-Boxes/
├── app.py                 # Flask 主應用
├── image_search.py        # 圖片搜尋模塊
├── excel_processor.py     # Excel 處理模塊
├── requirements.txt       # Python 依賴
├── templates/
│   └── index.html        # 網頁模板
└── static/
    ├── css/
    │   └── style.css     # 樣式表
    └── js/
        └── app.js        # 前端邏輯
```

## 🔧 API 端點

- `GET /` - 首頁
- `POST /api/search` - 單一產品搜尋
- `POST /api/search-batch` - 批量搜尋
- `POST /api/upload-excel` - 上傳 Excel 文件
- `POST /api/export-results` - 匯出搜尋結果
- `GET /api/health` - 健康檢查

## 📝 API 請求示例

### 單一搜尋
```bash
curl -X POST http://localhost:5000/api/search \
  -H "Content-Type: application/json" \
  -d '{"product_name": "iPhone 15"}'
```

### 上傳 Excel
```bash
curl -X POST http://localhost:5000/api/upload-excel \
  -F "file=@products.xlsx"
```

## ⚙️ 配置說明

### 修改搜尋結果數量
編輯 `image_search.py` 中的 `search()` 方法：
```python
return unique_results[:max_results]  # 修改 max_results 值
```

### 修改水印檢測關鍵字
編輯 `image_search.py` 中的 `watermark_keywords` 列表：
```python
self.watermark_keywords = [
    'watermark', 'getty', 'shutterstock', ...
]
```

## 🐛 常見問題

**Q: 搜尋速度很慢？**
A: 首次搜尋可能需要 5-15 秒，這是正常的。網絡速度和搜尋引擎響應時間會影響速度。

**Q: 某些圖片 URL 無法訪問？**
A: 部分搜尋結果可能來自已刪除或需要登錄的頁面。建議選擇多個搜尋結果。

**Q: 如何增加搜尋結果？**
A: 修改 `app.py` 中 `search()` 的 `max_results` 參數或在 `image_search.py` 中添加新的搜尋源。

## 🔐 注意事項

- 本工具僅供合法使用
- 請尊重圖片版權和知識產權
- 不建議自動批量下載圖片
- 某些搜尋引擎可能有速率限制

## 📄 許可證

MIT License

## 👨‍💻 開發者

Created with ❤️ for DK-Boxes

---

## 更新日誌

### v1.0.0 (2026-05-24)
- ✅ 完成基礎功能開發
- ✅ 實現單一和批量搜尋
- ✅ 新增 Excel 導入導出功能
- ✅ 整合多平台圖片搜尋
- ✅ 實現水印檢測功能
- ✅ 添加搜尋記錄功能