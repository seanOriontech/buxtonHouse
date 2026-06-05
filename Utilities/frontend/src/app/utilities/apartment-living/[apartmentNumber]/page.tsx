"use client";

import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { Card, CardHeader } from "@/components/card";
import { Pill } from "@/components/pill";
import {
  api,
  type ApartmentAnomaliesResponse,
  type ApartmentAnomaly,
  type ApartmentDailySeries,
  type ApartmentDetailResponse,
  type ApartmentLeakDetailResponse,
  type DailySeriesResponse,
} from "@/lib/api";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const LIVING_TYPE = "Apartment Living";
const TREND_DAYS = 10;

function fmtCost(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return "R" + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtNumber(n: number | null | undefined, digits = 0, suffix = ""): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits }) + suffix;
}

function fmtDateLong(iso?: string | null): string {
  if (!iso) return "—";
  const d = new Date(`${iso}T00:00:00`);
  return d.toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" });
}

export default function ApartmentDetailPage() {
  const params = useParams<{ apartmentNumber: string }>();
  const router = useRouter();
  const search = useSearchParams();
  const apartmentNumber = Number(params.apartmentNumber);

  // Date selector — synced with ?on= query param so links stay shareable.
  const todayIso = useMemo(() => {
    const d = new Date();
    const y = d.getFullYear(); const m = String(d.getMonth() + 1).padStart(2, "0"); const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }, []);
  const onParam = search.get("on") ?? todayIso;
  const [onDate, setOnDate] = useState<string>(onParam);

  const [data, setData] = useState<ApartmentDetailResponse | null>(null);
  const [series, setSeries] = useState<DailySeriesResponse | null>(null);
  const [leak, setLeak] = useState<ApartmentLeakDetailResponse | null>(null);
  const [anomalies, setAnomalies] = useState<ApartmentAnomaliesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [seriesLoading, setSeriesLoading] = useState(true);
  const [leakLoading, setLeakLoading] = useState(true);
  const [anomaliesLoading, setAnomaliesLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!Number.isFinite(apartmentNumber)) return;
    let cancelled = false;
    setLoading(true);
    setSeriesLoading(true);
    setLeakLoading(true);
    setAnomaliesLoading(true);
    setError(null);
    const isToday = onDate === todayIso;
    const onArg = isToday ? undefined : onDate;
    api.insights
      .apartmentDetail(apartmentNumber, LIVING_TYPE, onArg)
      .then((r) => !cancelled && setData(r))
      .catch((e) => !cancelled && setError(String(e)))
      .finally(() => !cancelled && setLoading(false));
    // Background fetches — don't gate the dashboard on them, but each tracks
    // its own loading state so the cards can show their own skeleton.
    api.insights.dailySeries(LIVING_TYPE, TREND_DAYS, onArg)
      .then((r) => !cancelled && setSeries(r))
      .catch(() => {})
      .finally(() => !cancelled && setSeriesLoading(false));
    api.insights.apartmentLeakDetail(apartmentNumber, LIVING_TYPE, 7, onArg)
      .then((r) => !cancelled && setLeak(r))
      .catch(() => {})
      .finally(() => !cancelled && setLeakLoading(false));
    api.insights.apartmentAnomalies(LIVING_TYPE, 14, onArg)
      .then((r) => !cancelled && setAnomalies(r))
      .catch(() => {})
      .finally(() => !cancelled && setAnomaliesLoading(false));
    return () => { cancelled = true; };
  }, [apartmentNumber, onDate, todayIso]);

  const anyLoading = loading || seriesLoading || leakLoading || anomaliesLoading;

  function commitDate(next: string) {
    setOnDate(next);
    const params = new URLSearchParams(search);
    if (next === todayIso) params.delete("on"); else params.set("on", next);
    router.replace(`/utilities/apartment-living/${apartmentNumber}${params.toString() ? `?${params}` : ""}`);
  }

  const cold = data?.utilities.cold_water;
  const hot  = data?.utilities.hot_water;
  const elec = data?.utilities.electricity;

  const thisApt: ApartmentDailySeries | undefined = useMemo(
    () => series?.apartments.find((a) => a.apartment_number === apartmentNumber),
    [series, apartmentNumber],
  );

  const buildingAvgByDate: Record<string, { water_pp: number; elec_pp: number }> = useMemo(() => {
    const out: Record<string, { water_pp: number; elec_pp: number; n: number }> = {};
    if (!series) return {};
    for (const a of series.apartments) {
      for (const d of a.days_per_person) {
        const e = (out[d.date] ??= { water_pp: 0, elec_pp: 0, n: 0 });
        e.water_pp += d.combined_water_litres_pp;
        e.elec_pp  += d.electricity_kwh_pp;
        e.n += 1;
      }
    }
    const avg: Record<string, { water_pp: number; elec_pp: number }> = {};
    for (const [k, v] of Object.entries(out)) avg[k] = { water_pp: v.water_pp / v.n, elec_pp: v.elec_pp / v.n };
    return avg;
  }, [series]);

  const trendData = useMemo(() => {
    if (!thisApt) return [];
    return thisApt.days_per_person.map((d) => ({
      date: d.date.slice(5),
      water_pp: d.combined_water_litres_pp,
      elec_pp: d.electricity_kwh_pp,
      avg_water_pp: buildingAvgByDate[d.date]?.water_pp ?? 0,
      avg_elec_pp: buildingAvgByDate[d.date]?.elec_pp ?? 0,
    }));
  }, [thisApt, buildingAvgByDate]);

  const anomaly: ApartmentAnomaly | undefined = useMemo(
    () => anomalies?.entries.find((a) => a.apartment_number === apartmentNumber),
    [anomalies, apartmentNumber],
  );

  const heatmapGrid = useMemo(() => {
    if (!leak) return null;
    const datesAsc = Array.from(new Set(leak.cells.map((c) => c.sast_date))).sort();
    const grid: Record<string, Record<number, { cold: number; hot: number; total: number }>> = {};
    for (const c of leak.cells) {
      (grid[c.sast_date] ??= {})[c.sast_hour] = { cold: c.cold_litres, hot: c.hot_litres, total: c.total_litres };
    }
    const max = Math.max(0.1, ...leak.cells.map((c) => c.total_litres));
    return { datesAsc, grid, max };
  }, [leak]);

  if (!Number.isFinite(apartmentNumber)) {
    return <div className="text-base text-red-300">Invalid apartment number.</div>;
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-5 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <Link href="/utilities/apartment-living" className="text-sm text-emerald-300 hover:underline">← Back to Apartment Living</Link>
            <h1 className="mt-1 flex items-center gap-2 text-2xl font-semibold tracking-tight text-neutral-100">
              Apartment {apartmentNumber} — Detail
              {anyLoading && (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/40 bg-neutral-950/50 px-2.5 py-1 text-xs font-normal text-emerald-300">
                  <Spinner className="h-3 w-3" />
                  Fetching live data…
                </span>
              )}
            </h1>
            <p className="text-base text-neutral-300">{LIVING_TYPE}{data && ` · ${data.occupants} occupant${data.occupants === 1 ? "" : "s"} · day ${data.days_elapsed_mtd} of ${data.days_in_month}`}</p>
          </div>
          <div className="flex items-end gap-3">
            <label className="text-sm text-neutral-400">
              <span className="block uppercase tracking-wider text-xs text-neutral-500">Select date</span>
              <input
                type="date"
                value={onDate}
                onChange={(e) => commitDate(e.target.value)}
                className="mt-1 rounded-md border border-emerald-500/40 bg-neutral-950 px-3 py-1.5 text-base text-neutral-100 focus:border-emerald-400 focus:outline-none"
              />
            </label>
            <div className="text-right text-sm text-neutral-400">
              <p className="uppercase tracking-wider text-xs text-neutral-500">Report date</p>
              <p className="text-base text-neutral-100">{fmtDateLong(data?.report_date)}</p>
            </div>
          </div>
        </div>
      </div>

      {error && <div className="rounded-md border border-red-500/30 bg-red-500/10 px-4 py-3 text-base text-red-300">{error}</div>}

      {/* Alerts — show placeholder while anomalies endpoint is in flight */}
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
          <CardHeader title="Active alerts" subtitle="Budget, spike and leak flags currently triggered for this apartment." />
          <div className="space-y-2 px-5 py-4 text-base">
            {data?.flags.map((f) => (
              <p key={f.code} className={f.severity === "red" ? "text-red-300" : "text-amber-300"}>
                ● <span className="uppercase tracking-wider text-xs">{f.severity}</span> · {f.description}
              </p>
            ))}
            {anomaly?.spikes.map((s, i) => (
              <p key={`sp-${i}`} className={s.severity === "red" ? "text-red-300" : "text-amber-300"}>
                ● {s.severity.toUpperCase()} {s.utility.replace("_", " ")} spike — today {s.today_per_person.toFixed(2)} per person vs your 14-day median {s.baseline_median.toFixed(2)} (robust Z = {s.robust_z.toFixed(2)})
              </p>
            ))}
            {anomaly?.leak && (
              <p className={anomaly.leak.severity === "red" ? "text-red-300" : "text-amber-300"}>
                ● {anomaly.leak.severity.toUpperCase()} water leak — avg {anomaly.leak.avg_overnight_litres.toFixed(1)} ℓ/night between 02:00–05:00 SAST, {anomaly.leak.nights_over_threshold}/{7} nights over {anomaly.leak.threshold_litres} ℓ (consecutive: {anomaly.leak.consecutive_nights})
              </p>
            )}
            {anomaly?.dow.map((d, i) => (
              <p key={`dow-${i}`} className={d.severity === "red" ? "text-red-300" : "text-amber-300"}>
                ● {d.severity.toUpperCase()} {d.day_name} pattern — {d.utility.replace("_", " ")} today {d.today_per_person.toFixed(2)} vs typical {d.day_name} {d.dow_median_per_person.toFixed(2)} (×{d.ratio.toFixed(1)})
              </p>
            ))}
          </div>
        </Card>
      ) : null}

      {/* Top row — Occupants, Utilities Overview, Utility cards */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-4">
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
          <LoadingOverlay active={loading} label="Loading apartment detail…" />
        </div>

        <div className="relative"><UtilityCardView title="Cold Water" emoji="💧" tone="sky" card={cold} unitsSuffix=" ℓ" displayDigits={0} />
          <LoadingOverlay active={loading && !cold} label="Reading meter…" />
        </div>
        <div className="relative"><UtilityCardView title="Hot Water"  emoji="🔥" tone="rose" card={hot}  unitsSuffix=" ℓ" displayDigits={0} />
          <LoadingOverlay active={loading && !hot}  label="Reading meter…" />
        </div>
        <div className="relative"><UtilityCardView title="Electricity" emoji="⚡" tone="amber" card={elec} unitsSuffix=" kWh" displayDigits={2} />
          <LoadingOverlay active={loading && !elec} label="Reading meter…" />
        </div>
      </div>

      {/* Per-bedroom electricity table */}
      <div className="relative">
      <Card>
        <CardHeader
          title="Individual electricity meters — by bedroom"
          subtitle="Does not include electricity consumed in common areas. % share is across the bedrooms only."
        />
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-neutral-950 text-xs uppercase tracking-wider text-neutral-500">
              <tr className="border-b border-neutral-800">
                <th className="px-3 py-2 text-left" rowSpan={2}>Room</th>
                <th className="px-3 py-2 text-left" rowSpan={2}>Meter</th>
                <th className="px-3 py-2 text-right" rowSpan={2}>Opening</th>
                <th className="px-3 py-2 text-right" rowSpan={2}>Current</th>
                <th className="px-3 py-2 text-center border-l border-neutral-800" colSpan={3}>Month to date</th>
                <th className="px-3 py-2 text-center border-l border-neutral-800" colSpan={3}>Today so far</th>
              </tr>
              <tr className="border-b border-neutral-800 text-xs uppercase tracking-wider text-neutral-500">
                <th className="px-3 py-1.5 text-right border-l border-neutral-800">kWh</th>
                <th className="px-3 py-1.5 text-right">Cost</th>
                <th className="px-3 py-1.5 text-right">% of apt</th>
                <th className="px-3 py-1.5 text-right border-l border-neutral-800">kWh</th>
                <th className="px-3 py-1.5 text-right">Cost</th>
                <th className="px-3 py-1.5 text-right">% of apt</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-900">
              {!data && loading && (
                Array.from({ length: 3 }).map((_, i) => (
                  <tr key={`sk-${i}`}>
                    {Array.from({ length: 10 }).map((__, c) => (
                      <td key={c} className="px-3 py-2"><Skeleton className="h-3 w-full" /></td>
                    ))}
                  </tr>
                ))
              )}
              {(data?.bedrooms ?? []).map((b) => (
                <tr key={b.external_id} className="text-neutral-200 hover:bg-neutral-900/50">
                  <td className="px-3 py-2 font-medium">{b.room_name}</td>
                  <td className="px-3 py-2 text-neutral-400">{b.external_id}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{b.opening_reading.toFixed(2)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{b.current_reading.toFixed(2)}</td>
                  <td className="px-3 py-2 text-right tabular-nums border-l border-neutral-800">{b.mtd_kwh.toFixed(2)} kWh</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtCost(b.mtd_cost)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{b.mtd_pct.toFixed(1)}%</td>
                  <td className="px-3 py-2 text-right tabular-nums border-l border-neutral-800">{b.today_kwh.toFixed(2)} kWh</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtCost(b.today_cost)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{b.today_pct.toFixed(1)}%</td>
                </tr>
              ))}
              {data && data.bedrooms.length === 0 && (
                <tr><td colSpan={10} className="px-3 py-6 text-center text-neutral-500">No bedroom sub-meters wired up for this apartment.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
      <LoadingOverlay active={loading} label="Aggregating sub-meters…" />
      </div>

      {/* Per-bedroom electricity — ranked bar chart (who's using the most) */}
      {(loading || (data?.bedrooms.length ?? 0) > 0) && (
        <div className="relative">
        <Card>
          <CardHeader
            title="Who's using the most — electricity by bedroom"
            subtitle="Bedrooms ranked by consumption. The heaviest user is highlighted."
          />
          <BedroomUsageChart bedrooms={data?.bedrooms ?? []} loading={loading} />
        </Card>
        </div>
      )}

      {/* 10-day trend */}
      <div className="relative">
      <Card>
        <CardHeader
          title="10-day per-person trend vs building average"
          subtitle="Apartment lines vs the cohort average for the same day. Diverging green/amber up = trending heavy."
        />
        <div className="grid grid-cols-1 gap-4 px-5 py-4 lg:grid-cols-2">
          <TrendChart title="Combined water (ℓ / person)" dataKey="water_pp" avgKey="avg_water_pp" colour="#0ea5e9" data={trendData} loading={seriesLoading && trendData.length === 0} />
          <TrendChart title="Electricity (kWh / person)" dataKey="elec_pp" avgKey="avg_elec_pp" colour="#f59e0b" data={trendData} loading={seriesLoading && trendData.length === 0} />
        </div>
      </Card>
      <LoadingOverlay active={seriesLoading && trendData.length === 0} label="Computing 10-day series…" />
      </div>

      {/* Water heatmap */}
      <div className="relative">
      <Card>
        <CardHeader
          title="Hourly water usage — last 7 days"
          subtitle="Each cell = total litres (cold + hot) drawn in that hour, SAST. Sustained flow at 02:00–05:00 is the leak signal."
        />
        {heatmapGrid ? (
          <div className="overflow-x-auto px-5 py-4">
            <table className="text-xs">
              <thead>
                <tr>
                  <th className="px-2 py-1 text-left text-neutral-500">Date</th>
                  {Array.from({ length: 24 }, (_, h) => (
                    <th key={h} className="px-1 py-1 text-center font-normal text-neutral-500">{String(h).padStart(2, "0")}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {heatmapGrid.datesAsc.map((d) => (
                  <tr key={d}>
                    <td className="px-2 py-0.5 whitespace-nowrap text-neutral-400">{d}</td>
                    {Array.from({ length: 24 }, (_, h) => {
                      const cell = heatmapGrid.grid[d]?.[h];
                      const v = cell?.total ?? 0;
                      const intensity = Math.min(1, v / heatmapGrid.max);
                      const bg = v > 0 ? `rgba(14,165,233,${0.15 + intensity * 0.75})` : "rgb(23,23,23)";
                      const night = h >= 2 && h < 5;
                      const border = night && v > (leak?.leak_threshold_litres ?? 5) / 3 ? "1px solid rgba(239,68,68,0.8)" : "1px solid rgb(38,38,38)";
                      return (
                        <td
                          key={h}
                          title={`${d} ${String(h).padStart(2,"0")}:00 — ${v.toFixed(1)} ℓ (cold ${cell?.cold.toFixed(1) ?? 0} ℓ, hot ${cell?.hot.toFixed(1) ?? 0} ℓ)`}
                          style={{ background: bg, border }}
                          className="h-5 w-6 text-center tabular-nums text-neutral-100"
                        >
                          {v >= 10 ? Math.round(v) : ""}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-3 text-sm text-neutral-500">
              Red-outlined cells in the 02:00–05:00 SAST band exceed the leak threshold ({(leak?.leak_threshold_litres ?? 5).toFixed(0)} ℓ ÷ 3 h ≈ {((leak?.leak_threshold_litres ?? 5) / 3).toFixed(1)} ℓ/h).
            </p>
          </div>
        ) : (
          <div className="space-y-2 px-5 py-4">
            <div className="flex items-center gap-2 text-sm text-neutral-400">
              <Spinner className="h-3.5 w-3.5" />
              <span>Pulling 7 × 24 hourly water cells from Influx…</span>
            </div>
            <Skeleton className="h-6 w-full" />
            <Skeleton className="h-6 w-full" />
            <Skeleton className="h-6 w-full" />
            <Skeleton className="h-6 w-3/4" />
          </div>
        )}
      </Card>
      <LoadingOverlay active={leakLoading && !heatmapGrid} label="Loading hourly water grid…" />
      </div>
    </div>
  );
}

function Spinner({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg
      className={`animate-spin text-emerald-300 ${className}`}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" strokeWidth="4" />
      <path d="M4 12a8 8 0 0 1 8-8" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
    </svg>
  );
}

/** Translucent backdrop with a spinner — overlays a Card while its data is
 * being refreshed. Children render underneath at reduced opacity so the user
 * sees the previous values being replaced rather than the layout collapsing. */
function LoadingOverlay({ active, label = "Loading…" }: { active: boolean; label?: string }) {
  if (!active) return null;
  return (
    <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-lg bg-neutral-950/50 backdrop-blur-[1px]">
      <div className="flex items-center gap-2 rounded-full border border-emerald-500/30 bg-neutral-900/90 px-3 py-1 text-xs text-emerald-300 shadow-lg">
        <Spinner />
        <span>{label}</span>
      </div>
    </div>
  );
}

/** Pulsing skeleton block — used in place of values until first data arrives. */
function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-neutral-800 ${className}`} />;
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
      {value === null ? (
        <Skeleton className="my-1 h-5 w-32" />
      ) : (
        <p className={`text-lg font-semibold tabular-nums ${colour}`}>{value}</p>
      )}
      {sub ? (
        <p className="text-xs text-neutral-500">{sub}</p>
      ) : value === null ? (
        <Skeleton className="h-3 w-24" />
      ) : null}
    </div>
  );
}

function UtilityCardView({
  title, emoji, tone, card, unitsSuffix, displayDigits,
}: {
  title: string;
  emoji: string;
  tone: "sky" | "rose" | "amber";
  card: ApartmentDetailResponse["utilities"][string] | undefined;
  unitsSuffix: string;
  displayDigits: number;
}) {
  const ringTone =
    tone === "sky"   ? "border-sky-500/30 bg-sky-500/5"
    : tone === "rose" ? "border-rose-500/30 bg-rose-500/5"
    :                   "border-amber-500/30 bg-amber-500/5";
  const accent =
    tone === "sky"   ? "text-sky-300"
    : tone === "rose" ? "text-rose-300"
    :                   "text-amber-300";

  function value(n: number | null | undefined, digits: number, suffix = "") {
    return card ? fmtNumber(n, digits, suffix) : <Skeleton className="h-4 w-20" />;
  }

  return (
    <Card>
      <CardHeader
        title={
          <span className={`flex items-center gap-2 ${accent}`}>
            <span>{title}</span>
            <span aria-hidden>{emoji}</span>
          </span>
        }
        subtitle={card ? `Cost per ${card.units_label}: R${card.cost_per_unit.toFixed(5)}` : "Reading tariff…"}
      />
      <div className={`grid grid-cols-2 gap-3 border-y border-neutral-800 ${ringTone} px-5 py-3 text-sm`}>
        <div>
          <p className="text-xs uppercase tracking-wider text-neutral-500">Opening reading</p>
          <p className="text-base font-semibold tabular-nums">{value(card?.opening_reading, 2)}</p>
          <p className="text-xs text-neutral-500">1st day of month, 00h01</p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wider text-neutral-500">Closing reading</p>
          <p className="text-base font-semibold tabular-nums">{value(card?.closing_reading, 2)}</p>
          <p className="text-xs text-neutral-500">Live reading</p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 px-5 py-3 text-sm">
        <div>
          <p className="text-xs uppercase tracking-wider text-neutral-500">Yesterday</p>
          <p className="text-base font-semibold tabular-nums">{value(card?.yesterday_units, displayDigits, unitsSuffix)}</p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wider text-neutral-500">Month to date</p>
          <p className="text-base font-semibold tabular-nums">{value(card?.mtd_units, displayDigits, unitsSuffix)}</p>
        </div>
      </div>
      <div className="border-t border-neutral-800 bg-neutral-950 px-5 py-2 text-sm text-neutral-400">
        Total cost MTD: <span className="font-medium text-neutral-100">{card ? fmtCost(card.mtd_cost) : <Skeleton className="inline-block h-3 w-16 align-middle" />}</span>
      </div>
    </Card>
  );
}

function BedroomUsageChart({
  bedrooms,
  loading,
}: {
  bedrooms: ApartmentDetailResponse["bedrooms"];
  loading?: boolean;
}) {
  const [metric, setMetric] = useState<"mtd" | "today">("mtd");

  const chartData = useMemo(() => {
    const rows = bedrooms.map((b) => ({
      name: b.room_name,
      kwh: metric === "mtd" ? b.mtd_kwh : b.today_kwh,
      cost: metric === "mtd" ? b.mtd_cost : b.today_cost,
      pct: metric === "mtd" ? b.mtd_pct : b.today_pct,
    }));
    rows.sort((a, b) => b.kwh - a.kwh);
    return rows;
  }, [bedrooms, metric]);

  const maxKwh = chartData.length ? chartData[0].kwh : 0;
  // One row ≈ 44px; keep a sensible floor so a single bedroom still reads well.
  const height = Math.max(160, chartData.length * 44 + 48);

  return (
    <div className="px-5 py-4">
      <div className="mb-3 flex items-center justify-end gap-1">
        {([
          { k: "mtd", label: "Month to date" },
          { k: "today", label: "Today so far" },
        ] as const).map((opt) => (
          <button
            key={opt.k}
            type="button"
            onClick={() => setMetric(opt.k)}
            className={`rounded-md border px-2.5 py-1 text-xs transition-colors ${
              metric === opt.k
                ? "border-amber-500/40 bg-amber-500/10 text-amber-300"
                : "border-neutral-800 text-neutral-400 hover:border-neutral-600 hover:text-neutral-200"
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {chartData.length === 0 ? (
        <div className="relative h-40 overflow-hidden rounded-md bg-neutral-950">
          <div className="absolute inset-0 animate-pulse bg-gradient-to-r from-neutral-900 via-neutral-800 to-neutral-900" />
          {loading && (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="flex items-center gap-2 rounded-full border border-amber-500/30 bg-neutral-900/90 px-3 py-1 text-xs text-amber-300">
                <Spinner /> <span>Loading chart…</span>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div style={{ height }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} layout="vertical" margin={{ top: 4, right: 64, bottom: 4, left: 8 }}>
              <CartesianGrid stroke="#262626" strokeDasharray="2 4" horizontal={false} />
              <XAxis type="number" tick={{ fill: "#a3a3a3", fontSize: 10 }} />
              <YAxis type="category" dataKey="name" width={130} tick={{ fill: "#d4d4d4", fontSize: 11 }} />
              <Tooltip
                cursor={{ fill: "#ffffff0a" }}
                contentStyle={{ background: "#0a0a0a", border: "1px solid #404040", fontSize: 11 }}
                labelStyle={{ color: "#fafafa" }}
                formatter={(value: number, _name, item) => {
                  const p = (item?.payload ?? {}) as { cost?: number; pct?: number };
                  return [`${value.toFixed(2)} kWh · ${fmtCost(p.cost)} · ${(p.pct ?? 0).toFixed(1)}% of apt`, "Usage"];
                }}
              />
              <Bar
                dataKey="kwh"
                radius={[0, 4, 4, 0]}
                label={{ position: "right", fill: "#a3a3a3", fontSize: 10, formatter: (v: number) => `${v.toFixed(1)} kWh` }}
              >
                {chartData.map((d, i) => (
                  <Cell key={i} fill={maxKwh > 0 && d.kwh === maxKwh ? "#fbbf24" : "#b45309"} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

function TrendChart({
  title, data, dataKey, avgKey, colour, loading,
}: {
  title: string;
  data: { date: string; water_pp: number; elec_pp: number; avg_water_pp: number; avg_elec_pp: number }[];
  dataKey: "water_pp" | "elec_pp";
  avgKey: "avg_water_pp" | "avg_elec_pp";
  colour: string;
  loading?: boolean;
}) {
  if (data.length === 0) {
    return (
      <div>
        <p className="mb-2 text-sm text-neutral-400">{title}</p>
        <div className="relative h-56 overflow-hidden rounded-md bg-neutral-950">
          <div className="absolute inset-0 animate-pulse bg-gradient-to-r from-neutral-900 via-neutral-800 to-neutral-900" />
          {loading && (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="flex items-center gap-2 rounded-full border border-emerald-500/30 bg-neutral-900/90 px-3 py-1 text-xs text-emerald-300">
                <Spinner /> <span>Loading chart…</span>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }
  return (
    <div>
      <p className="mb-2 text-sm text-neutral-400">{title}</p>
      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 8, bottom: 8, left: 0 }}>
            <CartesianGrid stroke="#262626" strokeDasharray="2 4" />
            <XAxis dataKey="date" tick={{ fill: "#a3a3a3", fontSize: 10 }} />
            <YAxis tick={{ fill: "#a3a3a3", fontSize: 10 }} />
            <Tooltip contentStyle={{ background: "#0a0a0a", border: "1px solid #404040", fontSize: 11 }} labelStyle={{ color: "#fafafa" }} />
            <Legend wrapperStyle={{ fontSize: 10 }} />
            <Line type="monotone" dataKey={dataKey} name="This apartment" stroke={colour} strokeWidth={2.5} dot={{ r: 2.5 }} />
            <Line type="monotone" dataKey={avgKey}  name="Building avg"  stroke="#737373" strokeWidth={1.5} strokeDasharray="3 3" dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
