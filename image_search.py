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
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
            'Accept-Language': 'zh-TW,zh;q=0.9,en-US;q=0.8,en;q=0.7',
            'Accept-Encoding': 'gzip, deflate, br',
            'DNT': '1',
            'Connection': 'keep-alive',
            'Upgrade-Insecure-Requests': '1'
        }
        self.watermark_keywords = [
            'watermark', 'getty', 'shutterstock', 'dreamstime',
            'istockphoto', 'alamy', '圖片來自', '水印', 'logo',
            'corbis', 'pond5', 'bigstock'
        ]

    def search(self, product_name, max_results=20):
        """搜尋產品圖片，使用多個來源"""
        all_results = []

        # 優先搜尋 Bing（通常更穩定）
        try:
            bing_results = self._search_bing_new(product_name, max_results)
            all_results.extend(bing_results)
            print(f"✓ Bing: {len(bing_results)} images")
        except Exception as e:
            print(f"✗ Bing error: {e}")

        # 補充 Google 搜尋
        try:
            google_results = self._search_google_new(product_name, max_results)
            all_results.extend(google_results)
            print(f"✓ Google: {len(google_results)} images")
        except Exception as e:
            print(f"✗ Google error: {e}")

        # 去重並排序
        unique_results = self._deduplicate_and_sort(all_results, max_results)

        print(f"✓ Total: {len(unique_results)} unique images")
        return unique_results[:max_results]

    def _search_bing_new(self, product_name, max_results=20):
        """改進的 Bing 搜尋"""
        results = []
        try:
            url = f"https://www.bing.com/images/search?q={quote(product_name)}"

            session = requests.Session()
            response = session.get(url, headers=self.headers, timeout=15)
            response.encoding = 'utf-8'

            # 策略 1：提取 murl
            pattern_murl = r'"murl":"([^"]+)"'
            matches = re.findall(pattern_murl, response.text)
            for img_url in matches[:max_results * 2]:
                try:
                    img_url = unquote(img_url).replace('\\/', '/')
                    if self._is_valid_url(img_url):
                        results.append({
                            'url': img_url,
                            'title': product_name,
                            'source': 'Bing',
                            'has_watermark': False,
                            'quality_score': 85
                        })
                except:
                    pass

            # 策略 2：提取 imgUrl
            pattern_imgurl = r'"imgUrl":"([^"]+)"'
            matches = re.findall(pattern_imgurl, response.text)
            for img_url in matches[:max_results * 2]:
                try:
                    img_url = unquote(img_url).replace('\\/', '/')
                    if self._is_valid_url(img_url) and img_url not in [r['url'] for r in results]:
                        results.append({
                            'url': img_url,
                            'title': product_name,
                            'source': 'Bing',
                            'has_watermark': False,
                            'quality_score': 85
                        })
                except:
                    pass

            # 策略 3：提取 image src
            soup = BeautifulSoup(response.text, 'html.parser')
            img_tags = soup.find_all('img', limit=max_results * 3)
            for img in img_tags:
                try:
                    src = img.get('src') or img.get('data-src') or img.get('data-url')
                    if src and src.startswith('http') and self._is_valid_url(src):
                        if src not in [r['url'] for r in results]:
                            results.append({
                                'url': src,
                                'title': product_name,
                                'source': 'Bing',
                                'has_watermark': False,
                                'quality_score': 80
                            })
                except:
                    pass

        except Exception as e:
            print(f"Bing error: {e}")

        return results[:max_results]

    def _search_google_new(self, product_name, max_results=20):
        """改進的 Google Images 搜尋"""
        results = []
        try:
            url = f"https://www.google.com/search?q={quote(product_name)}&tbm=isch"

            session = requests.Session()
            response = session.get(url, headers=self.headers, timeout=15)
            response.encoding = 'utf-8'

            # 策略 1：提取 imgUrl JSON
            pattern_imgurl = r'"imgUrl":"([^"\\]*(?:\\.[^"\\]*)*)"'
            matches = re.findall(pattern_imgurl, response.text)
            for img_url in matches:
                try:
                    img_url = img_url.replace('\\/', '/')
                    if self._is_valid_url(img_url):
                        results.append({
                            'url': img_url,
                            'title': product_name,
                            'source': 'Google',
                            'has_watermark': False,
                            'quality_score': 88
                        })
                except:
                    pass

            # 策略 2：提取 actualImageUrl
            pattern_actual = r'"actualImageUrl":"([^"\\]*(?:\\.[^"\\]*)*)"'
            matches = re.findall(pattern_actual, response.text)
            for img_url in matches:
                try:
                    img_url = img_url.replace('\\/', '/')
                    if self._is_valid_url(img_url) and img_url not in [r['url'] for r in results]:
                        results.append({
                            'url': img_url,
                            'title': product_name,
                            'source': 'Google',
                            'has_watermark': False,
                            'quality_score': 87
                        })
                except:
                    pass

            # 策略 3：提取 ou（原始 URL）
            pattern_ou = r'"ou":"([^"\\]*(?:\\.[^"\\]*)*)"'
            matches = re.findall(pattern_ou, response.text)
            for img_url in matches:
                try:
                    img_url = img_url.replace('\\/', '/')
                    if self._is_valid_url(img_url) and img_url not in [r['url'] for r in results]:
                        results.append({
                            'url': img_url,
                            'title': product_name,
                            'source': 'Google',
                            'has_watermark': False,
                            'quality_score': 90
                        })
                except:
                    pass

            # 策略 4：提取 image src（備用）
            soup = BeautifulSoup(response.text, 'html.parser')
            img_tags = soup.find_all('img', limit=max_results * 3)
            for img in img_tags:
                try:
                    src = img.get('src')
                    if src and src.startswith('http') and self._is_valid_url(src):
                        if src not in [r['url'] for r in results]:
                            results.append({
                                'url': src,
                                'title': product_name,
                                'source': 'Google',
                                'has_watermark': False,
                                'quality_score': 75
                            })
                except:
                    pass

        except Exception as e:
            print(f"Google error: {e}")

        return results[:max_results]

    def _deduplicate_and_sort(self, results, max_results):
        """去重並排序結果"""
        unique_results = []
        seen_urls = set()

        for result in results:
            url = result['url']
            # 簡單的域名去重（避免同一域名出現太多次）
            domain = self._extract_domain(url)

            if url not in seen_urls:
                seen_urls.add(url)
                # 檢測水印
                result['has_watermark'] = self._detect_watermark(url + result.get('title', ''))
                unique_results.append(result)

        # 按質量排序
        unique_results.sort(key=lambda x: (
            x['has_watermark'],  # 無水印優先
            -x['quality_score'],  # 質量分高優先
            x['source']  # Google 優先於 Bing
        ))

        return unique_results[:max_results]

    def _is_valid_url(self, url):
        """檢查 URL 是否有效"""
        if not url or not isinstance(url, str):
            return False

        # 必須以 http 開頭
        if not (url.startswith('http://') or url.startswith('https://')):
            return False

        # URL 長度合理
        if len(url) < 25 or len(url) > 2500:
            return False

        # 排除明顯無效的 URL
        invalid_patterns = [
            'google.com/images',
            '1x1', '1x2', '2x1',
            'pixel', 'transparent',
            'data:image',
            'base64',
            'placeholder',
            '.svg',
            'spacer',
            '/ads/',
            '/tracker',
            'doubleclick'
        ]

        url_lower = url.lower()
        for pattern in invalid_patterns:
            if pattern in url_lower:
                return False

        return True

    def _extract_domain(self, url):
        """提取域名"""
        try:
            from urllib.parse import urlparse
            domain = urlparse(url).netloc
            return domain
        except:
            return ''

    def _detect_watermark(self, text):
        """檢測水印標記"""
        if not text:
            return False

        text_lower = text.lower()
        for keyword in self.watermark_keywords:
            if keyword.lower() in text_lower:
                return True
        return False
