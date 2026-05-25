import requests
from bs4 import BeautifulSoup
import json
import time
from urllib.parse import quote, unquote
import re
import random

class ImageSearcher:
    def __init__(self):
        # 多個 User-Agent 輪換
        self.user_agents = [
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
            'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:122.0) Gecko/20100101 Firefox/122.0',
        ]

        self.watermark_keywords = [
            'watermark', 'getty', 'shutterstock', 'dreamstime',
            'istockphoto', 'alamy', '圖片來自', '水印', 'logo'
        ]

    def _get_headers(self):
        """獲取隨機請求頭"""
        return {
            'User-Agent': random.choice(self.user_agents),
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
            'Accept-Language': 'zh-TW,zh;q=0.9,en-US;q=0.8,en;q=0.7',
            'Accept-Encoding': 'gzip, deflate, br',
            'DNT': '1',
            'Connection': 'keep-alive',
            'Upgrade-Insecure-Requests': '1',
            'Sec-Fetch-Dest': 'document',
            'Sec-Fetch-Mode': 'navigate',
            'Sec-Fetch-Site': 'none',
            'Cache-Control': 'max-age=0',
        }

    def search(self, product_name, max_results=20):
        """搜尋產品圖片"""
        all_results = []

        # 嘗試多個搜尋源
        sources = [
            ('Bing', self._search_bing),
            ('Google', self._search_google),
            ('DuckDuckGo', self._search_duckduckgo),
        ]

        for source_name, search_func in sources:
            try:
                results = search_func(product_name, max_results)
                if results:
                    all_results.extend(results)
                    print(f"✓ {source_name}: {len(results)} images found")
                    if len(all_results) >= max_results:
                        break
            except Exception as e:
                print(f"✗ {source_name}: {str(e)}")
                continue

        # 去重並排序
        unique_results = self._deduplicate_and_sort(all_results)
        print(f"✓ Total: {len(unique_results)} unique images\n")

        return unique_results[:max_results]

    def _search_bing(self, product_name, max_results=25):
        """Bing 圖片搜尋"""
        results = []
        try:
            url = f"https://www.bing.com/images/search?q={quote(product_name)}&count=150"
            session = requests.Session()

            response = session.get(url, headers=self._get_headers(), timeout=20)
            response.encoding = 'utf-8'

            # 多種模式提取 URL
            patterns = [
                (r'"murl":"([^"]+)"', 'murl'),
                (r'"imgUrl":"([^"]+)"', 'imgUrl'),
                (r'data-src="([^"]+)"', 'data-src'),
                (r'src="([^"]+\.(?:jpg|jpeg|png|webp|gif))"', 'src'),
            ]

            for pattern, source_type in patterns:
                matches = re.findall(pattern, response.text, re.IGNORECASE)
                for match in matches[:max_results * 2]:
                    try:
                        img_url = unquote(match).replace('\\/', '/')
                        if self._is_valid_url(img_url):
                            results.append({
                                'url': img_url,
                                'source': f'Bing ({source_type})',
                                'has_watermark': False,
                                'quality_score': 85
                            })
                    except:
                        pass

                if len(results) >= max_results:
                    break

        except Exception as e:
            print(f"Bing error: {e}")

        return results[:max_results]

    def _search_google(self, product_name, max_results=25):
        """Google 圖片搜尋"""
        results = []
        try:
            url = f"https://www.google.com/search?q={quote(product_name)}&tbm=isch"
            session = requests.Session()

            response = session.get(url, headers=self._get_headers(), timeout=20)
            response.encoding = 'utf-8'

            # 更全面的正則表達式
            patterns = [
                (r'"ou":"([^"\\]*(?:\\.[^"\\]*)*)"', 'ou'),
                (r'"imgUrl":"([^"\\]*(?:\\.[^"\\]*)*)"', 'imgUrl'),
                (r'"actualImageUrl":"([^"\\]*(?:\\.[^"\\]*)*)"', 'actualImageUrl'),
                (r'"iurl":"([^"]+)"', 'iurl'),
                (r'imgurl=([^&]+)&', 'imgurl_param'),
            ]

            for pattern, source_type in patterns:
                matches = re.findall(pattern, response.text)
                for match in matches[:max_results * 2]:
                    try:
                        img_url = match.replace('\\/', '/')
                        if isinstance(img_url, str) and img_url.startswith('http'):
                            if self._is_valid_url(img_url):
                                results.append({
                                    'url': img_url,
                                    'source': f'Google ({source_type})',
                                    'has_watermark': False,
                                    'quality_score': 88
                                })
                    except:
                        pass

                if len(results) >= max_results:
                    break

        except Exception as e:
            print(f"Google error: {e}")

        return results[:max_results]

    def _search_duckduckgo(self, product_name, max_results=25):
        """DuckDuckGo 圖片搜尋（備用）"""
        results = []
        try:
            url = f"https://duckduckgo.com/i.js?q={quote(product_name)}&l=en-us&o=json&p=1&s=0&vqd=none"

            response = requests.get(url, headers=self._get_headers(), timeout=20)

            try:
                data = response.json()
                for result in data.get('results', [])[:max_results]:
                    img_url = result.get('image') or result.get('url')
                    if img_url and self._is_valid_url(img_url):
                        results.append({
                            'url': img_url,
                            'source': 'DuckDuckGo',
                            'has_watermark': False,
                            'quality_score': 82
                        })
            except:
                pass

        except Exception as e:
            print(f"DuckDuckGo error: {e}")

        return results[:max_results]

    def _deduplicate_and_sort(self, results):
        """去重並排序"""
        unique_results = []
        seen_urls = set()

        for result in results:
            url = result['url']
            if url not in seen_urls:
                seen_urls.add(url)
                result['has_watermark'] = self._detect_watermark(url)
                unique_results.append(result)

        # 排序：無水印優先，質量分高優先
        unique_results.sort(key=lambda x: (
            x['has_watermark'],
            -x['quality_score']
        ))

        return unique_results

    def _is_valid_url(self, url):
        """驗證 URL"""
        if not url or not isinstance(url, str):
            return False

        if not (url.startswith('http://') or url.startswith('https://')):
            return False

        if len(url) < 25 or len(url) > 3000:
            return False

        # 排除無效 URL
        invalid = [
            'google.com/images',
            'duckduckgo',
            '1x1', '2x1',
            'pixel', 'transparent',
            'data:image',
            'base64',
            'placeholder',
            'spacer',
            '/ads/',
        ]

        url_lower = url.lower()
        for pattern in invalid:
            if pattern in url_lower:
                return False

        return True

    def _detect_watermark(self, text):
        """檢測水印"""
        if not text:
            return False

        text_lower = text.lower()
        for keyword in self.watermark_keywords:
            if keyword.lower() in text_lower:
                return True
        return False
