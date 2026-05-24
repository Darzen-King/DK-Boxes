from flask import Flask, render_template, request, jsonify, send_file
from flask_cors import CORS
import os
from image_search import ImageSearcher
from excel_processor import ExcelProcessor
import json
from datetime import datetime

app = Flask(__name__)
CORS(app)
app.config['MAX_CONTENT_LENGTH'] = 50 * 1024 * 1024  # 50MB max file size

searcher = ImageSearcher()
excel_processor = ExcelProcessor()

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/api/search', methods=['POST'])
def search_product():
    """搜尋單個產品"""
    data = request.get_json()
    product_name = data.get('product_name', '').strip()

    if not product_name:
        return jsonify({'error': '請輸入產品名稱'}), 400

    try:
        results = searcher.search(product_name)
        return jsonify({
            'success': True,
            'product_name': product_name,
            'images': results,
            'count': len(results)
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/search-batch', methods=['POST'])
def search_batch():
    """批量搜尋產品"""
    data = request.get_json()
    products = data.get('products', [])

    if not products:
        return jsonify({'error': '請提供產品列表'}), 400

    results = {}
    try:
        for idx, product in enumerate(products):
            product_name = product.strip()
            if product_name:
                images = searcher.search(product_name)
                results[product_name] = {
                    'images': images,
                    'count': len(images)
                }
            # 返回進度
            yield f"data: {json.dumps({'progress': (idx + 1) / len(products) * 100, 'current': product_name})}\n\n"
    except Exception as e:
        yield f"data: {json.dumps({'error': str(e)})}\n\n"

@app.route('/api/upload-excel', methods=['POST'])
def upload_excel():
    """上傳 Excel 文件"""
    if 'file' not in request.files:
        return jsonify({'error': '請上傳文件'}), 400

    file = request.files['file']
    if file.filename == '':
        return jsonify({'error': '請選擇文件'}), 400

    if not file.filename.endswith(('.xlsx', '.xls')):
        return jsonify({'error': '請上傳 Excel 文件'}), 400

    try:
        products = excel_processor.read_products(file)
        return jsonify({
            'success': True,
            'products': products,
            'count': len(products)
        })
    except Exception as e:
        return jsonify({'error': f'讀取文件失敗: {str(e)}'}), 500

@app.route('/api/export-results', methods=['POST'])
def export_results():
    """匯出搜尋結果為 Excel"""
    data = request.get_json()
    results = data.get('results', {})

    try:
        file_path = excel_processor.write_results(results)
        return send_file(file_path, as_attachment=True,
                        download_name=f'product_images_{datetime.now().strftime("%Y%m%d_%H%M%S")}.xlsx')
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/health', methods=['GET'])
def health():
    """健康檢查"""
    return jsonify({'status': 'ok'})

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000)
