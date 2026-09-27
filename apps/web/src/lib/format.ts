import { formatUnits } from "viem";

/*
 * Formatting happens once, at the render boundary. Amounts stay integer base
 * units until here; nothing is converted through floating point.
 */

/** A base-unit amount as a decimal string trimmed to `places` fraction digits (floored). */
export function amount(
  value: bigint | string,
  decimals: number,
  places = 6,
): string {
  const full = formatUnits(BigInt(value), decimals);
  const [whole = "0", fraction = ""] = full.split(".");
  const cut = fraction.slice(0, places).replace(/0+$/u, "");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/gu, ",");
  return cut.length > 0 ? `${grouped}.${cut}` : grouped;
}

/** `0x1234…abcd`, keeping the checksum-free lowercase form the API emits. */
export function short(value: string, head = 6, tail = 4): string {
  if (value.length <= head + tail + 1) return value;
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

export function bps(value: string | number): string {
  const n = Number(value);
  return `${n} bps (${(n / 100).toFixed(2)}%)`;
}

export function duration(seconds: number): string {
  if (seconds <= 0) return "0 s";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return m > 0 ? `${h} h ${m} min` : `${h} h`;
  if (m > 0) return s > 0 ? `${m} min ${s} s` : `${m} min`;
  return `${s} s`;
}

export function utc(value: Date | string | number): string {
  const date =
    value instanceof Date
      ? value
      : new Date(typeof value === "number" ? value * 1000 : value);
  return `${date.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

export function relative(target: Date, now: Date): string {
  const seconds = Math.round((target.getTime() - now.getTime()) / 1000);
  return seconds >= 0 ? `in ${duration(seconds)}` : `${duration(-seconds)} ago`;
}
