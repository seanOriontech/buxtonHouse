"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import {
  api,
  type ApartmentReportResponse,
  type ApartmentRow,
} from "@/lib/api";

type SortDir = "asc" | "desc";
type SortKey = string;     // e.g. "apartment_number", "cold_water.yesterday.units.apt", "total.mtd.per"
type SortState = { key: SortKey; dir: SortDir };

function getSortValue(apt: ApartmentRow, key: SortKey): number {
  if (key === "apartment_number") return apt.apartment_number;
  if (key === "occupants") return apt.occupants;
  const occ = apt.occupants > 0 ? apt.occupants : 1;
  if (key.startsWith("total.")) {
    const [, period, agg] = key.split(".");
    const total =
      period === "yesterday" ? apt.total_cost_yesterday :
      period === "mtd"       ? apt.total_cost_mtd :
                               apt.total_cost_avg_per_day;
    return agg === "per" ? total / occ : total;
  }
  const [utility, period, metric, agg] = key.split(".");
  const util = apt.utilities[utility];
  if (!util) return 0;
  const periodData = (util as unknown as Record<string, { units: number; cost: number }>)[period];
  if (!periodData) return 0;
  const v = metric === "units" ? periodData.units : periodData.cost;
  return agg === "per" ? v / occ : v;
}

const LIVING_TYPE = "Apartment Living";

// Frozen left columns. left offsets MUST equal the running sum of the widths,
// and the widths are enforced inline (auto table-layout otherwise renders the
// Tailwind w-* hints narrower, so a hardcoded `left` overshoots and the frozen
// column slides over the first data column).
const FROZEN = {
  apt: { left: 0,   width: 72  },
  occ: { left: 72,  width: 120 },
  sex: { left: 192, width: 76  },
} as const;

function frozenStyle(col: { left: number; width: number }): React.CSSProperties {
  return { left: col.left, width: col.width, minWidth: col.width, maxWidth: col.width };
}

const UTILITIES = [
  { key: "cold_water",  label: "Cold water",  tone: "sky"   },
  { key: "hot_water",   label: "Hot water",   tone: "rose"  },
  { key: "electricity", label: "Electricity", tone: "amber" },
] as const;

const PERIODS = [
  { key: "yesterday",    label: "Yesterday" },
  { key: "mtd",          label: "Month to date" },
  { key: "avg_per_day",  label: "Avg. per day (MTD)" },
] as const;

function fmtUnits(n: number, unitLabel: string, opts?: { perPerson?: boolean }): string {
  if (!Number.isFinite(n)) return "—";
  if (unitLabel === "litre") {
    // Apartment totals: integer. Per-person: keep 2 decimals (small values
    // like 40.17 ℓ matter).
    const digits = opts?.perPerson ? 2 : 0;
    return (
      n.toLocaleString(undefined, {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      }) + " ℓ"
    );
  }
  // kWh: 2 decimals for small numbers, 0 for large
  const digits = n < 100 ? 2 : 0;
  return (
    n.toLocaleString(undefined, {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }) + " kWh"
  );
}

function fmtCost(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return (
    "R" +
    n.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  );
}

function safeDiv(n: number, d: number): number {
  return d > 0 ? n / d : 0;
}

function toneClass(tone: "sky" | "rose" | "amber"): string {
  return {
    sky:   "border-sky-500/30 bg-sky-500/10 text-sky-300",
    rose:  "border-rose-500/30 bg-rose-500/10 text-rose-300",
    amber: "border-amber-500/30 bg-amber-500/10 text-amber-300",
  }[tone];
}

// Per-utility cell tint (light/dark variants for zebra striping).
function toneCellBg(tone: "sky" | "rose" | "amber", striped: boolean): string {
  if (striped) {
    return {
      sky:   "bg-sky-500/15",
      rose:  "bg-rose-500/15",
      amber: "bg-amber-500/15",
    }[tone];
  }
  return {
    sky:   "bg-sky-500/5",
    rose:  "bg-rose-500/5",
    amber: "bg-amber-500/5",
  }[tone];
}

export default function ApartmentLivingUtilitiesPage() {
  const [data, setData] = useState<ApartmentReportResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [sort, setSort] = useState<SortState>({ key: "apartment_number", dir: "asc" });

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.reports
      .apartment(LIVING_TYPE)
      .then((r) => !cancelled && setData(r))
      .catch((e) => !cancelled && setError(String(e)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, []);

  function toggleSort(key: SortKey) {
    setSort((s) =>
      s.key === key
        ? { key, dir: s.dir === "asc" ? "desc" : "asc" }
        // Default to descending for value columns (highest first); ascending for apt # / occupants.
        : { key, dir: key === "apartment_number" || key === "occupants" ? "asc" : "desc" }
    );
  }

  const sortedApartments = useMemo(() => {
    if (!data) return [];
    const apts = [...data.apartments];
    const dir = sort.dir === "asc" ? 1 : -1;
    apts.sort((a, b) => {
      const va = getSortValue(a, sort.key);
      const vb = getSortValue(b, sort.key);
      if (va === vb) return a.apartment_number - b.apartment_number;
      return (va - vb) * dir;
    });
    return apts;
  }, [data, sort]);

  function SortHeader({ k, children, className = "" }: { k: SortKey; children: React.ReactNode; className?: string }) {
    const active = sort.key === k;
    const arrow = active ? (sort.dir === "asc" ? " ▲" : " ▼") : "";
    return (
      <button
        type="button"
        onClick={() => toggleSort(k)}
        className={`inline-flex w-full items-center justify-end gap-0.5 hover:text-white ${active ? "text-emerald-300" : ""} ${className}`}
      >
        <span>{children}</span>
        <span className="text-xs">{arrow}</span>
      </button>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Apartment Living — Utilities</h1>
        <p className="text-base text-neutral-500">
          Live per-apartment utility consumption and cost.{" "}
          {data?.report_date && <>Report date <span className="text-neutral-300">{data.report_date}</span>.</>}{" "}
          {data?.snapshot_date && <>Occupancy snapshot <span className="text-neutral-300">{data.snapshot_date}</span>.</>}{" "}
          {data?.days_elapsed_mtd && <>MTD spans <span className="text-neutral-300">{data.days_elapsed_mtd}</span> day{data.days_elapsed_mtd === 1 ? "" : "s"}.</>}
        </p>
        <div className="mt-3 flex flex-wrap gap-2 text-sm">
          {data &&
            UTILITIES.map((u) => {
              const t = data.tariffs[u.key];
              if (!t) return null;
              return (
                <span key={u.key} className={`rounded-md border px-2.5 py-1 ${toneClass(u.tone)}`}>
                  {u.label} · R{t.raw_rate.toFixed(4).replace(".", ",")} / {t.raw_unit}{" "}
                  <span className="text-neutral-400">(= R{t.rate_per_unit.toFixed(5).replace(".", ",")} / {t.display_unit})</span>
                </span>
              );
            })}
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 px-4 py-3 text-base text-red-300">
          {error}
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-neutral-800 bg-neutral-950">
        {/* border-separate (not border-collapse): Safari/WebKit ignores
            position:sticky on cells inside a border-collapse table, which made
            the pinned Apt/Occupants/Sex columns scroll away. */}
        <table className="w-full min-w-[1800px] border-separate border-spacing-0 text-sm">
          <thead className="bg-neutral-900 text-neutral-300">
            {/* Row 1 — utility group + tariff */}
            <tr className="border-b border-neutral-800">
              <th rowSpan={4} style={frozenStyle(FROZEN.apt)} className="sticky z-20 bg-neutral-900 px-3 py-2 text-left">
                <SortHeader k="apartment_number" className="!justify-start">Apt</SortHeader>
              </th>
              <th rowSpan={4} style={frozenStyle(FROZEN.occ)} className="sticky z-20 bg-neutral-900 px-3 py-2 text-left">
                <SortHeader k="occupants" className="!justify-start">Occupants</SortHeader>
              </th>
              <th rowSpan={4} style={frozenStyle(FROZEN.sex)} className="sticky z-20 bg-neutral-900 px-3 py-2 text-left">Sex</th>
              {UTILITIES.map((u) => {
                const t = data?.tariffs[u.key];
                const label = t
                  ? `${u.label} — R${t.raw_rate.toFixed(4).replace(".", ",")} / ${t.raw_unit}`
                  : u.label;
                return (
                  <th
                    key={u.key}
                    colSpan={3 * 4}
                    className={`border-l border-neutral-800 border-b px-3 py-2 ${toneClass(u.tone)}`}
                  >
                    {label}
                  </th>
                );
              })}
              <th colSpan={6} className="border-l border-neutral-800 bg-emerald-950/40 px-3 py-2 text-emerald-300">
                Total cost (all utilities)
              </th>
              <th rowSpan={4} className="w-12 border-l border-neutral-800 bg-neutral-900 px-2 py-2 text-center text-neutral-400">
                Detail
              </th>
            </tr>

            {/* Row 2 — time periods */}
            <tr className="border-b border-neutral-800 text-xs uppercase tracking-wider text-neutral-400">
              {UTILITIES.flatMap((_, u) =>
                PERIODS.map((p, i) => (
                  <th key={`u${u}-p${i}`} colSpan={4} className="border-l border-neutral-800 px-2 py-1.5 text-center">
                    {p.label}
                  </th>
                ))
              )}
              {PERIODS.map((p, i) => (
                <th key={`tot-p${i}`} colSpan={2} className="border-l border-neutral-800 bg-emerald-950/20 px-2 py-1.5 text-center">
                  {p.label}
                </th>
              ))}
            </tr>

            {/* Row 3 — aggregation level */}
            <tr className="border-b border-neutral-800 text-xs text-neutral-400">
              {UTILITIES.flatMap((_, u) =>
                PERIODS.flatMap((_, p) => [
                  <th key={`u${u}-p${p}-apt`} colSpan={2} className="border-l border-neutral-800 px-2 py-1 text-center">Apt</th>,
                  <th key={`u${u}-p${p}-per`} colSpan={2} className="border-l border-dotted border-neutral-800 px-2 py-1 text-center">Per person</th>,
                ])
              )}
              {PERIODS.flatMap((_, p) => [
                <th key={`tot-p${p}-apt`} className="border-l border-neutral-800 bg-emerald-950/20 px-2 py-1 text-center">Apt</th>,
                <th key={`tot-p${p}-per`} className="border-l border-dotted border-neutral-800 bg-emerald-950/20 px-2 py-1 text-center">Per person</th>,
              ])}
            </tr>

            {/* Row 4 — units vs cost (clickable to sort) */}
            <tr className="text-xs text-neutral-500">
              {UTILITIES.flatMap((u) =>
                PERIODS.flatMap((p) => {
                  const unitLabel = data?.tariffs[u.key]?.display_unit ?? "";
                  return [
                    <th key={`${u.key}-${p.key}-aU`} className="border-l border-neutral-800 px-2 py-1 text-right font-normal">
                      <SortHeader k={`${u.key}.${p.key}.units.apt`}>Units{unitLabel ? ` (${unitLabel})` : ""}</SortHeader>
                    </th>,
                    <th key={`${u.key}-${p.key}-aC`} className="px-2 py-1 text-right font-normal">
                      <SortHeader k={`${u.key}.${p.key}.cost.apt`}>Cost (R)</SortHeader>
                    </th>,
                    <th key={`${u.key}-${p.key}-pU`} className="border-l border-dotted border-neutral-800 px-2 py-1 text-right font-normal">
                      <SortHeader k={`${u.key}.${p.key}.units.per`}>Units</SortHeader>
                    </th>,
                    <th key={`${u.key}-${p.key}-pC`} className="px-2 py-1 text-right font-normal">
                      <SortHeader k={`${u.key}.${p.key}.cost.per`}>Cost (R)</SortHeader>
                    </th>,
                  ];
                })
              )}
              {PERIODS.flatMap((p) => [
                <th key={`tot-${p.key}-aC`} className="border-l border-neutral-800 bg-emerald-950/20 px-2 py-1 text-right font-normal">
                  <SortHeader k={`total.${p.key}.apt`}>Cost (R)</SortHeader>
                </th>,
                <th key={`tot-${p.key}-pC`} className="border-l border-dotted border-neutral-800 bg-emerald-950/20 px-2 py-1 text-right font-normal">
                  <SortHeader k={`total.${p.key}.per`}>Cost (R)</SortHeader>
                </th>,
              ])}
            </tr>
          </thead>

          <tbody className="divide-y divide-neutral-900">
            {loading && (
              <tr>
                <td colSpan={46} className="px-4 py-10 text-center text-base text-neutral-500">Loading…</td>
              </tr>
            )}
            {!loading && data && sortedApartments.length === 0 && (
              <tr>
                <td colSpan={46} className="px-4 py-10 text-center text-base text-neutral-500">
                  No apartments found for {LIVING_TYPE}.
                </td>
              </tr>
            )}
            {!loading && sortedApartments.map((apt, i) => (
              <ApartmentDataRow key={apt.apartment_number} apt={apt} striped={i % 2 === 1} />
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-sm text-neutral-500">
        Consumption computed live from Influx (cumulative meter readings, <code className="rounded bg-neutral-900 px-1 py-0.5">last − first</code> per window).
        Cost = units × tariff active on the report date. Occupancy from{" "}
        <code className="rounded bg-neutral-900 px-1 py-0.5">occupancy_snapshots</code>.
      </p>
    </div>
  );
}

function ApartmentDataRow({ apt, striped }: { apt: ApartmentRow; striped: boolean }) {
  const occ = apt.occupants;
  const stickyBg = striped ? "bg-neutral-900" : "bg-neutral-950";
  const totalBg = striped ? "bg-emerald-950/30" : "bg-emerald-950/10";

  return (
    <tr className="text-neutral-200 hover:bg-neutral-900/50">
      <td style={frozenStyle(FROZEN.apt)} className={`sticky z-20 ${stickyBg} px-3 py-2 font-medium`}>{apt.apartment_number}</td>
      <td style={frozenStyle(FROZEN.occ)} className={`sticky z-20 ${stickyBg} px-3 py-2 tabular-nums`}>{occ}</td>
      <td style={frozenStyle(FROZEN.sex)} className={`sticky z-20 ${stickyBg} px-3 py-2 text-neutral-400`}>Mixed</td>

      {UTILITIES.flatMap((u) => {
        const util = apt.utilities[u.key];
        const unitLabel = util?.units_label ?? "";
        const cellBg = toneCellBg(u.tone, striped);
        return PERIODS.flatMap((p) => {
          const period = util?.[p.key];
          const units = period?.units ?? 0;
          const cost = period?.cost ?? 0;
          const perUnits = safeDiv(units, occ);
          const perCost = safeDiv(cost, occ);
          return [
            <td key={`${u.key}-${p.key}-aU`} className={`whitespace-nowrap border-l border-neutral-800 ${cellBg} px-2 py-2 text-right tabular-nums`}>{fmtUnits(units, unitLabel)}</td>,
            <td key={`${u.key}-${p.key}-aC`} className={`whitespace-nowrap ${cellBg} px-2 py-2 text-right tabular-nums`}>{fmtCost(cost)}</td>,
            <td key={`${u.key}-${p.key}-pU`} className={`whitespace-nowrap border-l border-dotted border-neutral-800 ${cellBg} px-2 py-2 text-right tabular-nums`}>{fmtUnits(perUnits, unitLabel, { perPerson: true })}</td>,
            <td key={`${u.key}-${p.key}-pC`} className={`whitespace-nowrap ${cellBg} px-2 py-2 text-right tabular-nums`}>{fmtCost(perCost)}</td>,
          ];
        });
      })}

      <td className={`whitespace-nowrap border-l border-neutral-800 ${totalBg} px-2 py-2 text-right tabular-nums font-medium`}>{fmtCost(apt.total_cost_yesterday)}</td>
      <td className={`whitespace-nowrap border-l border-dotted border-neutral-800 ${totalBg} px-2 py-2 text-right tabular-nums`}>{fmtCost(safeDiv(apt.total_cost_yesterday, occ))}</td>
      <td className={`whitespace-nowrap border-l border-neutral-800 ${totalBg} px-2 py-2 text-right tabular-nums font-medium`}>{fmtCost(apt.total_cost_mtd)}</td>
      <td className={`whitespace-nowrap border-l border-dotted border-neutral-800 ${totalBg} px-2 py-2 text-right tabular-nums`}>{fmtCost(safeDiv(apt.total_cost_mtd, occ))}</td>
      <td className={`whitespace-nowrap border-l border-neutral-800 ${totalBg} px-2 py-2 text-right tabular-nums font-medium`}>{fmtCost(apt.total_cost_avg_per_day)}</td>
      <td className={`whitespace-nowrap border-l border-dotted border-neutral-800 ${totalBg} px-2 py-2 text-right tabular-nums`}>{fmtCost(safeDiv(apt.total_cost_avg_per_day, occ))}</td>
      <td className="border-l border-neutral-800 px-2 py-2 text-center">
        <Link
          href={`/utilities/apartment-living/${apt.apartment_number}`}
          title={`Open Apartment ${apt.apartment_number} detail`}
          className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-emerald-500/40 text-emerald-300 transition-colors hover:border-emerald-300 hover:bg-emerald-500/10"
          aria-label={`Apartment ${apt.apartment_number} detail`}
        >
          →
        </Link>
      </td>
    </tr>
  );
}
