"use client";

import Link from "next/link";

import { Button } from "./ui";
import { useWallet } from "./WalletProvider";

export function Header() {
  const { accountId, loading, signIn, signOut } = useWallet();
  return (
    <header className="border-b border-line bg-panel/80 backdrop-blur">
      <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-3 px-4 py-3">
        <Link href="/" className="font-display text-2xl font-bold tracking-tight text-accent">
          Heir
        </Link>
        <nav className="flex items-center gap-4 text-sm font-semibold">
          <Link href="/vault" className="hover:text-accent">My vault</Link>
          <Link href="/claim" className="hover:text-accent">Claim</Link>
          {loading ? null : accountId ? (
            <span className="flex items-center gap-2">
              <span className="hidden max-w-40 truncate text-muted sm:inline">{accountId}</span>
              <Button variant="secondary" onClick={signOut}>Sign out</Button>
            </span>
          ) : (
            <Button onClick={signIn}>Connect wallet</Button>
          )}
        </nav>
      </div>
    </header>
  );
}
