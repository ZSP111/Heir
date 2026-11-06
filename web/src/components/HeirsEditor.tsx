"use client";

/**
 * Editing heirs: NEAR accounts with % shares (must add up to 100%), and Ethereum
 * addresses with fixed ETH amounts. Also the period picker used for check-in/grace.
 */
import { isEthAddress } from "@/lib/eth";
import { ETH_DECIMALS, formatEth, parseUnits } from "@/lib/format";
import { percentToBps, type EthHeir, type EthHeirInput, type Heir } from "@/lib/heir";

import { Button, Input } from "./ui";

export interface NearHeirRow {
  accountId: string;
  percent: string;
}

export interface EthHeirRow {
  address: string;
  amountEth: string;
}

export const emptyNearRow = (): NearHeirRow => ({ accountId: "", percent: "" });
export const emptyEthRow = (): EthHeirRow => ({ address: "", amountEth: "" });

export function nearRowsFrom(heirs: Heir[]): NearHeirRow[] {
  return heirs.map((h) => ({ accountId: h.account_id, percent: String(h.share_bps / 100) }));
}

export function ethRowsFrom(heirs: EthHeir[]): EthHeirRow[] {
  return heirs.map((h) => ({ address: h.address, amountEth: formatEth(h.amount_wei) }));
}

/** Check the rows and convert them to what the contract expects. Throws a readable error. */
export function toHeirs(rows: NearHeirRow[], owner: string): Heir[] {
  const heirs = rows
    .filter((r) => r.accountId.trim() || r.percent.trim())
    .map((r) => {
      const accountId = r.accountId.trim().toLowerCase();
      if (!accountId) throw new Error("Every NEAR heir needs an account name");
      if (accountId === owner) throw new Error("You can't be your own heir");
      return { account_id: accountId, share_bps: percentToBps(r.percent) };
    });
  if (heirs.length === 0) throw new Error("Add at least one NEAR heir");
  const total = heirs.reduce((sum, h) => sum + h.share_bps, 0);
  if (total !== 10_000) throw new Error(`NEAR shares add up to ${total / 100}%; they must add up to 100%`);
  return heirs;
}

export function toEthHeirs(rows: EthHeirRow[]): EthHeirInput[] {
  return rows
    .filter((r) => r.address.trim() || r.amountEth.trim())
    .map((r) => {
      if (!isEthAddress(r.address)) throw new Error(`"${r.address}" is not an Ethereum address (0x + 40 hex characters)`);
      const wei = parseUnits(r.amountEth, ETH_DECIMALS);
      if (wei === 0n) throw new Error("Every ETH heir needs an amount above 0");
      return { address: r.address.trim(), amount_wei: wei.toString() };
    });
}

export function NearHeirsEditor({ rows, onChange }: { rows: NearHeirRow[]; onChange: (rows: NearHeirRow[]) => void }) {
  const total = rows.reduce((sum, r) => sum + (Number(r.percent) || 0), 0);
  const update = (i: number, patch: Partial<NearHeirRow>) =>
    onChange(rows.map((row, j) => (i === j ? { ...row, ...patch } : row)));
  return (
    <div className="space-y-2">
      {rows.map((row, i) => (
        <div key={i} className="flex items-end gap-2">
          <Input
            label={i === 0 ? "NEAR account" : undefined}
            placeholder="heir.testnet"
            value={row.accountId}
            onChange={(e) => update(i, { accountId: e.target.value })}
          />
          <div className="w-24">
            <Input
              label={i === 0 ? "Share %" : undefined}
              placeholder="50"
              inputMode="decimal"
              value={row.percent}
              onChange={(e) => update(i, { percent: e.target.value })}
            />
          </div>
          <Button variant="secondary" onClick={() => onChange(rows.filter((_, j) => j !== i))} aria-label="Remove heir">
            ✕
          </Button>
        </div>
      ))}
      <div className="flex items-center justify-between">
        <Button variant="secondary" onClick={() => onChange([...rows, emptyNearRow()])}>+ Add NEAR heir</Button>
        <span className={`text-sm font-semibold ${Math.abs(total - 100) < 0.001 ? "text-ok" : "text-warn"}`}>
          Total: {total}%
        </span>
      </div>
    </div>
  );
}

export function EthHeirsEditor({ rows, onChange }: { rows: EthHeirRow[]; onChange: (rows: EthHeirRow[]) => void }) {
  const update = (i: number, patch: Partial<EthHeirRow>) =>
    onChange(rows.map((row, j) => (i === j ? { ...row, ...patch } : row)));
  return (
    <div className="space-y-2">
      {rows.map((row, i) => (
        <div key={i} className="flex items-end gap-2">
          <Input
            label={i === 0 ? "Ethereum address" : undefined}
            placeholder="0x…"
            value={row.address}
            onChange={(e) => update(i, { address: e.target.value })}
          />
          <div className="w-28">
            <Input
              label={i === 0 ? "Amount (ETH)" : undefined}
              placeholder="0.01"
              inputMode="decimal"
              value={row.amountEth}
              onChange={(e) => update(i, { amountEth: e.target.value })}
            />
          </div>
          <Button variant="secondary" onClick={() => onChange(rows.filter((_, j) => j !== i))} aria-label="Remove ETH heir">
            ✕
          </Button>
        </div>
      ))}
      <Button variant="secondary" onClick={() => onChange([...rows, emptyEthRow()])}>+ Add ETH heir</Button>
    </div>
  );
}

// ---------------------------------------------------------------- periods

export const UNITS = { minutes: 60_000, hours: 3_600_000, days: 86_400_000 } as const;
export type Unit = keyof typeof UNITS;

export interface PeriodValue {
  amount: string;
  unit: Unit;
}

export function periodToMs(period: PeriodValue): number {
  const amount = Number(period.amount);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("Periods must be a positive number");
  const ms = Math.round(amount * UNITS[period.unit]);
  if (ms < 60_000) throw new Error("Periods must be at least 1 minute");
  return ms;
}

/** Show a period in the biggest unit it divides evenly into. */
export function msToPeriod(ms: number): PeriodValue {
  for (const unit of ["days", "hours", "minutes"] as const) {
    if (ms % UNITS[unit] === 0) return { amount: String(ms / UNITS[unit]), unit };
  }
  return { amount: String(ms / UNITS.minutes), unit: "minutes" };
}

export function PeriodInput({ label, hint, value, onChange }: {
  label: string;
  hint?: string;
  value: PeriodValue;
  onChange: (value: PeriodValue) => void;
}) {
  return (
    <div>
      <span className="mb-1 block text-xs font-semibold text-muted">{label}</span>
      <div className="flex gap-2">
        <Input inputMode="decimal" value={value.amount} onChange={(e) => onChange({ ...value, amount: e.target.value })} />
        <select
          value={value.unit}
          onChange={(e) => onChange({ ...value, unit: e.target.value as Unit })}
          className="rounded-xl border border-line bg-panel px-3 text-sm"
        >
          {Object.keys(UNITS).map((unit) => (
            <option key={unit} value={unit}>{unit}</option>
          ))}
        </select>
      </div>
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </div>
  );
}
