import { readFileSync } from "fs";
import { Connection, Keypair } from "@solana/web3.js";
import {
  CLOAK_PROGRAM_ID,
  createUtxo,
  generateUtxoKeypair,

  transact,
  type UtxoKeypair,
} from "@cloak.dev/sdk";
import { env } from "./lib/env.js";
import { log } from "./lib/logger.js";
import { confirm } from "./lib/confirm.js";
import {
  backupState,
  loadState,
  rehydrateUtxo,
  saveState,
  serializeUtxoToHex,
} from "./lib/state.js";

const TRANSFER_AMOUNT_USDC = 0.3;
const TRANSFER_ATOMICS = BigInt(Math.round(TRANSFER_AMOUNT_USDC * 1_000_000));

async function main() {
  log.step("PRE-FLIGHT");
  const state = loadState();
  log.info(`Network          : ${state.network}`);
  log.info(`Cloak program    : ${CLOAK_PROGRAM_ID.toBase58()}`);
  log.info(`Relay            : ${env.relayUrl}`);
  log.info(`Operator signer  : ${state.signer}`);
  log.info(`Shielded balance : ${state.shield.amount_usdc} USDC (shield TX ${state.shield.tx.slice(0, 12)}...)`);
  log.info(`Transfer amount  : ${TRANSFER_AMOUNT_USDC} USDC (private, inside the pool)`);

  const conn = new Connection(env.rpcUrl, "confirmed");
  const signer = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(readFileSync(env.keypairPath, "utf8")))
  );
  if (signer.publicKey.toBase58() !== state.signer) {
    log.fail(`Signer mismatch: state expects ${state.signer}, got ${signer.publicKey.toBase58()}`);
  }

  const shieldedAmount = BigInt(state.shield.amount_atomics);
  if (TRANSFER_ATOMICS > shieldedAmount) {
    log.fail(`Transfer (${TRANSFER_ATOMICS}) > shielded balance (${shieldedAmount})`);
  }
  const changeAtomics = shieldedAmount - TRANSFER_ATOMICS;
  log.info(`Change to operator: ${Number(changeAtomics) / 1e6} USDC`);

  const proceed = await confirm(
    `Send ${TRANSFER_AMOUNT_USDC} USDC privately to a new vendor UTXO (mainnet)?`
  );
  if (!proceed) {
    log.hint("Aborted by user.");
    return;
  }

  log.step("BUILDING UTXOS");
  const inputUtxo = await rehydrateUtxo(state.shield.utxo_serialized);
  log.info(`Input UTXO  : ${state.shield.amount_usdc} USDC (operator-owned, commitment from shield TX)`);

  const senderOwner: UtxoKeypair = {
    privateKey: BigInt(state.shield.owner_private_key),
    publicKey: BigInt(state.shield.owner_public_key),
  };
  // ensure rehydrated UTXO uses the same keypair we have privately
  inputUtxo.keypair = senderOwner;

  const vendorOwner = await generateUtxoKeypair();
  log.info(`Vendor pk (private): ${vendorOwner.privateKey.toString(16).slice(0, 16)}...`);
  log.info(`Vendor pk (public) : ${vendorOwner.publicKey.toString(16).slice(0, 16)}...`);

  const vendorUtxo = await createUtxo(TRANSFER_ATOMICS, vendorOwner, env.usdcMint);
  const changeUtxo = await createUtxo(changeAtomics, senderOwner, env.usdcMint);
  log.ok("Vendor + change UTXOs built");

  log.step("SUBMITTING SHIELDED TRANSFER TX (MAINNET)");
  log.hint("ZK proof generation + relay submission (20-60s)...");

  const result = await transact(
    {
      inputUtxos: [inputUtxo],
      outputUtxos: [vendorUtxo, changeUtxo],
      externalAmount: 0n,
      depositor: signer.publicKey,
    },
    {
      connection: conn,
      programId: CLOAK_PROGRAM_ID,
      relayUrl: env.relayUrl,
      depositorKeypair: signer,
      walletPublicKey: signer.publicKey,
      onProgress: (m) => log.progress("progress", m),
      onProofProgress: (p) => process.stdout.write(`\r  [proof] ${p}%   `),
    }
  );
  console.log();

  log.ok(`Shielded transfer confirmed: ${result.signature}`);
  log.info(`Explorer: https://explorer.solana.com/tx/${result.signature}`);
  log.info(`New Merkle root: ${result.newRoot.slice(0, 16)}...`);
  log.info(`Output commitments: ${result.outputCommitments.length} (vendor + change)`);

  log.step("SAVING STATE");
  backupState("pre-transfer");
  const updated = {
    ...state,
    transfer: {
      tx: result.signature,
      amount_usdc: TRANSFER_AMOUNT_USDC,
      amount_atomics: TRANSFER_ATOMICS.toString(),
      recipient_private_key: vendorOwner.privateKey.toString(),
      recipient_public_key: vendorOwner.publicKey.toString(),
      sender_change_utxo: serializeUtxoToHex(result.outputUtxos[1]),
      recipient_utxo: serializeUtxoToHex(result.outputUtxos[0]),
      new_root: result.newRoot,
    },
  };
  saveState(updated);
  log.ok("State updated with transfer details");

  log.banner(`TRANSFER COMPLETE — ${TRANSFER_AMOUNT_USDC} USDC SENT PRIVATELY`);
  log.hint("Next: npx tsx scripts/03-withdraw.ts (vendor withdraws to public addr)");
}

main().catch((e) => {
  log.error(e.message || String(e), e);
  process.exit(1);
});
