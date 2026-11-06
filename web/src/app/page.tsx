import Link from "next/link";

const steps = [
  ["Put savings in your vault", "NEAR goes into the Heir contract. Your vault also gets its own Ethereum address, controlled by the contract through NEAR Chain Signatures."],
  ["Name your heirs", "NEAR accounts with % shares, and Ethereum addresses with fixed ETH amounts."],
  ["Check in now and then", "One tap says “I'm still here”. Withdraw or change anything, any time."],
  ["If you go silent", "After your check-in period a grace period starts. If you still don't respond, the vault unlocks and your heirs claim, on NEAR and on Ethereum."],
];

export default function Home() {
  return (
    <div className="space-y-12">
      <section className="space-y-5 pt-4">
        <p className="text-sm font-bold uppercase tracking-widest text-accent">Crypto inheritance, across chains</p>
        <h1 className="font-display text-4xl font-bold leading-tight sm:text-5xl">
          If something happens to you, your crypto shouldn&apos;t vanish with you.
        </h1>
        <p className="max-w-2xl text-lg text-muted">
          Heir is a dead man&apos;s switch vault on NEAR. Your wallet stays the only key: the Heir
          website can never move your funds. The rules live in a smart contract.
        </p>
        <div className="flex flex-wrap gap-3">
          <Link href="/vault" className="rounded-xl bg-accent px-5 py-3 font-semibold text-white hover:bg-accent/90">
            Open my vault
          </Link>
          <Link href="/claim" className="rounded-xl border border-line bg-panel px-5 py-3 font-semibold hover:bg-surface">
            I&apos;m an heir
          </Link>
        </div>
      </section>

      <ol className="grid gap-4 sm:grid-cols-2">
        {steps.map(([title, text], i) => (
          <li key={title} className="rounded-2xl border border-line bg-panel p-5">
            <span className="font-display text-3xl font-bold text-accent/40">{i + 1}</span>
            <h2 className="mt-1 font-semibold">{title}</h2>
            <p className="mt-1 text-sm text-muted">{text}</p>
          </li>
        ))}
      </ol>

      <p className="text-sm text-muted">
        Running on NEAR testnet and Ethereum Sepolia. Test tokens only.
      </p>
    </div>
  );
}
