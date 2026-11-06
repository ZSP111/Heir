"use client";

/**
 * The heir's page. Shows every vault that names the connected account, or any vault
 * looked up by its owner (?owner=alice.testnet). NEAR heirs claim their share; anyone
 * can release an ETH heir's payout once the vault unlocks, and broadcast it to Ethereum.
 */
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import { config } from "@/lib/config";
import { broadcast, getTxState, suggestFees, txHash, type EthTxState } from "@/lib/eth";
import { formatEth, formatNear, shortAddress } from "@/lib/format";
import { useAction, useVault } from "@/lib/hooks";
import { bpsToPercent, getClaimable, getVault, getVaultsForHeir, tx, type EthHeir, type Vault } from "@/lib/heir";

import { Countdown } from "./Countdown";
import { Button, Card, ExternalLink, Input, Notice } from "./ui";
import { useWallet } from "./WalletProvider";

export function ClaimPage() {
  const { accountId, signIn } = useWallet();
  const router = useRouter();
  const ownerParam = useSearchParams().get("owner");
  const [lookup, setLookup] = useState(ownerParam ?? "");
  // Vaults naming the connected account, tagged with that account.
  const [found, setFound] = useState<{ account: string; owners: string[] } | null>(null);

  useEffect(() => {
    if (!accountId) return;
    getVaultsForHeir(accountId)
      .then((owners) => setFound({ account: accountId, owners }))
      .catch(() => setFound({ account: accountId, owners: [] }));
  }, [accountId]);
  const myVaults = accountId && found?.account === accountId ? found.owners : null;

  const owners = ownerParam ? [ownerParam] : (myVaults ?? []);

  return (
    <div className="space-y-6">
      <h1 className="font-display text-3xl font-bold">Claim an inheritance</h1>
      <Card>
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const owner = lookup.trim().toLowerCase();
            router.push(owner ? `/claim?owner=${encodeURIComponent(owner)}` : "/claim");
          }}
        >
          <Input
            label="Vault owner's NEAR account"
            placeholder="alice.testnet"
            value={lookup}
            onChange={(e) => setLookup(e.target.value)}
          />
          <Button type="submit" variant="secondary">Look up</Button>
        </form>
        {!ownerParam && !accountId && (
          <p className="mt-4 text-sm text-muted">
            Or <button className="font-semibold text-accent" onClick={signIn}>connect your wallet</button> to see every
            vault that names you as an heir.
          </p>
        )}
        {!ownerParam && accountId && myVaults?.length === 0 && (
          <p className="mt-4 text-sm text-muted">No vault names {accountId} as an heir yet.</p>
        )}
      </Card>
      {owners.map((owner) => (
        <VaultClaim key={owner} owner={owner} />
      ))}
    </div>
  );
}

function VaultClaim({ owner }: { owner: string }) {
  const { accountId, signAndSend } = useWallet();
  const { vault, status, now, loading, refresh } = useVault(owner);
  const action = useAction();
  const [claimable, setClaimable] = useState<string | null>(null);

  const isHeir = Boolean(accountId && vault?.heirs.some((h) => h.account_id === accountId));
  const claimed = Boolean(accountId && vault?.claimed.includes(accountId));

  useEffect(() => {
    if (accountId && isHeir) getClaimable(owner, accountId).then(setClaimable).catch(() => {});
  }, [owner, accountId, isHeir, vault]);

  if (loading) return <p className="text-muted">Loading {owner}&apos;s vault…</p>;
  if (!vault || !status) {
    return (
      <Notice>
        {owner} has no vault (or it has already been fully paid out and closed).
      </Notice>
    );
  }

  const claim = () =>
    action.run("claim", async () => {
      await signAndSend(tx.claim(owner));
      refresh();
      return "Claimed! The NEAR is in your wallet.";
    });

  return (
    <Card title={`${owner}'s vault`}>
      <div className="space-y-6">
        <Countdown vault={vault} status={status} now={now} />
        {action.error && <Notice kind="error">{action.error}</Notice>}
        {action.message && <Notice kind="success">{action.message}</Notice>}

        <section>
          <h3 className="mb-2 font-semibold">NEAR heirs</h3>
          <ul className="divide-y divide-line text-sm">
            {vault.heirs.map((h) => (
              <li key={h.account_id} className="flex justify-between gap-2 py-2">
                <span className="truncate">
                  {h.account_id}
                  {h.account_id === accountId && <span className="ml-2 text-xs font-bold text-accent">YOU</span>}
                </span>
                <span>
                  {bpsToPercent(h.share_bps)} {vault.claimed.includes(h.account_id) && <span className="text-ok">· claimed</span>}
                </span>
              </li>
            ))}
          </ul>
          {isHeir && !claimed && (
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <Button onClick={claim} busy={action.busy === "claim"} disabled={status !== "Unlocked"}>
                Claim {claimable ? `${formatNear(claimable)} NEAR` : "my share"}
              </Button>
              {status !== "Unlocked" && <span className="text-sm text-muted">Available once the vault unlocks.</span>}
            </div>
          )}
        </section>

        {vault.eth_heirs.length > 0 && (
          <section>
            <h3 className="mb-1 font-semibold">ETH heirs (Ethereum Sepolia)</h3>
            <p className="mb-2 text-sm text-muted">
              Paid from the vault&apos;s Ethereum address. Once the vault unlocks, anyone with a NEAR wallet can
              release a payout: the contract fixes the recipient and amount and has NEAR Chain Signatures sign it.
            </p>
            <ul className="divide-y divide-line">
              {vault.eth_heirs.map((heir) => (
                <EthPayout key={heir.address} vault={vault} heir={heir} unlocked={status === "Unlocked"} onChange={refresh} />
              ))}
            </ul>
          </section>
        )}
      </div>
    </Card>
  );
}

const stateLabels: Record<EthTxState, string> = {
  pending: "Sent, waiting for a block…",
  success: "Paid",
  failed: "Failed on Ethereum",
  unknown: "Signed, not yet broadcast",
};

function EthPayout({ vault, heir, unlocked, onChange }: { vault: Vault; heir: EthHeir; unlocked: boolean; onChange: () => void }) {
  const { accountId, signIn, signAndSend } = useWallet();
  const action = useAction();
  const [state, setState] = useState<EthTxState | null>(null);
  const hash = heir.signed_tx ? txHash(heir.signed_tx) : null;

  // Keep checking the payout's status on Ethereum.
  useEffect(() => {
    if (!hash) return;
    let cancelled = false;
    const check = () =>
      getTxState(hash)
        .then((s) => !cancelled && setState(s))
        .catch(() => {});
    check();
    const poll = setInterval(check, 10_000);
    return () => {
      cancelled = true;
      clearInterval(poll);
    };
  }, [hash]);

  const send = (signed: string) =>
    action.run("broadcast", async () => {
      await broadcast(signed);
      setState("pending");
      return "Sent to Ethereum.";
    });

  const release = () =>
    action.run("release", async () => {
      const fees = await suggestFees();
      await signAndSend(tx.releaseEth(vault.owner, heir.address, fees));
      // The contract stored the signed transaction: read it back and broadcast it.
      const updated = await getVault(vault.owner);
      const signed = updated?.eth_heirs.find((h) => h.address === heir.address)?.signed_tx;
      if (!signed) throw new Error("The MPC network didn't return a signature. Try again in a moment.");
      await broadcast(signed);
      setState("pending");
      onChange();
      return "Signed by NEAR Chain Signatures and sent to Ethereum.";
    });

  return (
    <li className="space-y-2 py-3 text-sm">
      <div className="flex flex-wrap justify-between gap-2">
        <ExternalLink href={`${config.ethExplorer}/address/${heir.address}`}>{shortAddress(heir.address)}</ExternalLink>
        <span className="font-semibold">{formatEth(heir.amount_wei)} ETH</span>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        {hash && state && (
          <span className={state === "success" ? "font-semibold text-ok" : state === "failed" ? "text-danger" : "text-muted"}>
            {stateLabels[state]} · <ExternalLink href={`${config.ethExplorer}/tx/${hash}`}>{shortAddress(hash)}</ExternalLink>
          </span>
        )}
        {unlocked && !heir.signed_tx && (
          accountId ? (
            <Button onClick={release} busy={action.busy === "release"}>Release ETH</Button>
          ) : (
            <Button variant="secondary" onClick={signIn}>Connect a NEAR wallet to release</Button>
          )
        )}
        {heir.signed_tx && state === "unknown" && (
          <Button variant="secondary" onClick={() => send(heir.signed_tx!)} busy={action.busy === "broadcast"}>
            Broadcast to Ethereum
          </Button>
        )}
        {heir.signed_tx && (state === "unknown" || state === "pending") && accountId && (
          <Button variant="secondary" onClick={release} busy={action.busy === "release"}>
            Re-sign with fresh gas price
          </Button>
        )}
        {!unlocked && <span className="text-muted">Available once the vault unlocks.</span>}
      </div>
      {action.error && <Notice kind="error">{action.error}</Notice>}
    </li>
  );
}
