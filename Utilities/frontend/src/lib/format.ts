/** Formatters shared across the Utilities frontend. */

export function fmtUnits(n: number, unitLabel: string, opts?: { perPerson?: boolean }): string {
  if (!Number.isFinite(n)) return "—";
  if (unitLabel === "litre") {
    const digits = opts?.perPerson ? 2 : 0;
    return (
      n.toLocaleString(undefined, {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      }) + " ℓ"
    );
  }
  if (unitLabel === "kWh") {
    const digits = n < 100 ? 2 : 0;
    return (
      n.toLocaleString(undefined, {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      }) + " kWh"
    );
  }
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

export function fmtCost(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return (
    "R" +
    n.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  );
}

export function safeDiv(n: number, d: number): number {
  return d > 0 ? n / d : 0;
}
