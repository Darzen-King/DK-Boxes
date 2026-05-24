class ProductImageSearcher {
    constructor() {
        this.currentResults = {};
        this.searchHistory = JSON.parse(localStorage.getItem('searchHistory')) || [];
        this.batchProducts = [];
        this.init();
    }

    init() {
        this.setupEventListeners();
        this.renderHistory();
    }

    setupEventListeners() {
        // 標籤切換
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', (e) => this.switchTab(e.target.dataset.tab));
        });

        // 單一搜尋
        document.getElementById('searchBtn').addEventListener('click', () => this.searchSingle());
        document.getElementById('productInput').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.searchSingle();
        });

        // 批量上傳
        const uploadArea = document.getElementById('uploadArea');
        uploadArea.addEventListener('click', () => document.getElementById('excelFile').click());
        uploadArea.addEventListener('dragover', (e) => {
            e.preventDefault();
            uploadArea.classList.add('dragover');
        });
        uploadArea.addEventListener('dragleave', () => uploadArea.classList.remove('dragover'));
        uploadArea.addEventListener('drop', (e) => {
            e.preventDefault();
            uploadArea.classList.remove('dragover');
            const files = e.dataTransfer.files;
            if (files.length) this.handleExcelUpload(files[0]);
        });

        document.getElementById('excelFile').addEventListener('change', (e) => {
            if (e.target.files.length) this.handleExcelUpload(e.target.files[0]);
        });

        // 批量搜尋和匯出
        document.getElementById('batchSearchBtn').addEventListener('click', () => this.searchBatch());
        document.getElementById('exportBtn').addEventListener('click', () => this.exportResults());
        document.getElementById('clearHistoryBtn').addEventListener('click', () => this.clearHistory());
    }

    switchTab(tabName) {
        // 更新標籤按鈕
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.classList.remove('active');
        });
        event.target.classList.add('active');

        // 更新標籤內容
        document.querySelectorAll('.tab-content').forEach(content => {
            content.classList.remove('active');
        });
        document.getElementById(tabName).classList.add('active');
    }

    async searchSingle() {
        const productName = document.getElementById('productInput').value.trim();
        if (!productName) {
            this.showNotification('請輸入產品名稱', 'error');
            return;
        }

        this.showLoading(true);
        try {
            const response = await fetch('/api/search', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ product_name: productName })
            });

            if (!response.ok) throw new Error('搜尋失敗');
            const data = await response.json();

            if (data.success) {
                this.currentResults[productName] = data.images;
                this.renderResults(productName, data.images);
                this.addToHistory(productName, data.images.length);
                this.showNotification(`找到 ${data.count} 張圖片`, 'success');
            } else {
                throw new Error(data.error);
            }
        } catch (error) {
            this.showNotification(error.message, 'error');
        } finally {
            this.showLoading(false);
        }
    }

    async handleExcelUpload(file) {
        const formData = new FormData();
        formData.append('file', file);

        this.showLoading(true);
        try {
            const response = await fetch('/api/upload-excel', {
                method: 'POST',
                body: formData
            });

            if (!response.ok) throw new Error('上傳失敗');
            const data = await response.json();

            if (data.success) {
                this.batchProducts = data.products;
                this.renderBatchProducts();
                this.showNotification(`成功讀取 ${data.count} 個產品`, 'success');
            } else {
                throw new Error(data.error);
            }
        } catch (error) {
            this.showNotification(error.message, 'error');
        } finally {
            this.showLoading(false);
        }
    }

    renderBatchProducts() {
        const container = document.getElementById('batchProducts');
        container.classList.add('show');
        container.innerHTML = `<h3>已選擇 ${this.batchProducts.length} 個產品</h3>`;

        if (this.batchProducts.length > 0) {
            const productsList = document.createElement('div');
            productsList.className = 'products-list';

            this.batchProducts.forEach(product => {
                const tag = document.createElement('div');
                tag.className = 'product-tag';
                tag.innerHTML = `
                    ${product}
                    <span class="remove" onclick="app.removeProduct('${product}')">✕</span>
                `;
                productsList.appendChild(tag);
            });

            container.appendChild(productsList);
            document.getElementById('batchSearchBtn').style.display = 'inline-flex';
        }
    }

    removeProduct(product) {
        this.batchProducts = this.batchProducts.filter(p => p !== product);
        if (this.batchProducts.length === 0) {
            document.getElementById('batchProducts').classList.remove('show');
            document.getElementById('batchSearchBtn').style.display = 'none';
        } else {
            this.renderBatchProducts();
        }
    }

    async searchBatch() {
        if (this.batchProducts.length === 0) {
            this.showNotification('請先上傳 Excel 文件', 'error');
            return;
        }

        this.showLoading(true);
        const resultsContainer = document.getElementById('batchResults');
        resultsContainer.innerHTML = '';
        this.currentResults = {};

        try {
            for (let i = 0; i < this.batchProducts.length; i++) {
                const product = this.batchProducts[i];
                const response = await fetch('/api/search', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ product_name: product })
                });

                if (!response.ok) continue;
                const data = await response.json();

                if (data.success) {
                    this.currentResults[product] = data.images;
                    this.renderResults(product, data.images, resultsContainer);
                    this.addToHistory(product, data.images.length);
                }

                // 更新進度
                const progress = ((i + 1) / this.batchProducts.length) * 100;
                this.updateLoadingBar(progress);
            }

            document.getElementById('exportBtn').style.display = 'inline-flex';
            this.showNotification('批量搜尋完成', 'success');
        } catch (error) {
            this.showNotification(error.message, 'error');
        } finally {
            this.showLoading(false);
        }
    }

    renderResults(productName, images, container = document.getElementById('singleResults')) {
        const resultItem = document.createElement('div');
        resultItem.className = 'result-item';

        let imageHTML = '';
        if (images.length > 0) {
            imageHTML = `
                <div class="image-grid">
                    ${images.map((img, idx) => `
                        <div class="image-card">
                            <div class="image-placeholder">🖼️</div>
                            <div class="image-info">
                                <div class="image-source">${img.source}</div>
                                ${img.has_watermark ? '<span class="watermark-badge">⚠️ 含水印</span>' : ''}
                            </div>
                        </div>
                    `).join('')}
                </div>
                <div class="urls-list">
                    ${images.map((img, idx) => `
                        <div class="image-url">
                            <span style="flex: 1; word-break: break-all; margin-right: 10px;">${img.url.substring(0, 80)}...</span>
                            <button class="copy-btn" onclick="app.copyToClipboard('${img.url.replace(/'/g, "\\'")}')">複製</button>
                        </div>
                    `).join('')}
                </div>
            `;
        } else {
            imageHTML = '<div class="empty-state">找不到相關圖片</div>';
        }

        resultItem.innerHTML = `
            <div class="result-header">
                <span class="product-name">${productName}</span>
                <span class="image-count">${images.length} 張圖片</span>
            </div>
            ${imageHTML}
        `;

        container.appendChild(resultItem);
    }

    copyToClipboard(text) {
        navigator.clipboard.writeText(text).then(() => {
            this.showNotification('已複製到剪貼板', 'success');
        }).catch(() => {
            this.showNotification('複製失敗', 'error');
        });
    }

    async exportResults() {
        if (Object.keys(this.currentResults).length === 0) {
            this.showNotification('沒有搜尋結果可匯出', 'error');
            return;
        }

        this.showLoading(true);
        try {
            const response = await fetch('/api/export-results', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ results: this.currentResults })
            });

            if (!response.ok) throw new Error('匯出失敗');

            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `product_images_${new Date().toISOString().split('T')[0]}.xlsx`;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);

            this.showNotification('成功匯出 Excel 文件', 'success');
        } catch (error) {
            this.showNotification(error.message, 'error');
        } finally {
            this.showLoading(false);
        }
    }

    addToHistory(productName, imageCount) {
        this.searchHistory.unshift({
            product: productName,
            count: imageCount,
            timestamp: new Date().toLocaleString('zh-TW')
        });

        // 保持最多 50 條記錄
        if (this.searchHistory.length > 50) {
            this.searchHistory.pop();
        }

        localStorage.setItem('searchHistory', JSON.stringify(this.searchHistory));
        this.renderHistory();
    }

    renderHistory() {
        const historyList = document.getElementById('historyList');

        if (this.searchHistory.length === 0) {
            historyList.innerHTML = '<div class="empty-state">還沒有搜尋記錄</div>';
            return;
        }

        historyList.innerHTML = this.searchHistory.map((item, idx) => `
            <div class="history-card" onclick="app.searchFromHistory('${item.product}')">
                <div class="history-product">${item.product}</div>
                <div class="history-time">${item.timestamp}</div>
                <div class="history-count">${item.count} 張圖片</div>
            </div>
        `).join('');
    }

    searchFromHistory(productName) {
        document.getElementById('productInput').value = productName;
        document.querySelector('[data-tab="single"]').click();
        this.searchSingle();
    }

    clearHistory() {
        if (confirm('確定要清空所有搜尋記錄嗎？')) {
            this.searchHistory = [];
            localStorage.removeItem('searchHistory');
            this.renderHistory();
            this.showNotification('搜尋記錄已清空', 'success');
        }
    }

    showLoading(show) {
        const loadingBar = document.getElementById('loadingBar');
        if (show) {
            loadingBar.classList.add('active');
            const progress = loadingBar.querySelector('.progress');
            let width = 10;
            const interval = setInterval(() => {
                if (width < 90) {
                    width += Math.random() * 30;
                    progress.style.width = width + '%';
                }
            }, 200);
            loadingBar.dataset.interval = interval;
        } else {
            clearInterval(parseInt(loadingBar.dataset.interval));
            const progress = loadingBar.querySelector('.progress');
            progress.style.width = '100%';
            setTimeout(() => {
                loadingBar.classList.remove('active');
                progress.style.width = '0%';
            }, 300);
        }
    }

    updateLoadingBar(progress) {
        const progressBar = document.getElementById('loadingBar').querySelector('.progress');
        progressBar.style.width = progress + '%';
    }

    showNotification(message, type = 'info') {
        const notification = document.getElementById('notification');
        notification.textContent = message;
        notification.className = `notification show ${type}`;

        setTimeout(() => {
            notification.classList.remove('show');
        }, 3000);
    }
}

// 初始化應用
const app = new ProductImageSearcher();
