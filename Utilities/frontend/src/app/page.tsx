"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { Card, CardHeader } from "@/components/card";
import { Pill } from "@/components/pill";
import { StatCard } from "@/components/stat-card";
import { api, type BuildingOverviewResponse } from "@/lib/api";
import { fmtCost } from "@/lib/format";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function monthName(iso: string): string {
  const m = parseInt(iso.slice(5, 7), 10);
  return MONTHS[m - 1] ?? "";
}

function fmt0(n: number): string {
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function fmt2(n: number): string {
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function BuildingOverviewPage() {
  const [data, setData] = useState<BuildingOverviewResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.insights
      .buildingOverview()
      .then((r) => !cancelled && setData(r))
      .catch((e) => !cancelled && setError(String(e)))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Building Overview</h1>
        <p className="text-base text-neutral-500">
          {data ? (
            <>
              Report date <span className="text-neutral-300">{data.report_date}</span>{" · "}
              Day <span className="text-neutral-300">{data.days_elapsed_mtd}</span> of{" "}
              <span className="text-neutral-300">{data.days_in_month}</span> in{" "}
              <span className="text-neutral-300">{monthName(data.report_date)}</span>.
              {data.snapshot_date && (
                <> Occupancy snapshot <span className="text-neutral-300">{data.snapshot_date}</span>.</>
              )}
            </>
          ) : (
            "Loading building summary…"
          )}
        </p>
      </div>

      {error && (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 px-4 py-3 text-base text-red-300">
          {error}
        </div>
      )}

      {/* People in the place */}
      <section>
        <h2 className="mb-3 text-sm font-medium uppercase tracking-wider text-neutral-500">People in the building</h2>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          {loading || !data ? (
            Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-24 animate-pulse rounded-lg border border-neutral-800 bg-neutral-900" />
            ))
          ) : (
            <>
              <StatCard
                label="Apartment Living"
                value={fmt0(data.occupancy.students_apartment_living)}
                hint="Students in apartments"
              />
              <StatCard
                label="Communal Living"
                value={fmt0(data.occupancy.students_communal_living)}
                hint="Students in communal rooms"
              />
              <StatCard
                label="Staff"
                value={fmt0(data.occupancy.staff)}
                hint="In tracked staff rooms"
              />
              <div className="rounded-lg border border-neutral-800 bg-neutral-900 px-5 py-4 opacity-60">
                <p className="text-sm font-medium uppercase tracking-wide text-neutral-500">Office</p>
                <p className="mt-2 text-3xl font-semibold tabular-nums text-neutral-400">—</p>
                <p className="mt-1 text-sm text-neutral-500">Not tracked</p>
              </div>
            </>
          )}
        </div>
        {data && (
          <p className="mt-2 text-sm text-neutral-500">
            Total tracked occupants: <span className="text-neutral-300">{fmt0(data.occupancy.total_tracked)}</span>
            {" · Students "}
            <span className="text-neutral-300">{fmt0(data.occupancy.students_total)}</span>
            {" · Staff "}
            <span className="text-neutral-300">{fmt0(data.occupancy.staff)}</span>
          </p>
        )}
      </section>

      {/* Water alerts */}
      <Card>
        <CardHeader
          title="Water — apartments over the cap"
          subtitle={
            data?.water_alerts.daily_cap_litres != null
              ? `Daily cap ${data.water_alerts.daily_cap_litres} ℓ/p · Monthly cap ${data.water_alerts.monthly_cap_litres?.toFixed(0)} ℓ/p (= daily × ${data.days_in_month} days)`
              : "No water cap configured. Set one on the Apartment Insights page."
          }
        />
        {loading || !data ? (
          <div className="h-32 animate-pulse rounded-b-lg bg-neutral-900" />
        ) : (
          <div className="grid grid-cols-1 gap-4 px-5 py-4 md:grid-cols-2">
            <div>
              <p className="mb-2 text-sm font-medium uppercase tracking-wider text-neutral-400">
                Over daily cap yesterday ({data.water_alerts.yesterday_over_cap.length})
              </p>
              {data.water_alerts.yesterday_over_cap.length === 0 ? (
                <p className="rounded-md border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 text-sm text-emerald-300">
                  None. All apartments within the daily cap yesterday.
                </p>
              ) : (
                <table className="w-full text-sm">
                  <thead className="text-xs uppercase tracking-wider text-neutral-500">
                    <tr className="border-b border-neutral-800">
                      <th className="px-2 py-1.5 text-left">Apt</th>
                      <th className="px-2 py-1.5 text-left">Occ</th>
                      <th className="px-2 py-1.5 text-right">Yday ℓ/p</th>
                      <th className="px-2 py-1.5 text-right">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-900">
                    {data.water_alerts.yesterday_over_cap.map((a) => (
                      <tr key={a.apartment_number} className="text-neutral-200">
                        <td className="px-2 py-1.5 font-medium">
                          <Link href="/utilities/apartment-insights" className="hover:text-white">{a.apartment_number}</Link>
                        </td>
                        <td className="px-2 py-1.5 tabular-nums">{a.occupants}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{a.value_per_person.toFixed(1)} ℓ</td>
                        <td className="px-2 py-1.5 text-right"><Pill tone="red">over daily</Pill></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            <div>
              <p className="mb-2 text-sm font-medium uppercase tracking-wider text-neutral-400">
                Forecast over monthly cap ({data.water_alerts.forecast_over_monthly.length})
              </p>
              {data.water_alerts.forecast_over_monthly.length === 0 ? (
                <p className="rounded-md border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 text-sm text-emerald-300">
                  None on track to exceed the monthly cap.
                </p>
              ) : (
                <table className="w-full text-sm">
                  <thead className="text-xs uppercase tracking-wider text-neutral-500">
                    <tr className="border-b border-neutral-800">
                      <th className="px-2 py-1.5 text-left">Apt</th>
                      <th className="px-2 py-1.5 text-left">Occ</th>
                      <th className="px-2 py-1.5 text-right">EOM ℓ/p</th>
                      <th className="px-2 py-1.5 text-right">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-900">
                    {data.water_alerts.forecast_over_monthly.map((a) => (
                      <tr key={a.apartment_number} className="text-neutral-200">
                        <td className="px-2 py-1.5 font-medium">
                          <Link href="/utilities/apartment-insights" className="hover:text-white">{a.apartment_number}</Link>
                        </td>
                        <td className="px-2 py-1.5 tabular-nums">{a.occupants}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{a.value_per_person.toFixed(0)} ℓ</td>
                        <td className="px-2 py-1.5 text-right"><Pill tone="amber">forecast over</Pill></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}
      </Card>

      {/* Electricity baseline */}
      <section>
        <h2 className="mb-3 text-sm font-medium uppercase tracking-wider text-neutral-500">Electricity baseline (month to date)</h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {loading || !data ? (
            Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-24 animate-pulse rounded-lg border border-neutral-800 bg-neutral-900" />
            ))
          ) : (
            <>
              <StatCard
                label="Building total MTD"
                value={fmt0(data.electricity.building_total_mtd_kwh)}
                units="kWh"
                hint={fmtCost(data.electricity.building_total_mtd_cost)}
              />
              <StatCard
                label="Avg / person / day"
                value={fmt2(data.electricity.avg_kwh_per_person_per_day)}
                units="kWh"
                hint={`Across ${fmt0(data.occupancy.total_tracked)} tracked occupants × ${data.days_elapsed_mtd} days`}
              />
              <StatCard
                label="Current tariff"
                value={`R${fmt2(data.electricity.rate_per_kwh)}`}
                units="/ kWh"
                hint="Apartment Living period"
              />
            </>
          )}
        </div>
      </section>

      {/* Heavy electricity users */}
      <section className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card>
          <CardHeader title="Heavy electricity — Apartment Living" subtitle="Top-decile apartments by MTD kWh/p" />
          {loading || !data ? (
            <div className="h-40 animate-pulse rounded-b-lg bg-neutral-900" />
          ) : data.electricity_heavy_users.apartments_top_decile.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-neutral-500">No apartments in the top decile.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-xs uppercase tracking-wider text-neutral-500">
                <tr className="border-b border-neutral-800">
                  <th className="px-3 py-1.5 text-left">Apt</th>
                  <th className="px-3 py-1.5 text-left">Occ</th>
                  <th className="px-3 py-1.5 text-right">MTD kWh/p</th>
                  <th className="px-3 py-1.5 text-right">Percentile</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-900">
                {data.electricity_heavy_users.apartments_top_decile.map((a) => (
                  <tr key={a.apartment_number} className="text-neutral-200">
                    <td className="px-3 py-1.5 font-medium">
                      <Link href="/utilities/apartment-insights" className="hover:text-white">{a.apartment_number}</Link>
                    </td>
                    <td className="px-3 py-1.5 tabular-nums">{a.occupants}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{a.mtd_kwh_per_person.toFixed(1)} kWh</td>
                    <td className="px-3 py-1.5 text-right"><Pill tone="amber">P{Math.round(a.percentile_rank)}</Pill></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        <Card>
          <CardHeader title="Heavy electricity — Communal Living" subtitle="Top-decile rooms by MTD kWh/p" />
          {loading || !data ? (
            <div className="h-40 animate-pulse rounded-b-lg bg-neutral-900" />
          ) : data.electricity_heavy_users.communal_rooms_top_decile.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-neutral-500">No rooms in the top decile.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-xs uppercase tracking-wider text-neutral-500">
                <tr className="border-b border-neutral-800">
                  <th className="px-3 py-1.5 text-left">Room</th>
                  <th className="px-3 py-1.5 text-left">Type</th>
                  <th className="px-3 py-1.5 text-left">Occ</th>
                  <th className="px-3 py-1.5 text-right">MTD kWh/p</th>
                  <th className="px-3 py-1.5 text-right">Percentile</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-900">
                {data.electricity_heavy_users.communal_rooms_top_decile.map((r) => (
                  <tr key={r.room_number} className="text-neutral-200">
                    <td className="px-3 py-1.5 font-medium">
                      <Link href="/utilities/communal-insights" className="hover:text-white">{r.room_number}</Link>
                    </td>
                    <td className="px-3 py-1.5 text-neutral-400">{r.room_type}</td>
                    <td className="px-3 py-1.5 tabular-nums">{r.occupants}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{r.mtd_kwh_per_person.toFixed(1)} kWh</td>
                    <td className="px-3 py-1.5 text-right"><Pill tone="amber">P{Math.round(r.percentile_rank)}</Pill></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </section>

      <p className="text-sm text-neutral-500">
        Want the raw Influx category totals?{" "}
        <Link href="/category-overview" className="text-emerald-400 hover:text-emerald-300">View category breakdown</Link>.
      </p>
    </div>
  );
}
