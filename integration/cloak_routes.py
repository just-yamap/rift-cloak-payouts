"""
Cloak Privacy — Flask blueprint proxying /admin/cloak/* to atm-connector.

Routes:
  GET  /admin/cloak/balance       → GET  http://localhost:8766/api/cloak/balance
  POST /admin/cloak/send          → POST http://localhost:8766/api/cloak/send
  GET  /admin/cloak/history       → GET  http://localhost:8766/api/cloak/history
  POST /admin/cloak/viewing-key   → POST http://localhost:8766/api/cloak/viewing-key

Integration (2 lines in server.py):
  from cloak_routes import bp as cloak_bp
  app.register_blueprint(cloak_bp)
"""

import os
import requests as req
from flask import Blueprint, request, jsonify

bp = Blueprint('cloak', __name__)

CONNECTOR_URL = os.environ.get('ATM_CONNECTOR_URL', 'http://localhost:8766')


def _connector_headers():
    """Auth headers for internal calls to atm-connector."""
    return {'X-Internal-Token': os.environ.get('RIFT_INTERNAL_TOKEN', '')}


# ── GET /admin/cloak/balance ──────────────────────────────────────

@bp.route('/admin/cloak/balance', methods=['GET'])
def cloak_balance():
    try:
        r = req.get(
            f'{CONNECTOR_URL}/api/cloak/balance',
            headers=_connector_headers(),
            timeout=10,
        )
        return jsonify(r.json()), r.status_code
    except Exception as e:
        return jsonify({'ok': False, 'error': f'Connector offline: {e}'}), 503


# ── POST /admin/cloak/send ────────────────────────────────────────

@bp.route('/admin/cloak/send', methods=['POST'])
def cloak_send():
    try:
        body = request.get_json(silent=True) or {}
        r = req.post(
            f'{CONNECTOR_URL}/api/cloak/send',
            json=body,
            headers=_connector_headers(),
            timeout=120,  # ZK proof generation can take 20-60s
        )
        return jsonify(r.json()), r.status_code
    except req.exceptions.Timeout:
        return jsonify({
            'ok': False,
            'error': 'Connector timeout — ZK proof generation may still be running.',
        }), 504
    except Exception as e:
        return jsonify({'ok': False, 'error': f'Connector offline: {e}'}), 503


# ── GET /admin/cloak/history ──────────────────────────────────────

@bp.route('/admin/cloak/history', methods=['GET'])
def cloak_history():
    try:
        params = {}
        if request.args.get('limit'):
            params['limit'] = request.args['limit']
        if request.args.get('type'):
            params['type'] = request.args['type']
        r = req.get(
            f'{CONNECTOR_URL}/api/cloak/history',
            params=params,
            headers=_connector_headers(),
            timeout=10,
        )
        return jsonify(r.json()), r.status_code
    except Exception as e:
        return jsonify({'ok': False, 'error': f'Connector offline: {e}'}), 503


# ── POST /admin/cloak/viewing-key ─────────────────────────────────

@bp.route('/admin/cloak/viewing-key', methods=['POST'])
def cloak_viewing_key():
    try:
        body = request.get_json(silent=True) or {}
        r = req.post(
            f'{CONNECTOR_URL}/api/cloak/viewing-key',
            json=body,
            headers=_connector_headers(),
            timeout=10,
        )
        return jsonify(r.json()), r.status_code
    except Exception as e:
        return jsonify({'ok': False, 'error': f'Connector offline: {e}'}), 503
