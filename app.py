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
from config import (
    JOHN_DEERE_CLIENT_ID, 
    JOHN_DEERE_CLIENT_SECRET, 
    JOHN_DEERE_AUTHORIZE_URL, 
    JOHN_DEERE_SCOPES
)

# Configure logging
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger(__name__)

def get_base_url():
    """Obtiene la URL base de la aplicación actual, con el protocolo correcto."""
    base_url = request.host_url.rstrip('/')
    if request.headers.get('X-Forwarded-Proto') == 'https':
        base_url = base_url.replace('http:', 'https:')
    return base_url

def get_full_redirect_uri():
    """Obtiene la URL de redirección completa para la autenticación OAuth."""
    return f"{get_base_url()}/auth-capture"

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
        # Obtener la URL de redirección completa mediante nuestra función de ayuda
        redirect_uri = get_full_redirect_uri()
        redirect_uri_encoded = quote(redirect_uri)
        
        # Generar un state único para seguridad
        state = os.urandom(16).hex()
        session['oauth_state'] = state
        
        # Construir la URL exacta según lo proporcionado
        scopes = '+'.join(JOHN_DEERE_SCOPES)
        auth_url = f"https://signin.johndeere.com/oauth2/aus78tnlaysMraFhC1t7/v1/authorize?response_type=code&client_id={JOHN_DEERE_CLIENT_ID}&redirect_uri={redirect_uri_encoded}&scope={scopes}&state={state}"
        
        # Guardar información en la sesión para verificar después
        session['auth_flow_started'] = True
        
        logger.info(f"Redireccionando a John Deere para autenticación con redirect_uri: {redirect_uri}")
        return redirect(auth_url)
    except Exception as e:
        logger.error(f"Login error: {str(e)}")
        return render_template('error.html', error=str(e))

@app.route('/auth-capture')
def auth_capture():
    """Página que captura el código de autorización de la URL y lo envía automáticamente a auth_complete."""
    return render_template('auth_capture.html')

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
        
        # Usar la función de ayuda para obtener la URL de redirección
        redirect_uri = get_full_redirect_uri()
        
        # Intercambiar el código por un token usando la misma URL de redirección
        from john_deere_api import exchange_code_for_token
        token = exchange_code_for_token(code, redirect_uri=redirect_uri)
        logger.info(f"Token recibido: access_token válido por {token.get('expires_in', 0)/60/60} horas")
        
        # Guardar el token en la sesión
        session['oauth_token'] = token
        
        # Guardar el código de autorización utilizado exitosamente
        session['last_auth_code'] = code
        
        # Redireccionar al dashboard
        return redirect(url_for('dashboard'))
    except Exception as e:
        logger.error(f"Callback error: {str(e)}")
        return render_template('error.html', error=str(e))

@app.route('/auth-complete', methods=['GET', 'POST'])
def auth_complete():
    """Captura la autenticación después de la redirección de John Deere o código manual."""
    try:
        logger.info("Capturando código de autorización")
        
        # Obtener el código de autorización
        code = None
        if request.method == 'POST':
            # Comprobar si es una solicitud de formulario o JSON
            if request.is_json:
                data = request.get_json()
                code = data.get('code')
            else:
                code = request.form.get('code')
        else:
            code = request.args.get('code')
        
        if not code:
            if request.is_json:
                return jsonify({'error': 'No se proporcionó un código de autorización válido.'}), 400
            flash("No se proporcionó un código de autorización válido.", "danger")
            return redirect(url_for('index'))
        
        # Intercambiar el código por un token
        try:
            # Usar la función de ayuda para obtener la URL de redirección
            redirect_uri = get_full_redirect_uri()
            
            from john_deere_api import exchange_code_for_token
            token = exchange_code_for_token(code, redirect_uri=redirect_uri)
            logger.info(f"Token recibido manualmente: access_token válido por {token.get('expires_in', 0)/60/60} horas")
            
            # Guardar el token en la sesión
            session['oauth_token'] = token
            
            # Guardar el código de autorización utilizado exitosamente
            session['last_auth_code'] = code
            
            # Responder según el tipo de solicitud
            if request.is_json:
                return jsonify({'success': True, 'redirect': url_for('dashboard')})
            
            flash("Autenticación exitosa con código proporcionado", "success")
        except Exception as token_error:
            logger.error(f"Error intercambiando código por token: {str(token_error)}")
            # En caso de error, usar un token simulado para desarrollo
            session['oauth_token'] = {
                'access_token': 'simulated_token_manual',
                'refresh_token': 'simulated_refresh_token_manual',
                'expires_in': 3600,
                'expires_at': time.time() + 3600
            }
            
            if request.is_json:
                return jsonify({
                    'success': False, 
                    'warning': 'No se pudo obtener un token real. Usando token simulado para desarrollo.',
                    'redirect': url_for('dashboard')
                })
            
            flash("No se pudo obtener un token real. Usando token simulado para desarrollo.", "warning")
        
        # Redirigir al dashboard
        return redirect(url_for('dashboard'))
    except Exception as e:
        logger.error(f"Error en auth-complete: {str(e)}")
        if request.is_json:
            return jsonify({'error': str(e)}), 500
        return render_template('error.html', error=str(e))

@app.route('/dashboard')
def dashboard():
    """Main dashboard view for authenticated users."""
    if 'oauth_token' not in session:
        return redirect(url_for('index'))
    
    try:
        token = session.get('oauth_token')
        
        try:
            # Intenta obtener organizaciones reales desde la API de John Deere
            logger.info("Obteniendo organizaciones reales desde la API de John Deere")
            
            # Verificar si estamos usando un token simulado
            if token.get('access_token') == 'simulated_token_manual':
                raise ValueError("No se puede conectar a la API con un token simulado. Se requiere un token real.")
                
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
            # Verificar si estamos usando un token simulado
            if token.get('access_token') == 'simulated_token_manual':
                return jsonify({'error': 'No se puede conectar a la API con un token simulado. Se requiere un token real.'}), 401
                
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
            # Verificar si estamos usando un token simulado
            if token.get('access_token') == 'simulated_token_manual':
                return jsonify({'error': 'No se puede conectar a la API con un token simulado. Se requiere un token real.'}), 401
                
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
    if 'oauth_token' not in session:
        return jsonify({'error': 'Not authenticated'}), 401
    
    try:
        token = session.get('oauth_token')
        
        try:
            # Verificar si estamos usando un token simulado
            if token.get('access_token') == 'simulated_token_manual':
                return jsonify({'error': 'No se puede conectar a la API con un token simulado. Se requiere un token real.'}), 401
                
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
        
        return jsonify(alerts)
    except Exception as e:
        logger.error(f"Error general en get_machine_alerts: {str(e)}")
        return jsonify({'error': str(e)}), 500

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

@app.errorhandler(404)
def page_not_found(e):
    return render_template('error.html', error="Page not found."), 404

@app.errorhandler(500)
def server_error(e):
    return render_template('error.html', error="Internal server error."), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)
