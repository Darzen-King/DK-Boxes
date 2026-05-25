import requests
from bs4 import BeautifulSoup
import json
import time
from urllib.parse import quote, unquote
import re

class ImageSearcher:
    def __init__(self):
        self.headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Language': 'zh-TW,zh;q=0.9,en-US;q=0.8,en;q=0.7',
            'Referer': 'https://www.google.com/'
        }
        self.watermark_keywords = [
            'watermark', 'getty', 'shutterstock', 'dreamstime',
            'istockphoto', 'alamy', '圖片來自', '水印', 'logo'
        ]

    def search(self, product_name, max_results=20):
        """搜尋產品圖片，使用多個來源"""
        all_results = []

        # 優先搜尋 Bing（通常更穩定）
        try:
            bing_results = self._search_bing(product_name, max_results)
            all_results.extend(bing_results)
            print(f"Bing found {len(bing_results)} images for '{product_name}'")
        except Exception as e:
            print(f"Bing search error: {e}")

        # 補充 Google 搜尋
        try:
            google_results = self._search_google(product_name, max_results)
            all_results.extend(google_results)
            print(f"Google found {len(google_results)} images for '{product_name}'")
        except Exception as e:
            print(f"Google search error: {e}")

        # 去重並排序
        unique_results = []
        seen_urls = set()

        for result in all_results:
            if result['url'] not in seen_urls and self._is_valid_url(result['url']):
                seen_urls.add(result['url'])
                unique_results.append(result)

        # 按質量排序（無水印的優先）
        unique_results.sort(key=lambda x: (x['has_watermark'], -x['quality_score']))

        return unique_results[:max_results]

    def _search_bing(self, product_name, max_results=20):
        """從 Bing 搜尋圖片"""
        results = []
        try:
            # 使用 Bing 搜尋
            url = f"https://www.bing.com/images/search?q={quote(product_name)}&first=1&count=150"

            session = requests.Session()
            response = session.get(url, headers=self.headers, timeout=15)
            response.encoding = 'utf-8'

            # 方法 1：提取 JSON 數據
            pattern = r'"murl":"([^"]+)"'
            matches = re.findall(pattern, response.text)

            for img_url in matches:
                try:
                    img_url = unquote(img_url)
                    if img_url.startswith('http') and len(img_url) > 20:
                        has_watermark = self._detect_watermark(img_url + product_name)
                        results.append({
                            'url': img_url,
                            'title': product_name,
                            'source': 'Bing',
                            'has_watermark': has_watermark,
                            'quality_score': 85
                        })
                        if len(results) >= max_results:
                            break
                except:
                    continue

            # 方法 2：解析 IMG 標籤
            if len(results) < max_results // 2:
                soup = BeautifulSoup(response.text, 'html.parser')
                img_tags = soup.find_all('img', {'class': 'mimg'})

                for img in img_tags:
                    try:
                        src = img.get('src') or img.get('data-src')
                        if src and src.startswith('http'):
                            if src not in [r['url'] for r in results]:
                                results.append({
                                    'url': src,
                                    'title': product_name,
                                    'source': 'Bing',
                                    'has_watermark': False,
                                    'quality_score': 80
                                })
                                if len(results) >= max_results:
                                    break
                    except:
                        continue

        except Exception as e:
            print(f"Bing search error: {e}")

        return results[:max_results]

    def _search_google(self, product_name, max_results=20):
        """從 Google Images 搜尋圖片"""
        results = []
        try:
            url = f"https://www.google.com/search?q={quote(product_name)}&tbm=isch"

            session = requests.Session()
            response = session.get(url, headers=self.headers, timeout=15)
            response.encoding = 'utf-8'

            # 方法 1：提取 imgUrl 參數
            pattern = r'"imgUrl":"([^"\\]+(?:\\.[^"\\]*)*)"'
            matches = re.findall(pattern, response.text)

            for img_url in matches:
                try:
                    # 清理轉義字符
                    img_url = img_url.replace('\\/', '/')
                    if img_url.startswith('http') and len(img_url) > 20:
                        has_watermark = self._detect_watermark(img_url)
                        results.append({
                            'url': img_url,
                            'title': product_name,
                            'source': 'Google',
                            'has_watermark': has_watermark,
                            'quality_score': 88
                        })
                        if len(results) >= max_results:
                            break
                except:
                    continue

            # 方法 2：提取 actualImageUrl
            if len(results) < max_results // 2:
                pattern2 = r'"actualImageUrl":"([^"\\]+(?:\\.[^"\\]*)*)"'
                matches2 = re.findall(pattern2, response.text)

                for img_url in matches2:
                    try:
                        img_url = img_url.replace('\\/', '/')
                        if img_url.startswith('http') and img_url not in [r['url'] for r in results]:
                            results.append({
                                'url': img_url,
                                'title': product_name,
                                'source': 'Google',
                                'has_watermark': False,
                                'quality_score': 85
                            })
                            if len(results) >= max_results:
                                break
                    except:
                        continue

        except Exception as e:
            print(f"Google search error: {e}")

        return results[:max_results]

    def _is_valid_url(self, url):
        """檢查 URL 是否有效"""
        if not url or not isinstance(url, str):
            return False

        # 必須以 http 開頭
        if not (url.startswith('http://') or url.startswith('https://')):
            return False

        # URL 長度合理
        if len(url) < 20 or len(url) > 2000:
            return False

        # 排除明顯無效的域名
        invalid_domains = ['google.com/images', '1x1', 'pixel', 'transparent.gif', 'data:image']
        if any(domain in url.lower() for domain in invalid_domains):
            return False

        return True

    def _detect_watermark(self, text):
        """檢測文字是否包含水印標記"""
        if not text:
            return False

        text_lower = text.lower()
        for keyword in self.watermark_keywords:
            if keyword.lower() in text_lower:
                return True
        return False
