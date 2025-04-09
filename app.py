import os
import logging
import time
from flask import Flask, redirect, url_for, session, request, render_template, flash, jsonify
from werkzeug.middleware.proxy_fix import ProxyFix
import json
from urllib.parse import quote

from john_deere_api import (
    get_oauth_session, 
    fetch_organizations, 
    fetch_machines_by_organization, 
    fetch_machine_details,
    fetch_machine_alerts
)
from config import JOHN_DEERE_CLIENT_ID, JOHN_DEERE_CLIENT_SECRET, JOHN_DEERE_AUTHORIZE_URL, JOHN_DEERE_SCOPES, REDIRECT_URI

# Configure logging
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger(__name__)

# Create Flask application
app = Flask(__name__)
app.secret_key = os.environ.get("SESSION_SECRET", "dev-secret-key")
app.wsgi_app = ProxyFix(app.wsgi_app, x_proto=1, x_host=1)

@app.route('/')
def index():
    """Landing page that checks if user is authenticated and redirects accordingly."""
    if 'oauth_token' in session:
        return redirect(url_for('dashboard'))
    return render_template('login.html')

@app.route('/login')
def login():
    """Initiates the OAuth2 authentication flow with John Deere."""
    try:
        # En un entorno de producción, descomentar este código para iniciar el flujo real de OAuth
        """
        # Construir la URL con el redirect_uri configurado
        redirect_uri_encoded = quote(REDIRECT_URI)
        
        # Generar un state único para seguridad
        state = os.urandom(16).hex()
        session['oauth_state'] = state
        
        # Construir la URL exacta según lo proporcionado
        scopes = '+'.join(JOHN_DEERE_SCOPES)
        auth_url = f"https://signin.johndeere.com/oauth2/aus78tnlaysMraFhC1t7/v1/authorize?response_type=code&client_id={JOHN_DEERE_CLIENT_ID}&redirect_uri={redirect_uri_encoded}&scope={scopes}&state={state}"
        
        # Guardar información en la sesión para verificar después
        session['auth_flow_started'] = True
        
        logger.info(f"Redireccionando a John Deere para autenticación con redirect_uri: {REDIRECT_URI}")
        return redirect(auth_url)
        """
        
        # Para entorno de desarrollo: simular un token exitoso
        logger.info("Simulando inicio de sesión exitoso para entorno de desarrollo")
        
        # Simular token para desarrollo
        session['oauth_token'] = {
            'access_token': 'simulated_access_token_for_development',
            'refresh_token': 'simulated_refresh_token_for_development',
            'expires_in': 3600,  # 1 hora
            'expires_at': time.time() + 3600
        }
        
        # Redireccionar al dashboard
        return redirect(url_for('dashboard'))
    except Exception as e:
        logger.error(f"Login error: {str(e)}")
        return render_template('error.html', error=str(e))

@app.route('/callback')
def callback():
    """Handles the OAuth2 callback from John Deere."""
    if 'error' in request.args:
        error = request.args['error']
        return render_template('error.html', error=f"OAuth error: {error}")
    
    try:
        # Verificar el state para prevenir CSRF
        state = request.args.get('state')
        if state and state != session.get('oauth_state'):
            logger.warning("Estado OAuth no coincide, posible ataque CSRF")
            return render_template('error.html', error="Verificación de estado fallida, intente nuevamente")
        
        code = request.args.get('code')
        if not code:
            return render_template('error.html', error="No authorization code received")
        
        # Intercambiar el código por un token
        from john_deere_api import exchange_code_for_token
        token = exchange_code_for_token(code)
        logger.info(f"Token recibido: access_token válido por {token.get('expires_in', 0)/60/60} horas")
        
        # Guardar el token en la sesión
        session['oauth_token'] = token
        
        # Redireccionar al dashboard
        return redirect(url_for('dashboard'))
    except Exception as e:
        logger.error(f"Callback error: {str(e)}")
        return render_template('error.html', error=str(e))

@app.route('/auth-complete')
def auth_complete():
    """Captura la autenticación después de la redirección de John Deere."""
    try:
        logger.info("Capturando redirección de autenticación de John Deere")
        # Este endpoint es para capturar cuando el usuario regresa de John Deere
        
        # Para propósitos de desarrollo, simularemos una autenticación exitosa
        session['oauth_token'] = {'access_token': 'simulated_token'}
        
        # Redirigir al dashboard
        return redirect(url_for('dashboard'))
    except Exception as e:
        logger.error(f"Error en auth-complete: {str(e)}")
        return render_template('error.html', error=str(e))

@app.route('/dashboard')
def dashboard():
    """Main dashboard view for authenticated users."""
    if 'oauth_token' not in session:
        return redirect(url_for('index'))
    
    try:
        token = session.get('oauth_token')
        
        # Para desarrollo, usamos datos de muestra
        # En producción, descomentar para usar datos reales:
        """
        from john_deere_api import fetch_organizations
        organizations = fetch_organizations(token)
        """
        
        # Datos de muestra para pruebas
        organizations = [
            {
                'id': '463153',
                'name': 'Forestal Link',
                'type': 'CUSTOMER'
            },
            {
                'id': '123456',
                'name': 'Agrícola Santa Rosa',
                'type': 'CUSTOMER'
            },
            {
                'id': '789012',
                'name': 'Hacienda El Bosque',
                'type': 'CUSTOMER'
            }
        ]
        
        # Mostrar información del token en el dashboard (solo para desarrollo)
        token_info = {
            'access_token': token.get('access_token', '')[:10] + '...' if token.get('access_token') else 'No disponible',
            'refresh_token': token.get('refresh_token', '')[:10] + '...' if token.get('refresh_token') else 'No disponible',
            'expires_in': f"{token.get('expires_in', 0)/60/60:.1f} horas" if token.get('expires_in') else 'No disponible',
        }
        
        return render_template('dashboard.html', organizations=organizations, token_info=token_info)
    except Exception as e:
        logger.error(f"Dashboard error: {str(e)}")
        flash(f"Error loading dashboard: {str(e)}", "danger")
        return render_template('error.html', error=str(e))

@app.route('/api/machines/<organization_id>')
def get_machines(organization_id):
    """API endpoint to get machines for a specific organization."""
    if 'oauth_token' not in session:
        return jsonify({'error': 'Not authenticated'}), 401
    
    try:
        # Sample data for machines in organization
        if organization_id == '463153':
            machines = [
                {
                    'id': 'M-1001',
                    'name': 'Harvester JD-550',
                    'model': '550G-LC',
                    'type': 'HARVESTER',
                    'location': {'latitude': -36.8282, 'longitude': -73.0514}
                },
                {
                    'id': 'M-1002',
                    'name': 'Forwarder JD-1710',
                    'model': '1710D',
                    'type': 'FORWARDER',
                    'location': {'latitude': -36.8301, 'longitude': -73.0498}
                },
                {
                    'id': 'M-1003',
                    'name': 'Excavator JD-350',
                    'model': '350G-LC',
                    'type': 'EXCAVATOR',
                    'location': {'latitude': -36.8325, 'longitude': -73.0532}
                }
            ]
        else:
            machines = [
                {
                    'id': f'M-{organization_id}-01',
                    'name': f'Harvester {organization_id}',
                    'model': '550G-LC',
                    'type': 'HARVESTER',
                    'location': {'latitude': -36.8282, 'longitude': -73.0514}
                }
            ]
        return jsonify(machines)
    except Exception as e:
        logger.error(f"Error fetching machines: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/machine/<machine_id>')
def get_machine_details(machine_id):
    """API endpoint to get details for a specific machine."""
    if 'oauth_token' not in session:
        return jsonify({'error': 'Not authenticated'}), 401
    
    try:
        # Sample machine details data
        machine_details = {
            'id': machine_id,
            'name': f'Machine {machine_id}',
            'serialNumber': f'SN-{machine_id}',
            'model': '550G-LC' if 'M-1001' in machine_id else '1710D',
            'type': 'HARVESTER' if 'M-1001' in machine_id else 'FORWARDER',
            'status': 'ACTIVE',
            'location': {
                'latitude': -36.8282, 
                'longitude': -73.0514
            },
            'hoursOfOperation': 1250,
            'fuelLevel': 78,
            'lastUpdated': '2025-04-08T14:30:00Z'
        }
        return jsonify(machine_details)
    except Exception as e:
        logger.error(f"Error fetching machine details: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/machine/<machine_id>/alerts')
def get_machine_alerts(machine_id):
    """API endpoint to get alerts for a specific machine."""
    if 'oauth_token' not in session:
        return jsonify({'error': 'Not authenticated'}), 401
    
    try:
        # Sample alerts data
        alerts = [
            {
                'id': f'ALT-{machine_id}-001',
                'type': 'WARNING',
                'title': 'Bajo nivel de combustible',
                'description': 'El nivel de combustible está por debajo del 25%',
                'timestamp': '2025-04-07T10:15:00Z',
                'status': 'ACTIVE'
            },
            {
                'id': f'ALT-{machine_id}-002',
                'type': 'CRITICAL',
                'title': 'Temperatura del motor alta',
                'description': 'La temperatura del motor ha superado el nivel recomendado',
                'timestamp': '2025-04-08T14:22:00Z',
                'status': 'ACTIVE'
            },
            {
                'id': f'ALT-{machine_id}-003',
                'type': 'INFO',
                'title': 'Mantenimiento programado',
                'description': 'Mantenimiento de rutina requerido en las próximas 50 horas',
                'timestamp': '2025-04-05T08:30:00Z',
                'status': 'ACTIVE'
            }
        ]
        return jsonify(alerts)
    except Exception as e:
        logger.error(f"Error fetching machine alerts: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.route('/logout')
def logout():
    """Logs out the user by clearing the session."""
    session.clear()
    flash("You have been logged out successfully.", "success")
    return redirect(url_for('index'))

@app.errorhandler(404)
def page_not_found(e):
    return render_template('error.html', error="Page not found."), 404

@app.errorhandler(500)
def server_error(e):
    return render_template('error.html', error="Internal server error."), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)
