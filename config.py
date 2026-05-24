"""
應用配置文件
"""

import os
from datetime import timedelta

class Config:
    """基礎配置"""
    # 應用設置
    SECRET_KEY = os.environ.get('SECRET_KEY') or 'dev-secret-key-change-in-production'
    DEBUG = os.environ.get('FLASK_DEBUG', True)
    TESTING = False

    # 服務器設置
    HOST = os.environ.get('HOST', '0.0.0.0')
    PORT = int(os.environ.get('PORT', 5000))

    # 文件上傳設置
    MAX_CONTENT_LENGTH = 50 * 1024 * 1024  # 50MB
    UPLOAD_FOLDER = os.path.join(os.path.dirname(__file__), 'uploads')
    ALLOWED_EXTENSIONS = {'xlsx', 'xls'}

    # 搜尋設置
    DEFAULT_MAX_RESULTS = 20
    SEARCH_TIMEOUT = 15  # 秒

    # 緩存設置
    CACHE_TYPE = 'simple'
    CACHE_DEFAULT_TIMEOUT = 300

    # 日誌設置
    LOG_LEVEL = 'INFO'
    LOG_FORMAT = '%(asctime)s - %(name)s - %(levelname)s - %(message)s'

    # 速率限制
    RATELIMIT_ENABLED = True
    RATELIMIT_STORAGE_URL = 'memory://'


class DevelopmentConfig(Config):
    """開發配置"""
    DEBUG = True
    TESTING = False


class ProductionConfig(Config):
    """生產配置"""
    DEBUG = False
    TESTING = False
    # 需要設置生產環境的密鑰
    SECRET_KEY = os.environ.get('SECRET_KEY')
    if not SECRET_KEY:
        raise ValueError("No SECRET_KEY set for Flask application")


class TestingConfig(Config):
    """測試配置"""
    DEBUG = True
    TESTING = True
    WTF_CSRF_ENABLED = False


# 選擇配置
config = {
    'development': DevelopmentConfig,
    'production': ProductionConfig,
    'testing': TestingConfig,
    'default': DevelopmentConfig
}


def get_config(env=None):
    """獲取配置對象"""
    if env is None:
        env = os.environ.get('FLASK_ENV', 'development')
    return config.get(env, config['default'])
