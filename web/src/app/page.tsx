import Link from "next/link";
import type { ReactNode } from "react";

// ---------------------------------------------------------------- small icons (stroke, 24px grid)

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="size-5" aria-hidden>
      {children}
    </svg>
  );
}
const icons = {
  vault: <Icon><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="12" cy="12" r="3.5" /><path d="M12 8.5V7M12 17v-1.5M15.5 12H17M7 12h1.5" /></Icon>,
  users: <Icon><circle cx="9" cy="8" r="3.2" /><path d="M3.5 19c.8-3 3-4.6 5.5-4.6S13.7 16 14.5 19" /><circle cx="17" cy="9" r="2.4" /><path d="M16 14.3c2.2.2 3.8 1.7 4.5 4.2" /></Icon>,
  check: <Icon><circle cx="12" cy="12" r="8.5" /><path d="m8.5 12.2 2.4 2.4 4.8-5" /></Icon>,
  clock: <Icon><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></Icon>,
  link: <Icon><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" /><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" /></Icon>,
  zap: <Icon><path d="M13 3 5 13.5h6L10 21l8-10.5h-6L13 3Z" /></Icon>,
  shield: <Icon><path d="M12 3 19 6v5.5c0 4.5-3 7.8-7 9.5-4-1.7-7-5-7-9.5V6l7-3Z" /><path d="m9 12 2 2 4-4" /></Icon>,
  key: <Icon><circle cx="8" cy="15" r="4" /><path d="m11 12 8.5-8.5M16 7l2.5 2.5M14 9l2 2" /></Icon>,
  x: <Icon><path d="m7 7 10 10M17 7 7 17" /></Icon>,
};

// ---------------------------------------------------------------- content

const steps = [
  { icon: icons.vault, title: "Fund your vault", text: "Move long-term savings into the Heir contract. Your vault also gets its own Ethereum address." },
  { icon: icons.users, title: "Name your heirs", text: "NEAR accounts with % shares, and Ethereum addresses with fixed ETH amounts." },
  { icon: icons.check, title: "Check in now and then", text: "One tap says “I'm still here”. It's free: Heir pays the network fee." },
  { icon: icons.clock, title: "If you go silent", text: "A grace period gives you time to respond. After that, your heirs can claim." },
];

const features = [
  { icon: icons.link, title: "Inherit across chains", text: "Using NEAR Chain Signatures, the contract controls a real Ethereum address and pays ETH heirs directly on Ethereum. No bridges, no wrapped tokens." },
  { icon: icons.zap, title: "Gas-free check-ins", text: "Checking in is a signed message, not a payment. Heir's relayer covers the fee, so staying “alive” costs you nothing." },
  { icon: icons.clock, title: "Grace period built in", text: "Miss a check-in and nothing moves yet. A grace period starts first, so a holiday or a lost phone never triggers a payout." },
  { icon: icons.key, title: "You stay in control", text: "Until the vault unlocks, you can withdraw, change heirs and shares, adjust the timers, or close the vault at any time." },
];

const cannot = [
  "Move, freeze or redirect your funds",
  "Change your heirs or their shares",
  "Unlock your vault early",
  "See or store your private keys",
];

const faqs = [
  { q: "Who holds the money?", a: "The Heir smart contract on NEAR, not a company. Your NEAR wallet is the only key that can manage your vault, and the contract's rules decide when heirs can claim." },
  { q: "What happens if I forget to check in?", a: "Your vault enters a grace period first. You can still check in, withdraw or change anything during it. Only when the grace period also ends does the vault unlock for your heirs." },
  { q: "How do my heirs claim?", a: "NEAR heirs open the claim page with their wallet and press Claim. ETH heirs don't need to do anything on NEAR: anyone can trigger their payout, and the contract sends the fixed amount to their Ethereum address." },
  { q: "How can a NEAR contract send ETH?", a: "NEAR Chain Signatures lets a NEAR account, including a smart contract, ask a decentralized network of signers to sign transactions for other chains. Only the Heir contract can request signatures for your vault's Ethereum address." },
  { q: "Is this live with real money?", a: "Not yet. Heir runs on NEAR testnet and Ethereum Sepolia with test tokens. The contract has not been audited." },
];

// ---------------------------------------------------------------- page

export default function Home() {
  return (
    <div>
      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_50%_at_80%_20%,var(--color-accent-soft),transparent)]" />
        <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-4 pb-16 pt-12 sm:px-6 lg:grid-cols-[1.1fr_1fr] lg:pb-24 lg:pt-20">
          <div className="space-y-7">
            <p className="inline-flex items-center gap-2 rounded-full border border-line bg-panel px-3 py-1 text-xs font-semibold text-accent">
              <span className="size-1.5 rounded-full bg-gold" /> Crypto inheritance on NEAR + Ethereum
            </p>
            <h1 className="font-display text-4xl font-semibold leading-[1.08] tracking-tight sm:text-5xl lg:text-6xl">
              Your crypto shouldn&apos;t disappear with you.
            </h1>
            <p className="max-w-xl text-lg leading-relaxed text-muted">
              Heir is a dead man&apos;s switch vault. Check in now and then. If you ever go silent, the people you
              choose inherit your NEAR and ETH, with no company, lawyer or password in between.
            </p>
            <div className="flex flex-wrap gap-3">
              <Link href="/vault" className="rounded-xl bg-accent px-6 py-3.5 font-semibold text-white shadow-sm transition hover:bg-accent/90">
                Create your vault
              </Link>
              <Link href="/claim" className="rounded-xl border border-line bg-panel px-6 py-3.5 font-semibold transition hover:border-ink/20">
                I&apos;m an heir
              </Link>
            </div>
            <ul className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted">
              {["Non-custodial", "Gas-free check-ins", "NEAR + ETH heirs"].map((item) => (
                <li key={item} className="flex items-center gap-1.5">
                  <span className="text-ok">{icons.check}</span> {item}
                </li>
              ))}
            </ul>
          </div>
          <VaultPreview />
        </div>
      </section>

      {/* How it works */}
      <section className="border-y border-line bg-panel">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:py-20">
          <SectionHeading eyebrow="How it works" title="Set it up once. Check in when you think of it." />
          <ol className="mt-10 grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
            {steps.map((step, i) => (
              <li key={step.title}>
                <div className="flex items-center gap-3">
                  <span className="flex size-10 items-center justify-center rounded-xl bg-accent-soft text-accent">{step.icon}</span>
                  <span className="text-xs font-bold uppercase tracking-widest text-muted">Step {i + 1}</span>
                </div>
                <h3 className="mt-4 font-semibold">{step.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-muted">{step.text}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Features */}
      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:py-20">
        <SectionHeading eyebrow="Why Heir" title="Built for the day you can't be there." />
        <div className="mt-10 grid gap-5 md:grid-cols-2">
          {features.map((f) => (
            <div key={f.title} className="rounded-2xl border border-line bg-panel p-6">
              <span className="flex size-10 items-center justify-center rounded-xl bg-accent-soft text-accent">{f.icon}</span>
              <h3 className="mt-4 text-lg font-semibold">{f.title}</h3>
              <p className="mt-1.5 leading-relaxed text-muted">{f.text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Trust */}
      <section className="bg-ink text-surface">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-16 sm:px-6 lg:grid-cols-2 lg:py-20">
          <div className="space-y-4">
            <p className="text-xs font-bold uppercase tracking-widest text-gold">Security</p>
            <h2 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">The rules live in code, not in a company.</h2>
            <p className="leading-relaxed text-surface/70">
              Your vault is a smart contract on NEAR. The Heir website only reads the blockchain and asks your wallet
              to sign. There is no account to hack, no database of balances, and no back door.
            </p>
            <a href="https://github.com/ZSP111/Heir" className="inline-block font-semibold text-gold underline-offset-4 hover:underline">
              Read the contract on GitHub →
            </a>
          </div>
          <div className="rounded-2xl border border-surface/15 bg-surface/5 p-6">
            <p className="flex items-center gap-2 font-semibold"><span className="text-gold">{icons.shield}</span> What Heir can never do</p>
            <ul className="mt-4 space-y-3">
              {cannot.map((item) => (
                <li key={item} className="flex items-center gap-3 text-surface/80">
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-surface/10 text-surface/70">{icons.x}</span>
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="mx-auto max-w-3xl px-4 py-16 sm:px-6 lg:py-20">
        <SectionHeading eyebrow="Questions" title="Good questions to ask." center />
        <div className="mt-10 divide-y divide-line rounded-2xl border border-line bg-panel">
          {faqs.map((f) => (
            <details key={f.q} className="group px-6 py-5">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-semibold">
                {f.q}
                <span className="text-xl leading-none text-muted transition group-open:rotate-45">+</span>
              </summary>
              <p className="mt-3 leading-relaxed text-muted">{f.a}</p>
            </details>
          ))}
        </div>
      </section>

      {/* Final call to action */}
      <section className="mx-auto max-w-6xl px-4 pb-20 sm:px-6">
        <div className="flex flex-col items-start justify-between gap-6 rounded-3xl bg-accent px-8 py-10 text-white sm:flex-row sm:items-center sm:px-12">
          <div>
            <h2 className="font-display text-3xl font-semibold tracking-tight">Leave nothing to chance.</h2>
            <p className="mt-2 text-white/75">Set up your vault in a few minutes. Change your mind any time.</p>
          </div>
          <Link href="/vault" className="shrink-0 rounded-xl bg-white px-6 py-3.5 font-semibold text-accent transition hover:bg-white/90">
            Create your vault
          </Link>
        </div>
      </section>
    </div>
  );
}

function SectionHeading({ eyebrow, title, center }: { eyebrow: string; title: string; center?: boolean }) {
  return (
    <div className={center ? "text-center" : ""}>
      <p className="text-xs font-bold uppercase tracking-widest text-accent">{eyebrow}</p>
      <h2 className="mt-2 font-display text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h2>
    </div>
  );
}

/** An illustration of the owner dashboard, with example data. */
function VaultPreview() {
  return (
    <div className="relative mx-auto w-full max-w-md">
      <div className="rounded-3xl border border-line bg-panel p-6 shadow-xl shadow-ink/5">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold">alice.near · vault</p>
          <span className="rounded-full bg-ok/10 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-ok">Active</span>
        </div>
        <p className="mt-5 text-xs text-muted">Next check-in due in</p>
        <p className="font-display text-4xl font-semibold tabular-nums">27d 14h 05m</p>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-line">
          <div className="h-full w-[18%] rounded-full bg-ok" />
        </div>
        <div className="mt-6 grid grid-cols-2 gap-3">
          <div className="rounded-xl bg-surface p-3">
            <p className="text-xs text-muted">NEAR</p>
            <p className="font-semibold">1,250.00</p>
          </div>
          <div className="rounded-xl bg-surface p-3">
            <p className="text-xs text-muted">ETH · 0x6cd1…28ce</p>
            <p className="font-semibold">2.40</p>
          </div>
        </div>
        <ul className="mt-5 space-y-2.5 text-sm">
          {[
            ["bob.near", "60% of NEAR"],
            ["carol.near", "40% of NEAR"],
            ["0x104c…7cae", "1.5 ETH"],
          ].map(([who, what]) => (
            <li key={who} className="flex items-center justify-between">
              <span className="flex items-center gap-2">
                <span className="flex size-6 items-center justify-center rounded-full bg-accent-soft text-[10px] font-bold text-accent">
                  {who.startsWith("0x") ? "Ξ" : who[0].toUpperCase()}
                </span>
                {who}
              </span>
              <span className="text-muted">{what}</span>
            </li>
          ))}
        </ul>
        <div className="mt-6 rounded-xl bg-accent py-3 text-center text-sm font-semibold text-white">I&apos;m still here</div>
      </div>
      <p className="mt-3 text-center text-xs text-muted">Example vault</p>
    </div>
  );
}
