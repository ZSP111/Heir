/** Small shared UI pieces, styled with Tailwind. */
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from "react";

import type { VaultStatus } from "@/lib/heir";

export function Card({ title, children, actions }: { title?: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="rounded-2xl border border-line bg-panel p-5 shadow-sm sm:p-6">
      {(title || actions) && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          {title && <h2 className="font-display text-lg font-semibold">{title}</h2>}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "danger";
  busy?: boolean;
};

export function Button({ variant = "primary", busy, disabled, children, className = "", ...rest }: ButtonProps) {
  const styles = {
    primary: "bg-accent text-white hover:bg-accent/90",
    secondary: "border border-line bg-panel text-ink hover:bg-surface",
    danger: "border border-danger/40 bg-panel text-danger hover:bg-danger/5",
  }[variant];
  return (
    <button
      {...rest}
      disabled={disabled || busy}
      className={`inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${styles} ${className}`}
    >
      {busy && <span className="size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />}
      {children}
    </button>
  );
}

export function Input({ label, hint, ...rest }: InputHTMLAttributes<HTMLInputElement> & { label?: string; hint?: string }) {
  return (
    <label className="block min-w-0 flex-1">
      {label && <span className="mb-1 block text-xs font-semibold text-muted">{label}</span>}
      <input
        {...rest}
        className="w-full rounded-xl border border-line bg-panel px-3 py-2.5 text-sm outline-none focus:border-accent"
      />
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}

const statusStyles: Record<VaultStatus, string> = {
  Active: "bg-ok/10 text-ok",
  Grace: "bg-warn/15 text-warn",
  Unlocked: "bg-danger/10 text-danger",
};

const statusLabels: Record<VaultStatus, string> = {
  Active: "Active",
  Grace: "Grace period",
  Unlocked: "Unlocked",
};

export function StatusBadge({ status }: { status: VaultStatus }) {
  return (
    <span className={`rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wide ${statusStyles[status]}`}>
      {statusLabels[status]}
    </span>
  );
}

export function Notice({ kind = "info", children }: { kind?: "info" | "error" | "success"; children: ReactNode }) {
  const styles = {
    info: "border-line bg-surface text-ink",
    error: "border-danger/30 bg-danger/5 text-danger",
    success: "border-ok/30 bg-ok/5 text-ok",
  }[kind];
  return <div className={`rounded-xl border px-4 py-3 text-sm ${styles}`}>{children}</div>;
}

export function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="font-medium text-accent underline-offset-2 hover:underline">
      {children}
    </a>
  );
}
