import Link from "next/link";

import { Logo } from "./Logo";

export function Footer() {
  return (
    <footer className="border-t border-line bg-panel">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 sm:grid-cols-[1fr_auto_auto] sm:px-6">
        <div className="max-w-sm space-y-3">
          <Logo />
          <p className="text-sm text-muted">
            A dead man&apos;s switch vault for crypto. Your heirs inherit your NEAR and ETH if you go silent.
          </p>
        </div>
        <div className="space-y-2 text-sm">
          <p className="font-semibold">Product</p>
          <Link href="/vault" className="block text-muted hover:text-ink">My vault</Link>
          <Link href="/claim" className="block text-muted hover:text-ink">Claim an inheritance</Link>
        </div>
        <div className="space-y-2 text-sm">
          <p className="font-semibold">Project</p>
          <a href="https://github.com/ZSP111/Heir" className="block text-muted hover:text-ink">GitHub</a>
          <a href="https://testnet.nearblocks.io/address/heir-vault.testnet" className="block text-muted hover:text-ink">Contract</a>
          <a href="https://docs.near.org/chain-abstraction/chain-signatures" className="block text-muted hover:text-ink">NEAR Chain Signatures</a>
        </div>
      </div>
      <div className="border-t border-line">
        <p className="mx-auto max-w-6xl px-4 py-4 text-xs text-muted sm:px-6">
          Built on NEAR. Running on NEAR testnet and Ethereum Sepolia: test tokens only, not audited.
        </p>
      </div>
    </footer>
  );
}
