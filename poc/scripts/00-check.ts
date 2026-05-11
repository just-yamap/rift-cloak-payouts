import "dotenv/config";
import { readFileSync } from "fs";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { getAccount, getAssociatedTokenAddress } from "@solana/spl-token";
import { CLOAK_PROGRAM_ID, VERSION } from "@cloak.dev/sdk";

const C = { g: "\x1b[32m", r: "\x1b[31m", y: "\x1b[33m", c: "\x1b[36m", b: "\x1b[1m", n: "\x1b[0m" };
const ok = (m: string) => console.log(`${C.g}  OK${C.n} ${m}`);
const fail = (m: string) => { console.log(`${C.r}  FAIL${C.n} ${m}`); process.exit(1); };
const info = (m: string) => console.log(`${C.y}  ->${C.n} ${m}`);
const step = (m: string) => console.log(`\n${C.b}${C.c}=== ${m} ===${C.n}\n`);

const RPC = process.env.SOLANA_RPC_URL!;
const KP = process.env.KEYPAIR_PATH!;
const RELAY = process.env.CLOAK_RELAY_URL!;
const USDC = new PublicKey(process.env.USDC_MINT!);

async function main() {
  step("1/6  Cloak SDK loaded");
  info(`SDK version: ${VERSION}`);
  info(`Cloak program ID: ${CLOAK_PROGRAM_ID.toBase58()}`);
  ok("SDK imports work");

  step("2/6  Mainnet RPC reachable");
  const conn = new Connection(RPC, "confirmed");
  const slot = await conn.getSlot();
  ok(`RPC live, current slot: ${slot}`);

  step("3/6  Keypair loaded from disk");
  const signer = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(readFileSync(KP, "utf8")))
  );
  ok(`Signer: ${signer.publicKey.toBase58()}`);

  step("4/6  Balances on mainnet");
  const solBal = await conn.getBalance(signer.publicKey);
  info(`SOL: ${(solBal / 1e9).toFixed(6)} SOL`);
  if (solBal < 5_000_000) fail("Need at least 0.005 SOL for fees");
  ok("Enough SOL for TX fees");

  const usdcAta = await getAssociatedTokenAddress(USDC, signer.publicKey);
  const usdcAccount = await getAccount(conn, usdcAta);
  const usdcAmount = Number(usdcAccount.amount) / 1e6;
  info(`USDC: ${usdcAmount} USDC (ATA: ${usdcAta.toBase58()})`);
  if (usdcAmount < 0.5) fail("Need at least 0.5 USDC for shield test");
  ok("Enough USDC for shield test");

  step("5/6  Cloak program is deployed on mainnet");
  const cloakProg = await conn.getAccountInfo(CLOAK_PROGRAM_ID);
  if (!cloakProg) fail("Cloak program not found on mainnet");
  ok(`Cloak program is live, owned by ${cloakProg!.owner.toBase58()}`);

  step("6/6  Cloak relay is reachable");
  try {
    const res = await fetch(`${RELAY}/health`, { signal: AbortSignal.timeout(5000) });
    info(`Status: ${res.status}`);
    if (res.ok || res.status === 404) {
      ok(`Relay endpoint responsive at ${RELAY}`);
    } else {
      fail(`Relay returned ${res.status}`);
    }
  } catch (e: any) {
    fail(`Relay unreachable: ${e.message}`);
  }

  console.log(`\n${C.g}${C.b}=== READY FOR LIVE CLOAK INTEGRATION ===${C.n}`);
  console.log(`${C.y}Next: tsx scripts/01-shield.ts (will shield 0.5 USDC)${C.n}\n`);
}

main().catch(e => { console.error(`${C.r}ERROR:${C.n}`, e); process.exit(1); });
