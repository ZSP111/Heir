/**
 * Amounts on chain are whole numbers of the smallest unit:
 *   1 NEAR = 10^24 yoctoNEAR,  1 ETH = 10^18 wei.
 * We keep them as bigint and only turn them into decimals for display.
 */
export const NEAR_DECIMALS = 24;
export const ETH_DECIMALS = 18;

export function formatUnits(amount: string | bigint, decimals: number, maxFraction = 4): string {
  const value = BigInt(amount);
  const base = 10n ** BigInt(decimals);
  const whole = value / base;
  const fraction = (value % base).toString().padStart(decimals, "0").slice(0, maxFraction);
  const trimmed = fraction.replace(/0+$/, "");
  return trimmed ? `${whole}.${trimmed}` : whole.toString();
}

/** "1.5" -> 1500000000000000000000000n (for NEAR). Throws on bad input. */
export function parseUnits(text: string, decimals: number): bigint {
  const clean = text.trim();
  if (!/^\d+(\.\d+)?$/.test(clean)) throw new Error(`"${text}" is not a valid amount`);
  const [whole, fraction = ""] = clean.split(".");
  if (fraction.length > decimals) throw new Error(`At most ${decimals} decimal places`);
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, "0"));
}

export const formatNear = (yocto: string | bigint) => formatUnits(yocto, NEAR_DECIMALS);
export const formatEth = (wei: string | bigint) => formatUnits(wei, ETH_DECIMALS, 6);

/** 90061000 ms -> "1d 1h 1m 1s" (drops leading zero units). */
export function formatDuration(ms: number): string {
  if (ms <= 0) return "0s";
  let seconds = Math.floor(ms / 1000);
  const parts: string[] = [];
  for (const [unit, size] of [["d", 86400], ["h", 3600], ["m", 60]] as const) {
    if (seconds >= size || parts.length) {
      parts.push(`${Math.floor(seconds / size)}${unit}`);
      seconds %= size;
    }
  }
  parts.push(`${seconds}s`);
  return parts.join(" ");
}

export function shortAddress(address: string): string {
  return address.length > 14 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address;
}
