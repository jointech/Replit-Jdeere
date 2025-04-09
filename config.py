import os

# OAuth2 Configuration
JOHN_DEERE_CLIENT_ID = os.environ.get('JOHN_DEERE_CLIENT_ID', '0oaknbms0250i6yty5d6')
JOHN_DEERE_CLIENT_SECRET = os.environ.get('JOHN_DEERE_CLIENT_SECRET', '')
JOHN_DEERE_API_BASE_URL = 'https://partnerapi.deere.com'
JOHN_DEERE_TOKEN_URL = 'https://signin.johndeere.com/oauth2/aus78tnlaysMraFhC1t7/v1/token'
JOHN_DEERE_AUTHORIZE_URL = 'https://signin.johndeere.com/oauth2/aus78tnlaysMraFhC1t7/v1/authorize'

# Scopes needed for the application
JOHN_DEERE_SCOPES = [
    'openid',
    'support-tool'
]

# Flask Configuration
DEBUG = True
SECRET_KEY = os.environ.get('SESSION_SECRET', 'dev-secret-key')

# Application Configuration
REDIRECT_URI = os.environ.get('REDIRECT_URI', 'ForestLink')
