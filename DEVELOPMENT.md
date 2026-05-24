# 開發指南 (Development Guide)

## 本地開發設置

### Windows 用戶

1. **安裝 Python**
   - 下載 Python 3.8+ 從 [python.org](https://www.python.org/downloads/)
   - 安裝時勾選「Add Python to PATH」

2. **克隆項目**
   ```bash
   git clone https://github.com/Darzen-King/DK-Boxes.git
   cd DK-Boxes
   ```

3. **快速啟動**
   - 直接雙擊 `run.bat` 文件
   - 或在命令提示符中執行：
   ```bash
   run.bat
   ```

### macOS/Linux 用戶

1. **安裝 Python**
   ```bash
   # macOS (使用 Homebrew)
   brew install python3
   
   # Ubuntu/Debian
   sudo apt-get install python3 python3-pip
   ```

2. **克隆項目**
   ```bash
   git clone https://github.com/Darzen-King/DK-Boxes.git
   cd DK-Boxes
   ```

3. **快速啟動**
   ```bash
   chmod +x run.sh
   ./run.sh
   ```

## 詳細手動設置

### 1. 建立虛擬環境
```bash
python3 -m venv venv
```

### 2. 激活虛擬環境
- **Windows:**
  ```bash
  venv\Scripts\activate
  ```
- **macOS/Linux:**
  ```bash
  source venv/bin/activate
  ```

### 3. 安裝依賴
```bash
pip install -r requirements.txt
```

### 4. 啟動應用
```bash
python3 app.py
```

### 5. 訪問應用
在瀏覽器中打開：`http://localhost:5000`

## 項目結構說明

```
DK-Boxes/
├── app.py                      # Flask 主應用程序
│   └── 路由和 API 端點定義
│
├── image_search.py             # 圖片搜尋核心模塊
│   ├── ImageSearcher 類
│   ├── Bing 搜尋實現
│   ├── Google 搜尋實現
│   └── 水印檢測邏輯
│
├── excel_processor.py          # Excel 文件處理
│   ├── 讀取 Excel
│   ├── 寫入 Excel
│   └── 創建模板
│
├── templates/
│   └── index.html             # 前端主頁面
│       ├── HTML 結構
│       └── 標籤頁面佈局
│
├── static/
│   ├── css/
│   │   └── style.css          # 樣式表
│   │       ├── 佈局和配色
│   │       ├── 動畫和過渡
│   │       └── 響應式設計
│   │
│   └── js/
│       └── app.js             # 前端邏輯
│           ├── 搜尋功能
│           ├── Excel 處理
│           ├── 結果展示
│           └── 歷史記錄
│
├── requirements.txt           # Python 依賴列表
├── run.sh                      # Linux/macOS 啟動腳本
├── run.bat                     # Windows 啟動腳本
├── README.md                   # 項目文檔
└── DEVELOPMENT.md            # 本文檔
```

## 代碼架構

### 後端架構 (Python)

**Flask 應用程序流程：**
```
request → app.py (路由) → image_search.py (邏輯) → response
                      ↓
                excel_processor.py (處理 Excel)
```

**圖片搜尋流程：**
```
product_name → ImageSearcher.search()
            → _search_bing() + _search_google()
            → 去重和排序
            → 返回結果
```

### 前端架構 (JavaScript)

**應用程序類：ProductImageSearcher**
```
初始化 → 事件監聽 → API 調用 → 結果渲染 → 本地存儲
```

**主要方法：**
- `searchSingle()` - 單一搜尋
- `searchBatch()` - 批量搜尋
- `handleExcelUpload()` - 上傳 Excel
- `exportResults()` - 匯出結果

## 常見開發任務

### 添加新的搜尋源

在 `image_search.py` 的 `search()` 方法中添加新的搜尋函數：

```python
def search(self, product_name, max_results=20):
    all_results = []
    
    # 現有源
    try:
        bing_results = self._search_bing(product_name, max_results // 2)
        all_results.extend(bing_results)
    except Exception as e:
        print(f"Bing search failed: {e}")
    
    # 新增源
    try:
        new_results = self._search_new_source(product_name, max_results // 2)
        all_results.extend(new_results)
    except Exception as e:
        print(f"New source search failed: {e}")
    
    # 後續處理...
```

### 修改水印檢測

編輯 `image_search.py` 中的 `watermark_keywords`：

```python
self.watermark_keywords = [
    'watermark', 'getty', 'shutterstock',  # 英文
    '水印', '圖片來自', '版權',             # 中文
    'istockphoto', 'alamy'                 # 其他
]
```

### 自定義 UI 樣式

編輯 `static/css/style.css` 修改顏色或佈局：

```css
/* 修改主色 */
.header {
    background: linear-gradient(135deg, #your-color-1 0%, #your-color-2 100%);
}

/* 修改按鈕 */
.btn-primary {
    background: linear-gradient(135deg, #your-color-1 0%, #your-color-2 100%);
}
```

### 調整搜尋參數

在 `app.py` 的 `search_product()` 函數中修改：

```python
@app.route('/api/search', methods=['POST'])
def search_product():
    data = request.get_json()
    product_name = data.get('product_name', '').strip()
    
    try:
        results = searcher.search(product_name, max_results=30)  # 修改這裡
        # ...
```

## 調試技巧

### 啟用調試模式

在 `app.py` 中已經啟用了調試模式：
```python
app.run(debug=True, host='0.0.0.0', port=5000)
```

### 查看服務器日誌

運行應用時會在終端顯示所有請求和錯誤。

### 瀏覽器開發者工具

按 `F12` 打開開發者工具查看：
- 網絡請求 (Network 標籤)
- 控制台錯誤 (Console 標籤)
- 存儲的數據 (Application 標籤)

### 測試 API 端點

使用 curl 測試：
```bash
# 測試單一搜尋
curl -X POST http://localhost:5000/api/search \
  -H "Content-Type: application/json" \
  -d '{"product_name": "iPhone"}'

# 測試健康檢查
curl http://localhost:5000/api/health
```

## 依賴說明

| 套件 | 版本 | 用途 |
|------|------|------|
| Flask | 2.3.2 | Web 框架 |
| Flask-CORS | 4.0.0 | 跨域請求支援 |
| requests | 2.31.0 | HTTP 請求 |
| beautifulsoup4 | 4.12.2 | HTML 解析 |
| openpyxl | 3.1.2 | Excel 處理 |
| Pillow | 10.0.0 | 圖片處理 |

## 性能優化建議

1. **緩存搜尋結果**
   ```python
   # 可以使用 Flask-Caching
   from flask_caching import Cache
   ```

2. **異步搜尋**
   ```python
   # 使用 Celery 處理長時間任務
   from celery import Celery
   ```

3. **限制請求頻率**
   ```python
   # 使用 Flask-Limiter
   from flask_limiter import Limiter
   ```

## 測試

### 手動測試清單

- [ ] 單一搜尋功能
- [ ] 批量 Excel 上傳
- [ ] 搜尋結果顯示
- [ ] URL 複製功能
- [ ] Excel 匯出功能
- [ ] 搜尋歷史記錄
- [ ] 響應式設計（手機端）

### 自動化測試

可以添加 pytest 進行單元測試：
```bash
pip install pytest
pytest tests/
```

## 部署指南

### 使用 Gunicorn (生產環境)

```bash
pip install gunicorn
gunicorn -w 4 -b 0.0.0.0:5000 app:app
```

### 使用 Docker

創建 `Dockerfile`：
```dockerfile
FROM python:3.9-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt
COPY . .
CMD ["python", "app.py"]
```

運行：
```bash
docker build -t product-image-searcher .
docker run -p 5000:5000 product-image-searcher
```

## 常見問題

**Q: 應用啟動失敗？**
A: 確保 Python 版本是 3.8+，檢查依賴是否正確安裝。

**Q: 搜尋結果為空？**
A: 檢查網絡連接，或者搜尋引擎可能有速率限制。

**Q: Excel 文件上傳失敗？**
A: 確保文件格式正確（.xlsx 或 .xls），且第一列包含產品名稱。

## 貢獻指南

1. 創建新的功能分支
2. 提交清晰的 commit 信息
3. 測試所有新功能
4. 提交 Pull Request

## 聯繫方式

有任何問題，請提交 Issue 或聯繫開發團隊。

---

**最後更新：2026-05-24**
