import os

# OAuth2 Configuration
JOHN_DEERE_CLIENT_ID = os.environ.get('JOHN_DEERE_CLIENT_ID', '0oaaob0zcwLvdRZhw5d7')
JOHN_DEERE_CLIENT_SECRET = os.environ.get('JOHN_DEERE_CLIENT_SECRET', '')
JOHN_DEERE_API_BASE_URL = 'https://partnerapi.deere.com'
JOHN_DEERE_TOKEN_URL = 'https://signin.johndeere.com/oauth2/aus78tnlaysMraFhC1t7/v1/token'
JOHN_DEERE_AUTHORIZE_URL = 'https://signin.johndeere.com/oauth2/aus78tnlaysMraFhC1t7/v1/authorize'

# Scopes needed for the application
JOHN_DEERE_SCOPES = [
    'offline_access',
    'ag1',
    'files',
    'eq1'
]

# Flask Configuration
DEBUG = True
SECRET_KEY = os.environ.get('SESSION_SECRET', 'dev-secret-key')

# Application Configuration
# Estos valores son solo los predeterminados, serán reemplazados dinámicamente
# en tiempo de ejecución con la URL real de la aplicación
REDIRECT_URI = os.environ.get('REDIRECT_URI', '/auth-capture')

# URL del captador de autenticación
# Esta es la URL que mostramos al usuario para capturar el código
AUTH_CAPTURE_URL = os.environ.get('AUTH_CAPTURE_URL', '/auth-capture')
