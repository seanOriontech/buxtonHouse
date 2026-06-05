"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";

import { Card, CardHeader } from "@/components/card";
import { Pill } from "@/components/pill";
import {
  api,
  type ApartmentAnomaliesResponse,
  type ApartmentAnomaly,
  type ApartmentDailySeries,
  type ApartmentInsight,
  type ApartmentLeakDetailResponse,
  type BaselineDrawResponse,
  type BaselineRow,
  type DailySeriesResponse,
  type InsightsResponse,
  type StaffQuartersResponse,
  type StaffRoom,
  type SubmeterBreakdownResponse,
  type UtilityType,
} from "@/lib/api";
import { fmtCost, fmtUnits } from "@/lib/format";
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

type TabKey = "watchlist" | "anomalies" | "sources" | "water" | "electricity";

const LIVING_TYPE = "Apartment Living";

const UTILITIES = [
  { key: "cold_water" as UtilityType,  label: "Cold water",  tone: "sky"   as const, unit: "m³" },
  { key: "hot_water"  as UtilityType,  label: "Hot water",   tone: "rose"  as const, unit: "m³" },
  { key: "electricity"as UtilityType,  label: "Electricity", tone: "amber" as const, unit: "kWh" },
];

const WATER_UTILITIES = new Set<UtilityType>(["cold_water", "hot_water"]);

type SortKey =
  | "apartment_number"
  | "occupants"
  | "risk_score"
  | "total_mtd_cost"
  | "total_eom_forecast_cost"
  | `${string}.yday_per_person`
  | `${string}.mtd_per_person`
  | `${string}.eom_per_person`
  | `${string}.percentile`;
type SortDir = "asc" | "desc";

function getSortValue(a: ApartmentInsight, k: SortKey): number {
  if (k === "apartment_number") return a.apartment_number;
  if (k === "occupants") return a.occupants;
  if (k === "risk_score") return a.risk_score;
  if (k === "total_mtd_cost") return a.total_mtd_cost;
  if (k === "total_eom_forecast_cost") return a.total_eom_forecast_cost;
  const [utility, metric] = k.split(".");
  const u = a.utilities[utility];
  if (!u) return 0;
  if (metric === "yday_per_person") return u.yesterday_units_per_person;
  if (metric === "mtd_per_person") return u.mtd_units_per_person;
  if (metric === "eom_per_person") return u.eom_forecast_units_per_person;
  if (metric === "percentile") return u.percentile_rank;
  return 0;
}

function utilityStatusTone(
  utility: UtilityType,
  u: ApartmentInsight["utilities"][string],
  combined: ApartmentInsight["combined_water"],
): "emerald" | "amber" | "red" {
  // For water utilities (cold + hot), the breach signal is the COMBINED cap,
  // not per-utility. Both cold and hot pills turn red when the combined daily
  // or projected-monthly limit is breached.
  if (WATER_UTILITIES.has(utility) && (combined.flags.over_daily || combined.flags.over_monthly)) {
    return "red";
  }
  if (u.flags.top_decile || u.flags.forecast_over_median_15x) return "amber";
  return "emerald";
}

function utilityStatusLabel(
  utility: UtilityType,
  u: ApartmentInsight["utilities"][string],
  combined: ApartmentInsight["combined_water"],
): string {
  if (WATER_UTILITIES.has(utility)) {
    if (combined.flags.over_daily && combined.flags.over_monthly) return "water over daily + monthly";
    if (combined.flags.over_daily)   return "water over daily";
    if (combined.flags.over_monthly) return "water over monthly";
  }
  if (u.flags.top_decile && u.flags.forecast_over_median_15x) return "heavy + forecast over";
  if (u.flags.top_decile) return "heavy";
  if (u.flags.forecast_over_median_15x) return "forecast over";
  return "normal";
}

function toneBg(tone: "sky" | "rose" | "amber"): string {
  return {
    sky:   "border-sky-500/30 bg-sky-500/10 text-sky-300",
    rose:  "border-rose-500/30 bg-rose-500/10 text-rose-300",
    amber: "border-amber-500/30 bg-amber-500/10 text-amber-300",
  }[tone];
}

export default function ApartmentInsightsPage() {
  const [data, setData] = useState<InsightsResponse | null>(null);
  const [staffData, setStaffData] = useState<StaffQuartersResponse | null>(null);
  const [series, setSeries] = useState<DailySeriesResponse | null>(null);
  const [seriesLoading, setSeriesLoading] = useState(false);
  const [anomalies, setAnomalies] = useState<ApartmentAnomaliesResponse | null>(null);
  const [anomaliesLoading, setAnomaliesLoading] = useState(false);
  const [baseline, setBaseline] = useState<BaselineDrawResponse | null>(null);
  const [baselineLoading, setBaselineLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [sortKey, setSortKey] = useState<SortKey>("risk_score");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [tab, setTab] = useState<TabKey>("watchlist");

  const [waterDraft, setWaterDraft] = useState<string | null>(null);
  const [savingWater, setSavingWater] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [insightsData, staffRes] = await Promise.all([
        api.insights.apartment(LIVING_TYPE),
        api.insights.staffQuarters(),
      ]);
      setData(insightsData);
      setStaffData(staffRes);

      // Daily series is slow (~15s) on the Influx free tier — fetch it in the
      // background so the Watchlist tab is interactive immediately. Trends
      // tabs show their own loading state until this resolves.
      setSeriesLoading(true);
      api.insights
        .dailySeries(LIVING_TYPE, 10)
        .then((r) => setSeries(r))
        .catch((e) => setError(String(e)))
        .finally(() => setSeriesLoading(false));

      // Anomalies endpoint is ~30 s (nightly Flux queries) — also background.
      setAnomaliesLoading(true);
      api.insights
        .apartmentAnomalies(LIVING_TYPE, 14)
        .then((r) => setAnomalies(r))
        .catch((e) => setError(String(e)))
        .finally(() => setAnomaliesLoading(false));

      // Baseline draw (~20 s — 7 nightly Flux queries)
      setBaselineLoading(true);
      api.insights
        .baselineDraw(LIVING_TYPE, 7)
        .then((r) => setBaseline(r))
        .catch((e) => setError(String(e)))
        .finally(() => setBaselineLoading(false));
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  function toggleSort(k: SortKey) {
    if (k === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(k);
      // Apt# / Occupants default asc; everything else desc (highest first)
      setSortDir(k === "apartment_number" || k === "occupants" ? "asc" : "desc");
    }
  }

  const sortedApartments = useMemo(() => {
    if (!data) return [];
    const arr = [...data.apartments];
    const dir = sortDir === "asc" ? 1 : -1;
    arr.sort((a, b) => {
      const va = getSortValue(a, sortKey);
      const vb = getSortValue(b, sortKey);
      if (va === vb) return a.apartment_number - b.apartment_number;
      return (va - vb) * dir;
    });
    return arr;
  }, [data, sortKey, sortDir]);

  const watchlist = useMemo(
    () => sortedApartments.filter((a) => a.risk_score > 0).slice(0, 10),
    [sortedApartments],
  );

  // Forecast warnings: one row per (apartment, utility) where forecast > median × 1.5
  const forecastWarnings = useMemo(() => {
    if (!data) return [];
    const out: { apt: ApartmentInsight; ut: typeof UTILITIES[number]; ratio: number }[] = [];
    for (const apt of data.apartments) {
      for (const u of UTILITIES) {
        const util = apt.utilities[u.key];
        if (!util?.flags.forecast_over_median_15x) continue;
        const ratio = util.cohort_median > 0 ? util.eom_forecast_units_per_person / util.cohort_median : 0;
        out.push({ apt, ut: u, ratio });
      }
    }
    return out.sort((a, b) => b.ratio - a.ratio);
  }, [data]);

  async function commitWaterLimit() {
    if (waterDraft === null) return;
    const raw = waterDraft.trim();
    setSavingWater(true);
    setError(null);
    try {
      const value = raw === "" ? null : Number(raw);
      if (raw !== "" && (!Number.isFinite(value as number) || (value as number) < 0)) {
        setError("Water limit must be a non-negative number");
        return;
      }
      // Fall back to a fresh living-types lookup if the insights payload
      // didn't include living_type_id (e.g. stale backend before the redeploy).
      let ltId = data?.living_type_id ?? null;
      if (!ltId) {
        const lts = await api.livingTypes.list();
        ltId = lts.find((lt) => lt.name === LIVING_TYPE)?.id ?? null;
      }
      if (!ltId) {
        setError(`Couldn't find living type "${LIVING_TYPE}" — is the backend up to date?`);
        return;
      }
      await api.livingTypes.update(ltId, { water_daily_litres_per_person: value });
      setWaterDraft(null);
      await load();
      setLastSavedAt(new Date());
    } catch (e) {
      setError(String(e));
    } finally {
      setSavingWater(false);
    }
  }

  function waterInputValue(): string {
    if (waterDraft !== null) return waterDraft;
    return data?.water_limit.daily != null ? String(data.water_limit.daily) : "";
  }

  function scheduleWaterAutoSave() {
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(() => {
      if (waterDraft !== null) commitWaterLimit();
    }, 700);
  }

  useEffect(() => {
    if (waterDraft === null) return;
    scheduleWaterAutoSave();
    return () => {
      if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waterDraft]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Apartment Insights</h1>
        <p className="text-base text-neutral-500">
          Watchlist for {LIVING_TYPE}.{" "}
          {data?.report_date && <>Report date <span className="text-neutral-300">{data.report_date}</span>.</>}{" "}
          {data && <>Day <span className="text-neutral-300">{data.days_elapsed_mtd}</span> of <span className="text-neutral-300">{data.days_in_month}</span>.</>}{" "}
          {data && <>Cohort N = <span className="text-neutral-300">{data.apartments.length}</span>.</>}
        </p>
        {data && (
          <div className="mt-3 flex flex-wrap gap-2 text-sm">
            {UTILITIES.map((u) => {
              const cs = data.cohort_stats[u.key];
              if (!cs) return null;
              return (
                <span key={u.key} className={`rounded-md border px-2.5 py-1 ${toneBg(u.tone)}`}>
                  {u.label} · median {fmtUnits(cs.median, u.key === "electricity" ? "kWh" : "litre")} · P90 {fmtUnits(cs.p90, u.key === "electricity" ? "kWh" : "litre")} per person MTD
                </span>
              );
            })}
          </div>
        )}
      </div>

      {error && (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 px-4 py-3 text-base text-red-300">
          {error}
        </div>
      )}

      {/* Tab nav */}
      <div className="flex gap-1 border-b border-neutral-800">
        {([
          { k: "watchlist",   label: "Watchlist" },
          { k: "anomalies",   label: "Anomalies" },
          { k: "sources",     label: "Sources" },
          { k: "water",       label: "Water trends" },
          { k: "electricity", label: "Electricity trends" },
        ] as { k: TabKey; label: string }[]).map((t) => {
          const active = tab === t.k;
          return (
            <button
              key={t.k}
              onClick={() => setTab(t.k)}
              className={
                "border-b-2 px-4 py-2 text-base font-medium transition-colors " +
                (active
                  ? "border-emerald-400 text-emerald-300"
                  : "border-transparent text-neutral-400 hover:text-white")
              }
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {tab === "anomalies" && (
        <AnomaliesTab data={anomalies} loading={anomaliesLoading} />
      )}
      {tab === "sources" && (
        <SourcesTab data={baseline} loading={baselineLoading} />
      )}
      {tab === "water" && (
        <WaterTrendsTab series={series} loading={seriesLoading} />
      )}
      {tab === "electricity" && (
        <ElectricityTrendsTab series={series} loading={seriesLoading} />
      )}
      {tab !== "watchlist" ? null : (<>

      {/* Combined water limit */}
      <Card>
        <CardHeader
          title="Combined water limit"
          subtitle="One daily cap on hot + cold combined, in litres per person. The monthly cap is derived as daily × days in the current month."
        />
        {/* Currently-saved values — the focal point. Input below is for editing. */}
        <div className="border-b border-neutral-800 px-5 py-4">
          {data?.water_limit.daily != null ? (
            <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
              <div>
                <p className="text-xs uppercase tracking-wider text-neutral-500">Currently saved</p>
                <p className="text-2xl font-semibold tabular-nums text-emerald-300">
                  {data.water_limit.daily} <span className="text-base font-normal text-neutral-400">ℓ / person / day</span>
                </p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wider text-neutral-500">Monthly equivalent</p>
                <p className="text-base font-medium tabular-nums text-neutral-200">
                  {data.water_limit.monthly?.toLocaleString()} <span className="text-sm text-neutral-500">ℓ / person · {data.days_in_month} days</span>
                </p>
              </div>
            </div>
          ) : (
            <p className="text-base text-neutral-500">
              {loading ? "Loading current limit…" : "No daily limit set yet — enter one below."}
            </p>
          )}
        </div>

        {/* Editor — small, secondary. */}
        <div className="flex flex-wrap items-end gap-4 px-5 py-4">
          <label className="flex flex-col gap-1.5">
            <span className="text-xs uppercase tracking-wider text-neutral-500">Update daily cap</span>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min="0"
                step="any"
                value={waterInputValue()}
                onChange={(e) => setWaterDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    if (waterDraft !== null) commitWaterLimit();
                  } else if (e.key === "Escape") {
                    setWaterDraft(null);
                    e.currentTarget.blur();
                  }
                }}
                disabled={savingWater}
                placeholder={data?.water_limit.daily != null ? String(data.water_limit.daily) : "—"}
                className="w-24 rounded-md border border-neutral-700 bg-neutral-950 px-2 py-1 text-right text-base tabular-nums text-neutral-100 focus:border-emerald-500 focus:outline-none disabled:opacity-40"
              />
              <span className="text-sm text-neutral-400">ℓ / person / day</span>
              <button
                type="button"
                onClick={() => waterDraft !== null && commitWaterLimit()}
                disabled={savingWater || waterDraft === null}
                className="rounded-md bg-emerald-500 px-3 py-1 text-sm font-medium text-neutral-950 hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {savingWater ? "Saving…" : "Save"}
              </button>
              {lastSavedAt && !savingWater && (
                <span className="text-xs text-emerald-300">
                  ✓ Saved {lastSavedAt.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                </span>
              )}
            </div>
          </label>

          <div className="flex flex-col gap-1.5">
            <span className="text-xs uppercase tracking-wider text-neutral-500">Monthly (auto)</span>
            <div className="flex items-center gap-2 rounded-md border border-neutral-800 bg-neutral-950 px-3 py-1.5">
              <span className="text-base tabular-nums text-neutral-200">
                {data?.water_limit.monthly != null
                  ? `${data.water_limit.monthly.toLocaleString()} ℓ`
                  : "—"}
              </span>
              {data && data.water_limit.daily != null && (
                <span className="text-xs text-neutral-500">
                  = {data.water_limit.daily} × {data.days_in_month} days
                </span>
              )}
            </div>
          </div>

          <p className="ml-auto max-w-md text-sm text-neutral-500">
            Save on blur or Enter. Clear the input to disable the cap. The same limit applies to every apartment in Apartment Living.
          </p>
        </div>
      </Card>

      {/* Watchlist */}
      <Card>
        <CardHeader
          title={`Watchlist (top ${watchlist.length})`}
          subtitle="Sorted by composite risk score: percentile rank + forecast over peer median + allowance breach. Click any column to re-sort."
        />
        {loading ? (
          <div className="h-40 animate-pulse rounded-b-lg bg-neutral-900" />
        ) : watchlist.length === 0 ? (
          <p className="px-5 py-10 text-center text-base text-neutral-500">
            No flagged apartments — every apartment is below the peer median × 1.5 forecast threshold and outside the top decile.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1100px] text-sm">
              <thead className="bg-neutral-950 text-xs uppercase tracking-wider text-neutral-500">
                <tr className="border-b border-neutral-800">
                  <th rowSpan={2} className="px-3 py-2 text-left">
                    <SortBtn current={sortKey} dir={sortDir} k="apartment_number" toggle={toggleSort} align="start">Apt</SortBtn>
                  </th>
                  <th rowSpan={2} className="px-3 py-2 text-left">
                    <SortBtn current={sortKey} dir={sortDir} k="occupants" toggle={toggleSort} align="start">Occ</SortBtn>
                  </th>
                  {UTILITIES.map((u) => (
                    <th
                      key={u.key}
                      colSpan={4}
                      className={`border-l border-neutral-800 border-b px-2 py-2 text-center ${toneBg(u.tone)}`}
                    >
                      {u.label}
                    </th>
                  ))}
                  <th rowSpan={2} className="border-l border-neutral-800 bg-emerald-950/30 px-3 py-2 text-right text-emerald-300">
                    <SortBtn current={sortKey} dir={sortDir} k="total_eom_forecast_cost" toggle={toggleSort}>EOM forecast</SortBtn>
                  </th>
                  <th rowSpan={2} className="border-l border-neutral-800 bg-emerald-950/30 px-3 py-2 text-right text-emerald-300">
                    <SortBtn current={sortKey} dir={sortDir} k="risk_score" toggle={toggleSort}>Risk</SortBtn>
                  </th>
                </tr>
                <tr className="border-b border-neutral-800 text-neutral-500">
                  {UTILITIES.flatMap((u) => [
                    <th key={`${u.key}-yday`} className="border-l border-neutral-800 px-2 py-1.5 text-right font-normal">
                      <SortBtn current={sortKey} dir={sortDir} k={`${u.key}.yday_per_person`} toggle={toggleSort}>Yday/p</SortBtn>
                    </th>,
                    <th key={`${u.key}-mtd`} className="px-2 py-1.5 text-right font-normal">
                      <SortBtn current={sortKey} dir={sortDir} k={`${u.key}.mtd_per_person`} toggle={toggleSort}>MTD/p</SortBtn>
                    </th>,
                    <th key={`${u.key}-eom`} className="px-2 py-1.5 text-right font-normal">
                      <SortBtn current={sortKey} dir={sortDir} k={`${u.key}.eom_per_person`} toggle={toggleSort}>EOM/p</SortBtn>
                    </th>,
                    <th key={`${u.key}-pct`} className="px-2 py-1.5 text-right font-normal">
                      <SortBtn current={sortKey} dir={sortDir} k={`${u.key}.percentile`} toggle={toggleSort}>Status</SortBtn>
                    </th>,
                  ])}
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-900">
                {watchlist.map((apt, i) => (
                  <ApartmentWatchlistRow key={apt.apartment_number} apt={apt} striped={i % 2 === 1} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Forecast warnings */}
      {forecastWarnings.length > 0 && (
        <Card>
          <CardHeader
            title={`End-of-month forecast warnings (${forecastWarnings.length})`}
            subtitle="Apartments where the projected per-person consumption exceeds the cohort median by more than 1.5×."
          />
          <table className="w-full text-sm">
            <thead className="bg-neutral-950 text-xs uppercase tracking-wider text-neutral-500">
              <tr className="border-b border-neutral-800">
                <th className="px-3 py-2 text-left">Apt</th>
                <th className="px-3 py-2 text-left">Occ</th>
                <th className="px-3 py-2 text-left">Utility</th>
                <th className="px-3 py-2 text-right">Forecast (per person)</th>
                <th className="px-3 py-2 text-right">Cohort median</th>
                <th className="px-3 py-2 text-right">Ratio</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-900">
              {forecastWarnings.map((w, i) => {
                const util = w.apt.utilities[w.ut.key];
                const unitLabel = w.ut.key === "electricity" ? "kWh" : "litre";
                return (
                  <tr key={`${w.apt.apartment_number}-${w.ut.key}`} className={i % 2 === 1 ? "bg-neutral-900/40" : ""}>
                    <td className="px-3 py-2 font-medium">{w.apt.apartment_number}</td>
                    <td className="px-3 py-2 tabular-nums">{w.apt.occupants}</td>
                    <td className="px-3 py-2">
                      <span className={`inline-flex rounded-md border px-2 py-0.5 ${toneBg(w.ut.tone)}`}>
                        {w.ut.label}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtUnits(util.eom_forecast_units_per_person, unitLabel, { perPerson: true })}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-neutral-400">{fmtUnits(util.cohort_median, unitLabel, { perPerson: true })}</td>
                    <td className="px-3 py-2 text-right tabular-nums font-medium text-amber-300">×{w.ratio.toFixed(2)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}

      {/* Staff Quarters */}
      {staffData && staffData.rooms.length > 0 && (
        <Card>
          <CardHeader
            title={`Staff Quarters (${staffData.rooms.length})`}
            subtitle="Tracked separately so staff use doesn't skew the student cohort percentiles. No allowance flags applied here."
          />
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-neutral-950 text-xs uppercase tracking-wider text-neutral-500">
                <tr className="border-b border-neutral-800">
                  <th rowSpan={2} className="px-3 py-2 text-left">Room</th>
                  <th rowSpan={2} className="px-3 py-2 text-left">Occ</th>
                  {UTILITIES.map((u) => (
                    <th key={u.key} colSpan={2} className={`border-l border-neutral-800 border-b px-2 py-2 text-center ${toneBg(u.tone)}`}>
                      {u.label}
                    </th>
                  ))}
                  <th rowSpan={2} className="border-l border-neutral-800 bg-emerald-950/30 px-3 py-2 text-right text-emerald-300">Yday cost</th>
                  <th rowSpan={2} className="border-l border-neutral-800 bg-emerald-950/30 px-3 py-2 text-right text-emerald-300">MTD cost</th>
                </tr>
                <tr className="border-b border-neutral-800 text-neutral-500">
                  {UTILITIES.flatMap((u) => [
                    <th key={`${u.key}-yday`} className="border-l border-neutral-800 px-2 py-1.5 text-right font-normal">Yesterday</th>,
                    <th key={`${u.key}-mtd`}  className="px-2 py-1.5 text-right font-normal">Month to date</th>,
                  ])}
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-900">
                {staffData.rooms.map((room, i) => (
                  <StaffRoomRow key={room.room_id} room={room} striped={i % 2 === 1} />
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Caveats */}
      {data?.caveats && data.caveats.length > 0 && (
        <div className="rounded-lg border border-neutral-800 bg-neutral-950 px-5 py-3 text-sm text-neutral-500">
          <p className="mb-1 font-medium text-neutral-400">Methodology notes</p>
          <ul className="list-inside list-disc space-y-0.5">
            {data.caveats.map((c, i) => <li key={i}>{c}</li>)}
          </ul>
        </div>
      )}
      </>)}
    </div>
  );
}

function SortBtn({
  current, dir, k, toggle, align = "end", children,
}: {
  current: SortKey;
  dir: SortDir;
  k: SortKey;
  toggle: (k: SortKey) => void;
  align?: "start" | "end";
  children: React.ReactNode;
}) {
  const active = current === k;
  const arrow = active ? (dir === "asc" ? " ▲" : " ▼") : "";
  return (
    <button
      type="button"
      onClick={() => toggle(k)}
      className={`inline-flex w-full items-center gap-0.5 hover:text-white ${align === "start" ? "justify-start" : "justify-end"} ${active ? "text-emerald-300" : ""}`}
    >
      <span>{children}</span>
      <span className="text-xs">{arrow}</span>
    </button>
  );
}

function StaffRoomRow({ room, striped }: { room: StaffRoom; striped: boolean }) {
  const rowBg = striped ? "bg-neutral-900/40" : "";
  return (
    <tr className={`text-neutral-200 hover:bg-neutral-900/70 ${rowBg}`}>
      <td className="whitespace-nowrap px-3 py-2 font-medium">
        {room.name}
        {room.notes && <span className="ml-2 text-xs text-neutral-500">{room.notes}</span>}
      </td>
      <td className="whitespace-nowrap px-3 py-2 tabular-nums">{room.occupants}</td>
      {UTILITIES.map((u) => {
        const util = room.utilities[u.key];
        if (!util) return (
          <Fragment key={u.key}>
            <td className="border-l border-neutral-800 px-2 py-2 text-right text-neutral-600">—</td>
            <td className="px-2 py-2 text-right text-neutral-600">—</td>
          </Fragment>
        );
        return (
          <Fragment key={u.key}>
            <td className="whitespace-nowrap border-l border-neutral-800 px-2 py-2 text-right tabular-nums">
              {fmtUnits(util.yesterday_units, util.units_label)}
            </td>
            <td className="whitespace-nowrap px-2 py-2 text-right tabular-nums text-neutral-300">
              {fmtUnits(util.mtd_units, util.units_label)}
            </td>
          </Fragment>
        );
      })}
      <td className="whitespace-nowrap border-l border-neutral-800 bg-emerald-950/20 px-3 py-2 text-right tabular-nums font-medium">
        {fmtCost(room.total_yesterday_cost)}
      </td>
      <td className="whitespace-nowrap border-l border-neutral-800 bg-emerald-950/20 px-3 py-2 text-right tabular-nums font-medium">
        {fmtCost(room.total_mtd_cost)}
      </td>
    </tr>
  );
}

function ApartmentWatchlistRow({ apt, striped }: { apt: ApartmentInsight; striped: boolean }) {
  const rowBg = striped ? "bg-neutral-900/40" : "";

  return (
    <tr className={`text-neutral-200 hover:bg-neutral-900/70 ${rowBg}`}>
      <td className="whitespace-nowrap px-3 py-2 font-medium">{apt.apartment_number}</td>
      <td className="whitespace-nowrap px-3 py-2 tabular-nums">{apt.occupants}</td>
      {UTILITIES.map((u) => {
        const util = apt.utilities[u.key];
        if (!util) return (
          <Fragment key={u.key}>
            <td className="border-l border-neutral-800 px-2 py-2 text-right text-neutral-600">—</td>
            <td className="px-2 py-2 text-right text-neutral-600">—</td>
            <td className="px-2 py-2 text-right text-neutral-600">—</td>
            <td className="px-2 py-2 text-right text-neutral-600">—</td>
          </Fragment>
        );
        const unitLabel = u.key === "electricity" ? "kWh" : "litre";
        const tone = utilityStatusTone(u.key, util, apt.combined_water);
        const label = utilityStatusLabel(u.key, util, apt.combined_water);
        return (
          <Fragment key={u.key}>
            <td className="whitespace-nowrap border-l border-neutral-800 px-2 py-2 text-right tabular-nums">
              {fmtUnits(util.yesterday_units_per_person, unitLabel, { perPerson: true })}
            </td>
            <td className="whitespace-nowrap px-2 py-2 text-right tabular-nums">
              {fmtUnits(util.mtd_units_per_person, unitLabel, { perPerson: true })}
            </td>
            <td className="whitespace-nowrap px-2 py-2 text-right tabular-nums text-neutral-300">
              {fmtUnits(util.eom_forecast_units_per_person, unitLabel, { perPerson: true })}
            </td>
            <td className="whitespace-nowrap px-2 py-2 text-right">
              <Pill tone={tone}>{label} · P{Math.round(util.percentile_rank)}</Pill>
            </td>
          </Fragment>
        );
      })}
      <td className="whitespace-nowrap border-l border-neutral-800 bg-emerald-950/20 px-3 py-2 text-right tabular-nums font-medium">
        {fmtCost(apt.total_eom_forecast_cost)}
      </td>
      <td className="whitespace-nowrap border-l border-neutral-800 bg-emerald-950/20 px-3 py-2 text-right tabular-nums font-medium text-emerald-300">
        {apt.risk_score.toFixed(2)}
      </td>
    </tr>
  );
}

/* -------------------------------------------------------------------------- */
/*  Trends tabs                                                               */
/* -------------------------------------------------------------------------- */

type TrendRow = {
  apartment_number: number;
  occupants: number;
  yesterday: number;
  day_before: number;
  consistency: number;  // days_over_water_limit or days_in_top_decile_electricity
};

type WaterTrendRow = TrendRow & {
  cold_yday: number;
  hot_yday: number;
  total_yday: number;
  cold_dayBefore: number;
  hot_dayBefore: number;
  total_dayBefore: number;
};

function buildTrendRows(
  apartments: ApartmentDailySeries[],
  picker: (d: ApartmentDailySeries["days_per_person"][number]) => number,
  consistency: (a: ApartmentDailySeries) => number,
): TrendRow[] {
  return apartments
    .map((a) => {
      const dpp = a.days_per_person;
      const yesterday  = dpp.length >= 1 ? picker(dpp[dpp.length - 1]) : 0;
      const day_before = dpp.length >= 2 ? picker(dpp[dpp.length - 2]) : 0;
      return {
        apartment_number: a.apartment_number,
        occupants: a.occupants,
        yesterday,
        day_before,
        consistency: consistency(a),
      };
    })
    .sort((a, b) => b.yesterday - a.yesterday);
}

function buildWaterRows(apartments: ApartmentDailySeries[]): WaterTrendRow[] {
  const zero = { cold_water_litres_pp: 0, hot_water_litres_pp: 0, combined_water_litres_pp: 0 };
  return apartments
    .map((a) => {
      const dpp = a.days_per_person;
      const yday      = dpp[dpp.length - 1] ?? zero;
      const dayBefore = dpp[dpp.length - 2] ?? zero;
      return {
        apartment_number: a.apartment_number,
        occupants: a.occupants,
        cold_yday: yday.cold_water_litres_pp,
        hot_yday:  yday.hot_water_litres_pp,
        total_yday: yday.combined_water_litres_pp,
        cold_dayBefore: dayBefore.cold_water_litres_pp,
        hot_dayBefore:  dayBefore.hot_water_litres_pp,
        total_dayBefore: dayBefore.combined_water_litres_pp,
        yesterday:  yday.combined_water_litres_pp,
        day_before: dayBefore.combined_water_litres_pp,
        consistency: a.days_over_water_limit,
      };
    })
    .sort((a, b) => b.total_yday - a.total_yday);
}

// Custom tooltip that shows cold + hot for each day plus the combined total.
function WaterTooltip({ active, label, payload }: {
  active?: boolean;
  label?: number | string;
  payload?: Array<{ dataKey: string; value: number }>;
}) {
  if (!active || !payload?.length) return null;
  const map = new Map(payload.map((p) => [p.dataKey, p.value]));
  const ydayCold = map.get("cold_yday") ?? 0;
  const ydayHot  = map.get("hot_yday")  ?? 0;
  const dbCold   = map.get("cold_dayBefore") ?? 0;
  const dbHot    = map.get("hot_dayBefore")  ?? 0;
  const ydayTotal = ydayCold + ydayHot;
  const dbTotal   = dbCold + dbHot;
  return (
    <div className="rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm shadow-lg">
      <p className="mb-1 font-medium text-neutral-100">Apartment {label}</p>
      <div className="grid grid-cols-[auto_auto_auto] gap-x-3 gap-y-0.5 tabular-nums">
        <span className="text-neutral-400">Yesterday</span>
        <span className="text-sky-300">cold {ydayCold.toFixed(1)} ℓ</span>
        <span className="text-rose-300">hot {ydayHot.toFixed(1)} ℓ</span>
        <span className="col-span-3 -mt-0.5 text-right text-emerald-300">total {ydayTotal.toFixed(1)} ℓ/p</span>

        <span className="text-neutral-400">Day before</span>
        <span className="text-sky-400/70">cold {dbCold.toFixed(1)} ℓ</span>
        <span className="text-rose-400/70">hot {dbHot.toFixed(1)} ℓ</span>
        <span className="col-span-3 -mt-0.5 text-right text-emerald-400/80">total {dbTotal.toFixed(1)} ℓ/p</span>
      </div>
    </div>
  );
}

function WaterTrendsTab({
  series, loading,
}: { series: DailySeriesResponse | null; loading: boolean }) {
  const [drillApt, setDrillApt] = useState<number | null>(null);

  // 90-day worst-offender data, loaded on demand (the Flux query takes ~60-90s
  // — too slow to auto-fetch on every page load).
  const [longSeries, setLongSeries] = useState<DailySeriesResponse | null>(null);
  const [longLoading, setLongLoading] = useState(false);
  const [longError, setLongError] = useState<string | null>(null);
  async function loadLong() {
    setLongLoading(true);
    setLongError(null);
    try {
      const r = await api.insights.dailySeries(LIVING_TYPE, 90);
      setLongSeries(r);
    } catch (e) {
      setLongError(String(e));
    } finally {
      setLongLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="rounded-lg border border-neutral-800 bg-neutral-900 px-5 py-12 text-center text-base text-neutral-400">
        Building 10-day daily series… this Flux query against Influx Cloud takes about 15 seconds.
      </div>
    );
  }
  if (!series) {
    return <div className="h-72 animate-pulse rounded-lg border border-neutral-800 bg-neutral-900" />;
  }
  const rows = buildWaterRows(series.apartments);
  const limit = series.water_daily_limit;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader
          title="Water — yesterday vs day before (per person)"
          subtitle={
            limit != null
              ? `Two stacked bars per apartment: day-before (muted) and yesterday (bright). Each bar = cold + hot. Bars crossing ${limit} ℓ get a red outline.`
              : "Two stacked bars per apartment: day-before (muted) and yesterday (bright). Each bar = cold + hot. Set a daily limit on the Watchlist tab to show a reference line."
          }
        />
        <div className="px-5 py-4">
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={rows} margin={{ top: 10, right: 16, bottom: 4, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                <XAxis dataKey="apartment_number" stroke="#a1a1aa" tickFormatter={(v) => `#${v}`} />
                <YAxis stroke="#a1a1aa" unit=" ℓ" />
                <Tooltip content={<WaterTooltip />} cursor={{ fill: "#27272a55" }} />

                {/* Day-before stack (left bar, muted colours) */}
                <Bar dataKey="cold_dayBefore" name="Cold (day before)" stackId="db" fill="#0369a1" />
                <Bar dataKey="hot_dayBefore"  name="Hot (day before)"  stackId="db" fill="#9f1239" radius={[2, 2, 0, 0]} />

                {/* Yesterday stack (right bar, bright colours; red outline when over the cap) */}
                <Bar dataKey="cold_yday" name="Cold water" stackId="yday" fill="#0ea5e9" />
                <Bar dataKey="hot_yday"  name="Hot water"  stackId="yday" fill="#f43f5e" radius={[2, 2, 0, 0]}>
                  {rows.map((r, i) => (
                    <Cell
                      key={i}
                      fill="#f43f5e"
                      stroke={limit != null && r.total_yday > limit ? "#ef4444" : "transparent"}
                      strokeWidth={limit != null && r.total_yday > limit ? 2 : 0}
                    />
                  ))}
                </Bar>

                {limit != null && (
                  <ReferenceLine
                    y={limit}
                    stroke="#ef4444"
                    strokeDasharray="6 4"
                    label={{ value: `cap ${limit} ℓ`, fill: "#ef4444", fontSize: 11, position: "right" }}
                  />
                )}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </Card>

      {drillApt != null && (
        <ApartmentWaterDrilldown
          series={series}
          apartmentNumber={drillApt}
          limit={limit}
          onClose={() => setDrillApt(null)}
        />
      )}

      <Card>
        <CardHeader
          title={`Consistently high water users — last ${series.days} days`}
          subtitle={`Click any row to see that apartment's 10-day water trend vs the building average. Count = days the apartment exceeded the daily limit${limit != null ? ` of ${limit} ℓ` : ""}.`}
        />
        {limit == null ? (
          <p className="px-5 py-8 text-base text-neutral-500">No water limit configured — set one on the Watchlist tab.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-xs uppercase tracking-wider text-neutral-500">
              <tr className="border-b border-neutral-800">
                <th className="px-3 py-2 text-left">Apt</th>
                <th className="px-3 py-2 text-left">Occ</th>
                <th className="px-3 py-2 text-right">Yday ℓ/p</th>
                <th className="px-3 py-2 text-right">Day before ℓ/p</th>
                <th className="px-3 py-2 text-right">Days over limit</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-900">
              {rows
                .slice()
                .sort((a, b) => b.consistency - a.consistency || b.yesterday - a.yesterday)
                .map((r) => {
                  const selected = drillApt === r.apartment_number;
                  return (
                    <tr
                      key={r.apartment_number}
                      onClick={() => setDrillApt(selected ? null : r.apartment_number)}
                      className={
                        "cursor-pointer text-neutral-200 transition-colors " +
                        (selected ? "bg-emerald-500/10" : "hover:bg-neutral-900/70")
                      }
                      title="Click to see this apartment's last 10 days vs building average"
                    >
                      <td className="px-3 py-2 font-medium">
                        {selected ? "▾ " : "▸ "}
                        {r.apartment_number}
                      </td>
                      <td className="px-3 py-2 tabular-nums">{r.occupants}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.yesterday.toFixed(1)} ℓ</td>
                      <td className="px-3 py-2 text-right tabular-nums text-neutral-400">{r.day_before.toFixed(1)} ℓ</td>
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
        )}
      </Card>

      {/* Long-term worst offenders — 90 days, on-demand */}
      <Card>
        <div className="flex items-center justify-between border-b border-neutral-800 px-5 py-4">
          <div>
            <h2 className="text-base font-medium text-neutral-100">Worst offenders — past 90 days</h2>
            <p className="mt-0.5 text-sm text-neutral-500">
              Ranks apartments by the number of days they exceeded the daily water cap over the last 90 days. Loads on demand; the Flux query takes about 60–90 seconds.
            </p>
          </div>
          <button
            onClick={loadLong}
            disabled={longLoading}
            className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-sm font-medium text-emerald-300 hover:bg-emerald-500/20 disabled:opacity-50"
          >
            {longLoading ? "Loading…" : longSeries ? "Refresh" : "Load 90-day ranking"}
          </button>
        </div>
        {longError && (
          <div className="mx-5 mt-4 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">{longError}</div>
        )}
        {longLoading && !longSeries && (
          <p className="px-5 py-12 text-center text-base text-neutral-400">
            Pulling 90 days of daily readings… still going.
          </p>
        )}
        {longSeries && (
          <LongTermRanking series={longSeries} limit={limit} />
        )}
      </Card>
    </div>
  );
}

function LongTermRanking({ series, limit }: { series: DailySeriesResponse; limit: number | null }) {
  const rows = series.apartments
    .map((a) => {
      const totalPp = a.days_per_person.reduce((s, d) => s + d.combined_water_litres_pp, 0);
      const avgPp = a.days_per_person.length ? totalPp / a.days_per_person.length : 0;
      return {
        apartment_number: a.apartment_number,
        occupants: a.occupants,
        days_over: a.days_over_water_limit,
        avg_pp: avgPp,
        days_window: series.days,
      };
    })
    .sort((a, b) => b.days_over - a.days_over || b.avg_pp - a.avg_pp);

  const heavyCount = rows.filter((r) => r.days_over >= series.days * 0.3).length;

  return (
    <>
      <p className="px-5 pt-4 text-sm text-neutral-500">
        Window: <span className="text-neutral-300">{series.date_range[0]}</span> →{" "}
        <span className="text-neutral-300">{series.date_range[1]}</span> ({series.days} days).{" "}
        <span className="text-red-300">{heavyCount}</span> apartments exceeded the cap on ≥ 30% of days.
      </p>
      <table className="mt-2 w-full text-sm">
        <thead className="text-xs uppercase tracking-wider text-neutral-500">
          <tr className="border-b border-neutral-800">
            <th className="px-3 py-2 text-left">Rank</th>
            <th className="px-3 py-2 text-left">Apt</th>
            <th className="px-3 py-2 text-left">Occ</th>
            <th className="px-3 py-2 text-right">Avg ℓ/p/day</th>
            <th className="px-3 py-2 text-right">Days over cap</th>
            <th className="px-3 py-2 text-right">% of window</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-900">
          {rows.map((r, i) => {
            const pct = r.days_window > 0 ? (r.days_over / r.days_window) * 100 : 0;
            const tone = pct >= 30 ? "red" : pct >= 10 ? "amber" : "emerald";
            return (
              <tr key={r.apartment_number} className="text-neutral-200">
                <td className="px-3 py-2 text-neutral-500 tabular-nums">{i + 1}</td>
                <td className="px-3 py-2 font-medium">{r.apartment_number}</td>
                <td className="px-3 py-2 tabular-nums">{r.occupants}</td>
                <td className="px-3 py-2 text-right tabular-nums">{r.avg_pp.toFixed(1)} ℓ</td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {limit != null ? <>{r.days_over} / {r.days_window}</> : <span className="text-neutral-500">—</span>}
                </td>
                <td className="px-3 py-2 text-right">
                  {limit != null ? <Pill tone={tone}>{pct.toFixed(0)}%</Pill> : <span className="text-neutral-500">—</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </>
  );
}

function ElectricityTrendsTab({
  series, loading,
}: { series: DailySeriesResponse | null; loading: boolean }) {
  if (loading) {
    return (
      <div className="rounded-lg border border-neutral-800 bg-neutral-900 px-5 py-12 text-center text-base text-neutral-400">
        Building 7-day daily series… this Flux query against Influx Cloud takes about 15 seconds.
      </div>
    );
  }
  if (!series) {
    return <div className="h-72 animate-pulse rounded-lg border border-neutral-800 bg-neutral-900" />;
  }
  const rows = buildTrendRows(
    series.apartments,
    (d) => d.electricity_kwh_pp,
    (a) => a.days_in_top_decile_electricity,
  );
  // Yesterday cohort P90 for the reference line (re-derive from rows so we don't need another payload field).
  const yesterdayValues = rows.map((r) => r.yesterday).sort((a, b) => a - b);
  const p90 = yesterdayValues.length
    ? (() => {
        const k = 0.9 * (yesterdayValues.length - 1);
        const lo = Math.floor(k);
        const hi = Math.min(lo + 1, yesterdayValues.length - 1);
        return yesterdayValues[lo] + (yesterdayValues[hi] - yesterdayValues[lo]) * (k - lo);
      })()
    : 0;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader
          title="Electricity — yesterday vs day before (per person)"
          subtitle={`kWh per person. Reference line at yesterday's cohort P90 (${p90.toFixed(2)} kWh) — apartments above are in the top decile.`}
        />
        <div className="px-5 py-4">
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={rows} margin={{ top: 10, right: 16, bottom: 4, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                <XAxis dataKey="apartment_number" stroke="#a1a1aa" tickFormatter={(v) => `#${v}`} />
                <YAxis stroke="#a1a1aa" unit=" kWh" />
                <Tooltip
                  contentStyle={{ background: "#0a0a0a", border: "1px solid #404040", borderRadius: 6 }}
                  labelStyle={{ color: "#fafafa" }}
                  labelFormatter={(v) => `Apartment ${v}`}
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

      <Card>
        <CardHeader
          title={`Consistently high electricity users — last ${series.days} days`}
          subtitle="Number of days in the window where the apartment was in the top decile (P90+) of per-person consumption. 7/7 means it's been heavy every day."
        />
        <table className="w-full text-sm">
          <thead className="text-xs uppercase tracking-wider text-neutral-500">
            <tr className="border-b border-neutral-800">
              <th className="px-3 py-2 text-left">Apt</th>
              <th className="px-3 py-2 text-left">Occ</th>
              <th className="px-3 py-2 text-right">Yday kWh/p</th>
              <th className="px-3 py-2 text-right">Day before kWh/p</th>
              <th className="px-3 py-2 text-right">Days in top decile</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-900">
            {rows
              .slice()
              .sort((a, b) => b.consistency - a.consistency || b.yesterday - a.yesterday)
              .map((r) => (
                <tr key={r.apartment_number} className="text-neutral-200">
                  <td className="px-3 py-2 font-medium">{r.apartment_number}</td>
                  <td className="px-3 py-2 tabular-nums">{r.occupants}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.yesterday.toFixed(2)} kWh</td>
                  <td className="px-3 py-2 text-right tabular-nums text-neutral-400">{r.day_before.toFixed(2)} kWh</td>
                  <td className="px-3 py-2 text-right">
                    <Pill tone={r.consistency >= series.days * 0.5 ? "red" : r.consistency > 0 ? "amber" : "emerald"}>
                      {r.consistency} / {series.days}
                    </Pill>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Drill-down: apartment vs building average over the daily-series window    */
/* -------------------------------------------------------------------------- */

function ApartmentWaterDrilldown({
  series, apartmentNumber, limit, onClose,
}: {
  series: DailySeriesResponse;
  apartmentNumber: number;
  limit: number | null;
  onClose: () => void;
}) {
  const apt = series.apartments.find((a) => a.apartment_number === apartmentNumber);
  if (!apt) return null;

  // Building average per day = mean of combined_water_litres_pp across the cohort.
  const dayLabels = apt.days_per_person.map((d) => d.date);
  const buildingAvgPerDay = dayLabels.map((day) => {
    const vals = series.apartments
      .map((a) => a.days_per_person.find((d) => d.date === day)?.combined_water_litres_pp ?? 0);
    return vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : 0;
  });

  const chartData = apt.days_per_person.map((d, i) => ({
    date: d.date,
    label: d.date.slice(5),                          // MM-DD
    apartment: d.combined_water_litres_pp,
    building_avg: buildingAvgPerDay[i],
  }));

  return (
    <Card>
      <div className="flex items-center justify-between border-b border-neutral-800 px-5 py-4">
        <div>
          <h2 className="text-base font-medium text-neutral-100">
            Apartment {apartmentNumber} — water usage, last {series.days} days
          </h2>
          <p className="mt-0.5 text-sm text-neutral-500">
            Apartment line vs cohort average for the same days. Reference line at the daily limit{limit != null ? ` (${limit} ℓ)` : ""}.
          </p>
        </div>
        <button
          onClick={onClose}
          className="rounded-md border border-neutral-700 px-2.5 py-1 text-sm text-neutral-400 hover:border-neutral-500 hover:text-white"
        >
          Close
        </button>
      </div>
      <div className="px-5 py-4">
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 10, right: 16, bottom: 4, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
              <XAxis dataKey="label" stroke="#a1a1aa" />
              <YAxis stroke="#a1a1aa" unit=" ℓ" />
              <Tooltip
                contentStyle={{ background: "#0a0a0a", border: "1px solid #404040", borderRadius: 6 }}
                labelStyle={{ color: "#fafafa" }}
                formatter={(value: number, name) => [`${value.toFixed(1)} ℓ/p`, name]}
              />
              <Legend wrapperStyle={{ fontSize: 11, color: "#a1a1aa" }} />
              <Line
                type="monotone"
                dataKey="apartment"
                name={`Apartment ${apartmentNumber}`}
                stroke="#22d3ee"
                strokeWidth={2.5}
                dot={{ r: 3, fill: "#22d3ee" }}
                activeDot={{ r: 5 }}
              />
              <Line
                type="monotone"
                dataKey="building_avg"
                name="Building average"
                stroke="#a1a1aa"
                strokeWidth={2}
                strokeDasharray="5 4"
                dot={{ r: 2, fill: "#a1a1aa" }}
              />
              {limit != null && (
                <ReferenceLine
                  y={limit}
                  stroke="#ef4444"
                  strokeDasharray="6 4"
                  label={{ value: `cap ${limit} ℓ`, fill: "#ef4444", fontSize: 11, position: "right" }}
                />
              )}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/*  Anomalies tab                                                             */
/* -------------------------------------------------------------------------- */

function AnomaliesTab({
  data, loading,
}: { data: ApartmentAnomaliesResponse | null; loading: boolean }) {
  const [drill, setDrill] = useState<number | null>(null);

  if (loading) {
    return (
      <div className="rounded-lg border border-neutral-800 bg-neutral-900 px-5 py-12 text-center text-base text-neutral-400">
        Running anomaly detection… this is ~30 s on Influx Cloud free (nightly water windows + daily series).
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
          title={`Apartments with active anomalies (${flagged.length})`}
          subtitle="Each apartment compared to its own past — spike, leak, and day-of-week deviations. Click a row for the personal trend chart."
        />
        {flagged.length === 0 ? (
          <p className="px-5 py-10 text-center text-base text-emerald-300">
            All apartments behaving normally — no spikes, leak signals, or day-of-week deviations today.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-xs uppercase tracking-wider text-neutral-500">
              <tr className="border-b border-neutral-800">
                <th className="px-3 py-2 text-left">Apt</th>
                <th className="px-3 py-2 text-left">Occ</th>
                <th className="px-3 py-2 text-left">Flags</th>
                <th className="px-3 py-2 text-right">Score</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-900">
              {flagged.map((apt) => {
                const selected = drill === apt.apartment_number;
                return (
                  <Fragment key={apt.apartment_number}>
                    <tr
                      onClick={() => setDrill(selected ? null : apt.apartment_number)}
                      className={
                        "cursor-pointer text-neutral-200 transition-colors " +
                        (selected ? "bg-emerald-500/10" : "hover:bg-neutral-900/70")
                      }
                    >
                      <td className="px-3 py-2 font-medium">{selected ? "▾ " : "▸ "}{apt.apartment_number}</td>
                      <td className="px-3 py-2 tabular-nums">{apt.occupants}</td>
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap gap-1.5">
                          {apt.spikes.map((s, i) => (
                            <Pill key={`s-${i}`} tone={s.severity}>
                              spike {s.utility} · z={s.robust_z.toFixed(1)}
                            </Pill>
                          ))}
                          {apt.leak && (
                            <Pill tone={apt.leak.severity}>
                              leak {apt.leak.consecutive_nights}n · peak {apt.leak.peak_night_litres.toFixed(0)} ℓ
                            </Pill>
                          )}
                          {apt.dow.map((d, i) => (
                            <Pill key={`d-${i}`} tone={d.severity}>
                              {d.day_name} {d.utility} ×{d.ratio.toFixed(1)}
                            </Pill>
                          ))}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums font-medium text-emerald-300">
                        {apt.anomaly_score.toFixed(2)}
                      </td>
                    </tr>
                    {selected && (
                      <tr>
                        <td colSpan={4} className="bg-neutral-950 px-5 py-4">
                          <ApartmentAnomalyDrilldown apt={apt} baselineWindowDays={data.baseline_window_days} />
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

function LeakHeatmap({ apartmentNumber }: { apartmentNumber: number }) {
  const [data, setData] = useState<ApartmentLeakDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.insights
      .apartmentLeakDetail(apartmentNumber, "Apartment Living", 7)
      .then((r) => !cancelled && setData(r))
      .catch((e) => !cancelled && setError(String(e)))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [apartmentNumber]);

  if (loading) {
    return (
      <div className="rounded-md border border-neutral-800 bg-neutral-900 px-4 py-6 text-center text-sm text-neutral-400">
        Loading hour-by-hour water flow… (~10 s)
      </div>
    );
  }
  if (error || !data) {
    return <div className="text-sm text-red-300">Couldn't load leak detail{error ? `: ${error}` : ""}</div>;
  }

  // Build a date × hour matrix from cells
  const cellMap = new Map<string, { cold: number; hot: number; total: number }>();
  for (const c of data.cells) {
    cellMap.set(`${c.sast_date}_${c.sast_hour}`, { cold: c.cold_litres, hot: c.hot_litres, total: c.total_litres });
  }
  const dates = Array.from(new Set(data.cells.map((c) => c.sast_date))).sort();
  const hours = Array.from({ length: 24 }, (_, i) => i);
  const maxTotal = Math.max(1, ...data.cells.map((c) => c.total_litres));

  function cellColor(total: number): string {
    if (total <= 0.1) return "bg-neutral-900";
    const intensity = Math.min(1, total / Math.max(5, maxTotal));
    if (total >= 5) return intensity > 0.66 ? "bg-red-500/80" : intensity > 0.33 ? "bg-red-500/60" : "bg-red-500/40";
    if (total >= 1) return "bg-amber-500/40";
    return "bg-amber-500/20";
  }

  return (
    <div className="rounded-md border border-neutral-800 bg-neutral-950 px-4 py-4">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h4 className="text-sm font-medium text-neutral-200">
          Hourly water flow — last 7 days (cold + hot, litres)
        </h4>
        <p className="text-xs text-neutral-500">
          Deep-night window {String(data.window_start_hour).padStart(2, "0")}–{String(data.window_end_hour).padStart(2, "0")} highlighted.
          Threshold {data.leak_threshold_litres} ℓ/night.
        </p>
      </div>

      <div className="overflow-x-auto">
        <table className="border-separate text-xs" style={{ borderSpacing: "1px" }}>
          <thead>
            <tr>
              <th className="px-1 py-0.5 text-right text-neutral-500">Date</th>
              {hours.map((h) => (
                <th
                  key={h}
                  className={
                    "w-7 px-0 py-0.5 text-center text-neutral-500 " +
                    (h >= data.window_start_hour && h < data.window_end_hour ? "text-amber-300" : "")
                  }
                >
                  {String(h).padStart(2, "0")}
                </th>
              ))}
              <th className="px-1 py-0.5 text-right text-neutral-500">Night ℓ</th>
            </tr>
          </thead>
          <tbody>
            {dates.map((d) => {
              const night = data.nights.find((n) => n.sast_date === d);
              return (
                <tr key={d}>
                  <td className="px-1 py-0.5 pr-2 text-right tabular-nums text-neutral-400">{d.slice(5)}</td>
                  {hours.map((h) => {
                    const c = cellMap.get(`${d}_${h}`) ?? { cold: 0, hot: 0, total: 0 };
                    const inWindow = h >= data.window_start_hour && h < data.window_end_hour;
                    return (
                      <td
                        key={h}
                        className={
                          "h-5 w-7 text-center align-middle text-xs tabular-nums " +
                          cellColor(c.total) +
                          (inWindow ? " ring-1 ring-amber-500/40" : "")
                        }
                        title={`${d} ${String(h).padStart(2,"0")}:00 SAST\ncold ${c.cold.toFixed(1)} ℓ · hot ${c.hot.toFixed(1)} ℓ · total ${c.total.toFixed(1)} ℓ`}
                      >
                        {c.total >= 5 ? c.total.toFixed(0) : ""}
                      </td>
                    );
                  })}
                  <td className={"px-1 py-0.5 pl-2 text-right tabular-nums " + (night?.over_threshold ? "font-semibold text-red-300" : "text-neutral-500")}>
                    {night ? night.total_litres_overnight.toFixed(1) : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-neutral-500">
        <span>Legend:</span>
        <span className="flex items-center gap-1"><span className="inline-block h-3 w-3 bg-neutral-900 border border-neutral-700"></span> &lt; 0.1 ℓ</span>
        <span className="flex items-center gap-1"><span className="inline-block h-3 w-3 bg-amber-500/40"></span> 1–5 ℓ</span>
        <span className="flex items-center gap-1"><span className="inline-block h-3 w-3 bg-red-500/40"></span> ≥ 5 ℓ</span>
        <span className="flex items-center gap-1"><span className="inline-block h-3 w-3 bg-red-500/80"></span> high</span>
        <span className="ml-auto">A persistent stripe in the highlighted 02–05 window is a leak signature.</span>
      </div>

      <div className="mt-3 text-xs text-neutral-400">
        <p className="mb-1 font-medium text-neutral-300">Cold vs hot — nightly window only</p>
        <div className="grid grid-cols-7 gap-2">
          {data.nights.map((n) => (
            <div key={n.sast_date} className={"rounded px-2 py-1.5 " + (n.over_threshold ? "bg-red-500/10 border border-red-500/20" : "bg-neutral-900")}>
              <p className="text-xs uppercase tracking-wider text-neutral-500">{n.sast_date.slice(5)}</p>
              <p className="text-sky-300">cold {n.cold_litres_overnight.toFixed(1)} ℓ</p>
              <p className="text-rose-300">hot {n.hot_litres_overnight.toFixed(1)} ℓ</p>
              <p className="mt-0.5 font-medium text-neutral-200">total {n.total_litres_overnight.toFixed(1)} ℓ</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ApartmentAnomalyDrilldown({ apt, baselineWindowDays }: { apt: ApartmentAnomaly; baselineWindowDays: number }) {
  const chartData = apt.daily_series.map((d) => ({
    label: d.date.slice(5),
    water: d.water_pp,
    elec: d.electricity_pp,
  }));

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <div>
        <h3 className="mb-1 text-sm font-medium uppercase tracking-wider text-neutral-400">
          Combined water (cold + hot) ℓ / person / day
        </h3>
        <div className="h-56">
          <ResponsiveContainer>
            <LineChart data={chartData} margin={{ top: 10, right: 12, bottom: 4, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
              <XAxis dataKey="label" stroke="#a1a1aa" />
              <YAxis stroke="#a1a1aa" unit=" ℓ" />
              <Tooltip
                contentStyle={{ background: "#0a0a0a", border: "1px solid #404040", borderRadius: 6 }}
                labelStyle={{ color: "#fafafa" }}
                formatter={(v: number) => `${v.toFixed(1)} ℓ/p`}
              />
              {apt.baseline_q1_water_pp != null && apt.baseline_q3_water_pp != null && (
                <ReferenceArea y1={apt.baseline_q1_water_pp} y2={apt.baseline_q3_water_pp} fill="#22d3ee" fillOpacity={0.08} />
              )}
              {apt.baseline_median_water_pp != null && (
                <ReferenceLine y={apt.baseline_median_water_pp} stroke="#22d3ee" strokeDasharray="3 3" />
              )}
              <Line type="monotone" dataKey="water" stroke="#22d3ee" strokeWidth={2.5} dot={{ r: 3, fill: "#22d3ee" }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div>
        <h3 className="mb-1 text-sm font-medium uppercase tracking-wider text-neutral-400">
          Electricity kWh / person / day
        </h3>
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
              {apt.baseline_q1_elec_pp != null && apt.baseline_q3_elec_pp != null && (
                <ReferenceArea y1={apt.baseline_q1_elec_pp} y2={apt.baseline_q3_elec_pp} fill="#f59e0b" fillOpacity={0.1} />
              )}
              {apt.baseline_median_elec_pp != null && (
                <ReferenceLine y={apt.baseline_median_elec_pp} stroke="#f59e0b" strokeDasharray="3 3" />
              )}
              <Line type="monotone" dataKey="elec" stroke="#f59e0b" strokeWidth={2.5} dot={{ r: 3, fill: "#f59e0b" }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {apt.leak && (
        <div className="col-span-full">
          <LeakHeatmap apartmentNumber={apt.apartment_number} />
        </div>
      )}

      <div className="col-span-full space-y-1 text-sm text-neutral-400">
        {apt.spikes.map((s, i) => (
          <p key={`s-${i}`}>
            <span className={s.severity === "red" ? "text-red-300" : "text-amber-300"}>● {s.severity.toUpperCase()}</span>{" "}
            {s.utility} spike — today {s.today_per_person.toFixed(1)} {s.utility === "electricity" ? "kWh" : "ℓ"} / p vs your {baselineWindowDays}-day median {s.baseline_median.toFixed(1)} (robust Z = {s.robust_z.toFixed(2)}).
          </p>
        ))}
        {apt.leak && (
          <p>
            <span className={apt.leak.severity === "red" ? "text-red-300" : "text-amber-300"}>● {apt.leak.severity.toUpperCase()}</span>{" "}
            Leak signal — {apt.leak.consecutive_nights} consecutive night{apt.leak.consecutive_nights === 1 ? "" : "s"} above {apt.leak.threshold_litres} ℓ in the 02:00–05:00 window. Peak {apt.leak.peak_night_litres.toFixed(1)} ℓ, avg {apt.leak.avg_overnight_litres.toFixed(1)} ℓ/night.
          </p>
        )}
        {apt.dow.map((d, i) => (
          <p key={`d-${i}`}>
            <span className={d.severity === "red" ? "text-red-300" : "text-amber-300"}>● {d.severity.toUpperCase()}</span>{" "}
            {d.day_name} {d.utility} — today {d.today_per_person.toFixed(2)} vs typical {d.day_name} {d.dow_median_per_person.toFixed(2)} (×{d.ratio.toFixed(1)}).
          </p>
        ))}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Sources tab — always-on baseline draw + click-to-see sub-meter breakdown  */
/* -------------------------------------------------------------------------- */

function SourcesTab({
  data, loading,
}: { data: BaselineDrawResponse | null; loading: boolean }) {
  const [drill, setDrill] = useState<number | null>(null);

  if (loading) {
    return (
      <div className="rounded-lg border border-neutral-800 bg-neutral-900 px-5 py-12 text-center text-base text-neutral-400">
        Computing apartment baseline draws… ~20 s (7 nightly Flux queries).
      </div>
    );
  }
  if (!data) return <div className="h-72 animate-pulse rounded-lg border border-neutral-800 bg-neutral-900" />;

  const maxWatts = Math.max(1, ...data.rows.map((r) => r.avg_overnight_watts));

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader
          title="Always-on baseline draw"
          subtitle={`Average electricity load between ${String(data.window_start_hour).padStart(2,"0")}:00 and ${String(data.window_end_hour).padStart(2,"0")}:00 SAST across the last ${data.nights} nights. This is your "ghost" load — fridges + standby + chargers + heaters left on. A high baseline costs ~24×365 × kW × R4.87 per year if not addressed.`}
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
                <th className="px-3 py-2 text-left">Apt</th>
                <th className="px-3 py-2 text-left">Occ</th>
                <th className="px-3 py-2 text-right">Avg kWh / night</th>
                <th className="px-3 py-2 text-right">Avg watts</th>
                <th className="px-3 py-2 text-left">Relative to cohort</th>
                <th className="px-3 py-2 text-right">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-900">
              {data.rows.map((row) => {
                const selected = drill === row.apartment_number;
                const barPct = (row.avg_overnight_watts / maxWatts) * 100;
                const barColor =
                  row.severity === "red" ? "bg-red-500"
                    : row.severity === "amber" ? "bg-amber-500"
                    : "bg-emerald-500";
                return (
                  <Fragment key={row.apartment_number}>
                    <tr
                      onClick={() => setDrill(selected ? null : row.apartment_number)}
                      className={
                        "cursor-pointer text-neutral-200 transition-colors " +
                        (selected ? "bg-emerald-500/10" : "hover:bg-neutral-900/70")
                      }
                      title="Click to see this apartment's sub-meter breakdown"
                    >
                      <td className="px-3 py-2 font-medium">{selected ? "▾ " : "▸ "}{row.apartment_number}</td>
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
                        <td colSpan={6} className="bg-neutral-950 px-5 py-4">
                          <SubmeterBreakdownDrilldown apartmentNumber={row.apartment_number} />
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
          <li>A baseline above the cohort P90 means the apartment is running ~1 kW worth of appliances continuously at 03:00. Common culprits: electric heater, geyser cycling, server, aquarium.</li>
          <li>Click any row to see which BEDROOM inside the apartment is drawing the most — sub-meter breakdown shows the room-by-room share.</li>
          <li>Annual cost of a 500 W "ghost" load at R4.87/kWh = R21,300/year. Targeting the high baselines is the highest-ROI conversation to have.</li>
        </ul>
      </div>
    </div>
  );
}

function SubmeterBreakdownDrilldown({ apartmentNumber }: { apartmentNumber: number }) {
  const [data, setData] = useState<SubmeterBreakdownResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.insights
      .submeterBreakdown(apartmentNumber, "Apartment Living")
      .then((r) => !cancelled && setData(r))
      .catch((e) => !cancelled && setError(String(e)))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [apartmentNumber]);

  if (loading) {
    return <div className="rounded-md border border-neutral-800 bg-neutral-900 px-4 py-6 text-center text-sm text-neutral-400">Loading sub-meter split…</div>;
  }
  if (error || !data) return <div className="text-sm text-red-300">{error || "no data"}</div>;
  if (data.submeters.length === 0) {
    return <div className="rounded-md border border-neutral-800 bg-neutral-900 px-4 py-4 text-center text-sm text-neutral-500">No sub-meters on this apartment.</div>;
  }

  const commonGap = data.main_meter_mtd_kwh != null
    ? Math.max(0, data.main_meter_mtd_kwh - data.total_submeter_mtd_kwh)
    : 0;

  return (
    <div className="rounded-md border border-neutral-800 bg-neutral-950 px-4 py-4">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h4 className="text-sm font-medium text-neutral-200">Apt {apartmentNumber} — electricity by bedroom (MTD)</h4>
        <p className="text-xs text-neutral-500">
          Bedrooms sub-meter total {data.total_submeter_mtd_kwh.toFixed(0)} kWh ·{" "}
          {data.main_meter_external_id && `main meter ${data.main_meter_external_id} reads ${data.main_meter_mtd_kwh?.toFixed(0)} kWh`}
          {commonGap > 0 && ` · common areas (kitchen / lounge / geyser) ≈ ${commonGap.toFixed(0)} kWh`}
        </p>
      </div>
      <table className="w-full text-sm">
        <thead className="text-xs uppercase tracking-wider text-neutral-500">
          <tr className="border-b border-neutral-800">
            <th className="px-2 py-1.5 text-left">Room</th>
            <th className="px-2 py-1.5 text-left">Meter</th>
            <th className="px-2 py-1.5 text-right">MTD kWh</th>
            <th className="px-2 py-1.5 text-right">MTD cost</th>
            <th className="px-2 py-1.5 text-left">Share of apt sub-meters</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-900">
          {data.submeters.map((s) => (
            <tr key={s.external_id} className="text-neutral-200">
              <td className="px-2 py-1.5 font-medium">{s.room_name}</td>
              <td className="px-2 py-1.5 text-neutral-400">{s.external_id}</td>
              <td className="px-2 py-1.5 text-right tabular-nums">{s.mtd_kwh.toFixed(1)}</td>
              <td className="px-2 py-1.5 text-right tabular-nums text-neutral-300">{fmtCost(s.mtd_cost)}</td>
              <td className="px-2 py-1.5">
                <div className="flex items-center gap-2">
                  <div className="h-2 w-40 overflow-hidden rounded bg-neutral-800">
                    <div
                      className="h-full bg-amber-500"
                      style={{ width: `${Math.min(100, s.pct_of_apartment_total)}%` }}
                    />
                  </div>
                  <span className="text-xs tabular-nums text-neutral-400">{s.pct_of_apartment_total.toFixed(1)}%</span>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-3 text-xs text-neutral-500">
        Rooms 1–{data.submeters.length} are the individual bedrooms. The gap between the main meter and the sub-meter sum is common-area usage (kitchen / lounge / geyser).
      </p>
    </div>
  );
}
