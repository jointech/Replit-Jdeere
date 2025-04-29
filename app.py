import logging
import os
import time
from urllib.parse import urlparse, urlunparse
import secrets

from flask import Flask, flash, jsonify, make_response, redirect, render_template, request, session, url_for
from flask_login import LoginManager, current_user
from requests_oauthlib import OAuth2Session
from werkzeug.middleware.proxy_fix import ProxyFix

from config import JOHN_DEERE_AUTHORIZE_URL
from john_deere_api import (
    JOHN_DEERE_CLIENT_ID,
    JOHN_DEERE_CLIENT_SECRET,
    exchange_code_for_token,
    fetch_alert_definition,
    fetch_machine_alerts,
    fetch_machine_details,
    fetch_machine_engine_hours,
    fetch_machine_location,
    fetch_machines_by_organization,
    fetch_organizations,
    get_oauth_session
)

app = Flask(__name__)
app.secret_key = os.environ.get("SESSION_SECRET", os.urandom(24).hex())
app.wsgi_app = ProxyFix(app.wsgi_app, x_proto=1, x_host=1)  # necesario para url_for con https

# Configuración más estricta para sesiones
app.config['SESSION_COOKIE_SECURE'] = True
app.config['SESSION_COOKIE_HTTPONLY'] = True 
app.config['SESSION_COOKIE_SAMESITE'] = 'Lax'
app.config['PERMANENT_SESSION_LIFETIME'] = 3600  # 1 hora

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
    # Verificación adicional de integridad de token
    if 'oauth_token' in session:
        token = session.get('oauth_token')
        
        # Validar que el token tiene la estructura correcta
        if not isinstance(token, dict) or 'access_token' not in token:
            logger.warning("Token corrupto encontrado en sesión, limpiando sesión")
            session.clear()
            return render_template('login.html')
            
        # Verificar si el token está expirado (más detallado que la verificación de refresh)
        if 'expires_at' in token and token.get('expires_at', 0) < time.time():
            logger.info("Token expirado en sesión, limpiando sesión")
            session.clear()
            return render_template('login.html')
            
        # Si todo está bien, redirigir al dashboard
        return redirect(url_for('dashboard'))
    
    # Asegurar que la sesión está limpia antes de mostrar la página de inicio
    session.clear()
    
    # Mostrar la página de inicio
    return render_template('login.html')

@app.route('/login')
def login():
    """Initiates the OAuth2 authentication flow with John Deere.
    Esta función siempre inicia un flujo de autorización completo con John Deere,
    forzando al usuario a proporcionar sus credenciales nuevamente."""
    
    # Limpiar completamente cualquier sesión existente
    session.clear()
    
    # Eliminar todas las cookies relacionadas con la sesión desde el lado del servidor
    # Esto se hará efectivo en la respuesta final
    
    # Obtener el URI de redirección dinámico
    redirect_uri = get_full_redirect_uri()
    
    # Generar un estado para protección contra CSRF
    state = secrets.token_urlsafe(32)
    session['oauth_state'] = state
    
    # Registrar en el log que estamos iniciando un nuevo flujo de autenticación
    logger.info(f"Iniciando nuevo flujo de autenticación con estado: {state[:10]}... y redirect_uri: {redirect_uri}")
    
    # Iniciar sesión OAuth2 con John Deere y obtener URL de autorización
    # Usamos siempre un objeto OAuth2Session nuevo para evitar cualquier persistencia
    oauth = get_oauth_session(state=state, redirect_uri=redirect_uri)
    
    # Forzar siempre un nuevo inicio de sesión en John Deere
    # Añadimos múltiples parámetros para asegurar que el usuario tenga que autenticarse completamente
    # cada vez que utilice el login
    auth_url, state = oauth.authorization_url(
        JOHN_DEERE_AUTHORIZE_URL,
        prompt="login consent",               # Esto fuerza a mostrar la pantalla de login y consentimiento siempre
        max_age="0",                          # Fuerza siempre una reautenticación  
        auth_type="rerequest",                # Solicita explícitamente todos los permisos nuevamente
        response_mode="query"                 # Respuesta en parámetros de URL
    )
    
    logger.info(f"Redirigiendo a URL de autorización de John Deere: {auth_url}")
    
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

@app.route('/location-history')
def location_history():
    """View for machine location history grouped by organization."""
    if 'oauth_token' not in session:
        flash("Debe iniciar sesión para acceder al historial de ubicaciones.", "warning")
        return redirect(url_for('index'))
    
    try:
        token = session.get('oauth_token')
        organizations = fetch_organizations(token)
        
        return render_template(
            'location_history.html',
            organizations=organizations
        )
    except Exception as e:
        logger.error(f"Error loading location history: {str(e)}")
        flash(f"Error al cargar el historial de ubicaciones: {str(e)}", "danger")
        return render_template('error.html', error=str(e))

@app.route('/api/location-history/<organization_id>')
def get_location_history(organization_id):
    """API endpoint to get location history for all machines in an organization."""
    if 'oauth_token' not in session:
        return jsonify({'error': 'Not authenticated'}), 401
    
    try:
        token = session.get('oauth_token')
        machines = fetch_machines_by_organization(token, organization_id)
        
        location_history = []
        for machine in machines:
            if machine.get('location'):
                location_history.append({
                    'vin': str(machine.get('id')),  # Convertir a string para asegurar el formato completo
                    'name': machine.get('name'),
                    'timestamp': machine.get('location', {}).get('timestamp'),
                    'latitude': machine.get('location', {}).get('latitude'),
                    'longitude': machine.get('location', {}).get('longitude')
                })
        
        return jsonify(location_history)
    except Exception as e:
        return jsonify({'error': str(e)}), 500

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
                flash(f"Organizaciones encontradas: {len(organizations)}", "organizations")
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
        
@app.route('/api/machine/<machine_id>/engine-hours')
def get_machine_engine_hours(machine_id):
    """API endpoint to get engine hours data for a specific machine."""
    logger.info(f"INICIO endpoint get_machine_engine_hours para máquina: {machine_id}")
    
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
                
            # Intentar obtener datos de horómetro reales desde la API de John Deere
            logger.info(f"Obteniendo datos de horómetro reales para la máquina {machine_id}")
            engine_hours_data = fetch_machine_engine_hours(token, machine_id)
            
            if not engine_hours_data:
                logger.warning(f"No se encontraron datos de horómetro para la máquina {machine_id}")
                return jsonify({'error': 'No se encontraron datos de horómetro'}), 404
                
        except Exception as eh_error:
            logger.error(f"Error obteniendo horómetro desde la API: {str(eh_error)}")
            error_msg = str(eh_error)
            
            # Personalizar respuesta según el tipo de error
            if "401" in error_msg:
                return jsonify({'error': 'Error de autenticación (401): No autorizado para acceder a la API de John Deere.'}), 401
            elif "404" in error_msg:
                return jsonify({'error': f'Error 404: No se encontraron datos de horómetro para la máquina con ID {machine_id} en la API de John Deere.'}), 404
            else:
                return jsonify({'error': f'Error al obtener datos de horómetro: {error_msg}'}), 500
        
        logger.info(f"Retornando datos de horómetro para la máquina {machine_id}")
        return jsonify(engine_hours_data)
    except Exception as e:
        logger.error(f"Error general en get_machine_engine_hours: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/alert/definition')
def get_alert_definition():
    """API endpoint to get detailed definition for a specific alert."""
    if 'oauth_token' not in session:
        return jsonify({"error": "No estás autenticado", "success": False}), 401
    
    # Obtener la URI de la definición desde los parámetros de consulta
    definition_uri = request.args.get('uri')
    if not definition_uri:
        return jsonify({"error": "Se requiere el parámetro 'uri'", "success": False}), 400
    
    try:
        # Obtener la definición de la alerta
        token = session.get('oauth_token')
        logger.info(f"Obteniendo definición de alerta desde URI: {definition_uri}")
        
        # Importamos la función correctamente
        from john_deere_api import fetch_alert_definition
        
        # La función ahora devuelve información de éxito o fallo
        result = fetch_alert_definition(token, definition_uri)
        
        if result.get('success') is True:
            # La solicitud fue exitosa
            logger.info(f"Definición de alerta obtenida correctamente: {str(result)[:150]}")
            return jsonify(result)
        else:
            # La solicitud falló, pero tenemos información estructurada para devolver
            logger.warning(f"No se pudo obtener definición, pero devolviendo información de error: {str(result)}")
            # Devuelve información del error con un código 200 para que el cliente pueda procesarlo
            # Esto es mejor que 404 para que el cliente pueda mostrar el mensaje personalizado
            return jsonify(result)
    except Exception as e:
        logger.error(f"Error crítico al obtener definición de alerta {definition_uri}: {str(e)}")
        return jsonify({
            "success": False,
            "error": str(e),
            "message": "Error interno del servidor al procesar la solicitud."
        }), 500

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
    """Logs out the user by revoking token and completely destroying the session."""
    try:
        if 'oauth_token' in session:
            # Obtener el token actual
            token = session.get('oauth_token')
            
            # Intentar revocar el token en John Deere
            try:
                import requests
                from requests.auth import HTTPBasicAuth
                
                revoke_url = "https://signin.johndeere.com/oauth2/aus78tnlaysMraFhC1t7/v1/revoke"
                
                # Usar autenticación básica con client_id y client_secret
                response = requests.post(
                    revoke_url,
                    auth=HTTPBasicAuth(JOHN_DEERE_CLIENT_ID, JOHN_DEERE_CLIENT_SECRET),
                    data={
                        'token': token.get('access_token'),
                        'token_type_hint': 'access_token'
                    },
                    timeout=5  # Añadir timeout para evitar bloqueos
                )
                
                if response.status_code == 200:
                    logger.info("Token revocado exitosamente")
                else:
                    logger.warning(f"Error al revocar token. Status: {response.status_code}")
                    
                # También intentar revocar refresh token si existe
                if token.get('refresh_token'):
                    try:
                        refresh_response = requests.post(
                            revoke_url,
                            auth=HTTPBasicAuth(JOHN_DEERE_CLIENT_ID, JOHN_DEERE_CLIENT_SECRET),
                            data={
                                'token': token.get('refresh_token'),
                                'token_type_hint': 'refresh_token'
                            },
                            timeout=5  # Añadir timeout para evitar bloqueos
                        )
                        
                        if refresh_response.status_code == 200:
                            logger.info("Refresh token revocado exitosamente")
                        else:
                            logger.warning(f"Error al revocar refresh token. Status: {refresh_response.status_code}")
                    except Exception as e:
                        logger.warning(f"Error al revocar refresh token: {str(e)}")
                    
            except Exception as e:
                logger.warning(f"Error al revocar token: {str(e)}")
    except Exception as e:
        logger.error(f"Error durante logout: {str(e)}")
    finally:
        # Eliminar explícitamente todas las claves relacionadas con la autenticación
        if 'oauth_token' in session:
            session.pop('oauth_token', None)
        if 'oauth_state' in session:
            session.pop('oauth_state', None)
        if 'user_orgs' in session:
            session.pop('user_orgs', None)
        if 'last_auth_code' in session:
            session.pop('last_auth_code', None)
        
        # Limpiar toda la sesión para asegurar que no quede información
        session.clear()
        
        # Regenerar nueva sesión con otro ID para evitar ataques de session fixation
        # Esto es más seguro que simplemente limpiar la sesión
        from flask import session as flask_session
        flask_session.modified = True
        
        # Crear una respuesta que incluya eliminación de todas las cookies
        response = make_response(redirect(url_for('index')))
        
        # Establecer Session a expirado para eliminarla del navegador
        response.set_cookie('session', '', expires=0, path='/')
        
        # Eliminar todas las cookies relacionadas con la sesión
        for cookie in request.cookies:
            if cookie.startswith('session'):
                response.delete_cookie(cookie, path='/')
                
        # Forzar expiración de todas las cookies para este dominio
        response.headers.add('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        response.headers.add('Pragma', 'no-cache')
        response.headers.add('Expires', '0')
        
        flash("Se ha cerrado completamente la sesión.", "success")
        
        # Redirigir directamente a login para forzar nueva autenticación completa con John Deere
        # En lugar de ir al index, vamos directamente a la ruta de login que inicia el flujo OAuth2
        return redirect(url_for('login'))

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
    app.run(host='0.0.0.0', port=5001, debug=True)