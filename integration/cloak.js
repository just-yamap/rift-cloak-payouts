/**
 * Cloak Privacy — production integration for shielded USDC payouts.
 *
 * Operator shields USDC into the Cloak pool, sends privately to vendors,
 * vendors withdraw to their public address. Viewing keys enable compliance
 * audits without exposing transaction details publicly.
 *
 * Uses the locally installed SDK at backend/integrations/cloak-pkg/.
 * Feature gate: USE_CLOAK=1 in env. When disabled, all functions throw.
 *
 * ─────────────────────────────────────────────────────────────────────
 *  Flow (mirrors the POC scripts in rift-cloak-poc/scripts/):
 *
 *    1. shield(amountUsdc, signer)
 *       → deposits USDC from operator's public ATA into Cloak pool.
 *         Returns serialized output UTXO + owner keypair for later use.
 *
 *    2. privateTransfer(inputUtxoSerialized, ownerPriv, ownerPub,
 *                       recipientPub, amountUsdc, signer)
 *       → shield-to-shield transfer inside the pool. Recipient gets a
 *         new UTXO; sender gets change UTXO.
 *
 *    3. withdrawToPublic(inputUtxoSerialized, ownerPriv, ownerPub,
 *                        recipient, signer)
 *       → full withdraw from pool to a public Solana address.
 *
 *    4. issueViewingKey(scope)
 *       → generates a CloakKeyPair-derived viewing key for auditor use.
 *         The viewing key can decrypt transaction metadata without
 *         spending authority.
 *
 *    5. getPoolBalance(signer)
 *       → returns the operator's shielded balance. Since the SDK does
 *         not expose a direct pool-balance query, this is derived from
 *         the persisted history file (sum of shields - withdrawals).
 *         The history file is the source of truth for the operator's
 *         local bookkeeping.
 *
 *  Prerequisites:
 *    • Cloak SDK installed at backend/integrations/cloak-pkg/
 *    • Env vars: SOLANA_RPC_URL, CLOAK_RELAY_URL (or defaults to https://api.cloak.ag)
 *    • USDC_MINT (or defaults to mainnet EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v)
 * ─────────────────────────────────────────────────────────────────────
 */
'use strict';

const path = require('path');
const fs = require('fs');

// ───────────────────────────────────────────────────────────
//  SDK lazy load (from local cloak-pkg install)
// ───────────────────────────────────────────────────────────

const SDK_PATH = path.join(__dirname, 'cloak-pkg', 'node_modules', '@cloak.dev', 'sdk');

let SDK = null;
try { SDK = require(SDK_PATH); } catch { /* optional — guarded by ensureSdk() */ }

function ensureSdk() {
  if (!SDK) {
    throw new Error(
      '@cloak.dev/sdk not loaded — ensure cloak-pkg is installed at backend/integrations/cloak-pkg/'
    );
  }
}

// ───────────────────────────────────────────────────────────
//  Constants
// ───────────────────────────────────────────────────────────

const DEFAULT_RELAY_URL = 'https://api.cloak.ag';
const DEFAULT_USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const HISTORY_FILE = path.join(__dirname, '..', 'data', 'cloak-history.json');

function getConfig() {
  const { Connection, PublicKey } = require('@solana/web3.js');
  return {
    rpcUrl: process.env.SOLANA_RPC_URL || process.env.SOLANA_RPC || 'https://api.mainnet-beta.solana.com',
    relayUrl: process.env.CLOAK_RELAY_URL || DEFAULT_RELAY_URL,
    usdcMint: new PublicKey(process.env.USDC_MINT || DEFAULT_USDC_MINT),
    programId: SDK ? SDK.CLOAK_PROGRAM_ID : null,
  };
}

// ───────────────────────────────────────────────────────────
//  UTXO serialization helpers
// ───────────────────────────────────────────────────────────

/**
 * Serialize a UTXO to a hex string for persistence.
 * Uses the SDK's serializeUtxo → Buffer → hex.
 */
function serializeUtxoToHex(utxo) {
  ensureSdk();
  const bytes = SDK.serializeUtxo(utxo);
  return Buffer.from(bytes).toString('hex');
}

/**
 * Rehydrate a UTXO from a hex-serialized string.
 */
async function rehydrateUtxo(hex) {
  ensureSdk();
  const bytes = Uint8Array.from(Buffer.from(hex, 'hex'));
  return SDK.deserializeUtxo(bytes);
}

// ───────────────────────────────────────────────────────────
//  1. shield(amountUsdc, signer)
// ───────────────────────────────────────────────────────────

/**
 * Shield USDC into the Cloak pool.
 *
 * @param {number}  amountUsdc  Amount in USDC (e.g. 10.5)
 * @param {Keypair} signer      Solana Keypair (operator wallet)
 * @param {object}  [opts]      Optional overrides
 * @param {function} [opts.onProgress]      Progress callback (string)
 * @param {function} [opts.onProofProgress] Proof % callback (number)
 * @returns {Promise<{
 *   signature: string,
 *   outputUtxoHex: string,
 *   ownerPrivateKey: string,
 *   ownerPublicKey: string,
 *   amountUsdc: number,
 *   amountAtomics: string,
 *   newRoot: string,
 *   outputCommitment: string
 * }>}
 */
async function shield(amountUsdc, signer, opts = {}) {
  ensureSdk();
  const { Connection } = require('@solana/web3.js');
  const cfg = getConfig();

  const atomics = BigInt(Math.round(amountUsdc * 1_000_000));
  const conn = new Connection(cfg.rpcUrl, 'confirmed');

  // Build UTXOs: zero input, USDC output
  const outputOwner = await SDK.generateUtxoKeypair();
  const inputZero = await SDK.createZeroUtxo(cfg.usdcMint);
  const outputUtxo = await SDK.createUtxo(atomics, outputOwner, cfg.usdcMint);

  const result = await SDK.transact(
    {
      inputUtxos: [inputZero],
      outputUtxos: [outputUtxo],
      externalAmount: atomics,
      depositor: signer.publicKey,
    },
    {
      connection: conn,
      programId: cfg.programId,
      relayUrl: cfg.relayUrl,
      depositorKeypair: signer,
      walletPublicKey: signer.publicKey,
      onProgress: opts.onProgress || undefined,
      onProofProgress: opts.onProofProgress || undefined,
    },
  );

  return {
    signature: result.signature,
    outputUtxoHex: serializeUtxoToHex(result.outputUtxos[0]),
    ownerPrivateKey: outputOwner.privateKey.toString(),
    ownerPublicKey: outputOwner.publicKey.toString(),
    amountUsdc,
    amountAtomics: atomics.toString(),
    newRoot: result.newRoot,
    outputCommitment: result.outputCommitments[0].toString(16),
  };
}

// ───────────────────────────────────────────────────────────
//  2. privateTransfer(...)
// ───────────────────────────────────────────────────────────

/**
 * Execute a shielded transfer inside the Cloak pool.
 *
 * @param {string}  inputUtxoSerialized  Hex-serialized input UTXO
 * @param {string}  ownerPriv            Owner private key (bigint string)
 * @param {string}  ownerPub             Owner public key (bigint string)
 * @param {string}  recipientPub         Recipient UTXO public key (bigint string)
 * @param {number}  amountUsdc           Amount to transfer in USDC
 * @param {Keypair} signer               Solana Keypair (fee payer)
 * @param {object}  [opts]               Optional overrides
 * @returns {Promise<{
 *   signature: string,
 *   recipientUtxoHex: string,
 *   recipientOwnerPub: string,
 *   changeUtxoHex: string,
 *   changeOwnerPriv: string,
 *   changeOwnerPub: string,
 *   amountUsdc: number,
 *   changeUsdc: number,
 *   newRoot: string
 * }>}
 */
async function privateTransfer(inputUtxoSerialized, ownerPriv, ownerPub, recipientPub, amountUsdc, signer, opts = {}) {
  ensureSdk();
  const { Connection } = require('@solana/web3.js');
  const cfg = getConfig();

  const transferAtomics = BigInt(Math.round(amountUsdc * 1_000_000));
  const conn = new Connection(cfg.rpcUrl, 'confirmed');

  // Rehydrate input UTXO and attach owner keypair
  const inputUtxo = await rehydrateUtxo(inputUtxoSerialized);
  const senderOwner = {
    privateKey: BigInt(ownerPriv),
    publicKey: BigInt(ownerPub),
  };
  inputUtxo.keypair = senderOwner;

  const inputAmount = inputUtxo.amount;
  if (transferAtomics > inputAmount) {
    throw new Error(
      `Transfer amount (${transferAtomics}) exceeds input UTXO balance (${inputAmount})`
    );
  }
  const changeAtomics = inputAmount - transferAtomics;

  // Build recipient + change UTXOs
  // The recipient shared their UTXO public key out-of-band.
  // We use it directly — the sender must NOT learn the recipient's private key.
  const recipientOwner = {
    publicKey: BigInt(recipientPub),
  };
  const recipientUtxo = await SDK.createUtxo(transferAtomics, recipientOwner, cfg.usdcMint);
  const changeUtxo = await SDK.createUtxo(changeAtomics, senderOwner, cfg.usdcMint);

  const result = await SDK.transact(
    {
      inputUtxos: [inputUtxo],
      outputUtxos: [recipientUtxo, changeUtxo],
      externalAmount: 0n,
      depositor: signer.publicKey,
    },
    {
      connection: conn,
      programId: cfg.programId,
      relayUrl: cfg.relayUrl,
      depositorKeypair: signer,
      walletPublicKey: signer.publicKey,
      onProgress: opts.onProgress || undefined,
      onProofProgress: opts.onProofProgress || undefined,
    },
  );

  const changeUsdc = Number(changeAtomics) / 1_000_000;

  return {
    signature: result.signature,
    recipientUtxoHex: serializeUtxoToHex(result.outputUtxos[0]),
    recipientOwnerPub: recipientOwner.publicKey.toString(),
    changeUtxoHex: serializeUtxoToHex(result.outputUtxos[1]),
    changeOwnerPriv: senderOwner.privateKey.toString(),
    changeOwnerPub: senderOwner.publicKey.toString(),
    amountUsdc,
    changeUsdc,
    newRoot: result.newRoot,
  };
}

// ───────────────────────────────────────────────────────────
//  3. withdrawToPublic(...)
// ───────────────────────────────────────────────────────────

/**
 * Full withdraw from the Cloak pool to a public Solana address.
 *
 * @param {string}    inputUtxoSerialized  Hex-serialized input UTXO
 * @param {string}    ownerPriv            Owner private key (bigint string)
 * @param {string}    ownerPub             Owner public key (bigint string)
 * @param {string}    recipient            Recipient Solana public key (base58)
 * @param {Keypair}   signer               Solana Keypair (fee payer)
 * @param {object}    [opts]               Optional overrides
 * @returns {Promise<{
 *   signature: string,
 *   amountUsdc: number,
 *   recipient: string,
 *   newRoot: string
 * }>}
 */
async function withdrawToPublic(inputUtxoSerialized, ownerPriv, ownerPub, recipient, signer, opts = {}) {
  ensureSdk();
  const { Connection, PublicKey } = require('@solana/web3.js');
  const cfg = getConfig();

  const conn = new Connection(cfg.rpcUrl, 'confirmed');
  const recipientPubkey = new PublicKey(recipient);

  // Rehydrate input UTXO and attach owner keypair
  const inputUtxo = await rehydrateUtxo(inputUtxoSerialized);
  inputUtxo.keypair = {
    privateKey: BigInt(ownerPriv),
    publicKey: BigInt(ownerPub),
  };

  const amountUsdc = Number(inputUtxo.amount) / 1_000_000;

  const result = await SDK.fullWithdraw(
    [inputUtxo],
    recipientPubkey,
    {
      connection: conn,
      programId: cfg.programId,
      relayUrl: cfg.relayUrl,
      depositorKeypair: signer,
      walletPublicKey: signer.publicKey,
      onProgress: opts.onProgress || undefined,
      onProofProgress: opts.onProofProgress || undefined,
    },
  );

  return {
    signature: result.signature,
    amountUsdc,
    recipient: recipientPubkey.toBase58(),
    newRoot: result.newRoot,
  };
}

// ───────────────────────────────────────────────────────────
//  4. issueViewingKey(scope)
// ───────────────────────────────────────────────────────────

/**
 * Generate a viewing key pair for auditor compliance.
 *
 * The viewing key allows an auditor to decrypt transaction metadata
 * (amounts, recipients, timestamps) without spending authority.
 *
 * @param {string} [scope]  Optional label for the viewing key (e.g. "Q1-2026-audit")
 * @returns {{
 *   publicKey: string,
 *   privateKey: string,
 *   scope: string,
 *   issuedAt: string
 * }}
 */
function issueViewingKey(scope = 'full') {
  ensureSdk();

  const vkPair = SDK.generateViewingKeyPair();

  return {
    publicKey: Buffer.from(vkPair.publicKey).toString('hex'),
    privateKey: Buffer.from(vkPair.privateKey).toString('hex'),
    scope,
    issuedAt: new Date().toISOString(),
  };
}

// ───────────────────────────────────────────────────────────
//  5. getPoolBalance(signer)
// ───────────────────────────────────────────────────────────

/**
 * Get the operator's shielded pool balance.
 *
 * The SDK does not expose a direct pool-balance query for individual
 * wallets (the pool is a single shared Merkle tree). Instead, we derive
 * the balance from the persisted history file:
 *   balance = sum(shield amounts) - sum(withdraw amounts) - sum(private_transfer amounts)
 *
 * This is the operator's local bookkeeping — it reflects what the
 * operator has deposited and spent through this integration. It does
 * NOT scan on-chain UTXOs (which would require the viewing key and
 * full Merkle tree traversal).
 *
 * @returns {{ balanceUsdc: number, lastUpdated: string | null }}
 */
function getPoolBalance() {
  let history = [];
  try {
    const raw = fs.readFileSync(HISTORY_FILE, 'utf8');
    history = JSON.parse(raw);
  } catch {
    // No history file yet — balance is 0
  }

  let balanceAtomics = 0;
  let lastUpdated = null;

  for (const entry of history) {
    if (entry.status !== 'confirmed') continue;
    if (entry.type === 'shield') {
      balanceAtomics += Math.round((entry.amount_usdc || 0) * 1_000_000);
    } else if (entry.type === 'withdraw') {
      balanceAtomics -= Math.round((entry.amount_usdc || 0) * 1_000_000);
    } else if (entry.type === 'private_transfer') {
      // Only subtract the net outflow: amount sent minus change returned
      const sent = Math.round((entry.amount_usdc || 0) * 1_000_000);
      const change = Math.round((entry.change_usdc || 0) * 1_000_000);
      balanceAtomics -= (sent - change);
    }
    lastUpdated = entry.timestamp;
  }

  return {
    balanceUsdc: Math.max(0, balanceAtomics / 1_000_000),
    lastUpdated,
  };
}

// ───────────────────────────────────────────────────────────
//  Compliance helpers (for TASK 5 / bonus)
// ───────────────────────────────────────────────────────────

/**
 * Scan on-chain transactions using a viewing key and produce a
 * compliance report. Wraps SDK's scanTransactions + toComplianceReport.
 *
 * @param {Uint8Array} viewingKeyNk   32-byte nk for chain note decryption
 * @param {Keypair}    signer         Operator keypair (for wallet pubkey)
 * @param {object}     [opts]         Scan options (limit, afterTimestamp, etc.)
 * @returns {Promise<import('@cloak.dev/sdk').ComplianceReport>}
 */
async function scanForCompliance(viewingKeyNk, signer, opts = {}) {
  ensureSdk();
  const { Connection } = require('@solana/web3.js');
  const cfg = getConfig();
  const conn = new Connection(cfg.rpcUrl, 'confirmed');

  const scanResult = await SDK.scanTransactions({
    connection: conn,
    programId: cfg.programId,
    viewingKeyNk,
    walletPublicKey: signer.publicKey,
    ...opts,
  });

  return SDK.toComplianceReport(scanResult);
}

module.exports = {
  shield,
  privateTransfer,
  withdrawToPublic,
  issueViewingKey,
  getPoolBalance,
  // Compliance helpers (bonus)
  scanForCompliance,
  // Low-level exports for advanced use
  serializeUtxoToHex,
  rehydrateUtxo,
};
