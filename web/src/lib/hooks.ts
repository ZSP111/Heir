"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { getVault, type Vault, type VaultStatus } from "./heir";

/**
 * Loads a vault and refreshes it every 10 seconds. Also returns the blockchain's
 * current time (ticking every second), so countdowns match what the contract sees.
 */
export function useVault(owner: string | null) {
  // The last result, tagged with whose vault it is, so switching owners shows "loading".
  const [result, setResult] = useState<{ owner: string; vault: Vault | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Difference between the chain's clock and this computer's clock.
  const clockOffset = useRef(0);
  // The current chain time; set in the browser once the vault loads (0 before that).
  const [now, setNow] = useState(0);

  // Bumping this reloads the vault right away (e.g. after a transaction).
  const [reloads, setReloads] = useState(0);
  const refresh = useCallback(() => setReloads((n) => n + 1), []);

  useEffect(() => {
    if (!owner) return;
    let cancelled = false;
    const load = () =>
      getVault(owner)
        .then((vault) => {
          if (cancelled) return;
          if (vault) clockOffset.current = vault.now_ms - Date.now();
          setNow(Date.now() + clockOffset.current);
          setResult({ owner, vault });
          setError(null);
        })
        .catch((e) => !cancelled && setError((e as Error).message));
    load();
    const poll = setInterval(load, 10_000);
    const tick = setInterval(() => setNow(Date.now() + clockOffset.current), 1000);
    return () => {
      cancelled = true;
      clearInterval(poll);
      clearInterval(tick);
    };
  }, [owner, reloads]);

  const current = owner && result?.owner === owner ? result : null;
  const vault = current?.vault ?? null;
  const loading = Boolean(owner) && !current && !error;

  // Work out the status from the ticking clock, so it flips without waiting for a refresh.
  let status: VaultStatus | null = null;
  if (vault) {
    status = now >= vault.unlocks_ms ? "Unlocked" : now >= vault.grace_starts_ms ? "Grace" : "Active";
  }
  return { vault, status, now, loading, error, refresh };
}

/**
 * Runs one action at a time (usually a wallet transaction) and keeps track of which
 * one is busy, plus the latest error or success message to show the user.
 */
export function useAction() {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const run = useCallback(async (name: string, action: () => Promise<string | void>) => {
    setBusy(name);
    setError(null);
    setMessage(null);
    try {
      const result = await action();
      if (result) setMessage(result);
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(null);
    }
  }, []);

  return { busy, error, message, run, setError };
}

/** Pull the contract's panic message out of a wallet/RPC error, if there is one. */
function friendlyError(error: unknown): string {
  const text = error instanceof Error ? error.message : typeof error === "string" ? error : JSON.stringify(error);
  const panic = text.match(/Smart contract panicked: ([^"\\]+)/);
  if (panic) return panic[1];
  if (/reject|cancel|denied/i.test(text)) return "The wallet request was cancelled.";
  return text || "Something went wrong.";
}
