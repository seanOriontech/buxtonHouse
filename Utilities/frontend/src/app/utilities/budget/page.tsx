"use client";

import { useEffect, useState } from "react";

import { Card, CardHeader } from "@/components/card";
import { Pill } from "@/components/pill";
import { api, type BudgetRow, type PerPersonBudgetResponse } from "@/lib/api";
import { fmtCost } from "@/lib/format";

const APT = "Apartment Living";
const COM = "Communal Living";

function pctTone(row: BudgetRow): "emerald" | "amber" | "red" {
  if (row.already_over) return "red";
  if (row.forecast_over) return "amber";
  return "emerald";
}

function pctLabel(row: BudgetRow): string {
  if (row.already_over) return `${row.pct_consumed.toFixed(0)}% — over`;
  if (row.forecast_over) return `${row.pct_consumed.toFixed(0)}% — forecast over`;
  return `${row.pct_consumed.toFixed(0)}% used`;
}

function ProgressBar({ pct, over, forecastOver }: { pct: number; over: boolean; forecastOver: boolean }) {
  const capped = Math.max(0, Math.min(150, pct));
  const colour = over
    ? "bg-red-500"
    : forecastOver
      ? "bg-amber-500"
      : pct >= 80
        ? "bg-yellow-500"
        : "bg-emerald-500";
  // Show a "100%" tick line
  return (
    <div className="relative h-2 w-32 overflow-hidden rounded bg-neutral-800">
      <div
        className={`absolute inset-y-0 left-0 ${colour}`}
        style={{ width: `${(capped / 150) * 100}%` }}
      />
      <div className="absolute inset-y-0 left-[66.66%] w-px bg-neutral-700" />
    </div>
  );
}

export default function BudgetPage() {
  const [apt, setApt] = useState<PerPersonBudgetResponse | null>(null);
  const [com, setCom] = useState<PerPersonBudgetResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      api.insights.perPersonBudget(APT),
      api.insights.perPersonBudget(COM),
    ])
      .then(([a, c]) => {
        if (cancelled) return;
        setApt(a);
        setCom(c);
      })
      .catch((e) => !cancelled && setError(String(e)))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Utility budget</h1>
        <p className="text-base text-neutral-500">
          Each tenant has a per-person monthly utility allowance set by the accommodation tariff.
          Total spend so far this month vs that allowance, plus a forecast for end-of-month and a
          predicted date the apartment / room will cross the cap at the current daily rate.
        </p>
      </div>

      {error && (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 px-4 py-3 text-base text-red-300">
          {error}
        </div>
      )}

      {loading || !apt || !com ? (
        <div className="h-40 animate-pulse rounded-lg border border-neutral-800 bg-neutral-900" />
      ) : (
        <>
          <BudgetSection
            title="Apartment Living"
            subtitle={
              apt.accommodation_rate_per_person_per_month != null
                ? `Allowance R${apt.accommodation_rate_per_person_per_month.toFixed(0)} / person / month (= R${(apt.daily_rate_per_person ?? 0).toFixed(2)} / person / day). Day ${apt.days_elapsed_mtd} of ${apt.days_in_month} (${apt.days_remaining} days remaining). Includes water + electricity.`
                : "No accommodation tariff configured for Apartment Living."
            }
            data={apt}
            showWater
          />
          <BudgetSection
            title="Communal Living"
            subtitle={
              com.accommodation_rate_per_person_per_month != null
                ? `Allowance R${com.accommodation_rate_per_person_per_month.toFixed(0)} / person / month (= R${(com.daily_rate_per_person ?? 0).toFixed(2)} / person / day). Electricity only (no per-room water meters).`
                : "No accommodation tariff configured for Communal Living."
            }
            data={com}
            showWater={false}
          />
        </>
      )}
    </div>
  );
}

function BudgetSection({
  title, subtitle, data, showWater,
}: {
  title: string;
  subtitle: string;
  data: PerPersonBudgetResponse;
  showWater: boolean;
}) {
  const overCount = data.rows.filter((r) => r.already_over).length;
  const forecastOverCount = data.rows.filter((r) => r.forecast_over).length;
  const okCount = data.rows.length - overCount - forecastOverCount;

  return (
    <section>
      <Card>
        <CardHeader title={title} subtitle={subtitle} />
        <div className="flex flex-wrap items-center gap-3 border-b border-neutral-800 px-5 py-3 text-sm">
          <span className="rounded-md border border-red-500/30 bg-red-500/10 px-2.5 py-1 text-red-300">
            {overCount} already over
          </span>
          <span className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-amber-300">
            {forecastOverCount} forecast over
          </span>
          <span className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-emerald-300">
            {okCount} within budget
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-sm">
            <thead className="bg-neutral-950 text-xs uppercase tracking-wider text-neutral-500">
              <tr className="border-b border-neutral-800">
                <th className="px-3 py-2 text-left">{data.living_type === APT ? "Apt" : "Room"}</th>
                {data.living_type === COM && <th className="px-3 py-2 text-left">Type</th>}
                <th className="px-3 py-2 text-left">Occ</th>
                {showWater && <th className="px-3 py-2 text-right">Water ℓ</th>}
                <th className="px-3 py-2 text-right">Elec kWh</th>
                <th className="px-3 py-2 text-right">MTD cost</th>
                <th className="px-3 py-2 text-right">EOM forecast</th>
                <th className="px-3 py-2 text-right">Allowance</th>
                <th className="px-3 py-2 text-left">Budget</th>
                <th className="px-3 py-2 text-left">Predicted over</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-900">
              {data.rows.map((r) => {
                const rowBg = r.already_over ? "bg-red-500/5" : r.forecast_over ? "bg-amber-500/5" : "";
                return (
                  <tr key={r.entity_number} className={`text-neutral-200 hover:bg-neutral-900/50 ${rowBg}`}>
                    <td className="px-3 py-2 font-medium">{r.entity_number}</td>
                    {data.living_type === COM && (
                      <td className="px-3 py-2 text-neutral-400">{r.room_type}</td>
                    )}
                    <td className="px-3 py-2 tabular-nums">{r.occupants}</td>
                    {showWater && (
                      <td className="px-3 py-2 text-right tabular-nums">
                        {r.mtd_water_litres != null ? r.mtd_water_litres.toLocaleString(undefined, { maximumFractionDigits: 0 }) : "—"}
                      </td>
                    )}
                    <td className="px-3 py-2 text-right tabular-nums">
                      {r.mtd_electricity_kwh.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums font-medium">{fmtCost(r.mtd_total_cost)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-neutral-300">{fmtCost(r.eom_forecast_total_cost)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-neutral-300">{fmtCost(r.monthly_allowance_cost)}</td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <ProgressBar pct={r.pct_consumed} over={r.already_over} forecastOver={r.forecast_over} />
                        <Pill tone={pctTone(r)}>{pctLabel(r)}</Pill>
                      </div>
                    </td>
                    <td className="px-3 py-2 tabular-nums">
                      {r.already_over ? (
                        <span className="text-red-300">— already over</span>
                      ) : r.predicted_over_date ? (
                        <span className="text-amber-300">{r.predicted_over_date}</span>
                      ) : (
                        <span className="text-neutral-600">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </section>
  );
}
