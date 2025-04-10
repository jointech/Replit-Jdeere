from flask_login import UserMixin
from werkzeug.security import generate_password_hash, check_password_hash
from flask_sqlalchemy import SQLAlchemy
from datetime import datetime

# Inicializar SQLAlchemy
db = SQLAlchemy()

# Tabla de asociación para relación muchos a muchos entre User y Organization
user_organizations = db.Table('user_organizations',
    db.Column('user_id', db.Integer, db.ForeignKey('user.id'), primary_key=True),
    db.Column('organization_id', db.String(50), db.ForeignKey('organization.id'), primary_key=True)
)

class User(UserMixin, db.Model):
    """Modelo de usuario para autenticación y gestión de permisos."""
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(80), unique=True, nullable=False)
    password_hash = db.Column(db.String(200), nullable=False)
    email = db.Column(db.String(120), unique=True, nullable=True)
    phone = db.Column(db.String(20), nullable=True)  # Para autenticación de dos factores
    is_admin = db.Column(db.Boolean, default=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    last_login = db.Column(db.DateTime)
    
    # Para OAuth2, guardamos el token en la base de datos
    oauth_token = db.Column(db.Text)  # El token completo como JSON
    oauth_token_expiry = db.Column(db.DateTime)  # Fecha de caducidad del token
    
    # Relación muchos a muchos con Organization
    organizations = db.relationship('Organization', secondary=user_organizations, 
                               lazy='subquery', backref=db.backref('users', lazy=True))
    
    def set_password(self, password):
        """Establece la contraseña del usuario, almacenando el hash."""
        self.password_hash = generate_password_hash(password)
    
    def check_password(self, password):
        """Verifica si la contraseña proporcionada coincide con el hash almacenado."""
        return check_password_hash(self.password_hash, password)
    
    def __repr__(self):
        return f'<User {self.username}>'

class Organization(db.Model):
    """Modelo que representa una organización de John Deere."""
    id = db.Column(db.String(50), primary_key=True)  # ID de la organización en John Deere
    name = db.Column(db.String(200), nullable=False)
    type = db.Column(db.String(50))  # Tipo de organización según John Deere
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    last_updated = db.Column(db.DateTime, onupdate=datetime.utcnow)
    
    def __repr__(self):
        return f'<Organization {self.name} ({self.id})>'

class Machine(db.Model):
    """Modelo para almacenar información básica de máquinas."""
    id = db.Column(db.String(50), primary_key=True)  # ID de la máquina en John Deere
    name = db.Column(db.String(200))
    organization_id = db.Column(db.String(50), db.ForeignKey('organization.id'), nullable=False)
    model = db.Column(db.String(100))
    category = db.Column(db.String(50))
    last_updated = db.Column(db.DateTime, onupdate=datetime.utcnow)
    
    # Relación con Organization
    organization = db.relationship('Organization', backref=db.backref('machines', lazy=True))
    
    def __repr__(self):
        return f'<Machine {self.name} ({self.id})>'

class LoginLog(db.Model):
    """Modelo para registrar intentos de inicio de sesión."""
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=True)  # Nullable para permitir registrar intentos fallidos
    username = db.Column(db.String(80))  # El nombre de usuario que intentó iniciar sesión
    success = db.Column(db.Boolean, default=False)  # Si el inicio de sesión fue exitoso
    timestamp = db.Column(db.DateTime, default=datetime.utcnow)
    ip_address = db.Column(db.String(45))  # IPv4 o IPv6
    user_agent = db.Column(db.String(500))  # Información del navegador
    
    # Relación con User
    user = db.relationship('User', backref=db.backref('login_logs', lazy=True))
    
    def __repr__(self):
        return f'<LoginLog {"Success" if self.success else "Failed"} - {self.username} - {self.timestamp}>'