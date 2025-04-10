import os

# OAuth2 Configuration
JOHN_DEERE_CLIENT_ID = os.environ.get('JOHN_DEERE_CLIENT_ID', 'johndeere-31HUiLWeHbAA9eMnAUvUNH6y')
JOHN_DEERE_CLIENT_SECRET = os.environ.get('JOHN_DEERE_CLIENT_SECRET', '')
JOHN_DEERE_API_BASE_URL = 'https://partnerapi.deere.com'
JOHN_DEERE_TOKEN_URL = 'https://signin.johndeere.com/oauth2/aus78tnlaysMraFhC1t7/v1/token'
JOHN_DEERE_AUTHORIZE_URL = 'https://signin.johndeere.com/oauth2/aus78tnlaysMraFhC1t7/v1/authorize'

# Configuration flags
USE_ALTERNATE_OAUTH_FLOW = True  # Si es True, usa los nuevos scopes y parámetros
USE_PERSISTENCE_HEADER_REDIRECT = False  # Si es True, usa la URL de redirección de persistent-header

# Original Scopes
ORIGINAL_JOHN_DEERE_SCOPES = [
    'offline_access',
    'ag1',
    'files',
    'eq1'
]

# New Scopes (based on the provided URL)
NEW_JOHN_DEERE_SCOPES = [
    'openid',
    'profile', 
    'customer_profile', 
    'toggles', 
    'email'
]

# Scopes to use (based on configuration flag)
JOHN_DEERE_SCOPES = NEW_JOHN_DEERE_SCOPES if USE_ALTERNATE_OAUTH_FLOW else ORIGINAL_JOHN_DEERE_SCOPES

# SMS Authentication Configuration
SMS_VERIFICATION_ENABLED = True
SMS_VERIFICATION_TIMEOUT = 300  # 5 minutos para introducir el código SMS

# Twilio Configuration (si se usa para enviar SMS)
TWILIO_ACCOUNT_SID = os.environ.get('TWILIO_ACCOUNT_SID', '')
TWILIO_AUTH_TOKEN = os.environ.get('TWILIO_AUTH_TOKEN', '')
TWILIO_PHONE_NUMBER = os.environ.get('TWILIO_PHONE_NUMBER', '')

# Flask Configuration
DEBUG = True
SECRET_KEY = os.environ.get('SESSION_SECRET', 'dev-secret-key')

# El sistema ahora usa funciones auxiliares en app.py para determinar URLs dinámicamente
# por lo que estas constantes ya no son necesarias.
