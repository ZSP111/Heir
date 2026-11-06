/** Heir's mark: a key whose bow is a shield. */
export function Logo({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <svg viewBox="0 0 32 32" className="size-8" aria-hidden>
        <rect width="32" height="32" rx="9" className="fill-accent" />
        <path d="M16 6.5 22.5 9v5.2c0 4.2-2.7 7.3-6.5 8.8-3.8-1.5-6.5-4.6-6.5-8.8V9L16 6.5Z" fill="none" stroke="#f6f4ee" strokeWidth="1.8" strokeLinejoin="round" />
        <circle cx="16" cy="13" r="2.2" fill="#d9a441" />
        <path d="M16 15.2v4" stroke="#d9a441" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
      <span className="font-display text-2xl font-semibold tracking-tight text-ink">Heir</span>
    </span>
  );
}
