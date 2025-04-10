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

def fetch_machine_location(token, machine_id):
    """Fetches location information for a specific machine from John Deere API."""
    try:
        token = refresh_token_if_needed(token)
        oauth = get_oauth_session(token=token)
        
        logger.info(f"Fetching location for machine {machine_id}")
        
        # Usando el endpoint de locationHistory según indicado
        endpoint = f"{JOHN_DEERE_API_BASE_URL}/platform/machines/{machine_id}/locationHistory"
        headers = {'x-deere-no-paging': 'true'}
        
        try:
            logger.info(f"Requesting machine location from: {endpoint}")
            response = oauth.get(endpoint, headers=headers)
            response.raise_for_status()
            
            # Procesar la respuesta
            data = response.json()
            logger.info(f"Received machine location history response: {data}")
            
            # Si recibimos un array de valores, obtenemos la última ubicación (más reciente)
            if 'values' in data and len(data['values']) > 0:
                # En locationHistory, los datos vienen en formato diferente, con 'point' en lugar de 'geometry'
                location_values = data['values']
                
                # Ordenar por eventTimestamp en orden descendente (más reciente primero)
                if len(location_values) > 1:
                    sorted_locations = sorted(
                        location_values, 
                        key=lambda x: x.get('eventTimestamp', '0'), 
                        reverse=True
                    )
                    location_data = sorted_locations[0]
                else:
                    location_data = location_values[0]
                
                # Extraer coordenadas según el formato de locationHistory (usa point.lat y point.lon)
                if 'point' in location_data and 'lat' in location_data['point'] and 'lon' in location_data['point']:
                    point = location_data['point']
                    timestamp = location_data.get('eventTimestamp') or location_data.get('gpsFixTimestamp')
                    
                    location = {
                        'longitude': point['lon'],
                        'latitude': point['lat'],
                        'timestamp': timestamp
                    }
                    logger.info(f"Successfully extracted location from locationHistory: {location}")
                    return location
                
            # Si los datos vienen directamente con geometry (formato del endpoint location)
            elif 'geometry' in data and 'coordinates' in data['geometry']:
                coords = data['geometry']['coordinates']
                timestamp = data.get('timestamp')
                
                # Coordenadas en GeoJSON están en [longitude, latitude]
                location = {
                    'longitude': coords[0],
                    'latitude': coords[1],
                    'timestamp': timestamp
                }
                logger.info(f"Successfully extracted location from direct geometry: {location}")
                return location
            
            logger.warning(f"Could not find valid location data in the response for machine {machine_id}")
            
        except Exception as e:
            logger.warning(f"Error fetching location for machine {machine_id} from locationHistory endpoint: {str(e)}")
            
        # Intentar con endpoint alternativo si el primero falla o no tiene datos válidos
        alt_endpoint = f"{JOHN_DEERE_API_BASE_URL}/platform/machines/{machine_id}/location"
        try:
            logger.info(f"Trying alternative location endpoint: {alt_endpoint}")
            response = oauth.get(alt_endpoint, headers=headers)
            response.raise_for_status()
            
            data = response.json()
            logger.info(f"Received machine location response: {data}")
            
            # Extraer la información de ubicación
            if 'geometry' in data and 'coordinates' in data['geometry']:
                coords = data['geometry']['coordinates']
                timestamp = data.get('timestamp')
                
                location = {
                    'longitude': coords[0],
                    'latitude': coords[1],
                    'timestamp': timestamp
                }
                logger.info(f"Successfully extracted location from alternative endpoint: {location}")
                return location
        except Exception as nested_e:
            logger.warning(f"Error fetching location from alternative endpoint: {str(nested_e)}")
            
        return None
    except Exception as e:
        logger.error(f"Error in fetch_machine_location for machine {machine_id}: {str(e)}")
        return None

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
        
        # Agregar encabezado para desactivar paginación y obtener todos los resultados
        headers = {'x-deere-no-paging': 'true'}
        
        # Realizar la petición con los parámetros específicos
        logger.info(f"Requesting URL: {endpoint} with params: {params}")
        response = oauth.get(endpoint, params=params, headers=headers)
        response.raise_for_status()
        
        # Process the response to extract machine data
        data = response.json()
        machines = []
        
        # Log especial para organizaciones grandes
        total_machines = 0
        if 'values' in data:
            total_machines = len(data['values'])
            logger.info(f"Recibidas {total_machines} máquinas para la organización {organization_id}")
        
        if 'values' in data:
            logger.info(f"Procesando {total_machines} máquinas para la organización {organization_id}")
            
            # Si hay muchas máquinas (más de 50), limitamos la obtención de ubicaciones
            # para mejorar el rendimiento y evitar demasiadas peticiones a la API
            limit_location_fetching = total_machines > 50
            
            # Para organizaciones con muchísimas máquinas, ajustamos el número de máquinas 
            # para las que buscamos ubicación
            location_fetch_limit = 15
            if total_machines > 200:
                location_fetch_limit = 10
            
            for machine in data['values']:
                machine_id = machine.get('id')
                logger.info(f"Processing machine: {machine_id} - {machine.get('name')}")
                
                # Inicializar location como None
                location = None
                
                # Para organizaciones con muchas máquinas, buscamos ubicación para
                # una cantidad razonable para un mejor balance entre
                # rendimiento y experiencia de usuario
                if machine_id and (not limit_location_fetching or len(machines) < location_fetch_limit):
                    location = fetch_machine_location(token, machine_id)
                    
                    # Si encontramos una ubicación, registrar el éxito
                    if location:
                        logger.info(f"Machine location found for {machine_id}: {location}")
                elif limit_location_fetching:
                    logger.info(f"Omitiendo búsqueda de ubicación para máquina {machine_id} para mejorar rendimiento")
                
                # Crear el objeto de máquina
                machine_obj = {
                    'id': machine_id,
                    'name': machine.get('name') or f"Máquina {machine_id}",
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
        
        # Obtener información de ubicación desde el endpoint específico
        location = fetch_machine_location(token, machine_id)
        
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

# Esta función ha sido reemplazada por una implementación más completa abajo

def fetch_alert_definition(token, definition_uri):
    """Fetches detailed definition for a specific alert.
    
    Args:
        token: OAuth token
        definition_uri: URI for the alert definition, either a full URL or just the path
    
    Returns:
        Dictionary with alert definition details or None if there was an error
    """
    try:
        logger.info(f"Fetching alert definition from: {definition_uri}")
        # Refresh token if needed
        token = refresh_token_if_needed(token)
        
        # Create OAuth session
        oauth = OAuth2Session(JOHN_DEERE_CLIENT_ID, token=token)
        
        # Handle either full URL or just path
        if not definition_uri.startswith('http'):
            # Ensure definition_uri starts with a slash if it's just a path
            if not definition_uri.startswith('/'):
                definition_uri = '/' + definition_uri
                
            definition_uri = f"https://partnerapi.deere.com{definition_uri}"
        
        # Add header to disable pagination
        headers = {'x-deere-no-paging': 'true'}
        
        response = oauth.get(definition_uri, headers=headers)
        response.raise_for_status()
        
        # Parse the response
        definition_data = response.json()
        logger.info(f"Retrieved alert definition: {str(definition_data)[:150]}...")
        
        # Normalize the definition data to a standard format
        normalized_definition = {
            'id': definition_data.get('id', 'unknown'),
            'title': definition_data.get('title', 'Sin título'),
            'description': definition_data.get('description', 'Sin descripción detallada'),
            'causes': definition_data.get('causes', []),
            'resolutions': definition_data.get('resolutions', []),
            'additionalInfo': definition_data.get('additionalInformation')
        }
        
        return normalized_definition
        
    except Exception as e:
        logger.error(f"Error fetching alert definition from {definition_uri}: {str(e)}")
        return None

def fetch_machine_alerts(token, machine_id, days_back=30):
    """Fetches alerts for a specific machine within a date range.
    
    Args:
        token: OAuth token
        machine_id: ID of the machine
        days_back: Number of days back to fetch alerts (default: 30)
    """
    try:
        logger.info(f"INICIO fetch_machine_alerts para máquina {machine_id}")
        
        token = refresh_token_if_needed(token)
        if not token:
            logger.error("Token no válido o expirado y no se pudo refrescar")
            return []
            
        oauth = get_oauth_session(token=token)
        if not oauth:
            logger.error("No se pudo crear la sesión OAuth")
            return []
        
        logger.info(f"Fetching alerts for machine {machine_id} for the last {days_back} days")
        
        # Calcular fechas para el rango de tiempo
        from datetime import datetime, timedelta
        
        # Fecha actual
        end_date = datetime.utcnow()
        # Fecha de inicio (hace N días)
        start_date = end_date - timedelta(days=days_back)
        
        # Formatear fechas en el formato requerido por la API
        start_date_str = start_date.strftime('%Y-%m-%dT%H:%M:%S.000Z')
        end_date_str = end_date.strftime('%Y-%m-%dT%H:%M:%S.000Z')
        
        # Usando el endpoint específico para alertas de máquinas con parámetros de fecha
        endpoint = f"{JOHN_DEERE_API_BASE_URL}/platform/machines/{machine_id}/alerts"
        
        # Parámetros para el rango de fechas
        params = {
            'startDate': start_date_str,
            'endDate': end_date_str
        }
        
        # Agregar encabezado para desactivar paginación
        headers = {'x-deere-no-paging': 'true'}
        
        logger.info(f"Requesting machine alerts from: {endpoint} with date range: {start_date_str} to {end_date_str}")
        response = oauth.get(endpoint, params=params, headers=headers)
        response.raise_for_status()
        
        # Process the response to extract alert data
        data = response.json()
        logger.info(f"Received machine alerts response for {machine_id}: {str(data)[:300]}...")
        
        alerts = []
        
        if 'values' in data:
            logger.info(f"Encontradas {len(data['values'])} alertas en la respuesta")
            for alert in data['values']:
                try:
                    logger.info(f"Procesando alerta: {str(alert)[:200]}...")
                    # Normalizar el tipo de severidad según la tabla proporcionada
                    # HIGH: rojo, MEDIUM: amarillo, LOW: gris, INFO: azul, DTC/UNKNOWN: gris
                    severity = 'unknown'  # valor por defecto
                    if alert.get('severity'):
                        sev_upper = str(alert.get('severity')).upper()
                        logger.info(f"Severidad original: {sev_upper}")
                        if 'HIGH' in sev_upper or 'CRITICAL' in sev_upper or 'ERROR' in sev_upper:
                            severity = 'high'
                        elif 'MEDIUM' in sev_upper or 'WARNING' in sev_upper or 'WARN' in sev_upper:
                            severity = 'medium'
                        elif 'LOW' in sev_upper:
                            severity = 'low'
                        elif 'INFO' in sev_upper:
                            severity = 'info'
                        elif 'DTC' in sev_upper:
                            severity = 'dtc'
                        logger.info(f"Severidad normalizada: {severity}")
                except Exception as err:
                    logger.error(f"Error procesando severidad de alerta: {str(err)}")
                    severity = 'unknown'
                
                try:
                    # Extraer datos del contenido si disponibles
                    description = 'Sin descripción'
                    title = 'Alerta sin título'
                    
                    logger.info(f"Procesando alerta con datos: {str(alert)[:300]}...")
                    
                    # Intentar obtener descripción y título directamente del mensaje
                    if 'description' in alert:
                        logger.info(f"Descripción encontrada directamente: {alert['description']}")
                        description = alert['description']
                    
                    if 'title' in alert:
                        logger.info(f"Título encontrado directamente: {alert['title']}")
                        title = alert['title']
                    
                    # Intentar obtener desde content si existe
                    if 'content' in alert:
                        content = alert.get('content', {})
                        logger.info(f"Contenido de alerta: {str(content)[:150]}...")
                        if isinstance(content, dict):
                            # Si content es un diccionario, intentar extraer la descripción y el título
                            if content.get('description'):
                                logger.info(f"Descripción encontrada en content: {content['description']}")
                                description = content['description']
                            if content.get('title'):
                                logger.info(f"Título encontrado en content: {content['title']}")
                                title = content['title']
                    
                    # Si tenemos un timestamp como 'time', usarlo
                    timestamp = alert.get('timestamp') or alert.get('time')
                    logger.info(f"Timestamp: {timestamp}")
                    
                    # Si no hay description, buscar también en message
                    if description == 'Sin descripción' and alert.get('message'):
                        logger.info(f"Usando message como descripción: {alert['message']}")
                        description = alert['message']
                    
                    # Extraer enlaces si están disponibles
                    links = []
                    if 'links' in alert and isinstance(alert['links'], list):
                        for link in alert['links']:
                            logger.info(f"Enlace encontrado: {link}")
                            links.append(link)
                    
                    # Crear objeto de alerta normalizado
                    alert_obj = {
                        'id': alert.get('id', 'sin-id'),
                        'title': title,
                        'description': description,
                        'severity': severity,
                        'timestamp': timestamp,  # Usar el timestamp ya procesado
                        'status': alert.get('status', 'ACTIVE'),
                        'type': alert.get('type', 'UNDEFINED'),
                        'links': links
                    }
                    
                    logger.info(f"Alerta procesada: {str(alert_obj)[:150]}...")
                    alerts.append(alert_obj)
                except Exception as err:
                    logger.error(f"Error procesando datos de alerta: {str(err)}")
        
        logger.info(f"Retrieved {len(alerts)} alerts for machine {machine_id}")
        return alerts
    except Exception as e:
        logger.error(f"Error fetching alerts for machine {machine_id}: {str(e)}")
        return []  # Devolver lista vacía en caso de error en lugar de propagar la excepción
