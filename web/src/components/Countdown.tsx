/** The big "time left" display for a vault, with a progress bar. */
import { formatDuration } from "@/lib/format";
import type { Vault, VaultStatus } from "@/lib/heir";

import { StatusBadge } from "./ui";

export function Countdown({ vault, status, now }: { vault: Vault; status: VaultStatus; now: number }) {
  const total = vault.unlocks_ms - vault.last_check_in_ms;
  const elapsed = Math.min(total, Math.max(0, now - vault.last_check_in_ms));
  const graceStartsAt = (vault.check_in_period_ms / total) * 100;

  const headline =
    status === "Active"
      ? { label: "Check in within", value: formatDuration(vault.grace_starts_ms - now) }
      : status === "Grace"
        ? { label: "Grace period: vault unlocks in", value: formatDuration(vault.unlocks_ms - now) }
        : { label: "Unlocked", value: "Heirs can claim" };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <StatusBadge status={status} />
        <span className="text-xs text-muted">Last check-in {new Date(vault.last_check_in_ms).toLocaleString()}</span>
      </div>
      <div>
        <p className="text-sm text-muted">{headline.label}</p>
        <p className="font-display text-4xl font-bold tabular-nums">{headline.value}</p>
      </div>
      <div className="relative h-2.5 overflow-hidden rounded-full bg-line" aria-hidden>
        <div
          className={`h-full rounded-full ${status === "Active" ? "bg-ok" : status === "Grace" ? "bg-warn" : "bg-danger"}`}
          style={{ width: `${(elapsed / total) * 100}%` }}
        />
        <div className="absolute inset-y-0 w-0.5 bg-ink/40" style={{ left: `${graceStartsAt}%` }} />
      </div>
      <p className="text-xs text-muted">
        Check-in period {formatDuration(vault.check_in_period_ms)}, then a grace period of{" "}
        {formatDuration(vault.grace_period_ms)}.
      </p>
    </div>
  );
}
