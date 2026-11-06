"use client";

import Link from "next/link";

import { Logo } from "./Logo";
import { Button } from "./ui";
import { useWallet } from "./WalletProvider";

export function Header() {
  const { accountId, loading, signIn, signOut } = useWallet();
  return (
    <header className="sticky top-0 z-20 border-b border-line/80 bg-surface/85 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">
        <Link href="/" aria-label="Heir home">
          <Logo />
        </Link>
        <nav className="flex items-center gap-0.5 whitespace-nowrap text-sm font-medium sm:gap-2">
          <Link href="/vault" className="rounded-lg px-2 py-2 text-muted hover:bg-panel hover:text-ink sm:px-3">My vault</Link>
          <Link href="/claim" className="rounded-lg px-2 py-2 text-muted hover:bg-panel hover:text-ink sm:px-3">Claim</Link>
          {loading ? null : accountId ? (
            <span className="flex items-center gap-2 pl-1">
              <span className="hidden max-w-44 truncate rounded-lg bg-panel px-3 py-2 text-xs text-muted ring-1 ring-line md:inline">
                {accountId}
              </span>
              <Button variant="secondary" onClick={signOut} className="px-3">Sign out</Button>
            </span>
          ) : (
            <Button onClick={signIn} className="ml-1 px-3 sm:px-4">
              <span>
                Connect<span className="hidden sm:inline"> wallet</span>
              </span>
            </Button>
          )}
        </nav>
      </div>
    </header>
  );
}
