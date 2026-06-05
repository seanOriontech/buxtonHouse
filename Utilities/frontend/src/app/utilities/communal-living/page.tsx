"use client";

import Link from "next/link";
import { Fragment, useEffect, useMemo, useState } from "react";

import {
  api,
  type CommunalReportResponse,
  type RoomReportRow,
} from "@/lib/api";
import { fmtCost } from "@/lib/format";

const PERIODS = [
  { key: "yesterday",    label: "Yesterday" },
  { key: "mtd",          label: "Month to date" },
  { key: "avg_per_day",  label: "Avg. per day (MTD)" },
] as const;

type PeriodKey = (typeof PERIODS)[number]["key"];

type SortKey =
  | "room_number"
  | "occupants"
  | `${PeriodKey}.units`
  | `${PeriodKey}.cost`
  | `${PeriodKey}.units_pp`
  | `${PeriodKey}.cost_pp`
  | "total_mtd_cost";
type SortDir = "asc" | "desc";

function getSortValue(r: RoomReportRow, k: SortKey): number {
  if (k === "room_number") return r.room_number;
  if (k === "occupants") return r.occupants;
  if (k === "total_mtd_cost") return r.electricity.mtd.cost;
  const occ = r.occupants > 0 ? r.occupants : 1;
  const [period, metric] = k.split(".") as [PeriodKey, string];
  const p = r.electricity[period];
  if (metric === "units")    return p.units;
  if (metric === "cost")     return p.cost;
  if (metric === "units_pp") return p.units / occ;
  if (metric === "cost_pp")  return p.cost / occ;
  return 0;
}

function fmtKwh(n: number, opts?: { perPerson?: boolean }): string {
  if (!Number.isFinite(n)) return "—";
  const d = opts?.perPerson ? (n < 10 ? 2 : 1) : (n < 100 ? 2 : 0);
  return (
    n.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d }) + " kWh"
  );
}

function safeDiv(n: number, d: number): number {
  return d > 0 ? n / d : 0;
}

const TONE = "border-amber-500/30 bg-amber-500/10 text-amber-300";
const CELL_TONE_DARK = "bg-amber-500/15";   // striped row
const CELL_TONE_LIGHT = "bg-amber-500/5";   // normal row

// Frozen left columns. left offsets MUST equal the running sum of the widths,
// and the widths are enforced inline (auto table-layout otherwise renders the
// Tailwind w-* hints narrower, so a hardcoded `left` overshoots and the frozen
// column slides over the first data column).
const FROZEN = {
  room: { left: 0,   width: 72  },
  occ:  { left: 72,  width: 120 },
  sex:  { left: 192, width: 76  },
} as const;

function frozenStyle(col: { left: number; width: number }): React.CSSProperties {
  return { left: col.left, width: col.width, minWidth: col.width, maxWidth: col.width };
}

export default function CommunalLivingPage() {
  const [data, setData] = useState<CommunalReportResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({
    key: "room_number",
    dir: "asc",
  });

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.reports.communalRoom()
      .then((r) => !cancelled && setData(r))
      .catch((e) => !cancelled && setError(String(e)))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, []);

  function toggleSort(k: SortKey) {
    setSort((s) =>
      s.key === k
        ? { key: k, dir: s.dir === "asc" ? "desc" : "asc" }
        : { key: k, dir: k === "room_number" || k === "occupants" ? "asc" : "desc" }
    );
  }

  const sortedRooms = useMemo(() => {
    if (!data) return [];
    const arr = [...data.rooms];
    const dir = sort.dir === "asc" ? 1 : -1;
    arr.sort((a, b) => {
      const va = getSortValue(a, sort.key);
      const vb = getSortValue(b, sort.key);
      if (va === vb) return a.room_number - b.room_number;
      return (va - vb) * dir;
    });
    return arr;
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
        <h1 className="text-2xl font-semibold tracking-tight">Communal Living — Utilities</h1>
        <p className="text-base text-neutral-500">
          Per-room electricity consumption and cost.{" "}
          {data?.report_date && <>Report date <span className="text-neutral-300">{data.report_date}</span>.</>}{" "}
          {data?.snapshot_date && <>Occupancy snapshot <span className="text-neutral-300">{data.snapshot_date}</span>.</>}{" "}
          {data && <>MTD spans <span className="text-neutral-300">{data.days_elapsed_mtd}</span> day{data.days_elapsed_mtd === 1 ? "" : "s"}.</>}
        </p>
        {data && (
          <div className="mt-3 flex flex-wrap gap-2 text-sm">
            <span className={`rounded-md border px-2.5 py-1 ${TONE}`}>
              Electricity · R{data.tariff_rate_per_kwh.toFixed(4).replace(".", ",")} / kWh
            </span>
          </div>
        )}
      </div>

      {error && (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 px-4 py-3 text-base text-red-300">
          {error}
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-neutral-800 bg-neutral-950">
        {/* border-separate (not border-collapse): Safari/WebKit ignores
            position:sticky on cells inside a border-collapse table, which made
            the pinned left columns scroll away. */}
        <table className="w-full min-w-[1100px] border-separate border-spacing-0 text-sm">
          <thead className="bg-neutral-900 text-neutral-300">
            {/* Row 1 — utility group + tariff */}
            <tr className="border-b border-neutral-800">
              <th rowSpan={4} style={frozenStyle(FROZEN.room)} className="sticky z-20 bg-neutral-900 px-3 py-2 text-left">
                <SortHeader k="room_number" className="!justify-start">Room</SortHeader>
              </th>
              <th rowSpan={4} style={frozenStyle(FROZEN.occ)} className="sticky z-20 bg-neutral-900 px-3 py-2 text-left">
                <SortHeader k="occupants" className="!justify-start">Occupants</SortHeader>
              </th>
              <th rowSpan={4} style={frozenStyle(FROZEN.sex)} className="sticky z-20 bg-neutral-900 px-3 py-2 text-left">Sex</th>
              <th
                colSpan={3 * 4}
                className={`border-l border-neutral-800 border-b px-3 py-2 ${TONE}`}
              >
                {data ? `Electricity — R${data.tariff_rate_per_kwh.toFixed(4).replace(".", ",")} / kWh` : "Electricity"}
              </th>
              <th colSpan={2} className="border-l border-neutral-800 bg-emerald-950/40 px-3 py-2 text-emerald-300">
                Total cost
              </th>
              <th rowSpan={4} className="w-12 border-l border-neutral-800 bg-neutral-900 px-2 py-2 text-center text-neutral-400">
                Detail
              </th>
            </tr>

            {/* Row 2 — period */}
            <tr className="border-b border-neutral-800 text-xs uppercase tracking-wider text-neutral-400">
              {PERIODS.map((p, i) => (
                <th key={`p${i}`} colSpan={4} className="border-l border-neutral-800 px-2 py-1.5 text-center">
                  {p.label}
                </th>
              ))}
              <th colSpan={2} className="border-l border-neutral-800 bg-emerald-950/20 px-2 py-1.5 text-center">
                MTD
              </th>
            </tr>

            {/* Row 3 — aggregation */}
            <tr className="border-b border-neutral-800 text-xs text-neutral-400">
              {PERIODS.flatMap((_, p) => [
                <th key={`p${p}-room`} colSpan={2} className="border-l border-neutral-800 px-2 py-1 text-center">Room</th>,
                <th key={`p${p}-per`}  colSpan={2} className="border-l border-dotted border-neutral-800 px-2 py-1 text-center">Per person</th>,
              ])}
              <th className="border-l border-neutral-800 bg-emerald-950/20 px-2 py-1 text-center">Room</th>
              <th className="border-l border-dotted border-neutral-800 bg-emerald-950/20 px-2 py-1 text-center">Per person</th>
            </tr>

            {/* Row 4 — units / cost (sortable) */}
            <tr className="text-xs text-neutral-500">
              {PERIODS.flatMap((p) => [
                <th key={`${p.key}-uR`} className="border-l border-neutral-800 px-2 py-1 text-right font-normal">
                  <SortHeader k={`${p.key}.units`}>Units (kWh)</SortHeader>
                </th>,
                <th key={`${p.key}-cR`} className="px-2 py-1 text-right font-normal">
                  <SortHeader k={`${p.key}.cost`}>Cost (R)</SortHeader>
                </th>,
                <th key={`${p.key}-uP`} className="border-l border-dotted border-neutral-800 px-2 py-1 text-right font-normal">
                  <SortHeader k={`${p.key}.units_pp`}>Units</SortHeader>
                </th>,
                <th key={`${p.key}-cP`} className="px-2 py-1 text-right font-normal">
                  <SortHeader k={`${p.key}.cost_pp`}>Cost (R)</SortHeader>
                </th>,
              ])}
              <th className="border-l border-neutral-800 bg-emerald-950/20 px-2 py-1 text-right font-normal">
                <SortHeader k="total_mtd_cost">Cost (R)</SortHeader>
              </th>
              <th className="border-l border-dotted border-neutral-800 bg-emerald-950/20 px-2 py-1 text-right font-normal">Cost (R)</th>
            </tr>
          </thead>

          <tbody className="divide-y divide-neutral-900">
            {loading && (
              <tr>
                <td colSpan={18} className="px-4 py-10 text-center text-base text-neutral-500">Loading…</td>
              </tr>
            )}
            {!loading && data && sortedRooms.length === 0 && (
              <tr>
                <td colSpan={18} className="px-4 py-10 text-center text-base text-neutral-500">
                  No rooms found for Communal Living.
                </td>
              </tr>
            )}
            {!loading &&
              sortedRooms.map((room, i) => <RoomRow key={room.room_id} room={room} striped={i % 2 === 1} />)}
          </tbody>
        </table>
      </div>

      <p className="text-sm text-neutral-500">
        Consumption computed live from Influx via <code className="rounded bg-neutral-900 px-1 py-0.5">last − first</code> per window.
        Cost = units × tariff active on the report date. Occupancy from{" "}
        <code className="rounded bg-neutral-900 px-1 py-0.5">occupancy_snapshots</code>.
      </p>
    </div>
  );
}

function RoomRow({ room, striped }: { room: RoomReportRow; striped: boolean }) {
  const occ = room.occupants;
  const stickyBg = striped ? "bg-neutral-900" : "bg-neutral-950";
  const cellBg = striped ? CELL_TONE_DARK : CELL_TONE_LIGHT;
  const totalBg = striped ? "bg-emerald-950/30" : "bg-emerald-950/10";

  return (
    <tr className="text-neutral-200 hover:bg-neutral-900/50">
      <td style={frozenStyle(FROZEN.room)} className={`sticky z-20 ${stickyBg} px-3 py-2 font-medium`}>{room.room_number}</td>
      <td style={frozenStyle(FROZEN.occ)} className={`sticky z-20 ${stickyBg} px-3 py-2 tabular-nums`}>{occ}</td>
      <td style={frozenStyle(FROZEN.sex)} className={`sticky z-20 ${stickyBg} px-3 py-2 text-neutral-400`}>Mixed</td>

      {PERIODS.map((p) => {
        const period = room.electricity[p.key];
        const units = period.units;
        const cost = period.cost;
        const perUnits = safeDiv(units, occ);
        const perCost = safeDiv(cost, occ);
        return (
          <Fragment key={p.key}>
            <td className={`whitespace-nowrap border-l border-neutral-800 ${cellBg} px-2 py-2 text-right tabular-nums`}>
              {fmtKwh(units)}
            </td>
            <td className={`whitespace-nowrap ${cellBg} px-2 py-2 text-right tabular-nums`}>{fmtCost(cost)}</td>
            <td className={`whitespace-nowrap border-l border-dotted border-neutral-800 ${cellBg} px-2 py-2 text-right tabular-nums`}>
              {fmtKwh(perUnits, { perPerson: true })}
            </td>
            <td className={`whitespace-nowrap ${cellBg} px-2 py-2 text-right tabular-nums`}>{fmtCost(perCost)}</td>
          </Fragment>
        );
      })}

      <td className={`whitespace-nowrap border-l border-neutral-800 ${totalBg} px-3 py-2 text-right tabular-nums font-medium`}>
        {fmtCost(room.electricity.mtd.cost)}
      </td>
      <td className={`whitespace-nowrap border-l border-dotted border-neutral-800 ${totalBg} px-3 py-2 text-right tabular-nums`}>
        {fmtCost(safeDiv(room.electricity.mtd.cost, occ))}
      </td>
      <td className="border-l border-neutral-800 px-2 py-2 text-center">
        <Link
          href={`/utilities/communal-living/${room.room_id}`}
          title={`Open Room ${room.room_number} detail`}
          className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-emerald-500/40 text-emerald-300 transition-colors hover:border-emerald-300 hover:bg-emerald-500/10"
          aria-label={`Room ${room.room_number} detail`}
        >
          →
        </Link>
      </td>
    </tr>
  );
}
