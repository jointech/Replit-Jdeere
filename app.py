import os
import logging
from flask import Flask, redirect, url_for, session, request, render_template, flash, jsonify
from werkzeug.middleware.proxy_fix import ProxyFix
import json

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
    if JOHN_DEERE_CLIENT_ID and JOHN_DEERE_CLIENT_SECRET:
        try:
            oauth_session = get_oauth_session()
            authorization_url, state = oauth_session.authorization_url(
                JOHN_DEERE_AUTHORIZE_URL,
                scope=' '.join(JOHN_DEERE_SCOPES)
            )
            session['oauth_state'] = state
            return redirect(authorization_url)
        except Exception as e:
            logger.error(f"Login error: {str(e)}")
            return render_template('error.html', error=str(e))
    else:
        return render_template('error.html', error="Missing API credentials. Please check environment variables.")

@app.route('/callback')
def callback():
    """Handles the OAuth2 callback from John Deere."""
    if 'oauth_state' not in session:
        return redirect(url_for('index'))
    
    if 'error' in request.args:
        error = request.args['error']
        return render_template('error.html', error=f"OAuth error: {error}")
    
    try:
        oauth_session = get_oauth_session(state=session['oauth_state'])
        token = oauth_session.fetch_token(
            f'{JOHN_DEERE_AUTHORIZE_URL}/oauth/token',
            client_secret=JOHN_DEERE_CLIENT_SECRET,
            authorization_response=request.url
        )
        session['oauth_token'] = token
        return redirect(url_for('dashboard'))
    except Exception as e:
        logger.error(f"Callback error: {str(e)}")
        return render_template('error.html', error=str(e))

@app.route('/dashboard')
def dashboard():
    """Main dashboard view for authenticated users."""
    if 'oauth_token' not in session:
        return redirect(url_for('index'))
    
    try:
        # Fetch organizations
        organizations = fetch_organizations(session['oauth_token'])
        return render_template('dashboard.html', organizations=organizations)
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
        machines = fetch_machines_by_organization(session['oauth_token'], organization_id)
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
        machine_details = fetch_machine_details(session['oauth_token'], machine_id)
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
        alerts = fetch_machine_alerts(session['oauth_token'], machine_id)
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
