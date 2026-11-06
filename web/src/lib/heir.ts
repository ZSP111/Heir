/**
 * Everything the app knows about the Heir vault contract: its data types, view calls,
 * and the transactions the wallet signs. Mirrors contract/src/lib.rs.
 */
import { config } from "./config";
import { view } from "./near";

export type VaultStatus = "Active" | "Grace" | "Unlocked";

export interface Heir {
  account_id: string;
  /** Basis points: 10000 = 100%. */
  share_bps: number;
}

export interface EthHeir {
  address: string;
  amount_wei: string;
  nonce: number | null;
  signed_tx: string | null;
}

export interface Vault {
  owner: string;
  heirs: Heir[];
  eth_heirs: EthHeir[];
  /** yoctoNEAR */
  balance: string;
  storage_deposit: string;
  check_in_period_ms: number;
  grace_period_ms: number;
  last_check_in_ms: number;
  grace_starts_ms: number;
  unlocks_ms: number;
  /** The blockchain's clock when this was read. */
  now_ms: number;
  status: VaultStatus;
  claimed: string[];
  paid_out: string;
}

export interface EthAccount {
  next_nonce: number;
  pending: boolean;
  last_signed_tx: string | null;
}

/** 0.05 NEAR, taken at creation to pay for the vault's storage on chain. */
export const STORAGE_DEPOSIT_YOCTO = 50_000_000_000_000_000_000_000n;

// ---------------------------------------------------------------- views

export const getVault = (owner: string) => view<Vault | null>(config.heirContract, "get_vault", { owner });

export const getVaultsForHeir = (heir: string) =>
  view<string[]>(config.heirContract, "get_vaults_for_heir", { heir });

export const getClaimable = (owner: string, heir: string) =>
  view<string>(config.heirContract, "get_claimable", { owner, heir });

export const getEthAccount = (owner: string) =>
  view<EthAccount>(config.heirContract, "get_eth_account", { owner });

// ---------------------------------------------------------------- transactions

/** A transaction for the wallet: one or more function calls on the Heir contract. */
export interface HeirTransaction {
  receiverId: string;
  actions: {
    type: "FunctionCall";
    params: { methodName: string; args: object; gas: string; deposit: string };
  }[];
}

function call(methodName: string, args: object, tgas = 30, depositYocto: bigint = 0n): HeirTransaction {
  return {
    receiverId: config.heirContract,
    actions: [
      {
        type: "FunctionCall",
        params: { methodName, args, gas: `${tgas}000000000000`, deposit: depositYocto.toString() },
      },
    ],
  };
}

export interface EthHeirInput {
  address: string;
  amount_wei: string;
}

export const tx = {
  /** `depositYocto` is the starting balance; the 0.05 NEAR storage fee is added on top. */
  createVault: (heirs: Heir[], checkInMs: number, graceMs: number, depositYocto: bigint) =>
    call(
      "create_vault",
      { heirs, check_in_period_ms: checkInMs, grace_period_ms: graceMs },
      30,
      depositYocto + STORAGE_DEPOSIT_YOCTO,
    ),
  checkIn: () => call("check_in", {}),
  deposit: (amountYocto: bigint) => call("deposit", {}, 30, amountYocto),
  withdraw: (amountYocto: bigint) => call("withdraw", { amount: amountYocto.toString() }),
  setHeirs: (heirs: Heir[]) => call("set_heirs", { heirs }),
  setEthHeirs: (ethHeirs: EthHeirInput[]) => call("set_eth_heirs", { eth_heirs: ethHeirs }),
  setPeriods: (checkInMs: number, graceMs: number) =>
    call("set_periods", { check_in_period_ms: checkInMs, grace_period_ms: graceMs }),
  cancel: () => call("cancel", {}),
  claim: (owner: string) => call("claim", { owner }),
  /** Asks the MPC network to sign an ETH heir's payout. Needs lots of gas for the round trip. */
  releaseEth: (owner: string, address: string, fees: EthFees) =>
    call(
      "release_eth",
      {
        owner,
        address,
        max_fee_per_gas: fees.maxFeePerGas.toString(),
        max_priority_fee_per_gas: fees.maxPriorityFeePerGas.toString(),
      },
      200,
    ),
  withdrawEth: (to: string, amountWei: bigint, fees: EthFees) =>
    call(
      "withdraw_eth",
      {
        to,
        amount_wei: amountWei.toString(),
        max_fee_per_gas: fees.maxFeePerGas.toString(),
        max_priority_fee_per_gas: fees.maxPriorityFeePerGas.toString(),
      },
      200,
    ),
};

export interface EthFees {
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
}

/** Turn a "12.5" percent string into basis points (1250). */
export function percentToBps(percent: string): number {
  const value = Number(percent);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`"${percent}" is not a valid percentage`);
  return Math.round(value * 100);
}

export const bpsToPercent = (bps: number) => `${bps / 100}%`;
