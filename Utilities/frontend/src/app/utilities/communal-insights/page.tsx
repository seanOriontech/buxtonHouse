"use client";

import { Fragment, useEffect, useMemo, useState } from "react";

import { Card, CardHeader } from "@/components/card";
import { Pill } from "@/components/pill";
import {
  api,
  type CommunalAnomaliesResponse,
  type CommunalBaselineDrawResponse,
  type CommunalDailySeriesResponse,
  type CommunalInsightsResponse,
  type CommunalSubmeterBreakdownResponse,
  type RoomAnomaly,
  type RoomDailySeries,
  type RoomInsight,
} from "@/lib/api";
import { fmtCost } from "@/lib/format";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type TabKey = "watchlist" | "anomalies" | "sources" | "trends";

type SortKey =
  | "room_number"
  | "occupants"
  | "risk_score"
  | "mtd_per_person"
  | "eom_per_person"
  | "percentile";
type SortDir = "asc" | "desc";

function getSortValue(r: RoomInsight, k: SortKey): number {
  if (k === "room_number") return r.room_number;
  if (k === "occupants") return r.occupants;
  if (k === "risk_score") return r.risk_score;
  if (k === "mtd_per_person") return r.electricity.mtd_kwh_per_person;
  if (k === "eom_per_person") return r.electricity.eom_forecast_kwh_per_person;
  if (k === "percentile") return r.electricity.percentile_rank;
  return 0;
}

function statusTone(r: RoomInsight): "emerald" | "amber" {
  if (r.electricity.flags.top_decile || r.electricity.flags.forecast_over_median_15x) return "amber";
  return "emerald";
}

function statusLabel(r: RoomInsight): string {
  const f = r.electricity.flags;
  if (f.top_decile && f.forecast_over_median_15x) return "heavy + forecast over";
  if (f.top_decile) return "heavy";
  if (f.forecast_over_median_15x) return "forecast over";
  return "normal";
}

function fmtKwh(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const d = n < 100 ? 2 : 0;
  return n.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d }) + " kWh";
}

export default function CommunalInsightsPage() {
  const [data, setData] = useState<CommunalInsightsResponse | null>(null);
  const [series, setSeries] = useState<CommunalDailySeriesResponse | null>(null);
  const [seriesLoading, setSeriesLoading] = useState(false);
  const [anomalies, setAnomalies] = useState<CommunalAnomaliesResponse | null>(null);
  const [anomaliesLoading, setAnomaliesLoading] = useState(false);
  const [baseline, setBaseline] = useState<CommunalBaselineDrawResponse | null>(null);
  const [baselineLoading, setBaselineLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [sortKey, setSortKey] = useState<SortKey>("risk_score");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [tab, setTab] = useState<TabKey>("watchlist");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.insights.communalRooms()
      .then((r) => !cancelled && setData(r))
      .catch((e) => !cancelled && setError(String(e)))
      .finally(() => !cancelled && setLoading(false));
    setSeriesLoading(true);
    api.insights.communalDaily(10)
      .then((r) => !cancelled && setSeries(r))
      .catch((e) => !cancelled && setError(String(e)))
      .finally(() => !cancelled && setSeriesLoading(false));
    setAnomaliesLoading(true);
    api.insights.communalAnomalies(14)
      .then((r) => !cancelled && setAnomalies(r))
      .catch((e) => !cancelled && setError(String(e)))
      .finally(() => !cancelled && setAnomaliesLoading(false));
    setBaselineLoading(true);
    api.insights.communalBaselineDraw(7)
      .then((r) => !cancelled && setBaseline(r))
      .catch((e) => !cancelled && setError(String(e)))
      .finally(() => !cancelled && setBaselineLoading(false));
    return () => { cancelled = true; };
  }, []);

  function toggleSort(k: SortKey) {
    if (k === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(k); setSortDir(k === "room_number" || k === "occupants" ? "asc" : "desc"); }
  }

  const sortedRooms = useMemo(() => {
    if (!data) return [];
    const arr = [...data.rooms];
    const dir = sortDir === "asc" ? 1 : -1;
    arr.sort((a, b) => {
      const va = getSortValue(a, sortKey);
      const vb = getSortValue(b, sortKey);
      if (va === vb) return a.room_number - b.room_number;
      return (va - vb) * dir;
    });
    return arr;
  }, [data, sortKey, sortDir]);

  const watchlist = useMemo(
    () => sortedRooms.filter((r) => r.risk_score > 0).slice(0, 15),
    [sortedRooms],
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Communal Insights</h1>
        <p className="text-base text-neutral-500">
          Per-room electricity watchlist for Communal Living.{" "}
          {data?.report_date && <>Report date <span className="text-neutral-300">{data.report_date}</span>.</>}{" "}
          {data && <>Day <span className="text-neutral-300">{data.days_elapsed_mtd}</span> of <span className="text-neutral-300">{data.days_in_month}</span>.</>}{" "}
          {data && <>Cohort N = <span className="text-neutral-300">{data.rooms.length}</span> rooms.</>}
        </p>
        {data && (
          <div className="mt-3 flex flex-wrap gap-2 text-sm">
            <span className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-amber-300">
              Electricity · median {fmtKwh(data.cohort_stats.median)}/p · P90 {fmtKwh(data.cohort_stats.p90)}/p MTD
            </span>
          </div>
        )}
      </div>

      {error && (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 px-4 py-3 text-base text-red-300">
          {error}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 border-b border-neutral-800">
        {([
          { k: "watchlist", label: "Watchlist" },
          { k: "anomalies", label: "Anomalies" },
          { k: "sources",   label: "Sources" },
          { k: "trends",    label: "Electricity trends" },
        ] as { k: TabKey; label: string }[]).map((t) => {
          const active = tab === t.k;
          return (
            <button
              key={t.k}
              onClick={() => setTab(t.k)}
              className={
                "border-b-2 px-4 py-2 text-base font-medium transition-colors " +
                (active ? "border-emerald-400 text-emerald-300" : "border-transparent text-neutral-400 hover:text-white")
              }
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {tab === "anomalies" && <CommunalAnomaliesTab data={anomalies} loading={anomaliesLoading} />}
      {tab === "sources"   && <CommunalSourcesTab data={baseline} loading={baselineLoading} />}
      {tab === "trends" && <ElectricityTrends series={series} loading={seriesLoading} />}

      {tab === "watchlist" && (
        <Card>
          <CardHeader
            title={`Watchlist (top ${watchlist.length})`}
            subtitle="Rooms ranked by composite risk: percentile rank + forecast over peer median × 1.5. Click any column to re-sort."
          />
          {loading ? (
            <div className="h-40 animate-pulse rounded-b-lg bg-neutral-900" />
          ) : watchlist.length === 0 ? (
            <p className="px-5 py-10 text-center text-base text-neutral-500">
              No flagged rooms — every room is below the peer median × 1.5 forecast threshold and outside the top decile.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-neutral-950 text-xs uppercase tracking-wider text-neutral-500">
                  <tr className="border-b border-neutral-800">
                    <th className="px-3 py-2 text-left"><SortBtn current={sortKey} dir={sortDir} k="room_number" toggle={toggleSort} align="start">Room</SortBtn></th>
                    <th className="px-3 py-2 text-left">Type</th>
                    <th className="px-3 py-2 text-left"><SortBtn current={sortKey} dir={sortDir} k="occupants" toggle={toggleSort} align="start">Occ</SortBtn></th>
                    <th className="px-3 py-2 text-right">Yday kWh/p</th>
                    <th className="px-3 py-2 text-right"><SortBtn current={sortKey} dir={sortDir} k="mtd_per_person" toggle={toggleSort}>MTD/p</SortBtn></th>
                    <th className="px-3 py-2 text-right"><SortBtn current={sortKey} dir={sortDir} k="eom_per_person" toggle={toggleSort}>EOM/p</SortBtn></th>
                    <th className="px-3 py-2 text-right"><SortBtn current={sortKey} dir={sortDir} k="percentile" toggle={toggleSort}>Status</SortBtn></th>
                    <th className="px-3 py-2 text-right text-emerald-300">MTD cost</th>
                    <th className="px-3 py-2 text-right text-emerald-300"><SortBtn current={sortKey} dir={sortDir} k="risk_score" toggle={toggleSort}>Risk</SortBtn></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-900">
                  {watchlist.map((r, i) => (
                    <RoomRow key={r.room_id} room={r} striped={i % 2 === 1} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {tab === "watchlist" && data?.caveats && data.caveats.length > 0 && (
        <div className="rounded-lg border border-neutral-800 bg-neutral-950 px-5 py-3 text-sm text-neutral-500">
          <p className="mb-1 font-medium text-neutral-400">Methodology notes</p>
          <ul className="list-inside list-disc space-y-0.5">
            {data.caveats.map((c, i) => <li key={i}>{c}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}

function SortBtn({
  current, dir, k, toggle, align = "end", children,
}: {
  current: SortKey; dir: SortDir; k: SortKey;
  toggle: (k: SortKey) => void; align?: "start" | "end"; children: React.ReactNode;
}) {
  const active = current === k;
  const arrow = active ? (dir === "asc" ? " ▲" : " ▼") : "";
  return (
    <button
      type="button"
      onClick={() => toggle(k)}
      className={
        "inline-flex w-full items-center gap-0.5 hover:text-white " +
        (align === "start" ? "justify-start" : "justify-end") + " " +
        (active ? "text-emerald-300" : "")
      }
    >
      <span>{children}</span>
      <span className="text-xs">{arrow}</span>
    </button>
  );
}

function RoomRow({ room, striped }: { room: RoomInsight; striped: boolean }) {
  const rowBg = striped ? "bg-neutral-900/40" : "";
  const tone = statusTone(room);
  const label = statusLabel(room);
  const e = room.electricity;
  return (
    <tr className={`text-neutral-200 hover:bg-neutral-900/70 ${rowBg}`}>
      <td className="whitespace-nowrap px-3 py-2 font-medium">{room.room_number}</td>
      <td className="whitespace-nowrap px-3 py-2 text-neutral-400">{room.room_type}</td>
      <td className="whitespace-nowrap px-3 py-2 tabular-nums">{room.occupants}</td>
      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{fmtKwh(e.yesterday_kwh_per_person)}</td>
      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{fmtKwh(e.mtd_kwh_per_person)}</td>
      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-neutral-300">{fmtKwh(e.eom_forecast_kwh_per_person)}</td>
      <td className="whitespace-nowrap px-3 py-2 text-right">
        <Pill tone={tone}>{label} · P{Math.round(e.percentile_rank)}</Pill>
      </td>
      <td className="whitespace-nowrap bg-emerald-950/20 px-3 py-2 text-right tabular-nums font-medium">{fmtCost(e.mtd_cost)}</td>
      <td className="whitespace-nowrap bg-emerald-950/20 px-3 py-2 text-right tabular-nums font-medium text-emerald-300">{room.risk_score.toFixed(2)}</td>
    </tr>
  );
}

/* -------------------------------------------------------------------------- */
/*  Trends tab                                                                */
/* -------------------------------------------------------------------------- */

function ElectricityTrends({
  series, loading,
}: { series: CommunalDailySeriesResponse | null; loading: boolean }) {
  const [drillRoom, setDrillRoom] = useState<number | null>(null);

  if (loading) {
    return (
      <div className="rounded-lg border border-neutral-800 bg-neutral-900 px-5 py-12 text-center text-base text-neutral-400">
        Building 10-day daily series… this Flux query against Influx Cloud takes about 15 seconds.
      </div>
    );
  }
  if (!series) return <div className="h-72 animate-pulse rounded-lg border border-neutral-800 bg-neutral-900" />;

  // Bar-chart rows: yesterday + day-before per-person, sorted by yesterday.
  const rows = series.rooms
    .map((r) => {
      const dpp = r.days;
      const yday = dpp.length >= 1 ? dpp[dpp.length - 1].kwh_per_person : 0;
      const dayBefore = dpp.length >= 2 ? dpp[dpp.length - 2].kwh_per_person : 0;
      return {
        room_number: r.room_number,
        occupants: r.occupants,
        yesterday: yday,
        day_before: dayBefore,
        consistency: r.days_in_top_decile,
      };
    })
    .sort((a, b) => b.yesterday - a.yesterday);

  // Cohort P90 of yesterday for the reference line
  const ydayVals = rows.map((r) => r.yesterday).sort((a, b) => a - b);
  const p90 = ydayVals.length
    ? (() => {
        const k = 0.9 * (ydayVals.length - 1);
        const lo = Math.floor(k); const hi = Math.min(lo + 1, ydayVals.length - 1);
        return ydayVals[lo] + (ydayVals[hi] - ydayVals[lo]) * (k - lo);
      })()
    : 0;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader
          title="Electricity — yesterday vs day before (per person)"
          subtitle={`kWh per person, per room. Reference line at yesterday's cohort P90 (${p90.toFixed(2)} kWh) — rooms above are in the top decile.`}
        />
        <div className="px-5 py-4">
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={rows} margin={{ top: 10, right: 16, bottom: 4, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                <XAxis dataKey="room_number" stroke="#a1a1aa" tickFormatter={(v) => `#${v}`} />
                <YAxis stroke="#a1a1aa" unit=" kWh" />
                <Tooltip
                  contentStyle={{ background: "#0a0a0a", border: "1px solid #404040", borderRadius: 6 }}
                  labelStyle={{ color: "#fafafa" }}
                  labelFormatter={(v) => `Room ${v}`}
                  formatter={(value: number, name) => [`${value.toFixed(2)} kWh/p`, name]}
                />
                <Bar dataKey="day_before" name="Day before" fill="#a16207" radius={[2, 2, 0, 0]} />
                <Bar dataKey="yesterday" name="Yesterday" radius={[2, 2, 0, 0]}>
                  {rows.map((r, i) => (
                    <Cell key={i} fill={r.yesterday >= p90 && p90 > 0 ? "#f97316" : "#f59e0b"} />
                  ))}
                </Bar>
                <ReferenceLine
                  y={p90}
                  stroke="#fbbf24"
                  strokeDasharray="6 4"
                  label={{ value: `P90 ${p90.toFixed(1)} kWh`, fill: "#fbbf24", fontSize: 11, position: "right" }}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </Card>

      {drillRoom != null && (
        <RoomDrilldown series={series} roomNumber={drillRoom} onClose={() => setDrillRoom(null)} />
      )}

      <Card>
        <CardHeader
          title={`Consistently high — last ${series.days} days`}
          subtitle="Days in the top decile (P90+) within Communal Living over the window. Click any row to see that room's daily trend vs the cohort average."
        />
        <table className="w-full text-sm">
          <thead className="text-xs uppercase tracking-wider text-neutral-500">
            <tr className="border-b border-neutral-800">
              <th className="px-3 py-2 text-left">Room</th>
              <th className="px-3 py-2 text-left">Occ</th>
              <th className="px-3 py-2 text-right">Yday kWh/p</th>
              <th className="px-3 py-2 text-right">Day before kWh/p</th>
              <th className="px-3 py-2 text-right">Days top decile</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-900">
            {rows
              .slice()
              .sort((a, b) => b.consistency - a.consistency || b.yesterday - a.yesterday)
              .map((r) => {
                const selected = drillRoom === r.room_number;
                return (
                  <tr
                    key={r.room_number}
                    onClick={() => setDrillRoom(selected ? null : r.room_number)}
                    className={
                      "cursor-pointer text-neutral-200 transition-colors " +
                      (selected ? "bg-emerald-500/10" : "hover:bg-neutral-900/70")
                    }
                    title="Click to drill in"
                  >
                    <td className="px-3 py-2 font-medium">{selected ? "▾ " : "▸ "}{r.room_number}</td>
                    <td className="px-3 py-2 tabular-nums">{r.occupants}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.yesterday.toFixed(2)} kWh</td>
                    <td className="px-3 py-2 text-right tabular-nums text-neutral-400">{r.day_before.toFixed(2)} kWh</td>
                    <td className="px-3 py-2 text-right">
                      <Pill tone={r.consistency >= series.days * 0.5 ? "red" : r.consistency > 0 ? "amber" : "emerald"}>
                        {r.consistency} / {series.days}
                      </Pill>
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

function RoomDrilldown({
  series, roomNumber, onClose,
}: { series: CommunalDailySeriesResponse; roomNumber: number; onClose: () => void }) {
  const room = series.rooms.find((r) => r.room_number === roomNumber);
  if (!room) return null;

  const dayLabels = room.days.map((d) => d.date);
  const buildingAvgPerDay = dayLabels.map((day) => {
    const vals = series.rooms.map((r) => r.days.find((d) => d.date === day)?.kwh_per_person ?? 0);
    return vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : 0;
  });

  const chartData = room.days.map((d, i) => ({
    label: d.date.slice(5),
    room: d.kwh_per_person,
    building_avg: buildingAvgPerDay[i],
  }));

  return (
    <Card>
      <div className="flex items-center justify-between border-b border-neutral-800 px-5 py-4">
        <div>
          <h2 className="text-base font-medium text-neutral-100">
            Room {roomNumber} — electricity, last {series.days} days
          </h2>
          <p className="mt-0.5 text-sm text-neutral-500">
            Room line vs Communal Living cohort average for the same days.
          </p>
        </div>
        <button onClick={onClose} className="rounded-md border border-neutral-700 px-2.5 py-1 text-sm text-neutral-400 hover:border-neutral-500 hover:text-white">
          Close
        </button>
      </div>
      <div className="px-5 py-4">
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 10, right: 16, bottom: 4, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
              <XAxis dataKey="label" stroke="#a1a1aa" />
              <YAxis stroke="#a1a1aa" unit=" kWh" />
              <Tooltip
                contentStyle={{ background: "#0a0a0a", border: "1px solid #404040", borderRadius: 6 }}
                labelStyle={{ color: "#fafafa" }}
                formatter={(value: number, name) => [`${value.toFixed(2)} kWh/p`, name]}
              />
              <Legend wrapperStyle={{ fontSize: 11, color: "#a1a1aa" }} />
              <Line type="monotone" dataKey="room" name={`Room ${roomNumber}`} stroke="#f97316" strokeWidth={2.5} dot={{ r: 3, fill: "#f97316" }} activeDot={{ r: 5 }} />
              <Line type="monotone" dataKey="building_avg" name="Cohort average" stroke="#a1a1aa" strokeWidth={2} strokeDasharray="5 4" dot={{ r: 2, fill: "#a1a1aa" }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </Card>
  );
}

// Suppress unused-var lint on Fragment
const _F = Fragment;
void _F;

/* -------------------------------------------------------------------------- */
/*  Anomalies tab (electricity-only, no leak)                                 */
/* -------------------------------------------------------------------------- */

function CommunalAnomaliesTab({
  data, loading,
}: { data: CommunalAnomaliesResponse | null; loading: boolean }) {
  const [drill, setDrill] = useState<number | null>(null);

  if (loading) {
    return (
      <div className="rounded-lg border border-neutral-800 bg-neutral-900 px-5 py-12 text-center text-base text-neutral-400">
        Running anomaly detection… ~15 s on Influx Cloud free.
      </div>
    );
  }
  if (!data) return <div className="h-72 animate-pulse rounded-lg border border-neutral-800 bg-neutral-900" />;

  const flagged = data.entries.filter((e) => e.anomaly_score > 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <span className="rounded-md border border-red-500/30 bg-red-500/10 px-2.5 py-1 text-sm text-red-300">
          {data.cohort_red_count} red
        </span>
        <span className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-sm text-amber-300">
          {data.cohort_amber_count} amber
        </span>
        <span className="text-sm text-neutral-500">
          Baseline: last {data.baseline_window_days} days · Compared to {data.entries[0]?.daily_series.at(-1)?.date ?? "—"}
        </span>
      </div>

      <Card>
        <CardHeader
          title={`Rooms with active anomalies (${flagged.length})`}
          subtitle="Each room compared to its own past — spike + day-of-week deviations on electricity. Click for the personal trend chart."
        />
        {flagged.length === 0 ? (
          <p className="px-5 py-10 text-center text-base text-emerald-300">
            All rooms behaving normally — no spikes or day-of-week deviations today.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-xs uppercase tracking-wider text-neutral-500">
              <tr className="border-b border-neutral-800">
                <th className="px-3 py-2 text-left">Room</th>
                <th className="px-3 py-2 text-left">Type</th>
                <th className="px-3 py-2 text-left">Occ</th>
                <th className="px-3 py-2 text-left">Flags</th>
                <th className="px-3 py-2 text-right">Score</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-900">
              {flagged.map((room) => {
                const selected = drill === room.room_number;
                return (
                  <Fragment key={room.room_number}>
                    <tr
                      onClick={() => setDrill(selected ? null : room.room_number)}
                      className={
                        "cursor-pointer text-neutral-200 transition-colors " +
                        (selected ? "bg-emerald-500/10" : "hover:bg-neutral-900/70")
                      }
                    >
                      <td className="px-3 py-2 font-medium">{selected ? "▾ " : "▸ "}{room.room_number}</td>
                      <td className="px-3 py-2 text-neutral-400">{room.room_type}</td>
                      <td className="px-3 py-2 tabular-nums">{room.occupants}</td>
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap gap-1.5">
                          {room.spikes.map((s, i) => (
                            <Pill key={`s-${i}`} tone={s.severity}>
                              spike · z={s.robust_z.toFixed(1)}
                            </Pill>
                          ))}
                          {room.dow.map((d, i) => (
                            <Pill key={`d-${i}`} tone={d.severity}>
                              {d.day_name} ×{d.ratio.toFixed(1)}
                            </Pill>
                          ))}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums font-medium text-emerald-300">
                        {room.anomaly_score.toFixed(2)}
                      </td>
                    </tr>
                    {selected && (
                      <tr>
                        <td colSpan={5} className="bg-neutral-950 px-5 py-4">
                          <CommunalAnomalyDrilldown room={room} baselineWindowDays={data.baseline_window_days} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>

      {data.caveats.length > 0 && (
        <div className="rounded-lg border border-neutral-800 bg-neutral-950 px-5 py-3 text-sm text-neutral-500">
          <p className="mb-1 font-medium text-neutral-400">Methodology</p>
          <ul className="list-inside list-disc space-y-0.5">
            {data.caveats.map((c, i) => <li key={i}>{c}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}

function CommunalAnomalyDrilldown({ room, baselineWindowDays }: { room: RoomAnomaly; baselineWindowDays: number }) {
  const chartData = room.daily_series.map((d) => ({
    label: d.date.slice(5),
    elec: d.electricity_pp,
  }));
  return (
    <div className="space-y-3">
      <div className="h-56">
        <ResponsiveContainer>
          <LineChart data={chartData} margin={{ top: 10, right: 12, bottom: 4, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
            <XAxis dataKey="label" stroke="#a1a1aa" />
            <YAxis stroke="#a1a1aa" unit=" kWh" />
            <Tooltip
              contentStyle={{ background: "#0a0a0a", border: "1px solid #404040", borderRadius: 6 }}
              labelStyle={{ color: "#fafafa" }}
              formatter={(v: number) => `${v.toFixed(2)} kWh/p`}
            />
            {room.baseline_q1_elec_pp != null && room.baseline_q3_elec_pp != null && (
              <ReferenceArea y1={room.baseline_q1_elec_pp} y2={room.baseline_q3_elec_pp} fill="#f59e0b" fillOpacity={0.1} />
            )}
            {room.baseline_median_elec_pp != null && (
              <ReferenceLine y={room.baseline_median_elec_pp} stroke="#f59e0b" strokeDasharray="3 3" />
            )}
            <Line type="monotone" dataKey="elec" stroke="#f59e0b" strokeWidth={2.5} dot={{ r: 3, fill: "#f59e0b" }} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="space-y-1 text-sm text-neutral-400">
        {room.spikes.map((s, i) => (
          <p key={`s-${i}`}>
            <span className={s.severity === "red" ? "text-red-300" : "text-amber-300"}>● {s.severity.toUpperCase()}</span>{" "}
            Electricity spike — today {s.today_per_person.toFixed(2)} kWh/p vs your {baselineWindowDays}-day median {s.baseline_median.toFixed(2)} (robust Z = {s.robust_z.toFixed(2)}).
          </p>
        ))}
        {room.dow.map((d, i) => (
          <p key={`d-${i}`}>
            <span className={d.severity === "red" ? "text-red-300" : "text-amber-300"}>● {d.severity.toUpperCase()}</span>{" "}
            {d.day_name} — today {d.today_per_person.toFixed(2)} vs typical {d.day_name} {d.dow_median_per_person.toFixed(2)} (×{d.ratio.toFixed(1)}).
          </p>
        ))}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Sources tab — always-on baseline draw per communal room, + meter split    */
/* -------------------------------------------------------------------------- */

function CommunalSourcesTab({
  data, loading,
}: { data: CommunalBaselineDrawResponse | null; loading: boolean }) {
  const [drill, setDrill] = useState<string | null>(null);

  if (loading) {
    return (
      <div className="rounded-lg border border-neutral-800 bg-neutral-900 px-5 py-12 text-center text-base text-neutral-400">
        Computing communal-room baseline draws… ~20 s (7 nightly Flux queries).
      </div>
    );
  }
  if (!data) return <div className="h-72 animate-pulse rounded-lg border border-neutral-800 bg-neutral-900" />;

  const maxWatts = Math.max(1, ...data.rows.map((r) => r.avg_overnight_watts));

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader
          title="Always-on baseline draw — communal rooms"
          subtitle={`Average electricity load between ${String(data.window_start_hour).padStart(2,"0")}:00 and ${String(data.window_end_hour).padStart(2,"0")}:00 SAST across the last ${data.nights} nights. Sustained common-area "ghost" load — geysers cycling, server racks, lights left on. A high baseline costs ~24×365 × kW × R4.87 per year if not addressed.`}
        />
        <div className="flex flex-wrap items-center gap-3 border-b border-neutral-800 px-5 py-3 text-sm">
          <span className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-emerald-300">
            Cohort median {data.cohort_median_watts.toFixed(0)} W
          </span>
          <span className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-amber-300">
            P75 {data.cohort_p75_watts.toFixed(0)} W
          </span>
          <span className="rounded-md border border-red-500/30 bg-red-500/10 px-2.5 py-1 text-red-300">
            P90 {data.cohort_p90_watts.toFixed(0)} W
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-neutral-950 text-xs uppercase tracking-wider text-neutral-500">
              <tr className="border-b border-neutral-800">
                <th className="px-3 py-2 text-left">Room</th>
                <th className="px-3 py-2 text-left">Type</th>
                <th className="px-3 py-2 text-left">Occ</th>
                <th className="px-3 py-2 text-right">Avg kWh / night</th>
                <th className="px-3 py-2 text-right">Avg watts</th>
                <th className="px-3 py-2 text-left">Relative to cohort</th>
                <th className="px-3 py-2 text-right">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-900">
              {data.rows.map((row) => {
                const selected = drill === row.room_id;
                const barPct = (row.avg_overnight_watts / maxWatts) * 100;
                const barColor =
                  row.severity === "red" ? "bg-red-500"
                    : row.severity === "amber" ? "bg-amber-500"
                    : "bg-emerald-500";
                return (
                  <Fragment key={row.room_id}>
                    <tr
                      onClick={() => setDrill(selected ? null : row.room_id)}
                      className={
                        "cursor-pointer text-neutral-200 transition-colors " +
                        (selected ? "bg-emerald-500/10" : "hover:bg-neutral-900/70")
                      }
                      title="Click to see this room's meter-by-meter MTD split"
                    >
                      <td className="px-3 py-2 font-medium">
                        {selected ? "▾ " : "▸ "}{row.room_number} <span className="text-neutral-400 font-normal">— {row.room_name}</span>
                      </td>
                      <td className="px-3 py-2 text-neutral-400">{row.room_type}</td>
                      <td className="px-3 py-2 tabular-nums">{row.occupants}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{row.avg_overnight_kwh.toFixed(2)} kWh</td>
                      <td className="px-3 py-2 text-right tabular-nums font-medium">{row.avg_overnight_watts.toFixed(0)} W</td>
                      <td className="px-3 py-2">
                        <div className="h-2 w-40 overflow-hidden rounded bg-neutral-800">
                          <div className={`h-full ${barColor}`} style={{ width: `${barPct}%` }} />
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right">
                        {row.severity ? <Pill tone={row.severity}>{row.severity}</Pill> : <span className="text-emerald-300 text-xs">normal</span>}
                      </td>
                    </tr>
                    {selected && (
                      <tr>
                        <td colSpan={7} className="bg-neutral-950 px-5 py-4">
                          <CommunalSubmeterDrilldown roomId={row.room_id} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="rounded-lg border border-neutral-800 bg-neutral-950 px-5 py-3 text-sm text-neutral-500">
        <p className="mb-1 font-medium text-neutral-400">How to use this</p>
        <ul className="list-inside list-disc space-y-0.5">
          <li>Communal rooms above the cohort P90 are running ~1 kW continuously at 03:00 — typical culprits: geyser stuck on, lights left on, server / aquarium / vending machine.</li>
          <li>Click any row to see the room's MTD split across its meters (some rooms have one meter; Comm_9 has sub-meters).</li>
          <li>Annual cost of a 500 W "ghost" load at R4.87/kWh = R21,300/year — the easiest savings in the building.</li>
        </ul>
      </div>
    </div>
  );
}

function CommunalSubmeterDrilldown({ roomId }: { roomId: string }) {
  const [data, setData] = useState<CommunalSubmeterBreakdownResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.insights
      .communalSubmeterBreakdown(roomId)
      .then((r) => !cancelled && setData(r))
      .catch((e) => !cancelled && setError(String(e)))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [roomId]);

  if (loading) {
    return <div className="rounded-md border border-neutral-800 bg-neutral-900 px-4 py-6 text-center text-sm text-neutral-400">Loading meter split…</div>;
  }
  if (error || !data) return <div className="text-sm text-red-300">{error || "no data"}</div>;
  if (data.submeters.length === 0) {
    return <div className="rounded-md border border-neutral-800 bg-neutral-900 px-4 py-4 text-center text-sm text-neutral-500">No electricity meters on this room.</div>;
  }

  return (
    <div className="rounded-md border border-neutral-800 bg-neutral-950 px-4 py-4">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h4 className="text-sm font-medium text-neutral-200">Room {data.room_number} — {data.room_name} — electricity by meter (MTD)</h4>
        <p className="text-xs text-neutral-500">
          Meter total {data.total_submeter_mtd_kwh.toFixed(0)} kWh ·{" "}
          {data.main_meter_external_id && `main meter ${data.main_meter_external_id} reads ${data.main_meter_mtd_kwh?.toFixed(0)} kWh`}
        </p>
      </div>
      <table className="w-full text-sm">
        <thead className="text-xs uppercase tracking-wider text-neutral-500">
          <tr className="border-b border-neutral-800">
            <th className="px-2 py-1.5 text-left">Meter</th>
            <th className="px-2 py-1.5 text-right">MTD kWh</th>
            <th className="px-2 py-1.5 text-right">MTD cost</th>
            <th className="px-2 py-1.5 text-left">Share of room total</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-900">
          {data.submeters.map((s) => (
            <tr key={s.external_id} className="text-neutral-200">
              <td className="px-2 py-1.5 font-medium">{s.external_id}</td>
              <td className="px-2 py-1.5 text-right tabular-nums">{s.mtd_kwh.toFixed(1)}</td>
              <td className="px-2 py-1.5 text-right tabular-nums text-neutral-300">{fmtCost(s.mtd_cost)}</td>
              <td className="px-2 py-1.5">
                <div className="flex items-center gap-2">
                  <div className="h-2 w-40 overflow-hidden rounded bg-neutral-800">
                    <div
                      className="h-full bg-amber-500"
                      style={{ width: `${Math.min(100, s.pct_of_room_total)}%` }}
                    />
                  </div>
                  <span className="text-xs tabular-nums text-neutral-400">{s.pct_of_room_total.toFixed(1)}%</span>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
