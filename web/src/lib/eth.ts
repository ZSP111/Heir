/**
 * Ethereum (Sepolia) helpers.
 *
 * Each vault owner has an Ethereum address that only the Heir contract can sign for,
 * through NEAR Chain Signatures. The address comes from three things: the Heir contract's
 * account, the path "eth-<owner>", and the MPC network's master key. We ask the MPC
 * contract for the matching public key, then turn it into an address the usual Ethereum
 * way: keccak256 of the key, keep the last 20 bytes.
 */
import { keccak_256 } from "@noble/hashes/sha3";
import bs58 from "bs58";

import { config } from "./config";
import type { EthFees } from "./heir";
import { view } from "./near";

/** Matches MAX_FEE_PER_GAS / MAX_PRIORITY_FEE_PER_GAS in the contract. */
const MAX_FEE_PER_GAS = 200_000_000_000n;
const MAX_PRIORITY_FEE_PER_GAS = 10_000_000_000n;
/** Matches ETH_TRANSFER_GAS_LIMIT in the contract. */
export const ETH_TRANSFER_GAS_LIMIT = 500_000n;

export async function deriveEthAddress(owner: string): Promise<string> {
  const publicKey = await view<string>(config.mpcContract, "derived_public_key", {
    path: `eth-${owner}`,
    predecessor: config.heirContract,
    domain_id: 0,
  });
  // "secp256k1:<base58 of the 64-byte x||y point>"
  const point = bs58.decode(publicKey.split(":")[1]);
  const hash = keccak_256(point);
  return "0x" + Array.from(hash.slice(-20), (b) => b.toString(16).padStart(2, "0")).join("");
}

async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  const response = await fetch(config.sepoliaRpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const json = await response.json();
  if (json.error) throw new Error(json.error.message ?? "Ethereum RPC error");
  return json.result as T;
}

export async function getEthBalance(address: string): Promise<bigint> {
  return BigInt(await rpc<string>("eth_getBalance", [address, "latest"]));
}

/** A gas price that should land within a block or two, kept under the contract's caps. */
export async function suggestFees(): Promise<EthFees> {
  const block = await rpc<{ baseFeePerGas: string }>("eth_getBlockByNumber", ["latest", false]);
  const baseFee = BigInt(block.baseFeePerGas);
  const priority = 1_500_000_000n; // 1.5 gwei tip for the block producer
  const maxFee = baseFee * 2n + priority;
  return {
    maxFeePerGas: maxFee < MAX_FEE_PER_GAS ? maxFee : MAX_FEE_PER_GAS,
    maxPriorityFeePerGas: priority < MAX_PRIORITY_FEE_PER_GAS ? priority : MAX_PRIORITY_FEE_PER_GAS,
  };
}

/**
 * Send a signed transaction to Ethereum. Returns its hash. If it was already sent
 * (e.g. someone else broadcast it first), returns the hash anyway.
 */
export async function broadcast(signedTx: string): Promise<string> {
  const hash = txHash(signedTx);
  try {
    await rpc<string>("eth_sendRawTransaction", [signedTx]);
  } catch (error) {
    const message = String((error as Error).message).toLowerCase();
    if (!message.includes("already known") && !message.includes("nonce too low")) throw error;
  }
  return hash;
}

/** An Ethereum transaction's hash is the keccak256 of its signed bytes. */
export function txHash(signedTx: string): string {
  return "0x" + toHex(keccak_256(fromHex(signedTx)));
}

export type EthTxState = "pending" | "success" | "failed" | "unknown";

export async function getTxState(hash: string): Promise<EthTxState> {
  const receipt = await rpc<{ status: string } | null>("eth_getTransactionReceipt", [hash]);
  if (receipt) return receipt.status === "0x1" ? "success" : "failed";
  const pending = await rpc<object | null>("eth_getTransactionByHash", [hash]);
  return pending ? "pending" : "unknown";
}

export function isEthAddress(text: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(text.trim());
}

function fromHex(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  return Uint8Array.from(clean.match(/../g) ?? [], (byte) => parseInt(byte, 16));
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
