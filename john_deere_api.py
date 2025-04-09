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
        
        response = oauth.get(
            f"{JOHN_DEERE_API_BASE_URL}/platform/equipment",
            params={"organizationId": organization_id, "categories": "machine"}
        )
        response.raise_for_status()
        
        # Process the response to extract machine data
        data = response.json()
        machines = []
        
        if 'values' in data:
            for machine in data['values']:
                location = None
                if 'lastKnownLocation' in machine:
                    location = {
                        'lat': machine['lastKnownLocation'].get('latitude'),
                        'lng': machine['lastKnownLocation'].get('longitude'),
                        'timestamp': machine['lastKnownLocation'].get('timestamp')
                    }
                
                machines.append({
                    'id': machine.get('id'),
                    'name': machine.get('name'),
                    'model': machine.get('model'),
                    'category': machine.get('category'),
                    'location': location,
                    'links': machine.get('links', [])
                })
        
        return machines
    except Exception as e:
        logger.error(f"Error fetching machines for organization {organization_id}: {str(e)}")
        raise

def fetch_machine_details(token, machine_id):
    """Fetches detailed information for a specific machine."""
    try:
        token = refresh_token_if_needed(token)
        oauth = get_oauth_session(token=token)
        
        response = oauth.get(f"{JOHN_DEERE_API_BASE_URL}/platform/machines/{machine_id}")
        response.raise_for_status()
        
        # Return the raw machine details
        return response.json()
    except Exception as e:
        logger.error(f"Error fetching details for machine {machine_id}: {str(e)}")
        raise

def fetch_machine_alerts(token, machine_id):
    """Fetches alerts for a specific machine."""
    try:
        token = refresh_token_if_needed(token)
        oauth = get_oauth_session(token=token)
        
        response = oauth.get(f"{JOHN_DEERE_API_BASE_URL}/platform/machines/{machine_id}/alerts")
        response.raise_for_status()
        
        # Process the response to extract alert data
        data = response.json()
        alerts = []
        
        if 'values' in data:
            for alert in data['values']:
                alerts.append({
                    'id': alert.get('id'),
                    'title': alert.get('title'),
                    'description': alert.get('description'),
                    'severity': alert.get('severity'),
                    'timestamp': alert.get('timestamp'),
                    'status': alert.get('status')
                })
        
        return alerts
    except Exception as e:
        logger.error(f"Error fetching alerts for machine {machine_id}: {str(e)}")
        raise
