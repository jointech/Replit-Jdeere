import os

# OAuth2 Configuration
JOHN_DEERE_CLIENT_ID = os.environ.get('JOHN_DEERE_CLIENT_ID', '0oaaob0zcwLvdRZhw5d7')
JOHN_DEERE_CLIENT_SECRET = os.environ.get('JOHN_DEERE_CLIENT_SECRET', '')
JOHN_DEERE_API_BASE_URL = 'https://partnertapi.deere.com'
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

# El sistema ahora usa funciones auxiliares en app.py para determinar URLs dinámicamente
# por lo que estas constantes ya no son necesarias.
