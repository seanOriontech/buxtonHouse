"use client";

import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { Card, CardHeader } from "@/components/card";
import {
  api,
  type CommunalAnomaliesResponse,
  type CommunalDailySeriesResponse,
  type CommunalRoomDetailResponse,
  type RoomAnomaly,
  type RoomDailySeries,
} from "@/lib/api";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const TREND_DAYS = 10;

function fmtCost(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return "R" + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtNumber(n: number | null | undefined, digits = 2, suffix = ""): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits }) + suffix;
}

function fmtDateLong(iso?: string | null): string {
  if (!iso) return "—";
  const d = new Date(`${iso}T00:00:00`);
  return d.toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" });
}

function Spinner({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={`animate-spin text-emerald-300 ${className}`} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" strokeWidth="4" />
      <path d="M4 12a8 8 0 0 1 8-8" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
    </svg>
  );
}

function LoadingOverlay({ active, label = "Loading…" }: { active: boolean; label?: string }) {
  if (!active) return null;
  return (
    <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-lg bg-neutral-950/50 backdrop-blur-[1px]">
      <div className="flex items-center gap-2 rounded-full border border-emerald-500/30 bg-neutral-900/90 px-3 py-1 text-sm text-emerald-300 shadow-lg">
        <Spinner /><span>{label}</span>
      </div>
    </div>
  );
}

function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-neutral-800 ${className}`} />;
}

export default function CommunalRoomDetailPage() {
  const params = useParams<{ roomId: string }>();
  const router = useRouter();
  const search = useSearchParams();
  const roomId = params.roomId;

  const todayIso = useMemo(() => {
    const d = new Date();
    const y = d.getFullYear(); const m = String(d.getMonth() + 1).padStart(2, "0"); const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }, []);
  const onParam = search.get("on") ?? todayIso;
  const [onDate, setOnDate] = useState<string>(onParam);

  const [data, setData] = useState<CommunalRoomDetailResponse | null>(null);
  const [series, setSeries] = useState<CommunalDailySeriesResponse | null>(null);
  const [anomalies, setAnomalies] = useState<CommunalAnomaliesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [seriesLoading, setSeriesLoading] = useState(true);
  const [anomaliesLoading, setAnomaliesLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!roomId) return;
    let cancelled = false;
    setLoading(true);
    setSeriesLoading(true);
    setAnomaliesLoading(true);
    setError(null);
    const onArg = onDate === todayIso ? undefined : onDate;
    api.insights
      .communalRoomDetail(roomId, onArg)
      .then((r) => !cancelled && setData(r))
      .catch((e) => !cancelled && setError(String(e)))
      .finally(() => !cancelled && setLoading(false));
    api.insights.communalDaily(TREND_DAYS, onArg)
      .then((r) => !cancelled && setSeries(r))
      .catch(() => {})
      .finally(() => !cancelled && setSeriesLoading(false));
    api.insights.communalAnomalies(14, onArg)
      .then((r) => !cancelled && setAnomalies(r))
      .catch(() => {})
      .finally(() => !cancelled && setAnomaliesLoading(false));
    return () => { cancelled = true; };
  }, [roomId, onDate, todayIso]);

  const anyLoading = loading || seriesLoading || anomaliesLoading;

  function commitDate(next: string) {
    setOnDate(next);
    const params = new URLSearchParams(search);
    if (next === todayIso) params.delete("on"); else params.set("on", next);
    router.replace(`/utilities/communal-living/${roomId}${params.toString() ? `?${params}` : ""}`);
  }

  const thisRoom: RoomDailySeries | undefined = useMemo(
    () => series?.rooms.find((r) => r.room_number === data?.room_number),
    [series, data?.room_number],
  );

  const cohortAvgByDate: Record<string, number> = useMemo(() => {
    const totals: Record<string, { sum: number; n: number }> = {};
    if (!series) return {};
    for (const r of series.rooms) {
      for (const d of r.days) {
        const e = (totals[d.date] ??= { sum: 0, n: 0 });
        e.sum += d.kwh_per_person; e.n += 1;
      }
    }
    const avg: Record<string, number> = {};
    for (const [k, v] of Object.entries(totals)) avg[k] = v.n > 0 ? v.sum / v.n : 0;
    return avg;
  }, [series]);

  const trendData = useMemo(() => {
    if (!thisRoom) return [];
    return thisRoom.days.map((d) => ({
      date: d.date.slice(5),
      elec_pp: d.kwh_per_person,
      avg_elec_pp: cohortAvgByDate[d.date] ?? 0,
    }));
  }, [thisRoom, cohortAvgByDate]);

  const anomaly: RoomAnomaly | undefined = useMemo(
    () => anomalies?.entries.find((a) => a.room_number === data?.room_number),
    [anomalies, data?.room_number],
  );

  if (!roomId) {
    return <div className="text-base text-red-300">Invalid room id.</div>;
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-5 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <Link href="/utilities/communal-living" className="text-sm text-emerald-300 hover:underline">← Back to Communal Living</Link>
            <h1 className="mt-1 flex items-center gap-2 text-2xl font-semibold tracking-tight text-neutral-100">
              {data ? `Room ${data.room_number} — ${data.room_name}` : "Communal Room — Detail"}
              {anyLoading && (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/40 bg-neutral-950/50 px-2.5 py-1 text-sm font-normal text-emerald-300">
                  <Spinner className="h-3 w-3" />
                  Fetching live data…
                </span>
              )}
            </h1>
            <p className="text-base text-neutral-300">
              Communal Living
              {data && ` · ${data.occupants} occupant${data.occupants === 1 ? "" : "s"} · ${data.room_type} · day ${data.days_elapsed_mtd} of ${data.days_in_month}`}
            </p>
          </div>
          <div className="flex items-end gap-3">
            <label className="text-sm text-neutral-400">
              <span className="block text-xs uppercase tracking-wider text-neutral-500">Select date</span>
              <input
                type="date"
                value={onDate}
                onChange={(e) => commitDate(e.target.value)}
                className="mt-1 rounded-md border border-emerald-500/40 bg-neutral-950 px-3 py-1.5 text-base text-neutral-100 focus:border-emerald-400 focus:outline-none"
              />
            </label>
            <div className="text-right text-sm text-neutral-400">
              <p className="text-xs uppercase tracking-wider text-neutral-500">Report date</p>
              <p className="text-base text-neutral-100">{fmtDateLong(data?.report_date)}</p>
            </div>
          </div>
        </div>
      </div>

      {error && <div className="rounded-md border border-red-500/30 bg-red-500/10 px-4 py-3 text-base text-red-300">{error}</div>}

      {/* Alerts */}
      {anomaliesLoading && !anomalies ? (
        <div className="relative">
          <Card>
            <CardHeader title="Active alerts" subtitle="Checking anomaly engine…" />
            <div className="space-y-2 px-5 py-4 text-base">
              <Skeleton className="h-3 w-3/4" />
              <Skeleton className="h-3 w-1/2" />
            </div>
          </Card>
          <LoadingOverlay active label="Scanning anomalies…" />
        </div>
      ) : null}
      {(data?.flags.length ?? 0) > 0 || anomaly ? (
        <Card>
          <CardHeader title="Active alerts" subtitle="Budget, spike and day-of-week flags currently triggered for this room." />
          <div className="space-y-2 px-5 py-4 text-base">
            {data?.flags.map((f) => (
              <p key={f.code} className={f.severity === "red" ? "text-red-300" : "text-amber-300"}>
                ● <span className="text-xs uppercase tracking-wider">{f.severity}</span> · {f.description}
              </p>
            ))}
            {anomaly?.spikes.map((s, i) => (
              <p key={`sp-${i}`} className={s.severity === "red" ? "text-red-300" : "text-amber-300"}>
                ● {s.severity.toUpperCase()} electricity spike — today {s.today_per_person.toFixed(2)} kWh/p vs your 14-day median {s.baseline_median.toFixed(2)} (robust Z = {s.robust_z.toFixed(2)})
              </p>
            ))}
            {anomaly?.dow.map((d, i) => (
              <p key={`dow-${i}`} className={d.severity === "red" ? "text-red-300" : "text-amber-300"}>
                ● {d.severity.toUpperCase()} {d.day_name} pattern — today {d.today_per_person.toFixed(2)} kWh/p vs typical {d.day_name} {d.dow_median_per_person.toFixed(2)} (×{d.ratio.toFixed(1)})
              </p>
            ))}
          </div>
        </Card>
      ) : null}

      {/* Top row — Occupants + Utilities Overview + Electricity card */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="relative space-y-4">
          <Card>
            <CardHeader title="No. of Occupants" />
            <div className="px-5 py-8 text-center">
              {data ? (
                <p className="text-4xl font-semibold tabular-nums text-neutral-100">{data.occupants}</p>
              ) : (
                <Skeleton className="mx-auto h-9 w-16" />
              )}
              <p className="mt-1 text-sm text-neutral-500">snapshot {data?.snapshot_date ?? "…"}</p>
            </div>
          </Card>

          <Card>
            <CardHeader title="Utilities Overview" />
            <div className="space-y-4 px-5 py-4">
              <Stat label="TOTAL ALLOWANCE FOR THE MONTH" value={data ? fmtCost(data.budget.monthly_allowance_total) : null} sub={data ? `${fmtCost(data.budget.monthly_allowance_per_person)} / person × ${data.occupants}` : undefined} />
              <Stat label="MTD UTILITIES COST" value={data ? fmtCost(data.budget.mtd_cost_total) : null} sub={data ? `${fmtCost(data.budget.mtd_cost_per_person)} / person` : undefined} />
              <Stat
                label="% OF ALLOWANCE USED"
                value={data ? `${data.budget.pct_consumed.toFixed(2)}%` : null}
                sub={data?.budget.already_over ? "Already over allowance" : data?.budget.forecast_over ? "Projected to exceed cap" : data ? "On track" : undefined}
                tone={data?.budget.already_over ? "red" : data?.budget.forecast_over ? "amber" : "emerald"}
              />
              <Stat
                label="PROJECTED DEPLETION DATE"
                value={data ? (data.budget.projected_depletion_date ? fmtDateLong(data.budget.projected_depletion_date) : "Within budget") : null}
                tone={data?.budget.projected_depletion_date ? "amber" : "emerald"}
              />
              <Stat label="PROJECTED EOM COST" value={data ? fmtCost(data.budget.projected_eom_cost) : null} sub={data ? `${fmtCost(data.budget.projected_eom_cost_per_person)} / person` : undefined} />
            </div>
          </Card>
          <LoadingOverlay active={loading} label="Loading room detail…" />
        </div>

        <div className="relative lg:col-span-2">
          <ElectricityCardView card={data?.electricity} />
          <LoadingOverlay active={loading && !data} label="Reading meter…" />
        </div>
      </div>

      {/* 10-day trend */}
      <div className="relative">
      <Card>
        <CardHeader
          title="10-day per-person electricity trend vs cohort average"
          subtitle="This room (yellow) vs the average across all communal rooms for the same day."
        />
        <div className="px-5 py-4">
          <TrendChart data={trendData} loading={seriesLoading && trendData.length === 0} />
        </div>
      </Card>
      <LoadingOverlay active={seriesLoading && trendData.length === 0} label="Computing 10-day series…" />
      </div>
    </div>
  );
}

function Stat({ label, value, sub, tone }: {
  label: string; value: string | null; sub?: string; tone?: "emerald" | "amber" | "red";
}) {
  const colour =
    tone === "red" ? "text-red-300"
      : tone === "amber" ? "text-amber-300"
      : tone === "emerald" ? "text-emerald-300"
      : "text-neutral-100";
  return (
    <div>
      <p className="text-xs uppercase tracking-wider text-neutral-500">{label}</p>
      {value === null ? <Skeleton className="my-1 h-5 w-32" /> : <p className={`text-xl font-semibold tabular-nums ${colour}`}>{value}</p>}
      {sub ? <p className="text-sm text-neutral-500">{sub}</p> : value === null ? <Skeleton className="h-3 w-24" /> : null}
    </div>
  );
}

function ElectricityCardView({ card }: { card: CommunalRoomDetailResponse["electricity"] | undefined }) {
  const value = (n: number | null | undefined, digits = 2, suffix = "") =>
    card ? fmtNumber(n, digits, suffix) : <Skeleton className="h-4 w-20" />;

  return (
    <Card>
      <CardHeader
        title={<span className="flex items-center gap-2 text-amber-300"><span>Electricity</span> <span aria-hidden>⚡</span></span>}
        subtitle={card ? `Cost per kWh: R${card.cost_per_kwh.toFixed(2)}` : "Reading tariff…"}
      />
      <div className="grid grid-cols-2 gap-3 border-y border-neutral-800 bg-amber-500/5 px-5 py-4 text-base">
        <div>
          <p className="text-xs uppercase tracking-wider text-neutral-500">Opening reading</p>
          <p className="text-lg font-semibold tabular-nums">{value(card?.opening_reading, 2)}</p>
          <p className="text-xs text-neutral-500">1st day of month, 00h01</p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wider text-neutral-500">Closing reading</p>
          <p className="text-lg font-semibold tabular-nums">{value(card?.closing_reading, 2)}</p>
          <p className="text-xs text-neutral-500">Live reading</p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 px-5 py-4 text-base">
        <div>
          <p className="text-xs uppercase tracking-wider text-neutral-500">Yesterday</p>
          <p className="text-lg font-semibold tabular-nums">{value(card?.yesterday_kwh, 2, " kWh")}</p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wider text-neutral-500">Month to date</p>
          <p className="text-lg font-semibold tabular-nums">{value(card?.mtd_kwh, 2, " kWh")}</p>
        </div>
      </div>
      <div className="border-t border-neutral-800 bg-neutral-950 px-5 py-2 text-sm text-neutral-400">
        Total cost MTD: <span className="font-medium text-neutral-100">{card ? fmtCost(card.mtd_cost) : <Skeleton className="inline-block h-3 w-16 align-middle" />}</span>
      </div>
    </Card>
  );
}

function TrendChart({
  data, loading,
}: {
  data: { date: string; elec_pp: number; avg_elec_pp: number }[];
  loading?: boolean;
}) {
  if (data.length === 0) {
    return (
      <div className="relative h-64 overflow-hidden rounded-md bg-neutral-950">
        <div className="absolute inset-0 animate-pulse bg-gradient-to-r from-neutral-900 via-neutral-800 to-neutral-900" />
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="flex items-center gap-2 rounded-full border border-emerald-500/30 bg-neutral-900/90 px-3 py-1 text-sm text-emerald-300">
              <Spinner /> <span>Loading chart…</span>
            </div>
          </div>
        )}
      </div>
    );
  }
  return (
    <div className="h-64">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 8, bottom: 8, left: 0 }}>
          <CartesianGrid stroke="#262626" strokeDasharray="2 4" />
          <XAxis dataKey="date" tick={{ fill: "#a3a3a3", fontSize: 11 }} />
          <YAxis tick={{ fill: "#a3a3a3", fontSize: 11 }} />
          <Tooltip contentStyle={{ background: "#0a0a0a", border: "1px solid #404040", fontSize: 12 }} labelStyle={{ color: "#fafafa" }} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <Line type="monotone" dataKey="elec_pp" name="This room" stroke="#f59e0b" strokeWidth={2.5} dot={{ r: 2.5 }} />
          <Line type="monotone" dataKey="avg_elec_pp" name="Cohort avg" stroke="#737373" strokeWidth={1.5} strokeDasharray="3 3" dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
