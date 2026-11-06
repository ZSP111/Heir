"use client";

/** The vault owner's page: create a vault, or manage the one you have. */
import Link from "next/link";
import { useEffect, useState } from "react";

import { config } from "@/lib/config";
import {
  broadcast,
  deriveEthAddress,
  ETH_TRANSFER_GAS_LIMIT,
  getEthBalance,
  isEthAddress,
  suggestFees,
} from "@/lib/eth";
import { ETH_DECIMALS, formatEth, formatNear, NEAR_DECIMALS, parseUnits, shortAddress } from "@/lib/format";
import { useAction, useVault } from "@/lib/hooks";
import { bpsToPercent, getEthAccount, tx, type HeirTransaction, type Vault } from "@/lib/heir";

import { Countdown } from "./Countdown";
import {
  emptyEthRow,
  emptyNearRow,
  EthHeirsEditor,
  ethRowsFrom,
  msToPeriod,
  NearHeirsEditor,
  nearRowsFrom,
  PeriodInput,
  periodToMs,
  toEthHeirs,
  toHeirs,
  type PeriodValue,
} from "./HeirsEditor";
import { Button, Card, ExternalLink, Input, Notice } from "./ui";
import { useWallet } from "./WalletProvider";

type Action = ReturnType<typeof useAction>;

/** Several calls to the Heir contract in one transaction (one wallet prompt). */
function combine(...transactions: HeirTransaction[]): HeirTransaction {
  return { receiverId: transactions[0].receiverId, actions: transactions.flatMap((t) => t.actions) };
}

export function OwnerDashboard() {
  const { accountId, loading: walletLoading, signIn } = useWallet();
  const { vault, status, now, loading, error, refresh } = useVault(accountId);
  const action = useAction();

  if (walletLoading) return <p className="text-muted">Loading wallet…</p>;
  if (!accountId) {
    return (
      <Card title="Your vault">
        <p className="mb-4 text-muted">Connect your NEAR wallet to create or manage your vault.</p>
        <Button onClick={signIn}>Connect wallet</Button>
      </Card>
    );
  }
  if (loading) return <p className="text-muted">Loading your vault…</p>;

  return (
    <div className="space-y-6">
      <h1 className="font-display text-3xl font-bold">My vault</h1>
      {error && <Notice kind="error">Couldn&apos;t load the vault: {error}</Notice>}
      {action.error && <Notice kind="error">{action.error}</Notice>}
      {action.message && <Notice kind="success">{action.message}</Notice>}
      {!vault || !status ? (
        <CreateVault owner={accountId} action={action} onDone={refresh} />
      ) : (
        <>
          <Card>
            <Countdown vault={vault} status={status} now={now} />
            {status === "Unlocked" ? (
              <div className="mt-4">
                <Notice>
                  Your vault has unlocked and now belongs to your heirs. Share the{" "}
                  <Link className="font-semibold text-accent" href={`/claim?owner=${vault.owner}`}>claim page</Link>{" "}
                  with them.
                </Notice>
              </div>
            ) : (
              <CheckInButton action={action} onDone={refresh} />
            )}
          </Card>
          <BalanceCard vault={vault} locked={status === "Unlocked"} action={action} onDone={refresh} />
          <EthCard vault={vault} locked={status === "Unlocked"} action={action} />
          <HeirsCard vault={vault} locked={status === "Unlocked"} action={action} onDone={refresh} />
          {status !== "Unlocked" && <SettingsCard vault={vault} action={action} onDone={refresh} />}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- create

function CreateVault({ owner, action, onDone }: { owner: string; action: Action; onDone: () => void }) {
  const { signAndSend } = useWallet();
  const [nearRows, setNearRows] = useState([emptyNearRow()]);
  const [ethRows, setEthRows] = useState<ReturnType<typeof emptyEthRow>[]>([]);
  const [checkIn, setCheckIn] = useState<PeriodValue>({ amount: "30", unit: "days" });
  const [grace, setGrace] = useState<PeriodValue>({ amount: "7", unit: "days" });
  const [deposit, setDeposit] = useState("1");

  const create = () =>
    action.run("create", async () => {
      const heirs = toHeirs(nearRows, owner);
      const ethHeirs = toEthHeirs(ethRows);
      const create = tx.createVault(heirs, periodToMs(checkIn), periodToMs(grace), parseUnits(deposit || "0", NEAR_DECIMALS));
      await signAndSend(ethHeirs.length ? combine(create, tx.setEthHeirs(ethHeirs)) : create);
      onDone();
      return "Your vault is live. Remember to check in!";
    });

  return (
    <Card title="Create your vault">
      <div className="space-y-6">
        <section className="space-y-2">
          <h3 className="font-semibold">NEAR heirs</h3>
          <p className="text-sm text-muted">They share your NEAR by percentage. Shares must add up to 100%.</p>
          <NearHeirsEditor rows={nearRows} onChange={setNearRows} />
        </section>
        <section className="space-y-2">
          <h3 className="font-semibold">ETH heirs (optional)</h3>
          <p className="text-sm text-muted">
            Ethereum addresses that receive a fixed amount of ETH from your vault&apos;s Ethereum address.
            You can fund it after creating the vault.
          </p>
          <EthHeirsEditor rows={ethRows} onChange={setEthRows} />
        </section>
        <section className="grid gap-4 sm:grid-cols-2">
          <PeriodInput label="Check-in period" hint="How long you can stay silent." value={checkIn} onChange={setCheckIn} />
          <PeriodInput label="Grace period" hint="Warning time before the vault unlocks." value={grace} onChange={setGrace} />
        </section>
        <Input
          label="Starting deposit (NEAR)"
          hint="Plus 0.05 NEAR for storage, refunded if you cancel."
          inputMode="decimal"
          value={deposit}
          onChange={(e) => setDeposit(e.target.value)}
        />
        <Button onClick={create} busy={action.busy === "create"}>Create vault</Button>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------- check in

function CheckInButton({ action, onDone }: { action: Action; onDone: () => void }) {
  const { signAndSend, signDelegate } = useWallet();

  const checkIn = () =>
    action.run("check-in", async () => {
      // Gasless first: the wallet signs a meta transaction and our relayer pays the gas.
      if (config.gasless) {
        const signedDelegate = await signDelegate(tx.checkIn());
        if (signedDelegate) {
          const response = await fetch("/api/relay", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ signedDelegate }),
          });
          const result = await response.json();
          if (!response.ok) throw new Error(result.error ?? "The relayer couldn't send your check-in");
          onDone();
          return "Checked in, gas-free. The countdown has restarted.";
        }
      }
      // This wallet can't sign meta transactions (or gasless is off): a normal transaction.
      await signAndSend(tx.checkIn());
      onDone();
      return "Checked in. The countdown has restarted.";
    });

  return (
    <div className="mt-5 space-y-1">
      <Button onClick={checkIn} busy={action.busy === "check-in"} className="w-full py-4 text-base">
        I&apos;m still here
      </Button>
      {config.gasless && <p className="text-center text-xs text-muted">Free: Heir pays the network fee when your wallet supports it.</p>}
    </div>
  );
}

// ---------------------------------------------------------------- NEAR balance

function BalanceCard({ vault, locked, action, onDone }: { vault: Vault; locked: boolean; action: Action; onDone: () => void }) {
  const { signAndSend } = useWallet();
  const [amount, setAmount] = useState("");

  const send = (kind: "deposit" | "withdraw") =>
    action.run(kind, async () => {
      const yocto = parseUnits(amount, NEAR_DECIMALS);
      await signAndSend(kind === "deposit" ? tx.deposit(yocto) : tx.withdraw(yocto));
      setAmount("");
      onDone();
      return kind === "deposit" ? `Deposited ${amount} NEAR.` : `Withdrew ${amount} NEAR to your wallet.`;
    });

  return (
    <Card title="NEAR in the vault">
      <p className="font-display text-3xl font-bold">{formatNear(vault.balance)} NEAR</p>
      <p className="mb-4 text-xs text-muted">+ {formatNear(vault.storage_deposit)} NEAR storage deposit</p>
      {!locked && (
        <div className="flex flex-wrap items-end gap-2">
          <Input label="Amount (NEAR)" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
          <Button onClick={() => send("deposit")} busy={action.busy === "deposit"} disabled={!amount}>Deposit</Button>
          <Button variant="secondary" onClick={() => send("withdraw")} busy={action.busy === "withdraw"} disabled={!amount}>
            Withdraw
          </Button>
        </div>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------- Ethereum

function EthCard({ vault, locked, action }: { vault: Vault; locked: boolean; action: Action }) {
  const { signAndSend } = useWallet();
  const [address, setAddress] = useState<string | null>(null);
  const [balance, setBalance] = useState<bigint | null>(null);
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [sentHash, setSentHash] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let poll: ReturnType<typeof setInterval> | undefined;
    deriveEthAddress(vault.owner).then((addr) => {
      if (cancelled) return;
      setAddress(addr);
      const loadBalance = () => getEthBalance(addr).then((b) => !cancelled && setBalance(b)).catch(() => {});
      loadBalance();
      poll = setInterval(loadBalance, 15_000);
    });
    return () => {
      cancelled = true;
      clearInterval(poll);
    };
  }, [vault.owner]);

  const promised = vault.eth_heirs.reduce((sum, h) => sum + BigInt(h.amount_wei), 0n);
  const gasReserve = BigInt(vault.eth_heirs.length) * ETH_TRANSFER_GAS_LIMIT * 3_000_000_000n; // room for ~3 gwei gas
  const short = balance !== null && balance < promised + gasReserve;

  const withdrawEth = () =>
    action.run("withdraw-eth", async () => {
      if (!isEthAddress(to)) throw new Error("Enter a valid Ethereum address to send to");
      const fees = await suggestFees();
      await signAndSend(tx.withdrawEth(to.trim(), parseUnits(amount, ETH_DECIMALS), fees));
      const signed = (await getEthAccount(vault.owner)).last_signed_tx;
      if (!signed) throw new Error("The MPC network didn't return a signature. Try again.");
      const hash = await broadcast(signed);
      setSentHash(hash);
      setAmount("");
      return "Signed by NEAR Chain Signatures and sent to Ethereum.";
    });

  return (
    <Card title="ETH in the vault (Sepolia)">
      <p className="text-sm text-muted">
        Your vault&apos;s Ethereum address. Only the Heir contract can sign for it, through NEAR Chain Signatures.
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <code className="break-all rounded-lg bg-surface px-2 py-1 text-sm">{address ?? "deriving…"}</code>
        {address && <ExternalLink href={`${config.ethExplorer}/address/${address}`}>Etherscan</ExternalLink>}
      </div>
      <p className="mt-2 rounded-lg border border-warn/30 bg-warn/5 px-3 py-2 text-xs text-warn">
        Only send <strong>Sepolia ETH</strong> to this address. Tokens (like USDC) or ETH on other networks sent
        here can&apos;t be moved by the vault yet.
      </p>
      <p className="mt-4 font-display text-3xl font-bold">{balance === null ? "…" : `${formatEth(balance)} ETH`}</p>
      {vault.eth_heirs.length > 0 && (
        <p className={`mt-1 text-sm ${short ? "font-semibold text-warn" : "text-muted"}`}>
          Promised to ETH heirs: {formatEth(promised)} ETH
          {short && " — top up the address so every heir can be paid (keep a little extra for gas)."}
        </p>
      )}
      {!locked && (
        <div className="mt-5 space-y-2">
          <h3 className="text-sm font-semibold">Send ETH out</h3>
          <div className="flex flex-wrap items-end gap-2">
            <Input label="To" placeholder="0x…" value={to} onChange={(e) => setTo(e.target.value)} />
            <div className="w-28">
              <Input label="Amount (ETH)" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </div>
            <Button variant="secondary" onClick={withdrawEth} busy={action.busy === "withdraw-eth"} disabled={!to || !amount}>
              Sign &amp; send
            </Button>
          </div>
          {sentHash && (
            <p className="text-sm">
              Sent: <ExternalLink href={`${config.ethExplorer}/tx/${sentHash}`}>{shortAddress(sentHash)}</ExternalLink>
            </p>
          )}
        </div>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------- heirs

function HeirsCard({ vault, locked, action, onDone }: { vault: Vault; locked: boolean; action: Action; onDone: () => void }) {
  const { signAndSend } = useWallet();
  const [editing, setEditing] = useState(false);
  const [nearRows, setNearRows] = useState(() => nearRowsFrom(vault.heirs));
  const [ethRows, setEthRows] = useState(() => ethRowsFrom(vault.eth_heirs));

  const startEditing = () => {
    setNearRows(nearRowsFrom(vault.heirs));
    setEthRows(ethRowsFrom(vault.eth_heirs));
    setEditing(true);
  };

  const save = () =>
    action.run("heirs", async () => {
      await signAndSend(combine(tx.setHeirs(toHeirs(nearRows, vault.owner)), tx.setEthHeirs(toEthHeirs(ethRows))));
      setEditing(false);
      onDone();
      return "Heirs updated.";
    });

  return (
    <Card
      title="Heirs"
      actions={!locked && !editing && <Button variant="secondary" onClick={startEditing}>Edit</Button>}
    >
      {editing ? (
        <div className="space-y-5">
          <NearHeirsEditor rows={nearRows} onChange={setNearRows} />
          <EthHeirsEditor rows={ethRows} onChange={setEthRows} />
          <div className="flex gap-2">
            <Button onClick={save} busy={action.busy === "heirs"}>Save heirs</Button>
            <Button variant="secondary" onClick={() => setEditing(false)}>Cancel</Button>
          </div>
        </div>
      ) : (
        <ul className="divide-y divide-line">
          {vault.heirs.map((h) => (
            <li key={h.account_id} className="flex justify-between py-2 text-sm">
              <span className="truncate">{h.account_id}</span>
              <span className="font-semibold">{bpsToPercent(h.share_bps)} of NEAR</span>
            </li>
          ))}
          {vault.eth_heirs.map((h) => (
            <li key={h.address} className="flex justify-between py-2 text-sm">
              <code className="truncate">{shortAddress(h.address)}</code>
              <span className="font-semibold">{formatEth(h.amount_wei)} ETH</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------- settings

function SettingsCard({ vault, action, onDone }: { vault: Vault; action: Action; onDone: () => void }) {
  const { signAndSend } = useWallet();
  const [checkIn, setCheckIn] = useState(() => msToPeriod(vault.check_in_period_ms));
  const [grace, setGrace] = useState(() => msToPeriod(vault.grace_period_ms));

  const savePeriods = () =>
    action.run("periods", async () => {
      await signAndSend(tx.setPeriods(periodToMs(checkIn), periodToMs(grace)));
      onDone();
      return "Periods updated.";
    });

  const cancel = () => {
    if (!window.confirm("Close your vault and send all its NEAR back to your wallet? ETH stays at your vault's Ethereum address.")) return;
    action.run("cancel", async () => {
      await signAndSend(tx.cancel());
      onDone();
      return "Vault closed. Its NEAR is back in your wallet.";
    });
  };

  return (
    <Card title="Settings">
      <div className="grid gap-4 sm:grid-cols-2">
        <PeriodInput label="Check-in period" value={checkIn} onChange={setCheckIn} />
        <PeriodInput label="Grace period" value={grace} onChange={setGrace} />
      </div>
      <div className="mt-4 flex flex-wrap justify-between gap-2">
        <Button variant="secondary" onClick={savePeriods} busy={action.busy === "periods"}>Save periods</Button>
        <Button variant="danger" onClick={cancel} busy={action.busy === "cancel"}>Close vault</Button>
      </div>
    </Card>
  );
}
