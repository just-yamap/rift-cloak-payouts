/**
 * 05-admin-demo.ts — Viewing key + compliance scan demo.
 *
 * Derives the operator's viewing key from the UTXO private key used in
 * the shield step, scans on-chain transactions, and produces a
 * compliance report. Read-only — no funds are spent.
 *
 * Usage:
 *   npx tsx scripts/05-admin-demo.ts
 */

import { Connection } from "@solana/web3.js";
import {
  CLOAK_PROGRAM_ID,
  generateViewingKeyPair,
  getNkFromUtxoPrivateKey,
  scanTransactions,
  toComplianceReport,
  formatComplianceCsv,
} from "@cloak.dev/sdk";
import { env } from "./lib/env.js";
import { log } from "./lib/logger.js";
import { loadState } from "./lib/state.js";

async function main() {
  log.step("RIFT × CLOAK — VIEWING KEY & COMPLIANCE DEMO");

  const state = loadState();
  const conn = new Connection(env.rpcUrl, "confirmed");

  // ── 1. Generate a fresh viewing key pair ────────────────────
  log.step("1/4  Generate viewing key pair");
  const vk = generateViewingKeyPair();
  log.ok("Viewing key pair generated");
  log.info(`Public  : ${Buffer.from(vk.publicKey).toString("hex").slice(0, 32)}...`);
  log.info(`Private : ${Buffer.from(vk.privateKey).toString("hex").slice(0, 16)}... (secret)`);
  log.dim("The public key is shared with auditors. The private key stays with the operator.");

  // ── 2. Derive nk from the operator's UTXO private key ──────
  log.step("2/4  Derive nk from operator UTXO keypair");
  const utxoPrivKey = BigInt(state.shield.owner_private_key);
  const nk = getNkFromUtxoPrivateKey(utxoPrivKey);
  log.ok(`nk derived: ${Buffer.from(nk).toString("hex").slice(0, 32)}...`);
  log.dim("nk is the incoming viewing base (Zcash-style). Used to trial-decrypt chain notes.");

  // ── 3. Scan on-chain transactions ──────────────────────────
  log.step("3/4  Scan on-chain Cloak transactions");
  log.info(`Program  : ${CLOAK_PROGRAM_ID.toBase58()}`);
  log.info(`Wallet   : ${state.signer}`);
  log.info("Scanning (this may take 10-30s depending on RPC load)...");

  const scanResult = await scanTransactions({
    connection: conn,
    programId: CLOAK_PROGRAM_ID,
    viewingKeyNk: nk,
    walletPublicKey: state.signer,
    limit: 50,
    onProgress: (processed, total) => {
      process.stdout.write(`\r  [scan] ${processed}/${total} transactions processed   `);
    },
    onStatus: (status) => {
      log.progress("status", status);
    },
  });
  console.log();

  log.ok(`Scan complete: ${scanResult.transactions.length} transactions found`);
  log.info(`RPC calls made: ${scanResult.rpcCallsMade}`);

  // ── 4. Produce compliance report ───────────────────────────
  log.step("4/4  Compliance report");

  const report = toComplianceReport(scanResult);

  log.info(`Transactions : ${report.summary.transactionCount}`);
  log.info(`Total in     : ${(report.summary.totalDeposits / 1_000_000).toFixed(6)} USDC`);
  log.info(`Total out    : ${(report.summary.totalWithdrawals / 1_000_000).toFixed(6)} USDC`);
  log.info(`Total fees   : ${(report.summary.totalFees / 1_000_000).toFixed(6)} USDC`);
  log.info(`Net change   : ${(report.summary.netChange / 1_000_000).toFixed(6)} USDC`);
  log.info(`Final balance: ${(report.summary.finalBalance / 1_000_000).toFixed(6)} USDC`);

  if (report.transactions.length > 0) {
    console.log();
    log.dim("─── Transaction Details ───────────────────────────────────────────");
    for (const tx of report.transactions) {
      const sig = tx.signature ? tx.signature.slice(0, 16) + "..." : "n/a";
      const date = new Date(tx.timestamp).toISOString().slice(0, 19);
      const amount = (tx.amount / 1_000_000).toFixed(6);
      const fee = (tx.fee / 1_000_000).toFixed(6);
      const bal = (tx.runningBalance / 1_000_000).toFixed(6);
      log.dim(`  ${date}  ${tx.txType.padEnd(10)}  ${amount.padStart(12)} USDC  fee ${fee}  bal ${bal}  ${sig}`);
    }
    log.dim("───────────────────────────────────────────────────────────────────");
  }

  // CSV export
  const csv = formatComplianceCsv(report);
  const csvPath = "./.cloak-compliance-report.csv";
  const { writeFileSync } = await import("fs");
  writeFileSync(csvPath, csv);
  log.ok(`CSV report saved to ${csvPath}`);

  // ── Summary ────────────────────────────────────────────────
  log.banner("COMPLIANCE DEMO COMPLETE");
  log.hint("Key takeaways:");
  log.hint("  1. Viewing key lets auditors see amounts + recipients WITHOUT spend authority");
  log.hint("  2. scanTransactions() trial-decrypts chain notes using the operator's nk");
  log.hint("  3. toComplianceReport() produces a structured, JSON-serializable report");
  log.hint("  4. formatComplianceCsv() exports to CSV for spreadsheet analysis");
  console.log();
  log.hint("Verified on-chain TXs:");
  console.log(`  Shield   : https://explorer.solana.com/tx/${state.shield.tx}`);
  if (state.transfer) console.log(`  Transfer : https://explorer.solana.com/tx/${state.transfer.tx}`);
  if (state.withdraw) console.log(`  Withdraw : https://explorer.solana.com/tx/${state.withdraw.tx}`);
  console.log();
}

main().catch((e) => {
  log.error(e.message || String(e), e);
  process.exit(1);
});
