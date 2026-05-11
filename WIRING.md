# Wiring Instructions - Live Integration into RIFT ATM

This document describes how to plug the additive Cloak integration files into
the live RIFT ATM backend. All files in `integration/` are designed to be
added without modifying any existing service code.

## Prerequisites

- `@cloak.dev/sdk` v0.1.6+ installed in `rift-solana/backend/integrations/cloak-pkg/`
- Operator Solana keypair available at the path defined by `KEYPAIR_PATH`
- Solana mainnet RPC + Cloak relay reachable
- USDC balance in operator's ATA

## Step 1 - Drop the files in place

```bash
cp integration/cloak.js          ~/rift-solana/backend/integrations/cloak.js
cp integration/cloak-routes.js   ~/rift-solana/backend/cloak-routes.js
cp integration/cloak_routes.py   ~/ATM_NV200/cloak_routes.py
cp integration/rift-admin-cloak.html ~/ATM_NV200/rift-admin-cloak.html
mkdir -p ~/rift-solana/backend/data
echo "[]" > ~/rift-solana/backend/data/cloak-history.json
```

## Step 2 - Wire into atm-connector.js (1 line)

In `~/rift-solana/backend/atm-connector.js`, after the other route mounts, add:

```js
app.use('/api/cloak', require('./cloak-routes')());
```

The factory call self-bootstraps from env vars (`SOLANA_RPC_URL`, `KEYPAIR_PATH`).
You can also inject an existing Connection/Keypair:

```js
app.use('/api/cloak', require('./cloak-routes')(myConnection, mySigner));
```

## Step 3 - Wire into server.py (2 lines)

In `~/ATM_NV200/server.py`, after the Flask `app` is created:

```python
from cloak_routes import bp as cloak_bp
app.register_blueprint(cloak_bp)
```

## Step 4 - Admin UI (optional)

Serve the standalone Cloak page via a Flask route:

```python
@app.route('/admin/cloak/ui')
def cloak_ui():
    return send_file('rift-admin-cloak.html')
```

Or add a sidebar link in `rift-admin-v2.html`.

## Step 5 - Environment variables
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
KEYPAIR_PATH=/path/to/operator-keypair.json
CLOAK_RELAY_URL=https://api.cloak.ag
USDC_MINT=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v
ATM_CONNECTOR_URL=http://localhost:8766

## Step 6 - Restart services

```bash
systemctl restart rift-atm-connector
systemctl restart rift-atm-admin
```

## Step 7 - Smoke test

```bash
# 1. Pool balance
curl http://localhost:5000/admin/cloak/balance

# 2. History
curl http://localhost:5000/admin/cloak/history

# 3. Send refused without confirm token
curl -X POST http://localhost:5000/admin/cloak/send \
  -H "Content-Type: application/json" \
  -d '{"action":"shield","amount_usdc":0.1}'
# Expected: 400 with "Missing confirmation" error
```

## Zero-Regression Guarantee

These integration files do not touch any existing route, function signature,
or data flow in RIFT. The Cloak system is fully isolated:

- New routes mount under `/api/cloak/*` and `/admin/cloak/*` - no conflicts
- New data file `backend/data/cloak-history.json` - separate state
- Admin UI is a standalone HTML page - no edits to `rift-admin-v2.html`

If the Cloak module fails to load, only `/api/cloak/*` routes return errors.
The rest of RIFT ATM continues to function normally.
