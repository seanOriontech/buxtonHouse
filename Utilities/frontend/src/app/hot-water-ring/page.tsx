"use client";

import { useEffect, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { Card, CardHeader } from "@/components/card";
import { DataTable, type Column } from "@/components/data-table";
import { Button } from "@/components/button";
import { api, type HotWaterRingResponse, type RingDay } from "@/lib/api";

const PERIODS = [7, 14, 30, 60, 90] as const;

function fmt(n: number, units?: string) {
  const s = n.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return units ? `${s} ${units}` : s;
}

export default function HotWaterRingPage() {
  const [days, setDays] = useState<number>(30);
  const [data, setData] = useState<HotWaterRingResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    api.hotWaterRing
      .daily(days)
      .then(setData)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [days]);

  const units = data?.units ?? "m³";

  const cols: Column<RingDay & { id: string }>[] = [
    {
      key: "date",
      header: "Day",
      render: (r) => (
        <span className="text-neutral-200">
          {new Date(r.date).toLocaleDateString(undefined, {
            weekday: "short",
            day: "2-digit",
            month: "short",
          })}
        </span>
      ),
    },
    {
      key: "ring_main",
      header: "HW_Ring_Main",
      className: "text-right",
      render: (r) => <span className="tabular-nums">{fmt(r.ring_main)}</span>,
    },
    {
      key: "supply_ring",
      header: "HW_Supply_Ring",
      className: "text-right",
      render: (r) => <span className="tabular-nums">{fmt(r.supply_ring)}</span>,
    },
    {
      key: "difference",
      header: "Difference",
      className: "text-right",
      render: (r) => (
        <span
          className={
            "tabular-nums font-medium " +
            (r.difference < 0 ? "text-amber-300" : "text-emerald-300")
          }
        >
          {r.difference > 0 ? "+" : ""}
          {fmt(r.difference)}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Hot Water Ring Main</h1>
          <p className="text-base text-neutral-500">
            Daily <span className="font-mono">HW_Ring_Main</span> −{" "}
            <span className="font-mono">HW_Supply_Ring</span> ({units}) over the selected period.
          </p>
        </div>
        <div className="flex gap-2">
          {PERIODS.map((p) => (
            <Button
              key={p}
              variant={days === p ? "primary" : "secondary"}
              onClick={() => setDays(p)}
            >
              {p}d
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
        <Summary label="HW_Ring_Main total" value={data?.totals.ring_main} units={units} />
        <Summary label="HW_Supply_Ring total" value={data?.totals.supply_ring} units={units} />
        <Summary
          label="Difference total"
          value={data?.totals.difference}
          units={units}
          tone={
            data ? (data.totals.difference < 0 ? "warn" : "good") : undefined
          }
        />
      </div>

      <Card>
        <CardHeader
          title="Daily difference"
          subtitle="HW_Ring_Main minus HW_Supply_Ring, per day"
        />
        <div className="px-5 py-4">
          {loading || !data ? (
            <div className="h-72 animate-pulse rounded-md bg-neutral-800/40" />
          ) : data.rows.length === 0 ? (
            <p className="py-8 text-center text-base text-neutral-500">No data.</p>
          ) : (
            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.rows}>
                  <CartesianGrid stroke="#262626" vertical={false} />
                  <XAxis
                    dataKey="date"
                    tick={{ fill: "#737373", fontSize: 11 }}
                    tickFormatter={(v) =>
                      new Date(v).toLocaleDateString(undefined, { day: "2-digit", month: "short" })
                    }
                  />
                  <YAxis tick={{ fill: "#737373", fontSize: 11 }} unit={` ${units}`} width={70} />
                  <Tooltip
                    contentStyle={{ background: "#171717", border: "1px solid #262626" }}
                    labelFormatter={(v) => new Date(v).toLocaleDateString()}
                    formatter={(val: number, name) => [fmt(val, units), name]}
                  />
                  <Legend wrapperStyle={{ color: "#a3a3a3", fontSize: 12 }} />
                  <Bar dataKey="difference" name="Difference" fill="#10b981" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </Card>

      <Card>
        <CardHeader title="Per-day breakdown" subtitle={`${data?.days ?? days} days`} />
        <div className="px-5 py-4">
          {loading || !data ? (
            <div className="h-40 animate-pulse rounded-md bg-neutral-800/40" />
          ) : (
            <DataTable
              rows={data.rows.map((r) => ({ ...r, id: r.date }))}
              columns={cols}
              empty="No data"
            />
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
  value: number | undefined;
  units?: string;
  tone?: "good" | "warn";
}) {
  const valueClass =
    tone === "good" ? "text-emerald-300" : tone === "warn" ? "text-amber-300" : "text-neutral-100";
  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-900 px-5 py-4">
      <p className="text-sm font-medium uppercase tracking-wide text-neutral-500">{label}</p>
      <p className={`mt-2 text-3xl font-semibold tabular-nums ${valueClass}`}>
        {value === undefined
          ? "—"
          : value.toLocaleString(undefined, { maximumFractionDigits: 2 })}
        {value !== undefined && units && (
          <span className="ml-1 text-base font-normal text-neutral-400">{units}</span>
        )}
      </p>
    </div>
  );
}
