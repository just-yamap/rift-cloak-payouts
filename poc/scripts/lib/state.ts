import { readFileSync, writeFileSync, existsSync, copyFileSync } from "fs";
import { deserializeUtxo, serializeUtxo, type Utxo } from "@cloak.dev/sdk";
import { STATE_FILE } from "./env.js";

type SerializedUtxo = string;

function uint8ArrayToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function hexToUint8Array(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

function legacyObjectToHex(obj: any): string {
  if (typeof obj === "string") return obj;
  const keys = Object.keys(obj);
  const bytes = new Uint8Array(keys.length);
  for (let i = 0; i < keys.length; i++) bytes[i] = obj[String(i)];
  return uint8ArrayToHex(bytes);
}

export interface CloakPocState {
  timestamp: string;
  network: "mainnet-beta";
  signer: string;
  shield: {
    tx: string;
    amount_usdc: number;
    amount_atomics: string;
    utxo_serialized: SerializedUtxo;
    owner_private_key: string;
    owner_public_key: string;
    new_root: string;
  };
  transfer?: {
    tx: string;
    amount_usdc: number;
    amount_atomics: string;
    recipient_private_key: string;
    recipient_public_key: string;
    sender_change_utxo?: SerializedUtxo;
    recipient_utxo: SerializedUtxo;
    new_root: string;
  };
  withdraw?: {
    tx: string;
    amount_usdc: number;
    recipient_address: string;
    new_root: string;
  };
}

export function loadState(): CloakPocState {
  if (!existsSync(STATE_FILE)) {
    throw new Error("State file not found");
  }
  return JSON.parse(readFileSync(STATE_FILE, "utf8")) as CloakPocState;
}

export function saveState(state: CloakPocState): void {
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

export function backupState(label: string): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const target = `${STATE_FILE}.bak-${label}-${stamp}`;
  copyFileSync(STATE_FILE, target);
  return target;
}

export function serializeUtxoToHex(utxo: Utxo): string {
  return uint8ArrayToHex(serializeUtxo(utxo));
}

export async function rehydrateUtxo(serialized: SerializedUtxo | object): Promise<Utxo> {
  if (typeof serialized === "string") {
    return deserializeUtxo(hexToUint8Array(serialized));
  }
  return deserializeUtxo(hexToUint8Array(legacyObjectToHex(serialized)));
}

export function migrateLegacyStateIfNeeded(): void {
  const raw = readFileSync(STATE_FILE, "utf8");
  const j = JSON.parse(raw);
  if (j.shield && typeof j.shield.utxo_serialized === "string") return;
  if (j.shield && typeof j.shield.utxo_serialized === "object") {
    j.shield.utxo_serialized = legacyObjectToHex(j.shield.utxo_serialized);
    writeFileSync(STATE_FILE, JSON.stringify(j, null, 2));
    return;
  }
  const upgraded: CloakPocState = {
    timestamp: j.timestamp,
    network: j.network,
    signer: j.signer,
    shield: {
      tx: j.shield_tx,
      amount_usdc: j.amount_usdc,
      amount_atomics: j.amount_atomics,
      utxo_serialized: legacyObjectToHex(j.shielded_utxo),
      owner_private_key: j.output_owner.privateKey,
      owner_public_key: j.output_owner.publicKey,
      new_root: j.new_root,
    },
  };
  writeFileSync(STATE_FILE, JSON.stringify(upgraded, null, 2));
}
