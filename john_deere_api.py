import requests
from requests_oauthlib import OAuth2Session
import logging
from config import (
    JOHN_DEERE_CLIENT_ID, 
    JOHN_DEERE_CLIENT_SECRET, 
    JOHN_DEERE_API_BASE_URL, 
    JOHN_DEERE_TOKEN_URL
)

logger = logging.getLogger(__name__)

def get_oauth_session(token=None, state=None, redirect_uri=None):
    """Creates an OAuth2Session for John Deere API."""
    from config import JOHN_DEERE_SCOPES
    
    # Creamos argumentos base y solo agregamos redirect_uri si se proporciona
    kwargs = {
        'client_id': JOHN_DEERE_CLIENT_ID,
        'token': token,
        'state': state,
        'scope': JOHN_DEERE_SCOPES
    }
    
    # Añadir redirect_uri solo si se proporciona
    if redirect_uri:
        kwargs['redirect_uri'] = redirect_uri
        
    return OAuth2Session(**kwargs)

def exchange_code_for_token(code, redirect_uri=None):
    """Exchange authorization code for access token."""
    try:
        # Detectar códigos de prueba específicos para simular un token
        if code in ['manual_test_code', 'test_code']:
            # Generar un token simulado para pruebas
            logger.warning("Código de prueba detectado. Generando token simulado.")
            
            import time
            simulated_token = {
                'access_token': 'test_token',  # Usamos test_token en lugar de simulated_token_manual para diferenciar
                'refresh_token': 'test_refresh_token',
                'expires_in': 3600,
                'expires_at': time.time() + 3600
            }
            return simulated_token
        
        # El redirect_uri debe ser proporcionado desde fuera, ya no tenemos un valor por defecto
        if redirect_uri is None:
            logger.error("Se requiere un redirect_uri para el intercambio de token")
            raise ValueError("Se requiere un redirect_uri para el intercambio de token")
            
        logger.info(f"Intercambiando código por token con redirect_uri: {redirect_uri}")
        
        # Crear una sesión OAuth SIN pasar el redirect_uri ni otros parámetros de OAuth
        # Usamos una sesión nueva de requests directamente para evitar conflictos con redirect_uri
        import requests
        from requests.auth import HTTPBasicAuth
        
        logger.info(f"Usando solicitud directa para obtener token con codigo: {code[:5]}...")
        
        # Preparamos la solicitud directa a la API de token
        token_data = {
            'grant_type': 'authorization_code',
            'code': code,
            'redirect_uri': redirect_uri
        }
        
        # Hacemos la solicitud de token directamente sin usar OAuth2Session
        token_response = requests.post(
            JOHN_DEERE_TOKEN_URL,
            data=token_data,
            auth=HTTPBasicAuth(JOHN_DEERE_CLIENT_ID, JOHN_DEERE_CLIENT_SECRET)
        )
        
        if token_response.status_code != 200:
            error_message = f"Error obteniendo token: {token_response.status_code} - {token_response.text}"
            logger.error(error_message)
            raise ValueError(error_message)
            
        # Convertimos la respuesta JSON a un diccionario
        token = token_response.json()
        return token
    except Exception as e:
        logger.error(f"Error exchanging code for token: {str(e)}")
        raise

def refresh_token_if_needed(token):
    """Refreshes the token if it's expired."""
    import time
    if token.get('expires_at') and token['expires_at'] < time.time():
        oauth = get_oauth_session(token=token)
        token = oauth.refresh_token(
            JOHN_DEERE_TOKEN_URL,
            client_id=JOHN_DEERE_CLIENT_ID,
            client_secret=JOHN_DEERE_CLIENT_SECRET
        )
    return token

def fetch_organizations(token):
    """Fetches organizations from John Deere API."""
    try:
        token = refresh_token_if_needed(token)
        oauth = get_oauth_session(token=token)
        
        # Agregar encabezado para desactivar paginación y obtener todas las organizaciones
        headers = {'x-deere-no-paging': 'true'}
        response = oauth.get(f"{JOHN_DEERE_API_BASE_URL}/platform/organizations", headers=headers)
        response.raise_for_status()
        
        # Process the response to extract organization data
        data = response.json()
        organizations = []
        
        if 'values' in data:
            for org in data['values']:
                organizations.append({
                    'id': org.get('id'),
                    'name': org.get('name'),
                    'type': org.get('type'),
                    'links': org.get('links', [])
                })
        
        logger.info(f"Obtenidas {len(organizations)} organizaciones (sin paginación)")
        return organizations
    except Exception as e:
        logger.error(f"Error fetching organizations: {str(e)}")
        raise

def fetch_machines_by_organization(token, organization_id):
    """Fetches machines for a specific organization from John Deere API."""
    try:
        token = refresh_token_if_needed(token)
        oauth = get_oauth_session(token=token)
        
        logger.info(f"Fetching machines for organization {organization_id}")
        
        # Usando el endpoint específico para equipos con el formato exacto proporcionado
        endpoint = "https://equipmentapi.deere.com/isg/equipment"
        
        # Parámetros específicos para el endpoint de equipos
        params = {
            "organizationIds": organization_id,
            "categories": "machine"
        }
        
        # Agregar encabezado para desactivar paginación
        headers = {'x-deere-no-paging': 'true'}
        
        # Realizar la petición con los parámetros específicos
        logger.info(f"Requesting URL: {endpoint} with params: {params}")
        response = oauth.get(endpoint, params=params, headers=headers)
        response.raise_for_status()
        
        # Process the response to extract machine data
        data = response.json()
        machines = []
        
        if 'values' in data:
            for machine in data['values']:
                logger.info(f"Processing machine: {machine.get('id')} - {machine.get('name')}")
                
                # Inicializar location como None
                location = None
                
                # Verificar si existe la ubicación en el formato esperado
                if 'lastKnownLocation' in machine:
                    # Normalizar el formato de ubicación para que sea consistente
                    # con lo que espera el frontend (latitude/longitude)
                    location = {
                        'latitude': machine['lastKnownLocation'].get('latitude'),
                        'longitude': machine['lastKnownLocation'].get('longitude'),
                        'timestamp': machine['lastKnownLocation'].get('timestamp')
                    }
                    logger.info(f"Machine location found: {location}")
                
                # Crear el objeto de máquina
                machine_obj = {
                    'id': machine.get('id'),
                    'name': machine.get('name') or f"Máquina {machine.get('id')}",
                    'model': machine.get('model'),
                    'category': machine.get('category') or 'UNKNOWN',
                    'type': machine.get('type') or machine.get('category') or 'UNKNOWN',
                    'location': location,
                    'links': machine.get('links', [])
                }
                
                machines.append(machine_obj)
        
        logger.info(f"Retrieved {len(machines)} machines for organization {organization_id}")
        return machines
    except Exception as e:
        logger.error(f"Error fetching machines for organization {organization_id}: {str(e)}")
        raise

def fetch_machine_details(token, machine_id):
    """Fetches detailed information for a specific machine."""
    try:
        token = refresh_token_if_needed(token)
        oauth = get_oauth_session(token=token)
        
        logger.info(f"Fetching details for machine {machine_id}")
        
        # Usando el endpoint específico para equipos
        endpoint = "https://equipmentapi.deere.com/isg/equipment"
        
        # Parámetro para obtener un equipo específico por ID
        params = {"ids": machine_id}
        
        # Agregar encabezado para desactivar paginación
        headers = {'x-deere-no-paging': 'true'}
        
        logger.info(f"Requesting machine details from: {endpoint} with params: {params}")
        response = oauth.get(endpoint, params=params, headers=headers)
        response.raise_for_status()
        
        # Obtener los datos de la respuesta
        data = response.json()
        logger.info(f"Received machine details response: {data}")
        
        # La respuesta contiene un array de valores, tenemos que obtener la primera máquina
        machine_data = None
        if 'values' in data and len(data['values']) > 0:
            machine_data = data['values'][0]
        else:
            logger.error(f"No machine data found for ID: {machine_id}")
            raise ValueError(f"No se encontraron detalles para la máquina con ID: {machine_id}")
        
        # Crear un objeto con la estructura esperada por nuestro frontend
        location = None
        if 'lastKnownLocation' in machine_data:
            location = {
                'latitude': machine_data['lastKnownLocation'].get('latitude'),
                'longitude': machine_data['lastKnownLocation'].get('longitude'),
                'timestamp': machine_data['lastKnownLocation'].get('timestamp')
            }
        
        # Extraer detalles adicionales si están disponibles
        machine_details = {
            'id': machine_data.get('id'),
            'name': machine_data.get('name', f"Máquina {machine_id}"),
            'serialNumber': machine_data.get('serialNumber', f"SN-{machine_id}"),
            'model': machine_data.get('model', 'Desconocido'),
            'type': machine_data.get('type') or machine_data.get('category', 'UNKNOWN'),
            'category': machine_data.get('category', 'UNKNOWN'),
            'status': machine_data.get('status', 'ACTIVE'),
            'location': location,
            'hoursOfOperation': machine_data.get('hoursOfOperation', 0),
            'fuelLevel': machine_data.get('fuelLevel', 0),
            'lastUpdated': machine_data.get('lastUpdated') or machine_data.get('timestamp')
        }
        
        return machine_details
    except Exception as e:
        logger.error(f"Error fetching details for machine {machine_id}: {str(e)}")
        raise

def fetch_machine_alerts(token, machine_id):
    """Fetches alerts for a specific machine."""
    try:
        token = refresh_token_if_needed(token)
        oauth = get_oauth_session(token=token)
        
        logger.info(f"Fetching alerts for machine {machine_id}")
        
        # Usando el endpoint específico para alertas de máquinas
        endpoint = f"{JOHN_DEERE_API_BASE_URL}/platform/machines/{machine_id}/alerts"
        
        # Agregar encabezado para desactivar paginación
        headers = {'x-deere-no-paging': 'true'}
        
        logger.info(f"Requesting machine alerts from: {endpoint}")
        response = oauth.get(endpoint, headers=headers)
        response.raise_for_status()
        
        # Process the response to extract alert data
        data = response.json()
        logger.info(f"Received machine alerts response for {machine_id}")
        
        alerts = []
        
        if 'values' in data:
            for alert in data['values']:
                # Normalizar el tipo de severidad a uno de nuestros valores esperados
                severity = 'info'  # valor por defecto
                if alert.get('severity'):
                    sev_lower = str(alert.get('severity')).lower()
                    if 'critical' in sev_lower or 'error' in sev_lower:
                        severity = 'critical'
                    elif 'warning' in sev_lower or 'warn' in sev_lower:
                        severity = 'warning'
                
                alert_obj = {
                    'id': alert.get('id'),
                    'title': alert.get('title', 'Alerta sin título'),
                    'description': alert.get('description', 'Sin descripción'),
                    'severity': severity,
                    'timestamp': alert.get('timestamp'),
                    'status': alert.get('status', 'ACTIVE'),
                    'type': alert.get('type', 'UNDEFINED')
                }
                
                alerts.append(alert_obj)
        
        logger.info(f"Retrieved {len(alerts)} alerts for machine {machine_id}")
        return alerts
    except Exception as e:
        logger.error(f"Error fetching alerts for machine {machine_id}: {str(e)}")
        raise
