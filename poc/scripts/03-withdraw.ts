import { readFileSync } from "fs";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { getAccount, getAssociatedTokenAddress } from "@solana/spl-token";
import {
  CLOAK_PROGRAM_ID,
  fullWithdraw,
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
} from "./lib/state.js";

async function main() {
  log.step("PRE-FLIGHT");
  const state = loadState();
  if (!state.transfer) {
    log.fail("No transfer in state. Run 02-transfer.ts first.");
    return;
  }

  log.info(`Network            : ${state.network}`);
  log.info(`Cloak program      : ${CLOAK_PROGRAM_ID.toBase58()}`);
  log.info(`Relay              : ${env.relayUrl}`);
  log.info(`Signer (fee payer) : ${state.signer}`);
  log.info(`Transfer TX        : ${state.transfer.tx.slice(0, 12)}...`);
  log.info(`Vendor UTXO amount : ${state.transfer.amount_usdc} USDC (shielded)`);

  const conn = new Connection(env.rpcUrl, "confirmed");
  const signer = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(readFileSync(env.keypairPath, "utf8")))
  );

  // Vendor withdraws back to the same wallet for simplicity (round-trip demo)
  const recipient = signer.publicKey;
  log.info(`Withdraw recipient : ${recipient.toBase58()} (public address)`);

  const recipientAta = await getAssociatedTokenAddress(env.usdcMint, recipient);
  let usdcBefore = 0;
  try {
    const acc = await getAccount(conn, recipientAta);
    usdcBefore = Number(acc.amount) / 1e6;
  } catch {
    log.info("Recipient USDC ATA does not exist yet (will be created during withdraw)");
  }
  log.info(`USDC balance before: ${usdcBefore} USDC`);

  const proceed = await confirm(
    `Withdraw ${state.transfer.amount_usdc} USDC from Cloak pool to ${recipient.toBase58().slice(0, 8)}... (mainnet)?`
  );
  if (!proceed) {
    log.hint("Aborted by user.");
    return;
  }

  log.step("REHYDRATING VENDOR UTXO");
  const vendorUtxo = await rehydrateUtxo(state.transfer.recipient_utxo);
  const vendorOwner: UtxoKeypair = {
    privateKey: BigInt(state.transfer.recipient_private_key),
    publicKey: BigInt(state.transfer.recipient_public_key),
  };
  vendorUtxo.keypair = vendorOwner;
  log.ok(`Vendor UTXO ready: ${state.transfer.amount_usdc} USDC, owned by ${vendorOwner.publicKey.toString(16).slice(0, 12)}...`);

  log.step("SUBMITTING FULL WITHDRAW TX (MAINNET)");
  log.hint("ZK proof generation + relay submission (20-60s)...");

  const result = await fullWithdraw(
    [vendorUtxo],
    recipient,
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

  log.ok(`Withdraw TX confirmed: ${result.signature}`);
  log.info(`Explorer: https://explorer.solana.com/tx/${result.signature}`);
  log.info(`New Merkle root: ${result.newRoot.slice(0, 16)}...`);

  log.step("POST-FLIGHT BALANCE");
  const accAfter = await getAccount(conn, recipientAta);
  const usdcAfter = Number(accAfter.amount) / 1e6;
  log.info(`USDC: ${usdcBefore} -> ${usdcAfter} (received: ${usdcAfter - usdcBefore} USDC)`);

  log.step("SAVING STATE");
  backupState("pre-withdraw");
  const updated = {
    ...state,
    withdraw: {
      tx: result.signature,
      amount_usdc: state.transfer.amount_usdc,
      recipient_address: recipient.toBase58(),
      new_root: result.newRoot,
    },
  };
  saveState(updated);
  log.ok("State updated with withdraw details");

  log.banner(`WITHDRAW COMPLETE — END-TO-END CLOAK FLOW DONE`);
  log.hint("Flow recap:");
  log.hint(`  1. Shield   : ${state.shield.tx.slice(0, 20)}...`);
  log.hint(`  2. Transfer : ${state.transfer.tx.slice(0, 20)}... (private!)`);
  log.hint(`  3. Withdraw : ${result.signature.slice(0, 20)}...`);
  log.hint("Next: npx tsx scripts/04-verify.ts");
}

main().catch((e) => {
  log.error(e.message || String(e), e);
  process.exit(1);
});
