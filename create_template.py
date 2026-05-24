#!/usr/bin/env python3
"""
創建 Excel 模板文件的腳本
用於幫助用戶準備批量搜尋的 Excel 文件
"""

from excel_processor import ExcelProcessor
import os

def create_example_template():
    """創建示例 Excel 模板"""
    processor = ExcelProcessor()

    print("📋 正在創建 Excel 模板...")

    try:
        template_path = processor.create_template()
        print(f"✅ 模板已成功創建！")
        print(f"📁 文件位置: {template_path}")
        print(f"📥 您可以下載此文件並添加產品名稱")
        print(f"\n📝 使用方式:")
        print("1. 打開生成的 Excel 文件")
        print("2. 在「產品列表」工作表中添加更多產品名稱")
        print("3. 在網頁應用中上傳此文件進行批量搜尋")

        return template_path
    except Exception as e:
        print(f"❌ 創建模板失敗: {e}")
        return None

if __name__ == '__main__':
    create_example_template()
