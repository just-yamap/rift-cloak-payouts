import "dotenv/config";
import { PublicKey } from "@solana/web3.js";

function required(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`Missing env var: ${key}`);
  return v;
}

export const env = {
  rpcUrl: required("SOLANA_RPC_URL"),
  keypairPath: required("KEYPAIR_PATH"),
  relayUrl: required("CLOAK_RELAY_URL"),
  usdcMint: new PublicKey(required("USDC_MINT")),
} as const;

export const STATE_FILE = "./.cloak-poc-state.json";
