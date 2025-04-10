import logging
import os
import time
import json
from urllib.parse import urlparse, urlunparse
import secrets
from datetime import datetime, timedelta

from flask import Flask, flash, jsonify, redirect, render_template, request, session, url_for
from flask_login import LoginManager, login_user, logout_user, login_required, current_user
from requests_oauthlib import OAuth2Session
from werkzeug.security import generate_password_hash, check_password_hash
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
    fetch_user_info,
    get_oauth_session
)
from models import db, User, Organization, Machine, LoginLog

# Inicialización de la aplicación
app = Flask(__name__)
app.secret_key = os.environ.get("SESSION_SECRET", os.urandom(24).hex())
app.wsgi_app = ProxyFix(app.wsgi_app, x_proto=1, x_host=1)  # necesario para url_for con https

# Configurar SQLAlchemy
database_url = os.environ.get("DATABASE_URL")
# Si estamos en PostgreSQL, asegurarnos de que la URL comienza con postgresql://
if database_url and database_url.startswith("postgres://"):
    database_url = database_url.replace("postgres://", "postgresql://", 1)
    
app.config['SQLALCHEMY_DATABASE_URI'] = database_url or 'sqlite:///deere_dashboard.db'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
app.config['SQLALCHEMY_ENGINE_OPTIONS'] = {
    'pool_pre_ping': True,  # Verifica conexiones antes de usarlas
    'pool_recycle': 300,    # Recicla conexiones cada 5 minutos
}
db.init_app(app)

# Inicializar LoginManager para Flask-Login
login_manager = LoginManager()
login_manager.init_app(app)
login_manager.login_view = 'login_form'
login_manager.login_message = 'Por favor inicie sesión para acceder a esta página.'
login_manager.login_message_category = 'warning'

# Configurar logging
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger(__name__)

@login_manager.user_loader
def load_user(user_id):
    """Función requerida por Flask-Login para cargar un usuario."""
    return User.query.get(int(user_id))

# Crear tablas de la base de datos al iniciar la aplicación
with app.app_context():
    db.create_all()
    
    # Verificar si existe un usuario administrador
    admin = User.query.filter_by(is_admin=True).first()
    if not admin:
        # Crear usuario administrador por defecto
        admin = User(
            username="admin",
            email="admin@example.com",
            is_admin=True
        )
        admin.set_password("admin123")  # Contraseña temporal que debe cambiarse
        db.session.add(admin)
        db.session.commit()
        logger.info("Usuario administrador creado exitosamente")

def is_admin_user():
    """Función de ayuda para verificar si el usuario actual es administrador."""
    if current_user.is_authenticated:
        return current_user.is_admin
    return False

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
    # Verificar si debemos usar la URI registrada en John Deere
    from config import USE_REGISTERED_REDIRECT_URI, JOHN_DEERE_REGISTERED_REDIRECT_URI, JOHN_DEERE_CALLBACK_PATH
    
    if USE_REGISTERED_REDIRECT_URI and JOHN_DEERE_REGISTERED_REDIRECT_URI:
        # Usar la URI registrada explícitamente en John Deere
        redirect_uri = JOHN_DEERE_REGISTERED_REDIRECT_URI
        logger.info(f"Usando URI de redirección registrada: {redirect_uri}")
        return redirect_uri
    
    # Si no se usa la URI registrada, calcular dinámicamente
    base_url = get_base_url()
    redirect_path = JOHN_DEERE_CALLBACK_PATH  # Usar la ruta configurada
    
    # Construir la URL completa de redirección
    redirect_uri = f"{base_url}{redirect_path}"
    logger.info(f"URL de redirección calculada dinámicamente: {redirect_uri}")
    return redirect_uri

@app.route('/')
def index():
    """Landing page that shows login options or redirects to dashboard if already authenticated."""
    # Si el usuario está logueado y tiene un token OAuth válido, redirigir al dashboard
    if current_user.is_authenticated and 'oauth_token' in session:
        return redirect(url_for('dashboard'))
    
    # Si el usuario está logueado pero no tiene token OAuth, redirigir a la autenticación de John Deere
    if current_user.is_authenticated and 'oauth_token' not in session:
        return redirect(url_for('login'))
    
    # Si no está autenticado, mostrar opciones de inicio de sesión
    # Esta página mostrará tanto la opción de inicio de sesión local como con John Deere
    return render_template('login_options.html')

@app.route('/register', methods=['GET', 'POST'])
@login_required
def register():
    """Página de registro de usuarios (solo accesible por administradores)."""
    # Verificar si el usuario actual es administrador
    if not current_user.is_admin:
        flash("No tiene permisos para acceder a esta página.", "danger")
        return redirect(url_for('dashboard'))
    
    if request.method == 'POST':
        # Obtener datos del formulario
        username = request.form.get('username')
        password = request.form.get('password')
        email = request.form.get('email')
        is_admin = 'is_admin' in request.form
        organizations = request.form.getlist('organizations')
        
        # Validar datos
        if not username or not password:
            flash("El nombre de usuario y la contraseña son obligatorios.", "danger")
            return redirect(url_for('register'))
        
        # Verificar si el usuario ya existe
        existing_user = User.query.filter_by(username=username).first()
        if existing_user:
            flash(f"El usuario '{username}' ya existe.", "danger")
            return redirect(url_for('register'))
        
        # Crear nuevo usuario
        new_user = User(
            username=username,
            email=email,
            is_admin=is_admin
        )
        new_user.set_password(password)
        
        # Asignar organizaciones si se seleccionaron
        if organizations:
            for org_id in organizations:
                org = Organization.query.get(org_id)
                if org:
                    new_user.organizations.append(org)
        
        # Guardar en la base de datos
        db.session.add(new_user)
        db.session.commit()
        
        flash(f"Usuario '{username}' creado exitosamente.", "success")
        return redirect(url_for('register'))
    
    # Obtener todas las organizaciones para el formulario
    organizations = Organization.query.all()
    # Obtener todos los usuarios para mostrarlos
    users = User.query.all()
    
    return render_template('register.html', 
                          organizations=organizations,
                          users=users)

@app.route('/login-form', methods=['GET', 'POST'])
def login_form():
    """Página de inicio de sesión de usuario."""
    # Si ya está autenticado, redirigir al dashboard
    if current_user.is_authenticated and 'oauth_token' in session:
        return redirect(url_for('dashboard'))
    
    # Procesar el formulario de login
    if request.method == 'POST':
        username = request.form.get('username')
        password = request.form.get('password')
        
        if not username or not password:
            flash('Por favor, complete todos los campos.', 'danger')
            return render_template('user_login.html')
        
        # Buscar usuario en la base de datos
        user = User.query.filter_by(username=username).first()
        
        # Registrar el intento de login, incluso si falla
        log_entry = LoginLog(
            username=username,
            ip_address=request.remote_addr,
            user_agent=request.user_agent.string,
            user_id=user.id if user else None,
            success=False  # Se actualiza después si es exitoso
        )
        db.session.add(log_entry)
        
        # Verificar credenciales
        if not user or not user.check_password(password):
            db.session.commit()  # Guardar el log de intento fallido
            flash('Usuario o contraseña incorrectos', 'danger')
            return render_template('user_login.html')
        
        # Login exitoso
        login_user(user)
        
        # Actualizar el log
        log_entry.success = True
        user.last_login = datetime.utcnow()
        db.session.commit()
        
        # Si no tiene token de OAuth, redirigir a la autenticación de John Deere
        if 'oauth_token' not in session:
            flash('Autenticación exitosa. Por favor, complete la autenticación con John Deere.', 'success')
            return redirect(url_for('login'))
        
        # Si ya tiene token, ir directamente al dashboard
        return redirect(url_for('dashboard'))
    
    # Mostrar formulario de login
    return render_template('user_login.html')

@app.route('/login')
def login():
    """Initiates the OAuth2 authentication flow with John Deere."""
    # Obtener el URI de redirección dinámico
    redirect_uri = get_full_redirect_uri()
    
    # Generar un estado para protección contra CSRF
    state = secrets.token_urlsafe(32)
    session['oauth_state'] = state
    
    # Verificar si usamos la configuración alternativa del flujo OAuth
    from config import USE_ALTERNATE_OAUTH_FLOW, USE_PERSISTENCE_HEADER_REDIRECT
    
    # Si usamos la redirección de persistent-header, cambiar el redirect_uri
    if USE_PERSISTENCE_HEADER_REDIRECT:
        redirect_uri = "https://persistent-header.deere.com/login"
    
    # Iniciar sesión OAuth2 con John Deere y obtener URL de autorización
    oauth = get_oauth_session(state=state, redirect_uri=redirect_uri)
    auth_url, state = oauth.authorization_url(JOHN_DEERE_AUTHORIZE_URL)
    
    # Si estamos usando el flujo alternativo, modificamos la URL de autorización directamente
    if USE_ALTERNATE_OAUTH_FLOW:
        logger.info("Usando el flujo OAuth alternativo con los nuevos scopes")
    
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
        
        # Si el usuario está autenticado, guardar el token en su perfil
        if current_user.is_authenticated:
            # Convertir el token a formato JSON y guardarlo en el usuario
            if token:
                # Calcular la fecha de expiración
                expires_in = token.get('expires_in', 3600)
                expiry_date = datetime.utcnow() + timedelta(seconds=expires_in)
                
                # Guardar token y fecha de expiración en el usuario
                current_user.oauth_token = json.dumps(token)
                current_user.oauth_token_expiry = expiry_date
                
                # Actualizar las organizaciones asociadas al usuario
                try:
                    # Primero guardamos la información del token actual
                    db.session.commit()
                    
                    # Ahora procedemos a obtener y asociar organizaciones
                    orgs = fetch_organizations(token)
                    
                    # Buscar o crear organizaciones en la base de datos
                    for org_data in orgs:
                        try:
                            org_id = org_data.get('id')
                            if not org_id:
                                logger.warning(f"Organización sin ID válido: {org_data}")
                                continue
                                
                            # Uso de get_or_404 puede causar un error 404, usar filtro en su lugar
                            org = Organization.query.filter_by(id=org_id).first()
                            
                            if not org:
                                # Crear nueva organización
                                org = Organization(
                                    id=org_id,
                                    name=org_data.get('name', 'Sin nombre'),
                                    type=org_data.get('type', 'Unknown')
                                )
                                db.session.add(org)
                                db.session.flush()  # Asegurar que la organización se crea antes de asignar
                            
                            # Asignar organización al usuario si no la tiene ya
                            if org not in current_user.organizations:
                                current_user.organizations.append(org)
                        except Exception as single_org_error:
                            logger.error(f"Error procesando organización {org_data.get('id', 'unknown')}: {str(single_org_error)}")
                            # Continuar con las siguientes organizaciones
                            continue
                    
                    # Guardar los cambios de organizaciones
                    db.session.commit()
                    logger.info(f"Asociadas {len(orgs)} organizaciones al usuario {current_user.username}")
                except Exception as org_error:
                    logger.error(f"Error al procesar organizaciones para el usuario: {str(org_error)}")
                    # Revertir cambios en caso de error
                    db.session.rollback()
                    
                    # Asegurar que al menos guardamos la información del token
                    try:
                        db.session.commit()
                    except Exception as final_error:
                        logger.error(f"Error crítico al guardar token: {str(final_error)}")
                        db.session.rollback()
                logger.info(f"Token OAuth guardado para el usuario {current_user.username}")
        
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
@login_required
def dashboard():
    """Main dashboard view for authenticated users."""
    if 'oauth_token' not in session:
        flash("Debe iniciar sesión para acceder al dashboard.", "warning")
        return redirect(url_for('index'))
    
    try:
        token = session.get('oauth_token')
        
        # Obtener organizaciones del usuario actual
        user_organizations = []
        if current_user.is_authenticated:
            if current_user.is_admin:
                # Si es admin, buscar todas las organizaciones
                user_organizations = Organization.query.all()
                logger.info(f"Usuario admin: {current_user.username}, mostrando todas las organizaciones ({len(user_organizations)})")
            else:
                # Si no es admin, mostrar solo sus organizaciones asignadas
                user_organizations = current_user.organizations
                logger.info(f"Usuario: {current_user.username}, organizaciones asignadas: {len(user_organizations)}")
        
        # Si no hay organizaciones en la base de datos, intentar obtenerlas de la API
        if not user_organizations:
            try:
                # Intenta obtener organizaciones reales desde la API de John Deere
                logger.info("No hay organizaciones en la base de datos, obteniendo desde API de John Deere")
                
                # Verificar si estamos usando un token simulado o de prueba
                if token.get('access_token') in ['simulated_token_manual', 'test_token']:
                    # El mensaje de error será más específico para entornos de desarrollo
                    raise ValueError("Modo de desarrollo: Se está utilizando un token simulado. Para conectar con datos reales, por favor autentíquese con credenciales válidas de John Deere.")
                    
                api_organizations = fetch_organizations(token)
                logger.info(f"Organizaciones obtenidas de API: {len(api_organizations)}")
                
                # Convertir las organizaciones de la API a objetos de la base de datos
                organizations = []
                for org_data in api_organizations:
                    try:
                        org_id = org_data.get('id')
                        if not org_id:
                            logger.warning(f"Organización sin ID válido: {org_data}")
                            continue
                            
                        org_name = org_data.get('name', 'Sin nombre')
                        org_type = org_data.get('type', 'Desconocido')
                        
                        # Buscar o crear la organización en la base de datos usando filter_by en lugar de get
                        org = Organization.query.filter_by(id=org_id).first()
                        if not org:
                            org = Organization(id=org_id, name=org_name, type=org_type)
                            db.session.add(org)
                            db.session.flush()  # Asegurar que la organización está creada antes de asignarla
                            
                            # Asignar al usuario actual si no es administrador
                            if current_user.is_authenticated and not current_user.is_admin:
                                if org not in current_user.organizations:
                                    current_user.organizations.append(org)
                        
                        organizations.append(org)
                    except Exception as single_org_error:
                        logger.error(f"Error procesando organización {org_data.get('id', 'unknown')}: {str(single_org_error)}")
                        # Continuar con las siguientes organizaciones
                        continue
                
                # Guardar cambios en la base de datos
                db.session.commit()
                
                # Si el usuario no es administrador, filtrar solo sus organizaciones
                if current_user.is_authenticated and not current_user.is_admin:
                    user_organizations = current_user.organizations
                else:
                    user_organizations = organizations
                
                if not user_organizations:
                    # Si no hay organizaciones, mostrar mensaje de error
                    logger.warning("No se obtuvieron organizaciones para el usuario")
                    flash("No se encontraron organizaciones asociadas a su cuenta. Contacte al administrador.", "warning")
                else:
                    # Mensaje de éxito si se obtuvieron datos
                    flash(f"Se obtuvieron {len(user_organizations)} organizaciones asociadas a su cuenta.", "success")
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
                    
                # Crear una lista vacía para evitar errores
                user_organizations = []
        
        # Convertir las organizaciones de la base de datos al formato esperado por el frontend
        organizations = []
        for org in user_organizations:
            organizations.append({
                'id': org.id,
                'name': org.name,
                'type': org.type
            })
        
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
@login_required
def get_machines(organization_id):
    """API endpoint to get machines for a specific organization."""
    if 'oauth_token' not in session:
        return jsonify({'error': 'Not authenticated'}), 401
    
    # Verificar si el usuario tiene acceso a esta organización
    if not current_user.is_admin:
        has_access = False
        for org in current_user.organizations:
            if str(org.id) == organization_id:
                has_access = True
                break
        
        if not has_access:
            logger.warning(f"Usuario {current_user.username} intentó acceder a organización no autorizada: {organization_id}")
            return jsonify({'error': 'No tiene permiso para acceder a esta organización'}), 403
    
    try:
        token = session.get('oauth_token')
        
        # Buscar máquinas en la base de datos primero
        db_machines = Machine.query.filter_by(organization_id=organization_id).all()
        
        # Si hay máquinas en la base de datos, retornarlas directamente
        if db_machines:
            machines = []
            for machine in db_machines:
                machines.append({
                    'id': machine.id,
                    'name': machine.name,
                    'model': machine.model,
                    'category': machine.category,
                    'organization_id': machine.organization_id
                })
            logger.info(f"Retornando {len(machines)} máquinas de la base de datos para la organización {organization_id}")
            return jsonify(machines)
        
        # Si no hay máquinas en la base de datos, intentar obtenerlas de la API
        try:
            # Verificar si estamos usando un token simulado o de prueba
            if token.get('access_token') in ['simulated_token_manual', 'test_token']:
                return jsonify({'error': 'Modo de desarrollo: Se está utilizando un token simulado. Para conectar con datos reales, por favor autentíquese con credenciales válidas de John Deere.'}), 401
                
            # Intentar obtener máquinas reales desde la API de John Deere
            logger.info(f"Obteniendo máquinas reales para la organización {organization_id}")
            api_machines = fetch_machines_by_organization(token, organization_id)
            logger.info(f"Máquinas obtenidas de API: {len(api_machines)}")
            
            if not api_machines:
                logger.warning(f"No se obtuvieron máquinas para la organización {organization_id}")
                # Retornar lista vacía pero con mensaje informativo
                return jsonify([])
            
            # Guardar las máquinas en la base de datos para futuras consultas
            for machine_data in api_machines:
                machine_id = machine_data.get('id')
                
                # Verificar si la máquina ya existe
                machine = Machine.query.get(machine_id)
                if not machine:
                    # Extraer nombre, modelo y categoría
                    name = machine_data.get('name', 'Sin nombre')
                    
                    # El modelo puede ser un objeto o una cadena
                    model = machine_data.get('model', '')
                    if isinstance(model, dict):
                        model = model.get('name', '')
                    
                    category = machine_data.get('category', '')
                    
                    # Crear nueva máquina
                    machine = Machine(
                        id=machine_id,
                        name=name,
                        model=model,
                        category=category,
                        organization_id=organization_id
                    )
                    db.session.add(machine)
            
            db.session.commit()
            logger.info(f"Se guardaron {len(api_machines)} máquinas en la base de datos")
                
            return jsonify(api_machines)
                
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
        
    except Exception as e:
        logger.error(f"Error general en get_machines: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/machine/<machine_id>')
@login_required
def get_machine_details(machine_id):
    """API endpoint to get details for a specific machine."""
    if 'oauth_token' not in session:
        return jsonify({'error': 'Not authenticated'}), 401
    
    # Verificar si el usuario tiene acceso a la máquina
    if not current_user.is_admin:
        # Buscar la máquina para obtener su organización
        machine = Machine.query.get(machine_id)
        if not machine:
            # Si la máquina no está en la base de datos, verificar en tiempo real
            # con las organizaciones del usuario
            has_access = False
            try:
                # Buscar la máquina en las organizaciones del usuario
                token = session.get('oauth_token')
                for org in current_user.organizations:
                    # Intentar obtener máquinas de la organización desde la API
                    org_machines = fetch_machines_by_organization(token, org.id)
                    for m in org_machines:
                        if m.get('id') == machine_id:
                            has_access = True
                            break
                    if has_access:
                        break
            except Exception as e:
                logger.error(f"Error verificando acceso a máquina {machine_id}: {str(e)}")
                
            if not has_access:
                logger.warning(f"Usuario {current_user.username} intentó acceder a máquina no autorizada: {machine_id}")
                return jsonify({'error': 'No tiene permiso para acceder a esta máquina'}), 403
        else:
            # Si la máquina está en la base de datos, verificar si pertenece a una
            # organización del usuario
            has_access = False
            for org in current_user.organizations:
                if org.id == machine.organization_id:
                    has_access = True
                    break
            
            if not has_access:
                logger.warning(f"Usuario {current_user.username} intentó acceder a máquina no autorizada: {machine_id}")
                return jsonify({'error': 'No tiene permiso para acceder a esta máquina'}), 403
    
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
@login_required
def get_machine_alerts(machine_id):
    """API endpoint to get alerts for a specific machine."""
    logger.info(f"INICIO endpoint get_machine_alerts para máquina: {machine_id}")
    
    if 'oauth_token' not in session:
        logger.error("No hay token OAuth en la sesión")
        return jsonify({'error': 'Not authenticated'}), 401
    
    # Verificar si el usuario tiene acceso a la máquina
    if not current_user.is_admin:
        # Buscar la máquina para obtener su organización
        machine = Machine.query.get(machine_id)
        if machine:
            # Verificar si la organización de la máquina está entre las del usuario
            has_access = False
            for org in current_user.organizations:
                if org.id == machine.organization_id:
                    has_access = True
                    break
            
            if not has_access:
                logger.warning(f"Usuario {current_user.username} intentó acceder a alertas de máquina no autorizada: {machine_id}")
                return jsonify({'error': 'No tiene permiso para acceder a esta máquina'}), 403
    
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
@login_required
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
    """Logs out the user by clearing the session."""
    # Cerrar sesión con Flask-Login
    if current_user.is_authenticated:
        logout_user()
    
    # Limpiar la sesión completa
    session.clear()
    flash("Se ha cerrado la sesión exitosamente.", "success")
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