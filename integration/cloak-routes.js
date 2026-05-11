/**
 * Cloak Express Router — /api/cloak/* routes for shielded USDC payouts.
 *
 * Factory export: returns an Express Router.
 * Both injection styles work:
 *
 *   app.use('/api/cloak', require('./cloak-routes')())                     // self-bootstrap from env
 *   app.use('/api/cloak', require('./cloak-routes')(connection, signer))   // injected deps
 *
 * Routes:
 *   GET  /balance       — operator's shielded pool balance (from history)
 *   POST /send          — execute a private transfer or shield+transfer
 *   GET  /history       — list past private payouts
 *   POST /viewing-key   — issue a viewing key (localhost only)
 */
'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const HISTORY_FILE = path.join(__dirname, 'data', 'cloak-history.json');

// ───────────────────────────────────────────────────────────
//  History file helpers (append-only JSON array)
// ───────────────────────────────────────────────────────────

function readHistory() {
  try {
    const raw = fs.readFileSync(HISTORY_FILE, 'utf8');
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function appendHistory(entry) {
  const history = readHistory();
  history.push(entry);
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2));
  return entry;
}

function updateHistoryEntry(id, updates) {
  const history = readHistory();
  const idx = history.findIndex(e => e.id === id);
  if (idx !== -1) {
    Object.assign(history[idx], updates);
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2));
  }
  return idx !== -1 ? history[idx] : null;
}

// ───────────────────────────────────────────────────────────
//  Localhost guard for sensitive routes
// ───────────────────────────────────────────────────────────

function isLocalhost(req) {
  const ip = req.ip || req.connection?.remoteAddress || '';
  const forwarded = req.headers['x-forwarded-for'] || '';
  const localIps = ['127.0.0.1', '::1', '::ffff:127.0.0.1'];
  if (localIps.includes(ip)) return true;
  const firstForwarded = forwarded.split(',')[0].trim();
  if (localIps.includes(firstForwarded)) return true;
  return false;
}

// ───────────────────────────────────────────────────────────
//  Factory
// ───────────────────────────────────────────────────────────

module.exports = function createCloakRouter(connection, signer) {
  const router = express.Router();

  let cloak = null;
  let _connection = connection || null;
  let _signer = signer || null;

  function ensureCloak() {
    if (!cloak) {
      cloak = require('./integrations/cloak.js');
    }
  }

  function ensureDeps() {
    if (!_connection || !_signer) {
      const { Connection, Keypair } = require('@solana/web3.js');
      if (!_connection) {
        const rpcUrl = process.env.SOLANA_RPC_URL || process.env.SOLANA_RPC || 'https://api.mainnet-beta.solana.com';
        _connection = new Connection(rpcUrl, 'confirmed');
      }
      if (!_signer) {
        const kpPath = process.env.KEYPAIR_PATH;
        if (!kpPath) {
          throw new Error('cloak-routes: KEYPAIR_PATH env var required for self-bootstrap');
        }
        const raw = JSON.parse(fs.readFileSync(kpPath, 'utf8'));
        _signer = Keypair.fromSecretKey(Uint8Array.from(raw));
      }
    }
  }

  // GET /balance
  router.get('/balance', (req, res) => {
    try {
      ensureCloak();
      const result = cloak.getPoolBalance();
      res.json({
        ok: true,
        balance_usdc: result.balanceUsdc,
        last_updated: result.lastUpdated,
      });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // POST /send
  router.post('/send', async (req, res) => {
    const { action, amount_usdc, recipient, input_utxo, owner_priv, owner_pub, confirm } = req.body || {};

    if (confirm !== 'yes') {
      return res.status(400).json({
        ok: false,
        error: 'Missing confirmation. Include { confirm: "yes" } in request body.',
      });
    }

    if (!action) {
      return res.status(400).json({ ok: false, error: 'Missing "action" field. Use "shield", "private_transfer", or "withdraw".' });
    }

    if (!amount_usdc || typeof amount_usdc !== 'number' || amount_usdc <= 0) {
      return res.status(400).json({ ok: false, error: 'Invalid "amount_usdc". Must be a positive number.' });
    }

    const historyId = crypto.randomUUID();
    const historyEntry = {
      id: historyId,
      type: action,
      amount_usdc,
      recipient: recipient || null,
      tx_signature: null,
      timestamp: new Date().toISOString(),
      status: 'pending',
    };
    appendHistory(historyEntry);

    try {
      ensureCloak();
      ensureDeps();
      let result;

      switch (action) {
        case 'shield': {
          result = await cloak.shield(amount_usdc, _signer, {});
          updateHistoryEntry(historyId, {
            status: 'confirmed',
            tx_signature: result.signature,
            _output_utxo_hex: result.outputUtxoHex,
            _owner_priv: result.ownerPrivateKey,
            _owner_pub: result.ownerPublicKey,
          });
          break;
        }

        case 'private_transfer': {
          if (!input_utxo || !owner_priv || !owner_pub) {
            updateHistoryEntry(historyId, { status: 'failed', error: 'Missing UTXO data for transfer' });
            return res.status(400).json({
              ok: false,
              error: 'private_transfer requires input_utxo, owner_priv, and owner_pub fields.',
            });
          }
          if (!recipient) {
            updateHistoryEntry(historyId, { status: 'failed', error: 'Missing recipient pubkey for private_transfer' });
            return res.status(400).json({
              ok: false,
              error: 'private_transfer requires recipient (recipient UTXO public key as bigint string).',
            });
          }
          result = await cloak.privateTransfer(
            input_utxo, owner_priv, owner_pub,
            recipient, amount_usdc, _signer,
          );
          updateHistoryEntry(historyId, {
            status: 'confirmed',
            tx_signature: result.signature,
            change_usdc: result.changeUsdc,
            _change_utxo_hex: result.changeUtxoHex,
            _change_owner_priv: result.changeOwnerPriv,
            _change_owner_pub: result.changeOwnerPub,
            _recipient_utxo_hex: result.recipientUtxoHex,
            _recipient_owner_pub: result.recipientOwnerPub,
          });
          break;
        }

        case 'withdraw': {
          if (!input_utxo || !owner_priv || !owner_pub || !recipient) {
            updateHistoryEntry(historyId, { status: 'failed', error: 'Missing UTXO or recipient data for withdraw' });
            return res.status(400).json({
              ok: false,
              error: 'withdraw requires input_utxo, owner_priv, owner_pub, and recipient fields.',
            });
          }
          result = await cloak.withdrawToPublic(
            input_utxo, owner_priv, owner_pub,
            recipient, _signer,
          );
          updateHistoryEntry(historyId, {
            status: 'confirmed',
            tx_signature: result.signature,
          });
          break;
        }

        default:
          updateHistoryEntry(historyId, { status: 'failed', error: 'Unknown action: ' + action });
          return res.status(400).json({ ok: false, error: 'Unknown action "' + action + '". Use "shield", "private_transfer", or "withdraw".' });
      }

      res.json({ ok: true, id: historyId, result });
    } catch (err) {
      updateHistoryEntry(historyId, { status: 'failed', error: err.message });
      res.status(500).json({ ok: false, id: historyId, error: err.message });
    }
  });

  // GET /history
  router.get('/history', (req, res) => {
    try {
      let history = readHistory();
      const typeFilter = req.query.type;
      if (typeFilter) {
        history = history.filter(e => e.type === typeFilter);
      }
      const limit = parseInt(req.query.limit, 10) || 50;
      history = history.slice(-limit).reverse();
      const sanitized = history.map(e => ({
        id: e.id,
        type: e.type,
        amount_usdc: e.amount_usdc,
        change_usdc: e.change_usdc,
        recipient: e.recipient,
        tx_signature: e.tx_signature,
        timestamp: e.timestamp,
        status: e.status,
        error: e.error || undefined,
      }));
      res.json({ ok: true, count: sanitized.length, history: sanitized });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // POST /viewing-key (localhost only)
  router.post('/viewing-key', (req, res) => {
    if (!isLocalhost(req)) {
      return res.status(403).json({
        ok: false,
        error: 'Viewing key issuance is restricted to localhost.',
      });
    }
    try {
      ensureCloak();
      const scope = (req.body && req.body.scope) || 'full';
      const vk = cloak.issueViewingKey(scope);
      appendHistory({
        id: crypto.randomUUID(),
        type: 'viewing_key_issued',
        amount_usdc: 0,
        recipient: null,
        tx_signature: null,
        timestamp: new Date().toISOString(),
        status: 'confirmed',
        _scope: scope,
      });
      res.json({ ok: true, viewing_key: vk });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  return router;
};
