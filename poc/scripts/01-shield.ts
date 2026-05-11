import "dotenv/config";
import { readFileSync, writeFileSync } from "fs";
import { createInterface } from "readline";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { getAccount, getAssociatedTokenAddress } from "@solana/spl-token";
import {
  CLOAK_PROGRAM_ID,
  createUtxo,
  createZeroUtxo,
  generateUtxoKeypair,
  transact,
  serializeUtxo,
} from "@cloak.dev/sdk";

const C = { g: "\x1b[32m", r: "\x1b[31m", y: "\x1b[33m", c: "\x1b[36m", b: "\x1b[1m", n: "\x1b[0m" };
const ok = (m: string) => console.log(`${C.g}  OK${C.n} ${m}`);
const fail = (m: string) => { console.log(`${C.r}  FAIL${C.n} ${m}`); process.exit(1); };
const info = (m: string) => console.log(`${C.y}  ->${C.n} ${m}`);
const step = (m: string) => console.log(`\n${C.b}${C.c}=== ${m} ===${C.n}\n`);

const SHIELD_AMOUNT_USDC = 0.5;
const SHIELD_ATOMICS = BigInt(Math.round(SHIELD_AMOUNT_USDC * 1_000_000));
const STATE_FILE = "./.cloak-poc-state.json";

const RPC = process.env.SOLANA_RPC_URL!;
const KP = process.env.KEYPAIR_PATH!;
const RELAY = process.env.CLOAK_RELAY_URL!;
const USDC = new PublicKey(process.env.USDC_MINT!);

async function confirm(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question(`\n${C.y}${question} (yes/no): ${C.n}`, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === "yes");
    });
  });
}

async function main() {
  step("PRE-FLIGHT");
  info(`Network        : MAINNET (real funds)`);
  info(`Cloak program  : ${CLOAK_PROGRAM_ID.toBase58()}`);
  info(`Relay          : ${RELAY}`);
  info(`USDC mint      : ${USDC.toBase58()}`);
  info(`Shield amount  : ${SHIELD_AMOUNT_USDC} USDC (${SHIELD_ATOMICS} atomics)`);

  const conn = new Connection(RPC, "confirmed");
  const signer = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(readFileSync(KP, "utf8")))
  );
  info(`Signer         : ${signer.publicKey.toBase58()}`);

  const solBefore = await conn.getBalance(signer.publicKey);
  info(`SOL balance    : ${(solBefore / 1e9).toFixed(6)} SOL`);

  const usdcAta = await getAssociatedTokenAddress(USDC, signer.publicKey);
  const usdcAccBefore = await getAccount(conn, usdcAta);
  const usdcBefore = Number(usdcAccBefore.amount) / 1e6;
  info(`USDC balance   : ${usdcBefore} USDC`);

  if (usdcBefore < SHIELD_AMOUNT_USDC) fail(`Not enough USDC (need ${SHIELD_AMOUNT_USDC})`);
  if (solBefore < 5_000_000) fail("Need at least 0.005 SOL for fees");

  const proceed = await confirm(
    `Shield ${SHIELD_AMOUNT_USDC} USDC into Cloak shielded pool on MAINNET?`
  );
  if (!proceed) {
    console.log(`${C.r}Aborted by user.${C.n}`);
    process.exit(0);
  }

  step("BUILDING UTXOS");
  const outputOwner = await generateUtxoKeypair();
  info(`Output UTXO owner pk (private): ${outputOwner.privateKey.toString(16).slice(0, 16)}...`);
  info(`Output UTXO owner pk (public) : ${outputOwner.publicKey.toString(16).slice(0, 16)}...`);

  const inputZero = await createZeroUtxo(USDC);
  const outputUtxo = await createUtxo(SHIELD_ATOMICS, outputOwner, USDC);
  ok("Zero input + USDC output UTXOs built");

  step("SUBMITTING SHIELD TX TO MAINNET");
  console.log(`${C.y}This may take 20-60 seconds (ZK proof generation + relay submission)...${C.n}\n`);

  const result = await transact(
    {
      inputUtxos: [inputZero],
      outputUtxos: [outputUtxo],
      externalAmount: SHIELD_ATOMICS,
      depositor: signer.publicKey,
    },
    {
      connection: conn,
      programId: CLOAK_PROGRAM_ID,
      relayUrl: RELAY,
      depositorKeypair: signer,
      walletPublicKey: signer.publicKey,
      onProgress: (msg) => console.log(`  ${C.c}[progress]${C.n} ${msg}`),
      onProofProgress: (pct) => process.stdout.write(`\r  ${C.c}[proof]${C.n} ${pct}%   `),
    }
  );
  console.log();

  ok(`Shield TX confirmed: ${result.signature}`);
  info(`Explorer: https://explorer.solana.com/tx/${result.signature}`);
  info(`Output commitment: ${result.outputCommitments[0].toString(16).slice(0, 16)}...`);
  info(`New Merkle root  : ${result.newRoot.slice(0, 16)}...`);

  step("POST-FLIGHT BALANCES");
  const solAfter = await conn.getBalance(signer.publicKey);
  info(`SOL: ${(solBefore / 1e9).toFixed(6)} -> ${(solAfter / 1e9).toFixed(6)} (cost: ${((solBefore - solAfter) / 1e9).toFixed(6)} SOL)`);

  const usdcAccAfter = await getAccount(conn, usdcAta);
  const usdcAfter = Number(usdcAccAfter.amount) / 1e6;
  info(`USDC: ${usdcBefore} -> ${usdcAfter} (shielded: ${usdcBefore - usdcAfter} USDC)`);

  step("SAVING STATE FOR NEXT SCRIPTS");
  const state = {
    timestamp: new Date().toISOString(),
    network: "mainnet-beta",
    signer: signer.publicKey.toBase58(),
    shielded_utxo: serializeUtxo(result.outputUtxos[0]),
    output_owner: {
      privateKey: outputOwner.privateKey.toString(),
      publicKey: outputOwner.publicKey.toString(),
    },
    shield_tx: result.signature,
    new_root: result.newRoot,
    amount_usdc: SHIELD_AMOUNT_USDC,
    amount_atomics: SHIELD_ATOMICS.toString(),
  };
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  ok(`State persisted to ${STATE_FILE}`);

  console.log(`\n${C.g}${C.b}=== SHIELD COMPLETE — ${SHIELD_AMOUNT_USDC} USDC NOW IN CLOAK POOL ===${C.n}`);
  console.log(`${C.y}Next: tsx scripts/02-transfer.ts (private shield-to-shield)${C.n}`);
  console.log(`${C.y}  or: tsx scripts/03-withdraw.ts (full withdraw to public address)${C.n}\n`);
}

main().catch(e => {
  console.error(`\n${C.r}ERROR:${C.n}`, e.message || e);
  if (e.category) console.error(`${C.r}Category:${C.n} ${e.category}`);
  if (e.cause) console.error(`${C.r}Cause:${C.n}`, e.cause);
  process.exit(1);
});
