"use client";

import { useEffect, useMemo, useState } from "react";

import { Card, CardHeader } from "@/components/card";
import { StatCard } from "@/components/stat-card";
import { Button } from "@/components/button";
import { api, periodRange, type OverviewResponse } from "@/lib/api";

type Period = "today" | "week" | "month";

const UTILITY_LABEL: Record<string, string> = {
  electricity: "Electricity",
  hot_water: "Hot water",
  cold_water: "Cold water",
  gas: "Gas",
  other: "Other",
};
const UTILITY_UNITS: Record<string, string> = {
  electricity: "kWh",
  hot_water: "m³",
  cold_water: "m³",
  gas: "m³",
};

export default function CategoryOverviewPage() {
  const [period, setPeriod] = useState<Period>("week");
  const [data, setData] = useState<OverviewResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const { from, to } = periodRange(period);
    api.usage
      .overview(from, to)
      .then((r) => !cancelled && setData(r))
      .catch((e) => !cancelled && setError(String(e)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [period]);

  const categoryMatrix = useMemo(() => {
    if (!data) return [];
    const map = new Map<string, Record<string, number>>();
    for (const row of data.breakdown) {
      const bucket = map.get(row.category) ?? {};
      bucket[row.utility_type] = (bucket[row.utility_type] ?? 0) + row.total;
      map.set(row.category, bucket);
    }
    return Array.from(map.entries()).map(([category, by]) => ({ category, by }));
  }, [data]);

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Category breakdown</h1>
          <p className="text-base text-neutral-500">
            Building-wide consumption from InfluxDB, totals per category × utility.
          </p>
        </div>
        <div className="flex gap-2">
          {(["today", "week", "month"] as Period[]).map((p) => (
            <Button
              key={p}
              variant={period === p ? "primary" : "secondary"}
              onClick={() => setPeriod(p)}
            >
              {p[0].toUpperCase() + p.slice(1)}
            </Button>
          ))}
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 px-4 py-3 text-base text-red-300">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {loading || !data ? (
          Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="h-24 animate-pulse rounded-lg border border-neutral-800 bg-neutral-900"
            />
          ))
        ) : (
          Object.entries(data.totals).map(([utility, total]) => (
            <StatCard
              key={utility}
              label={UTILITY_LABEL[utility] ?? utility}
              value={total.toLocaleString(undefined, { maximumFractionDigits: 1 })}
              units={UTILITY_UNITS[utility]}
            />
          ))
        )}
      </div>

      <Card>
        <CardHeader title="Breakdown by category" subtitle="Sum per category × utility" />
        <div className="overflow-x-auto px-5 py-4">
          {categoryMatrix.length === 0 ? (
            <p className="py-8 text-center text-base text-neutral-500">No usage in this period.</p>
          ) : (
            <table className="w-full text-base">
              <thead className="text-left text-sm uppercase tracking-wide text-neutral-500">
                <tr>
                  <th className="py-2">Category</th>
                  {Object.keys(UTILITY_LABEL).map((u) => (
                    <th key={u} className="py-2 text-right">
                      {UTILITY_LABEL[u]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-800">
                {categoryMatrix.map(({ category, by }) => (
                  <tr key={category}>
                    <td className="py-2 capitalize text-neutral-200">{category.replace("_", " ")}</td>
                    {Object.keys(UTILITY_LABEL).map((u) => (
                      <td key={u} className="py-2 text-right tabular-nums text-neutral-300">
                        {by[u]
                          ? by[u].toLocaleString(undefined, { maximumFractionDigits: 1 })
                          : "—"}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </Card>
    </div>
  );
}
