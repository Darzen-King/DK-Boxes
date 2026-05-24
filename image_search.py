import requests
from bs4 import BeautifulSoup
import json
import time
from urllib.parse import quote
import re

class ImageSearcher:
    def __init__(self):
        self.headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
        self.watermark_keywords = [
            'watermark', 'getty', 'shutterstock', 'dreamstime',
            'istockphoto', 'alamy', '圖片來自', '水印', 'logo'
        ]

    def search(self, product_name, max_results=20):
        """搜尋產品圖片，使用多個來源"""
        all_results = []

        # 嘗試從多個來源搜尋
        try:
            bing_results = self._search_bing(product_name, max_results // 2)
            all_results.extend(bing_results)
        except Exception as e:
            print(f"Bing search failed: {e}")

        try:
            google_results = self._search_google(product_name, max_results // 2)
            all_results.extend(google_results)
        except Exception as e:
            print(f"Google search failed: {e}")

        # 去重並排序
        unique_results = []
        seen_urls = set()

        for result in all_results:
            if result['url'] not in seen_urls:
                seen_urls.add(result['url'])
                unique_results.append(result)

        # 按質量排序（無水印的優先）
        unique_results.sort(key=lambda x: (x['has_watermark'], -x['quality_score']))

        return unique_results[:max_results]

    def _search_bing(self, product_name, max_results=10):
        """從 Bing 搜尋圖片"""
        results = []
        try:
            url = f"https://www.bing.com/images/search?q={quote(product_name)}&first=1&count={max_results}"
            response = requests.get(url, headers=self.headers, timeout=10)
            response.encoding = 'utf-8'

            # 使用 Bing 的 JSON 數據
            pattern = r'id="mmComponent_images_\d+"[^>]*data-json="([^"]*)"'
            matches = re.findall(pattern, response.text)

            for match in matches[:max_results]:
                try:
                    json_data = json.loads(match)
                    for item in json_data:
                        if 'murl' in item:
                            image_url = item.get('murl', '')
                            title = item.get('title', product_name)

                            if image_url and self._is_valid_url(image_url):
                                has_watermark = self._detect_watermark(title)
                                results.append({
                                    'url': image_url,
                                    'title': title,
                                    'source': 'Bing',
                                    'has_watermark': has_watermark,
                                    'quality_score': 85
                                })
                except:
                    continue

            # 使用備用方法：解析 HTML
            if not results:
                results.extend(self._parse_bing_html(response.text, product_name))

        except Exception as e:
            print(f"Error in Bing search: {e}")

        return results

    def _parse_bing_html(self, html_content, product_name):
        """解析 Bing HTML 內容"""
        results = []
        try:
            soup = BeautifulSoup(html_content, 'html.parser')
            img_containers = soup.find_all('a', {'class': 'iusc'})

            for container in img_containers[:15]:
                try:
                    # 從 data-m 屬性提取 JSON
                    data_m = container.get('data-m', '')
                    if data_m:
                        json_data = json.loads(data_m)
                        image_url = json_data.get('murl', '')
                        title = json_data.get('title', product_name)

                        if image_url and self._is_valid_url(image_url):
                            has_watermark = self._detect_watermark(title)
                            results.append({
                                'url': image_url,
                                'title': title,
                                'source': 'Bing',
                                'has_watermark': has_watermark,
                                'quality_score': 80
                            })
                except:
                    continue
        except:
            pass

        return results

    def _search_google(self, product_name, max_results=10):
        """從 Google Images 搜尋圖片"""
        results = []
        try:
            # Google Images URL
            url = f"https://www.google.com/search?q={quote(product_name)}&tbm=isch&ijn=0"
            response = requests.get(url, headers=self.headers, timeout=10)
            response.encoding = 'utf-8'

            # 提取圖片 URLs
            pattern = r'"imgUrl":"([^"]+)"'
            matches = re.findall(pattern, response.text)

            for img_url in matches[:max_results]:
                try:
                    # 解碼 URL
                    img_url = img_url.replace('\\/', '/')
                    if img_url.startswith('http') and self._is_valid_url(img_url):
                        has_watermark = self._detect_watermark(img_url)
                        results.append({
                            'url': img_url,
                            'title': product_name,
                            'source': 'Google',
                            'has_watermark': has_watermark,
                            'quality_score': 90
                        })
                except:
                    continue

        except Exception as e:
            print(f"Error in Google search: {e}")

        return results

    def _is_valid_url(self, url):
        """檢查 URL 是否有效"""
        if not url or not isinstance(url, str):
            return False
        return url.startswith('http://') or url.startswith('https://')

    def _detect_watermark(self, text):
        """檢測文字是否包含水印標記"""
        text_lower = text.lower()
        for keyword in self.watermark_keywords:
            if keyword in text_lower:
                return True
        return False

    def _verify_image_quality(self, url):
        """驗證圖片質量（檢查 URL 長度和格式）"""
        # 簡單的質量評分
        score = 100

        # 檢查常見的低質量標記
        if any(x in url.lower() for x in ['thumb', 'small', 'low', 'mini']):
            score -= 20

        # 檢查是否為高質量域名
        if any(x in url.lower() for x in ['cdn', 'images-na', 'media']):
            score += 10

        return score
