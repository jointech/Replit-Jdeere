import requests
from requests_oauthlib import OAuth2Session
import logging
from config import (
    JOHN_DEERE_CLIENT_ID, 
    JOHN_DEERE_CLIENT_SECRET, 
    JOHN_DEERE_API_BASE_URL, 
    JOHN_DEERE_TOKEN_URL,
    REDIRECT_URI
)

logger = logging.getLogger(__name__)

def get_oauth_session(token=None, state=None):
    """Creates an OAuth2Session for John Deere API."""
    from config import JOHN_DEERE_SCOPES
    return OAuth2Session(
        client_id=JOHN_DEERE_CLIENT_ID,
        token=token,
        state=state,
        redirect_uri=REDIRECT_URI,
        scope=JOHN_DEERE_SCOPES
    )

def exchange_code_for_token(code):
    """Exchange authorization code for access token."""
    try:
        oauth = get_oauth_session()
        token = oauth.fetch_token(
            JOHN_DEERE_TOKEN_URL,
            code=code,
            client_id=JOHN_DEERE_CLIENT_ID,
            client_secret=JOHN_DEERE_CLIENT_SECRET
        )
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
        
        response = oauth.get(f"{JOHN_DEERE_API_BASE_URL}/platform/organizations")
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
        
        # Endpoint para equipos
        endpoint = f"{JOHN_DEERE_API_BASE_URL}/platform/equipment"
        # Los parámetros deben incluir el ID de la organización y el filtro para máquinas
        params = {"organizationId": organization_id, "categories": "machine"}
        
        # Realizar la petición
        response = oauth.get(endpoint, params=params)
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
        
        response = oauth.get(f"{JOHN_DEERE_API_BASE_URL}/platform/machines/{machine_id}")
        response.raise_for_status()
        
        # Obtener los datos de la respuesta
        data = response.json()
        logger.info(f"Received machine details response: {data}")
        
        # Crear un objeto con la estructura esperada por nuestro frontend
        location = None
        if 'lastKnownLocation' in data:
            location = {
                'latitude': data['lastKnownLocation'].get('latitude'),
                'longitude': data['lastKnownLocation'].get('longitude'),
                'timestamp': data['lastKnownLocation'].get('timestamp')
            }
        
        machine_details = {
            'id': data.get('id'),
            'name': data.get('name', f"Máquina {machine_id}"),
            'serialNumber': data.get('serialNumber', f"SN-{machine_id}"),
            'model': data.get('model', 'Desconocido'),
            'type': data.get('type') or data.get('category', 'UNKNOWN'),
            'category': data.get('category', 'UNKNOWN'),
            'status': data.get('status', 'ACTIVE'),
            'location': location,
            'hoursOfOperation': data.get('hoursOfOperation', 0),
            'fuelLevel': data.get('fuelLevel', 0),
            'lastUpdated': data.get('lastUpdated') or data.get('timestamp')
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
        
        response = oauth.get(f"{JOHN_DEERE_API_BASE_URL}/platform/machines/{machine_id}/alerts")
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
