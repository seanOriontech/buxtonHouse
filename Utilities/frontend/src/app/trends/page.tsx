"use client";

import { useEffect, useState } from "react";
import {
  Bar,
  BarChart,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { Card, CardHeader } from "@/components/card";
import { Button } from "@/components/button";
import { api, type TrendResponse, type UtilityType } from "@/lib/api";

const UTILITIES: UtilityType[] = ["electricity", "cold_water", "hot_water"];
const LABEL: Record<UtilityType, string> = {
  electricity: "Electricity",
  cold_water: "Cold water",
  hot_water: "Hot water",
  gas: "Gas",
  other: "Other",
  aux: "Aux",
  temperature: "Temperature",
  level: "Level",
};

export default function TrendsPage() {
  const [utility, setUtility] = useState<UtilityType>("electricity");
  const [data, setData] = useState<TrendResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    api.usage
      .trends(utility, "monthly", 12)
      .then(setData)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [utility]);

  const total = data?.buckets.reduce((acc, b) => acc + b.value, 0) ?? 0;
  const priorTotal = data?.buckets.reduce(
    (acc, b) => acc + (b.previous_year_value ?? 0),
    0,
  ) ?? 0;
  const yoyDelta = priorTotal > 0 ? ((total - priorTotal) / priorTotal) * 100 : null;

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Trends</h1>
          <p className="text-base text-neutral-500">Last 12 months vs. prior year.</p>
        </div>
        <div className="flex gap-2">
          {UTILITIES.map((u) => (
            <Button
              key={u}
              variant={utility === u ? "primary" : "secondary"}
              onClick={() => setUtility(u)}
            >
              {LABEL[u]}
            </Button>
          ))}
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 px-4 py-3 text-base text-red-300">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Summary label="12mo total" value={total} units={data?.units} />
        <Summary label="Prior 12mo" value={priorTotal} units={data?.units} />
        <Summary
          label="YoY change"
          value={yoyDelta !== null ? `${yoyDelta.toFixed(1)}%` : "—"}
          tone={yoyDelta !== null ? (yoyDelta < 0 ? "good" : "warn") : undefined}
        />
      </div>

      <Card>
        <CardHeader title={LABEL[utility]} subtitle="Monthly buckets" />
        <div className="px-5 py-4">
          {loading || !data ? (
            <div className="h-64 animate-pulse rounded-md bg-neutral-800/40" />
          ) : data.buckets.length === 0 ? (
            <p className="py-8 text-center text-base text-neutral-500">No trend data.</p>
          ) : (
            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.buckets}>
                  <XAxis
                    dataKey="period_start"
                    tick={{ fill: "#737373", fontSize: 11 }}
                    tickFormatter={(v) =>
                      new Date(v).toLocaleDateString(undefined, { month: "short", year: "2-digit" })
                    }
                  />
                  <YAxis tick={{ fill: "#737373", fontSize: 11 }} />
                  <Tooltip
                    contentStyle={{ background: "#171717", border: "1px solid #262626" }}
                    labelFormatter={(v) => new Date(v).toLocaleDateString()}
                  />
                  <Legend wrapperStyle={{ color: "#a3a3a3", fontSize: 12 }} />
                  <Bar dataKey="value" name="This year" fill="#10b981" />
                  <Bar dataKey="previous_year_value" name="Prior year" fill="#404040" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}

function Summary({
  label,
  value,
  units,
  tone,
}: {
  label: string;
  value: number | string;
  units?: string | null;
  tone?: "good" | "warn";
}) {
  const valueClass =
    tone === "good" ? "text-emerald-300" : tone === "warn" ? "text-amber-300" : "text-neutral-100";
  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-900 px-5 py-4">
      <p className="text-sm font-medium uppercase tracking-wide text-neutral-500">{label}</p>
      <p className={`mt-2 text-3xl font-semibold tabular-nums ${valueClass}`}>
        {typeof value === "number"
          ? value.toLocaleString(undefined, { maximumFractionDigits: 1 })
          : value}
        {units && typeof value === "number" && (
          <span className="ml-1 text-base font-normal text-neutral-400">{units}</span>
        )}
      </p>
    </div>
  );
}
