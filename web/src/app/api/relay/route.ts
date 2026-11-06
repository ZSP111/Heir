/**
 * POST /api/relay — the gasless check-in relayer.
 *
 * Body: { signedDelegate: base64 } — a meta transaction signed by the user's wallet.
 * The relayer checks it (see relayPolicy.ts), wraps it in a transaction signed with the
 * relayer's own key, and pays the gas. The user's key never comes here.
 *
 * Needs RELAYER_ACCOUNT_ID and RELAYER_PRIVATE_KEY on the server (never NEXT_PUBLIC_).
 */
import "server-only";

import { deserialize } from "borsh";
import { Account, JsonRpcProvider, SCHEMA, type KeyPairString, type SignedDelegate } from "near-api-js";

import { config } from "@/lib/config";
import { getVault } from "@/lib/heir";
import { checkDelegate } from "@/lib/relayPolicy";

function relayer(): Account | null {
  const accountId = process.env.RELAYER_ACCOUNT_ID;
  const privateKey = process.env.RELAYER_PRIVATE_KEY as KeyPairString | undefined;
  if (!accountId || !privateKey) return null;
  return new Account(accountId, new JsonRpcProvider({ url: config.nearRpcUrl }), privateKey);
}

export async function POST(request: Request) {
  const account = relayer();
  if (!account) return Response.json({ error: "Gasless check-ins are not set up on this server" }, { status: 503 });

  let signed: SignedDelegate;
  try {
    const { signedDelegate } = await request.json();
    const bytes = Buffer.from(String(signedDelegate), "base64");
    signed = deserialize(SCHEMA.SignedDelegate, bytes) as unknown as SignedDelegate;
  } catch {
    return Response.json({ error: "Expected { signedDelegate: base64 }" }, { status: 400 });
  }

  const rejected = checkDelegate(signed, config.heirContract);
  if (rejected) return Response.json({ error: rejected }, { status: 403 });

  // Only pay for check-ins that will succeed: the sender must own a vault that hasn't unlocked.
  const vault = await getVault(signed.delegateAction.senderId).catch(() => null);
  if (!vault) return Response.json({ error: "No vault for this account" }, { status: 403 });
  if (Date.now() >= vault.unlocks_ms) return Response.json({ error: "This vault has unlocked" }, { status: 403 });

  try {
    const outcome = await account.relayMetaTransaction(signed);
    return Response.json({ transactionHash: outcome.transaction.hash });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 502 });
  }
}
