/**
 * What the gasless relayer agrees to pay for. Kept as a small pure function so the
 * rules are easy to read and test.
 *
 * A meta transaction is a "delegate action": the user signs a list of actions for one
 * receiver, and our relayer wraps it in a transaction and pays the gas. The relayer
 * can't change what the user signed, but it decides what it's willing to pay for.
 */
import type { SignedDelegate } from "near-api-js";

/** Gasless check-ins only: one `check_in` call on the Heir contract, no NEAR attached. */
export const RELAYED_METHODS = ["check_in"];
/** check_in is cheap; refuse anything asking the relayer to buy lots of gas. */
export const MAX_RELAYED_GAS = 30_000_000_000_000n; // 30 Tgas

export function checkDelegate(signed: SignedDelegate, heirContract: string): string | null {
  const { receiverId, actions } = signed.delegateAction;
  if (receiverId !== heirContract) return `Only calls to ${heirContract} are relayed`;
  if (actions.length !== 1) return "Exactly one action is relayed";
  const call = actions[0].functionCall;
  if (!call) return "Only function calls are relayed";
  if (!RELAYED_METHODS.includes(call.methodName)) return `Only ${RELAYED_METHODS.join(", ")} is relayed`;
  if (call.deposit !== 0n) return "Relayed calls can't attach NEAR";
  if (call.gas > MAX_RELAYED_GAS) return "Too much gas requested";
  return null;
}
