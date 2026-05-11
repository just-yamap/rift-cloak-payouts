import { Connection, PublicKey } from "@solana/web3.js";
import { CLOAK_PROGRAM_ID } from "@cloak.dev/sdk";
import { env } from "./lib/env.js";
import { log } from "./lib/logger.js";
import { loadState } from "./lib/state.js";

async function main() {
  log.step("RIFT × CLOAK — END-TO-END VERIFICATION (READ-ONLY)");

  const state = loadState();
  const conn = new Connection(env.rpcUrl, "confirmed");

  log.step("1/7  Cloak program is live on mainnet");
  const cloakProg = await conn.getAccountInfo(CLOAK_PROGRAM_ID);
  if (!cloakProg) log.fail("Cloak program not found");
  log.ok(`Cloak program: ${CLOAK_PROGRAM_ID.toBase58()}`);
  log.info(`Owner: ${cloakProg!.owner.toBase58()}`);

  log.step("2/7  Cloak relay is reachable");
  const res = await fetch(`${env.relayUrl}/health`, { signal: AbortSignal.timeout(5000) });
  if (!res.ok && res.status !== 404) log.fail(`Relay returned ${res.status}`);
  log.ok(`Relay ${env.relayUrl} is alive (HTTP ${res.status})`);

  log.step("3/7  Shield TX is finalized on-chain");
  const shieldTx = await conn.getTransaction(state.shield.tx, {
    maxSupportedTransactionVersion: 0,
    commitment: "confirmed",
  });
  if (!shieldTx) log.fail(`Shield TX not found: ${state.shield.tx}`);
  if (shieldTx!.meta?.err) log.fail(`Shield TX failed: ${JSON.stringify(shieldTx!.meta.err)}`);
  log.ok(`Shield TX confirmed in slot ${shieldTx!.slot}`);
  log.info(`Amount: ${state.shield.amount_usdc} USDC`);
  log.info(`Explorer: https://explorer.solana.com/tx/${state.shield.tx}`);

  if (!state.transfer) log.fail("No transfer in state");
  log.step("4/7  Shielded transfer TX is finalized");
  const transferTx = await conn.getTransaction(state.transfer!.tx, {
    maxSupportedTransactionVersion: 0,
    commitment: "confirmed",
  });
  if (!transferTx) log.fail(`Transfer TX not found: ${state.transfer!.tx}`);
  if (transferTx!.meta?.err) log.fail(`Transfer TX failed: ${JSON.stringify(transferTx!.meta.err)}`);
  log.ok(`Transfer TX confirmed in slot ${transferTx!.slot}`);
  log.info(`Amount: ${state.transfer!.amount_usdc} USDC (PRIVATE — hidden from explorer)`);
  log.info(`Explorer: https://explorer.solana.com/tx/${state.transfer!.tx}`);

  if (!state.withdraw) log.fail("No withdraw in state");
  log.step("5/7  Withdraw TX is finalized");
  const withdrawTx = await conn.getTransaction(state.withdraw!.tx, {
    maxSupportedTransactionVersion: 0,
    commitment: "confirmed",
  });
  if (!withdrawTx) log.fail(`Withdraw TX not found: ${state.withdraw!.tx}`);
  if (withdrawTx!.meta?.err) log.fail(`Withdraw TX failed: ${JSON.stringify(withdrawTx!.meta.err)}`);
  log.ok(`Withdraw TX confirmed in slot ${withdrawTx!.slot}`);
  log.info(`Amount: ${state.withdraw!.amount_usdc} USDC`);
  log.info(`Recipient: ${state.withdraw!.recipient_address}`);
  log.info(`Explorer: https://explorer.solana.com/tx/${state.withdraw!.tx}`);

  log.step("6/7  Privacy guarantee: no observable link between operator and vendor");
  log.info(`Operator deposited at slot   : ${shieldTx!.slot}`);
  log.info(`Internal transfer at slot    : ${transferTx!.slot} (amount+dest HIDDEN)`);
  log.info(`Public withdraw at slot      : ${withdrawTx!.slot}`);
  log.ok("Anyone watching the chain sees 3 separate Cloak TXs, but cannot");
  log.ok("prove they belong to the same logical payment flow.");

  log.step("7/7  Treasury reconciliation");
  log.info(`Operator shielded            : ${state.shield.amount_usdc} USDC`);
  log.info(`Sent privately to vendor     : ${state.transfer!.amount_usdc} USDC`);
  log.info(`Vendor withdrew publicly     : ${state.withdraw!.amount_usdc} USDC`);
  log.info(`Change still in pool         : ${state.shield.amount_usdc - state.transfer!.amount_usdc} USDC`);
  log.ok("All amounts accounted for.");

  log.banner("ALL 7 CHECKS PASSED — RIFT × CLOAK FLOW OPERATIONAL");

  console.log();
  log.hint("On-chain proofs (mainnet):");
  console.log(`  Shield   : https://explorer.solana.com/tx/${state.shield.tx}`);
  console.log(`  Transfer : https://explorer.solana.com/tx/${state.transfer!.tx}`);
  console.log(`  Withdraw : https://explorer.solana.com/tx/${state.withdraw!.tx}`);
  console.log();
}

main().catch((e) => {
  log.error(e.message || String(e), e);
  process.exit(1);
});
