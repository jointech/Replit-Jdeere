import os

# OAuth2 Configuration
JOHN_DEERE_CLIENT_ID = os.environ.get('JOHN_DEERE_CLIENT_ID', '')
JOHN_DEERE_CLIENT_SECRET = os.environ.get('JOHN_DEERE_CLIENT_SECRET', '')
JOHN_DEERE_API_BASE_URL = 'https://sandboxapi.deere.com'
JOHN_DEERE_TOKEN_URL = f'{JOHN_DEERE_API_BASE_URL}/platform/oauth/token'
JOHN_DEERE_AUTHORIZE_URL = f'{JOHN_DEERE_API_BASE_URL}/platform/oauth/authorize'

# Scopes needed for the application
JOHN_DEERE_SCOPES = [
    'ag1',
    'ag2',
    'ag3',
    'org1',
    'org2',
    'files',
    'eq1',
    'eq2'
]

# Flask Configuration
DEBUG = True
SECRET_KEY = os.environ.get('SESSION_SECRET', 'dev-secret-key')

# Application Configuration
REDIRECT_URI = 'http://localhost:5000/callback'
