"use client";

/**
 * NEAR wallet connection using NEAR Connect (@hot-labs/near-connect), as recommended by
 * docs.near.org. It shows a picker of NEAR wallets, remembers the choice, and asks the
 * wallet to sign transactions. The library needs `window`, so it's loaded in the browser.
 */
import type { NearConnector } from "@hot-labs/near-connect";
import { createContext, useCallback, useContext, useEffect, useState } from "react";

import { config } from "@/lib/config";
import type { HeirTransaction } from "@/lib/heir";

interface Wallet {
  /** The signed-in NEAR account, or null. */
  accountId: string | null;
  /** True until we know whether a wallet was already connected. */
  loading: boolean;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  /** Ask the wallet to sign and send a transaction. Resolves once it's on chain. */
  signAndSend: (transaction: HeirTransaction) => Promise<unknown>;
  /**
   * Ask the wallet to sign a meta transaction (without sending it) for a relayer to
   * submit. Returns it base64-encoded, or null if this wallet can't sign meta transactions.
   */
  signDelegate: (transaction: HeirTransaction) => Promise<string | null>;
}

const WalletContext = createContext<Wallet | null>(null);

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [connector, setConnector] = useState<NearConnector | null>(null);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    let instance: NearConnector | null = null;
    const onSignIn = (event: { accounts: { accountId: string }[] }) => {
      if (!cancelled) setAccountId(event.accounts[0]?.accountId ?? null);
    };
    const onSignOut = () => {
      if (!cancelled) setAccountId(null);
    };

    import("@hot-labs/near-connect").then(async ({ NearConnector }) => {
      if (cancelled) return;
      instance = new NearConnector({ network: config.network });
      instance.on("wallet:signIn", onSignIn);
      instance.on("wallet:signOut", onSignOut);
      setConnector(instance);
      try {
        // Restore a wallet connected on an earlier visit.
        const { accounts } = await instance.getConnectedWallet();
        if (!cancelled) setAccountId(accounts[0]?.accountId ?? null);
      } catch {
        // Nothing connected yet.
      } finally {
        if (!cancelled) setLoading(false);
      }
    });

    return () => {
      cancelled = true;
      instance?.off("wallet:signIn", onSignIn);
      instance?.off("wallet:signOut", onSignOut);
    };
  }, []);

  const signIn = useCallback(async () => {
    if (!connector) return;
    const wallet = await connector.connect();
    const accounts = await wallet.getAccounts();
    setAccountId(accounts[0]?.accountId ?? null);
  }, [connector]);

  const signOut = useCallback(async () => {
    if (!connector) return;
    await connector.disconnect();
    setAccountId(null);
  }, [connector]);

  const signAndSend = useCallback(
    async (transaction: HeirTransaction) => {
      if (!connector) throw new Error("The wallet is still loading");
      const wallet = await connector.wallet();
      return wallet.signAndSendTransaction(transaction);
    },
    [connector],
  );

  const signDelegate = useCallback(
    async (transaction: HeirTransaction) => {
      if (!connector) throw new Error("The wallet is still loading");
      const wallet = await connector.wallet();
      if (!wallet.manifest.features?.signDelegateActions) return null;
      const { signedDelegateActions } = await wallet.signDelegateActions({ delegateActions: [transaction] });
      return signedDelegateActions[0] ?? null;
    },
    [connector],
  );

  return (
    <WalletContext.Provider value={{ accountId, loading, signIn, signOut, signAndSend, signDelegate }}>
      {children}
    </WalletContext.Provider>
  );
}

export function useWallet(): Wallet {
  const wallet = useContext(WalletContext);
  if (!wallet) throw new Error("useWallet must be used inside <WalletProvider>");
  return wallet;
}
