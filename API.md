# API 文檔

## 概述

本應用提供 RESTful API 用於產品圖片搜尋和 Excel 文件處理。

**基礎 URL：** `http://localhost:5000/api`

---

## 端點列表

### 1. 健康檢查

**端點：** `GET /api/health`

**描述：** 檢查服務器是否在線

**響應：**
```json
{
    "status": "ok"
}
```

---

### 2. 單一產品搜尋

**端點：** `POST /api/search`

**描述：** 搜尋單個產品的圖片

**請求：**
```json
{
    "product_name": "Apple iPhone 15 Pro"
}
```

**響應（成功）：**
```json
{
    "success": true,
    "product_name": "Apple iPhone 15 Pro",
    "count": 20,
    "images": [
        {
            "url": "https://example.com/image1.jpg",
            "title": "Apple iPhone 15 Pro",
            "source": "Bing",
            "has_watermark": false,
            "quality_score": 85
        },
        {
            "url": "https://example.com/image2.jpg",
            "title": "iPhone 15 Pro official",
            "source": "Google",
            "has_watermark": false,
            "quality_score": 90
        }
    ]
}
```

**響應（失敗）：**
```json
{
    "error": "請輸入產品名稱"
}
```

**使用 curl：**
```bash
curl -X POST http://localhost:5000/api/search \
  -H "Content-Type: application/json" \
  -d '{"product_name": "iPhone 15"}'
```

**使用 Python：**
```python
import requests

url = "http://localhost:5000/api/search"
data = {"product_name": "iPhone 15"}
response = requests.post(url, json=data)
print(response.json())
```

**使用 JavaScript：**
```javascript
fetch('/api/search', {
    method: 'POST',
    headers: {
        'Content-Type': 'application/json'
    },
    body: JSON.stringify({
        product_name: 'iPhone 15'
    })
})
.then(response => response.json())
.then(data => console.log(data));
```

---

### 3. 上傳 Excel 文件

**端點：** `POST /api/upload-excel`

**描述：** 上傳 Excel 文件並讀取產品列表

**請求：**
- 方法：`POST`
- Content-Type：`multipart/form-data`
- 參數：
  - `file`：Excel 文件（.xlsx 或 .xls）

**響應（成功）：**
```json
{
    "success": true,
    "products": [
        "Apple iPhone 15 Pro",
        "Samsung Galaxy S24",
        "Sony WH-1000XM5"
    ],
    "count": 3
}
```

**響應（失敗）：**
```json
{
    "error": "請上傳 Excel 文件"
}
```

**使用 curl：**
```bash
curl -X POST http://localhost:5000/api/upload-excel \
  -F "file=@products.xlsx"
```

**使用 Python：**
```python
import requests

with open('products.xlsx', 'rb') as f:
    files = {'file': f}
    response = requests.post('http://localhost:5000/api/upload-excel', files=files)
    print(response.json())
```

**使用 JavaScript：**
```javascript
const formData = new FormData();
const fileInput = document.getElementById('fileInput');
formData.append('file', fileInput.files[0]);

fetch('/api/upload-excel', {
    method: 'POST',
    body: formData
})
.then(response => response.json())
.then(data => console.log(data));
```

---

### 4. 批量搜尋

**端點：** `POST /api/search-batch`

**描述：** 批量搜尋多個產品（Server-Sent Events）

**請求：**
```json
{
    "products": [
        "Apple iPhone 15 Pro",
        "Samsung Galaxy S24",
        "Sony WH-1000XM5"
    ]
}
```

**響應：**
使用 Server-Sent Events，每個產品返回進度信息：
```
data: {"progress": 33.33, "current": "Apple iPhone 15 Pro"}
data: {"progress": 66.67, "current": "Samsung Galaxy S24"}
data: {"progress": 100, "current": "Sony WH-1000XM5"}
```

**使用 JavaScript：**
```javascript
const eventSource = new EventSource('/api/search-batch');
eventSource.onmessage = function(event) {
    const data = JSON.parse(event.data);
    console.log(`進度: ${data.progress}% - ${data.current}`);
};
eventSource.onerror = function() {
    eventSource.close();
};
```

---

### 5. 匯出搜尋結果

**端點：** `POST /api/export-results`

**描述：** 將搜尋結果匯出為 Excel 文件

**請求：**
```json
{
    "results": {
        "Apple iPhone 15 Pro": {
            "images": [
                {
                    "url": "https://example.com/image1.jpg",
                    "source": "Bing",
                    "has_watermark": false,
                    "quality_score": 85
                }
            ],
            "count": 20
        }
    }
}
```

**響應：**
- Content-Type：`application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`
- 返回 Excel 文件的二進制內容

**使用 curl：**
```bash
curl -X POST http://localhost:5000/api/export-results \
  -H "Content-Type: application/json" \
  -d '{"results": {...}}' \
  -o result.xlsx
```

**使用 Python：**
```python
import requests

results = {
    "Apple iPhone 15 Pro": {
        "images": [...],
        "count": 20
    }
}

response = requests.post(
    'http://localhost:5000/api/export-results',
    json={"results": results}
)

with open('results.xlsx', 'wb') as f:
    f.write(response.content)
```

---

## 數據模型

### 圖片對象

```json
{
    "url": "string - 圖片 URL",
    "title": "string - 圖片標題或來源描述",
    "source": "string - 搜尋來源 (Bing/Google)",
    "has_watermark": "boolean - 是否含有水印",
    "quality_score": "integer - 質量評分 (0-100)"
}
```

### 搜尋結果對象

```json
{
    "product_name": "string - 產品名稱",
    "images": "Array<ImageObject> - 圖片列表",
    "count": "integer - 圖片數量"
}
```

---

## 錯誤處理

### 錯誤響應格式

```json
{
    "error": "string - 錯誤信息"
}
```

### HTTP 狀態碼

| 狀態碼 | 含義 |
|--------|------|
| 200 | 請求成功 |
| 400 | 請求參數錯誤 |
| 405 | 方法不允許 |
| 500 | 服務器錯誤 |

### 常見錯誤

| 錯誤信息 | 原因 | 解決方案 |
|---------|------|--------|
| 請輸入產品名稱 | product_name 為空 | 提供有效的產品名稱 |
| 請上傳文件 | 未上傳文件 | 提供 Excel 文件 |
| 請上傳 Excel 文件 | 文件格式不正確 | 使用 .xlsx 或 .xls 格式 |
| 讀取文件失敗 | 文件損壞或格式錯誤 | 確保 Excel 文件有效 |

---

## 速率限制

目前無速率限制，但長期運行可能遇到搜尋引擎的限制。建議：
- 批量搜尋時間間隔至少 1 秒
- 大量搜尋時添加延遲

---

## 使用示例

### 完整的 Python 工作流

```python
import requests
import json
import time

API_URL = "http://localhost:5000/api"

# 1. 搜尋單個產品
product = "Apple iPhone 15 Pro"
response = requests.post(f"{API_URL}/search", json={"product_name": product})
data = response.json()
print(f"找到 {data['count']} 張圖片")

# 2. 獲取搜尋結果
images = data['images']
for idx, img in enumerate(images[:3], 1):
    print(f"{idx}. {img['source']} - {img['url'][:50]}...")

# 3. 批量搜尋
products = ["iPhone", "Samsung", "Sony"]
batch_response = requests.post(
    f"{API_URL}/search-batch",
    json={"products": products}
)

# 4. 匯出結果
results = {product: {"images": images, "count": len(images)}}
export_response = requests.post(
    f"{API_URL}/export-results",
    json={"results": results}
)

with open("results.xlsx", "wb") as f:
    f.write(export_response.content)
print("✅ 結果已匯出到 results.xlsx")
```

### 完整的 JavaScript 工作流

```javascript
const API_URL = 'http://localhost:5000/api';

async function searchProduct(productName) {
    const response = await fetch(`${API_URL}/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ product_name: productName })
    });
    return await response.json();
}

async function uploadExcel(file) {
    const formData = new FormData();
    formData.append('file', file);
    
    const response = await fetch(`${API_URL}/upload-excel`, {
        method: 'POST',
        body: formData
    });
    return await response.json();
}

async function exportResults(results) {
    const response = await fetch(`${API_URL}/export-results`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ results })
    });
    
    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'results.xlsx';
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
}

// 使用示例
(async () => {
    // 1. 搜尋單個產品
    const result = await searchProduct('iPhone 15');
    console.log(`找到 ${result.count} 張圖片`);
    
    // 2. 導出結果
    await exportResults(result);
})();
```

---

## 跨域 (CORS) 支援

本 API 支援 CORS，可以從任何域名訪問。

**CORS 配置：**
- 允許所有來源
- 允許所有方法
- 允許常見請求頭

---

## 版本控制

**當前版本：** 1.0.0

**API 版本：** v1（未來可能升級為 v2 等）

---

## 最後更新

2026-05-24

---

## 反饋和建議

如有 API 改進建議，請提交 Issue 或 Pull Request。
