import logging
import os
import time
from urllib.parse import urlparse, urlunparse
import secrets

from flask import Flask, flash, jsonify, redirect, render_template, request, session, url_for
from flask_login import LoginManager, current_user
from requests_oauthlib import OAuth2Session
from werkzeug.middleware.proxy_fix import ProxyFix

from config import JOHN_DEERE_AUTHORIZE_URL
from john_deere_api import (
    JOHN_DEERE_CLIENT_ID,
    exchange_code_for_token,
    fetch_alert_definition,
    fetch_machine_alerts,
    fetch_machine_details,
    fetch_machines_by_organization,
    fetch_organizations,
    get_oauth_session
)

app = Flask(__name__)
app.secret_key = os.environ.get("SESSION_SECRET", os.urandom(24).hex())
app.wsgi_app = ProxyFix(app.wsgi_app, x_proto=1, x_host=1)  # necesario para url_for con https

logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger(__name__)

def get_base_url():
    """Obtiene la URL base de la aplicación actual, con el protocolo correcto."""
    # Intentar usar X-Forwarded-Proto/Host en entornos como Replit
    host = request.headers.get('X-Forwarded-Host') or request.headers.get('Host') or request.host
    proto = request.headers.get('X-Forwarded-Proto') or request.scheme
    
    # Si estamos detrás de un proxy, asegurar que usamos https
    if host and 'replit.dev' in host:
        proto = 'https'
    
    # Construir y retornar la URL base
    base_url = f"{proto}://{host}"
    logger.info(f"URL base calculada: {base_url}")
    return base_url

def get_full_redirect_uri():
    """Obtiene la URL de redirección completa para la autenticación OAuth."""
    # Usamos la función de URL base y añadimos la ruta de redirección
    base_url = get_base_url()
    redirect_path = "/auth-capture"
    redirect_uri = f"{base_url}{redirect_path}"
    logger.info(f"URL de redirección calculada: {redirect_uri}")
    return redirect_uri

@app.route('/')
def index():
    """Landing page that checks if user is authenticated and redirects accordingly."""
    # Si ya estamos autenticados, redirigir al dashboard
    if 'oauth_token' in session:
        return redirect(url_for('dashboard'))
    
    # De lo contrario, mostrar la página de inicio
    return render_template('login.html')

@app.route('/login')
def login():
    """Initiates the OAuth2 authentication flow with John Deere."""
    # Obtener el URI de redirección dinámico
    redirect_uri = get_full_redirect_uri()
    
    # Generar un estado para protección contra CSRF
    state = secrets.token_urlsafe(32)
    session['oauth_state'] = state
    
    # Iniciar sesión OAuth2 con John Deere y obtener URL de autorización
    oauth = get_oauth_session(state=state, redirect_uri=redirect_uri)
    auth_url, state = oauth.authorization_url(JOHN_DEERE_AUTHORIZE_URL)
    
    logger.info(f"Redirigiendo a URL de autorización de John Deere: {auth_url} con redirect_uri {redirect_uri}")
    
    # Redirigir al usuario a la página de inicio de sesión/autorización de John Deere
    return redirect(auth_url)

@app.route('/auth-capture')
def auth_capture():
    """Página que captura el código de autorización de la URL y lo envía automáticamente a auth_complete."""
    # Obtener parámetros de la URL, incluyendo código y estado
    code = request.args.get('code')
    state = request.args.get('state')
    error = request.args.get('error')
    
    # URL base para la redirección que se usó en el flujo OAuth
    redirect_uri = get_full_redirect_uri()
    
    # Verificar si hay un código y estado válidos
    if code and state:
        if state != session.get('oauth_state'):
            logger.error("Estado inválido en la respuesta de autorización OAuth")
            flash("Error de seguridad: el estado de la respuesta no coincide con el estado esperado.", "danger")
            return redirect(url_for('index'))
        
        # Log para depuración
        logger.info(f"Código de autorización recibido: {code[:10]}...")
        
        # Renderizar la plantilla que enviará automáticamente el código
        return render_template(
            'auth_capture.html', 
            code=code, 
            state=state, 
            redirect_uri=redirect_uri
        )
    
    # Manejar errores específicos de OAuth
    if error:
        logger.error(f"Error en la autorización OAuth: {error}")
        flash(f"Error de autorización: {error}", "danger")
    else:
        logger.error("No se recibió código o token en la redirección de autorización OAuth")
        flash("No se pudo completar la autenticación. No se recibió código de autorización.", "danger")
    
    return redirect(url_for('index'))

@app.route('/callback', methods=['GET', 'POST'])
def callback():
    """Handles the OAuth2 callback from John Deere."""
    code = request.args.get('code')
    state = request.args.get('state')
    
    # URL de redirección que se usó en el flujo OAuth
    redirect_uri = get_full_redirect_uri()
    
    if code and state:
        logger.info(f"Intentando intercambiar código por token con redirect_uri {redirect_uri}")
        try:
            # Intercambiar código por token de acceso
            token = exchange_code_for_token(code, redirect_uri=redirect_uri)
            
            # Guardar el token en la sesión
            session['oauth_token'] = token
            # Guardar el código para referencia (solo para depuración)
            session['last_auth_code'] = code
            
            flash("Autenticación exitosa con John Deere API.", "success")
            return redirect(url_for('dashboard'))
        except Exception as e:
            logger.error(f"Error intercambiando código por token: {str(e)}")
            flash(f"Error intercambiando código por token: {str(e)}", "danger")
    else:
        logger.error("No se recibió código o estado en callback OAuth")
        flash("No se recibió código de autorización o estado.", "danger")
    
    return redirect(url_for('index'))

@app.route('/auth-complete', methods=['POST'])
def auth_complete():
    """Captura la autenticación después de la redirección de John Deere o código manual."""
    logger.info("Capturando código de autorización")
    
    # Determinar si es una solicitud AJAX o un envío de formulario
    is_ajax = request.headers.get('Content-Type') == 'application/x-www-form-urlencoded' and not request.form.get('_is_form')
    
    # Obtener código y URL de redirección dependiendo del tipo de solicitud
    if is_ajax:
        code = request.form.get('code')
        redirect_uri = request.form.get('redirect_uri')
        logger.info(f"Solicitud AJAX recibida con redirect_uri: {redirect_uri}")
    else:
        code = request.form.get('code')
        redirect_uri = request.form.get('redirect_uri')
        logger.info(f"Envío de formulario recibido con redirect_uri: {redirect_uri}")
    
    if not code:
        error_msg = "No se proporcionó un código de autorización."
        logger.error(error_msg)
        
        if is_ajax:
            return jsonify({"success": False, "error": error_msg})
        else:
            flash(error_msg, "danger")
            return redirect(url_for('index'))
    
    if not redirect_uri:
        # Si no se proporciona redirect_uri, usamos la URL base de la aplicación
        redirect_uri = get_full_redirect_uri()
        logger.info(f"No se proporcionó redirect_uri, usando valor por defecto: {redirect_uri}")
    
    try:
        # Intercambiar código por token de acceso
        token = exchange_code_for_token(code, redirect_uri=redirect_uri)
        
        # Guardar el token en la sesión
        session['oauth_token'] = token
        # Guardar el código para referencia (solo para depuración)
        session['last_auth_code'] = code
        
        success_msg = "Autenticación exitosa con John Deere API."
        logger.info(success_msg)
        
        if is_ajax:
            return jsonify({
                "success": True,
                "message": success_msg,
                "redirect": url_for('dashboard')
            })
        else:
            flash(success_msg, "success")
            return redirect(url_for('dashboard'))
    except Exception as e:
        error_msg = f"Error intercambiando código por token: {str(e)}"
        logger.error(error_msg)
        
        if is_ajax:
            return jsonify({
                "success": False,
                "error": error_msg
            })
        else:
            flash(error_msg, "danger")
            return redirect(url_for('auth_setup'))

@app.route('/dashboard')
def dashboard():
    """Main dashboard view for authenticated users."""
    if 'oauth_token' not in session:
        flash("Debe iniciar sesión para acceder al dashboard.", "warning")
        return redirect(url_for('index'))
    
    try:
        token = session.get('oauth_token')
        
        try:
            # Intenta obtener organizaciones reales desde la API de John Deere
            logger.info("Obteniendo organizaciones reales desde la API de John Deere")
            
            # Verificar si estamos usando un token simulado o de prueba
            if token.get('access_token') in ['simulated_token_manual', 'test_token']:
                # El mensaje de error será más específico para entornos de desarrollo
                raise ValueError("Modo de desarrollo: Se está utilizando un token simulado. Para conectar con datos reales, por favor autentíquese con credenciales válidas de John Deere.")
                
            organizations = fetch_organizations(token)
            logger.info(f"Organizaciones obtenidas: {organizations}")
            
            if not organizations:
                # Si no hay organizaciones reales, mostrar mensaje de error
                logger.warning("No se obtuvieron organizaciones reales")
                flash("No se encontraron organizaciones en la cuenta de John Deere. Verifique los permisos de su aplicación.", "warning")
                organizations = []
            else:
                # Mensaje de éxito si se obtuvieron datos reales
                flash(f"Se obtuvieron {len(organizations)} organizaciones de John Deere.", "success")
        except Exception as org_error:
            # Mensaje de error específico según el tipo de error
            logger.error(f"Error obteniendo organizaciones: {str(org_error)}")
            
            error_msg = str(org_error)
            
            # Personalizar mensajes de error comunes
            if "401" in error_msg:
                flash("Error de autenticación (401): No autorizado para acceder a la API de John Deere. Verifique las credenciales y permisos.", "danger")
            elif "404" in error_msg:
                flash("Error 404: El recurso solicitado no existe en la API de John Deere. Verifique los endpoints y parámetros.", "danger")
            else:
                flash(f"Error al obtener organizaciones: {error_msg}", "danger")
                
            # Crear una lista vacía para evitar errores, pero no usar datos simulados
            organizations = []
        
        # Información del token (solo para desarrollo)
        token_access = token.get('access_token', '')
        token_refresh = token.get('refresh_token', '')
        token_info = {
            'access_token': token_access[:10] + '...' if token_access else 'No disponible',
            'refresh_token': token_refresh[:10] + '...' if token_refresh else 'No disponible',
            'expires_in': f"{token.get('expires_in', 0)/60/60:.1f} horas" if token.get('expires_in') else 'No disponible',
            'token_type': token.get('token_type', 'Bearer')
        }
        
        # Recuperar el último código de autorización utilizado exitosamente (si existe)
        last_auth_code = session.get('last_auth_code')
        auth_code_info = None
        if last_auth_code:
            auth_code_info = {
                'code': last_auth_code[:5] + '...' + last_auth_code[-5:] if len(last_auth_code) > 10 else last_auth_code,
                'full_length': len(last_auth_code)
            }
        
        return render_template(
            'dashboard.html', 
            organizations=organizations, 
            token_info=token_info,
            auth_code_info=auth_code_info
        )
    except Exception as e:
        logger.error(f"Dashboard error: {str(e)}")
        flash(f"Error al cargar el dashboard: {str(e)}", "danger")
        return render_template('error.html', error=str(e))

@app.route('/api/machines/<organization_id>')
def get_machines(organization_id):
    """API endpoint to get machines for a specific organization."""
    if 'oauth_token' not in session:
        return jsonify({'error': 'Not authenticated'}), 401
    
    try:
        token = session.get('oauth_token')
        
        try:
            # Verificar si estamos usando un token simulado o de prueba
            if token.get('access_token') in ['simulated_token_manual', 'test_token']:
                return jsonify({'error': 'Modo de desarrollo: Se está utilizando un token simulado. Para conectar con datos reales, por favor autentíquese con credenciales válidas de John Deere.'}), 401
                
            # Intentar obtener máquinas reales desde la API de John Deere
            logger.info(f"Obteniendo máquinas reales para la organización {organization_id}")
            machines = fetch_machines_by_organization(token, organization_id)
            logger.info(f"Máquinas obtenidas: {len(machines)}")
            
            if not machines:
                logger.warning(f"No se obtuvieron máquinas para la organización {organization_id}")
                # Retornar lista vacía pero con mensaje informativo
                return jsonify([])
                
        except Exception as m_error:
            logger.error(f"Error fetching machines from API: {str(m_error)}")
            error_msg = str(m_error)
            
            # Personalizar respuesta según el tipo de error
            if "401" in error_msg:
                return jsonify({'error': 'Error de autenticación (401): No autorizado para acceder a la API de John Deere.'}), 401
            elif "404" in error_msg:
                return jsonify({'error': 'Error 404: El recurso solicitado no existe en la API de John Deere.'}), 404
            else:
                return jsonify({'error': f'Error al obtener máquinas: {error_msg}'}), 500
                
            # No usamos datos simulados, solo retornamos el error
        
        return jsonify(machines)
    except Exception as e:
        logger.error(f"Error general en get_machines: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/machine/<machine_id>')
def get_machine_details(machine_id):
    """API endpoint to get details for a specific machine."""
    if 'oauth_token' not in session:
        return jsonify({'error': 'Not authenticated'}), 401
    
    try:
        token = session.get('oauth_token')
        
        try:
            # Verificar si estamos usando un token simulado o de prueba
            if token.get('access_token') in ['simulated_token_manual', 'test_token']:
                return jsonify({'error': 'Modo de desarrollo: Se está utilizando un token simulado. Para conectar con datos reales, por favor autentíquese con credenciales válidas de John Deere.'}), 401
                
            # Intentar obtener detalles reales desde la API de John Deere
            logger.info(f"Obteniendo detalles reales para la máquina {machine_id}")
            machine_details = fetch_machine_details(token, machine_id)
            
            if not machine_details:
                logger.warning(f"No se obtuvieron detalles para la máquina {machine_id}")
                return jsonify({'error': f'No se encontraron detalles para la máquina {machine_id}'}), 404
                
        except Exception as md_error:
            logger.error(f"Error fetching machine details from API: {str(md_error)}")
            error_msg = str(md_error)
            
            # Personalizar respuesta según el tipo de error
            if "401" in error_msg:
                return jsonify({'error': 'Error de autenticación (401): No autorizado para acceder a la API de John Deere.'}), 401
            elif "404" in error_msg:
                return jsonify({'error': f'Error 404: No se encontró la máquina con ID {machine_id} en la API de John Deere.'}), 404
            else:
                return jsonify({'error': f'Error al obtener detalles de la máquina: {error_msg}'}), 500
        
        return jsonify(machine_details)
    except Exception as e:
        logger.error(f"Error general en get_machine_details: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/machine/<machine_id>/alerts')
def get_machine_alerts(machine_id):
    """API endpoint to get alerts for a specific machine."""
    logger.info(f"INICIO endpoint get_machine_alerts para máquina: {machine_id}")
    
    if 'oauth_token' not in session:
        logger.error("No hay token OAuth en la sesión")
        return jsonify({'error': 'Not authenticated'}), 401
    
    try:
        token = session.get('oauth_token')
        logger.info(f"Token presente: {bool(token)}")
        
        try:
            # Verificar si estamos usando un token simulado o de prueba
            if token.get('access_token') in ['simulated_token_manual', 'test_token']:
                logger.warning("Usando token simulado")
                return jsonify({'error': 'Modo de desarrollo: Se está utilizando un token simulado. Para conectar con datos reales, por favor autentíquese con credenciales válidas de John Deere.'}), 401
                
            # Intentar obtener alertas reales desde la API de John Deere
            logger.info(f"Obteniendo alertas reales para la máquina {machine_id}")
            alerts = fetch_machine_alerts(token, machine_id)
            
            if not alerts:
                logger.warning(f"No se encontraron alertas para la máquina {machine_id}")
                # Retornar una lista vacía, no es un error que una máquina no tenga alertas
                return jsonify([])
                
        except Exception as ma_error:
            logger.error(f"Error fetching machine alerts from API: {str(ma_error)}")
            error_msg = str(ma_error)
            
            # Personalizar respuesta según el tipo de error
            if "401" in error_msg:
                return jsonify({'error': 'Error de autenticación (401): No autorizado para acceder a la API de John Deere.'}), 401
            elif "404" in error_msg:
                return jsonify({'error': f'Error 404: No se encontró la máquina con ID {machine_id} en la API de John Deere.'}), 404
            else:
                return jsonify({'error': f'Error al obtener alertas de la máquina: {error_msg}'}), 500
        
        logger.info(f"Retornando {len(alerts)} alertas para la máquina {machine_id}")
        return jsonify(alerts)
    except Exception as e:
        logger.error(f"Error general en get_machine_alerts: {str(e)}")
        return jsonify({'error': str(e)}), 500
        
@app.route('/api/alert/definition')
def get_alert_definition():
    """API endpoint to get detailed definition for a specific alert."""
    if 'oauth_token' not in session:
        return jsonify({"error": "No estás autenticado"}), 401
    
    # Obtener la URI de la definición desde los parámetros de consulta
    definition_uri = request.args.get('uri')
    if not definition_uri:
        return jsonify({"error": "Se requiere el parámetro 'uri'"}), 400
    
    try:
        # Obtener la definición de la alerta
        token = session.get('oauth_token')
        logger.info(f"Obteniendo definición de alerta desde URI: {definition_uri}")
        
        # Importamos la función correctamente
        from john_deere_api import fetch_alert_definition
        
        definition = fetch_alert_definition(token, definition_uri)
        if definition:
            logger.info(f"Definición de alerta obtenida correctamente: {str(definition)[:150]}")
            return jsonify(definition)
        else:
            logger.error(f"No se pudo obtener la definición de la alerta desde {definition_uri}")
            return jsonify({"error": "No se pudo obtener la definición de la alerta"}), 404
    except Exception as e:
        logger.error(f"Error al obtener definición de alerta {definition_uri}: {str(e)}")
        return jsonify({"error": str(e)}), 500

@app.route('/auth-setup')
def auth_setup():
    """Página con instrucciones para configurar la autenticación automática."""
    # Obtener la URL base mediante nuestra función de ayuda
    base_url = get_base_url()
    redirect_uri = get_full_redirect_uri()
    
    return render_template(
        'auth_setup.html', 
        redirect_uri=redirect_uri,
        auth_capture_url=redirect_uri,
        base_url=base_url
    )

@app.route('/logout')
def logout():
    """Logs out the user by clearing the session."""
    session.clear()
    flash("You have been logged out successfully.", "success")
    return redirect(url_for('index'))

@app.route('/test-location/<machine_id>')
def test_location(machine_id):
    """Endpoint de prueba para obtener ubicación directamente."""
    if 'oauth_token' not in session:
        return jsonify({'error': 'No hay token en sesión. Inicie sesión primero.'}), 401
    
    token = session['oauth_token']
    
    try:
        # Importamos aquí para no interferir con las importaciones principales
        from requests_oauthlib import OAuth2Session
        from john_deere_api import refresh_token_if_needed, fetch_machine_location
        
        # Refrescar token si es necesario
        token = refresh_token_if_needed(token)
        
        # Crear sesión OAuth
        oauth = OAuth2Session(JOHN_DEERE_CLIENT_ID, token=token)
        
        # Probar el endpoint locationHistory
        history_endpoint = f"https://partnerapi.deere.com/platform/machines/{machine_id}/locationHistory"
        logger.info(f"Probando endpoint locationHistory: {history_endpoint}")
        
        # Agregar header para desactivar paginación
        headers = {'x-deere-no-paging': 'true'}
        
        history_response = oauth.get(history_endpoint, headers=headers)
        history_data = None
        history_status = history_response.status_code
        history_error = None
        
        try:
            history_response.raise_for_status()
            history_data = history_response.json()
        except Exception as e:
            history_error = str(e)
        
        # Probar endpoint location directo
        location_endpoint = f"https://partnerapi.deere.com/platform/machines/{machine_id}/location"
        logger.info(f"Probando endpoint location: {location_endpoint}")
        
        location_response = oauth.get(location_endpoint, headers=headers)
        location_data = None
        location_status = location_response.status_code
        location_error = None
        
        try:
            location_response.raise_for_status()
            location_data = location_response.json()
        except Exception as e:
            location_error = str(e)
        
        # Probar nuestra función actualizada de obtención de ubicación
        location_result = fetch_machine_location(token, machine_id)
        
        # Resultado de todas las pruebas
        result = {
            'machine_id': machine_id,
            'locationHistory': {
                'endpoint': history_endpoint,
                'status': history_status,
                'data': history_data,
                'error': history_error
            },
            'location': {
                'endpoint': location_endpoint,
                'status': location_status,
                'data': location_data,
                'error': location_error
            },
            'processed_location': location_result
        }
        
        return jsonify(result)
    
    except Exception as e:
        logger.error(f"Error en prueba de ubicación: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.errorhandler(404)
def page_not_found(e):
    return render_template('error.html', error="Page not found."), 404

@app.errorhandler(500)
def server_error(e):
    return render_template('error.html', error="Internal server error."), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)