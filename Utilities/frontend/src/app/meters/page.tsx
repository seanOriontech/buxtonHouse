"use client";

import { useEffect, useState } from "react";

import { Card, CardHeader } from "@/components/card";
import { DataTable, type Column } from "@/components/data-table";
import { Pill } from "@/components/pill";
import { Button } from "@/components/button";
import { api, type DiscoveredMeter, type LatestReading } from "@/lib/api";

export default function MetersPage() {
  const [readings, setReadings] = useState<LatestReading[]>([]);
  const [discovered, setDiscovered] = useState<DiscoveredMeter[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [r, d] = await Promise.all([api.usage.latest(), api.meters.discover()]);
      setReadings(r);
      setDiscovered(d);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const cols: Column<LatestReading>[] = [
    {
      key: "external_id",
      header: "Meter",
      render: (r) => <span className="font-mono text-neutral-100">{r.external_id}</span>,
    },
    {
      key: "room",
      header: "Room",
      render: (r) =>
        r.room_name ? (
          <span className="text-neutral-200">{r.room_name}</span>
        ) : (
          <Pill tone="amber">Unassigned</Pill>
        ),
    },
    {
      key: "utility",
      header: "Utility",
      render: (r) =>
        r.utility_type ? (
          <Pill tone={pillTone(r.utility_type)}>{r.utility_type.replace("_", " ")}</Pill>
        ) : (
          <span className="text-neutral-500">—</span>
        ),
    },
    {
      key: "value",
      header: "Latest",
      className: "text-right",
      render: (r) => (
        <span className="tabular-nums">
          {r.value.toLocaleString(undefined, { maximumFractionDigits: 2 })}
          {r.units && <span className="ml-1 text-neutral-500">{r.units}</span>}
        </span>
      ),
    },
    {
      key: "last_seen",
      header: "Last seen",
      render: (r) => (
        <span className="text-neutral-400">{new Date(r.last_seen).toLocaleString()}</span>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (r) =>
        r.stale ? <Pill tone="red">Stale</Pill> : <Pill tone="emerald">Live</Pill>,
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Meters</h1>
          <p className="text-base text-neutral-500">Live readings from InfluxDB.</p>
        </div>
        <Button variant="secondary" onClick={load}>
          Refresh
        </Button>
      </div>

      {error && (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 px-4 py-3 text-base text-red-300">
          {error}
        </div>
      )}

      {loading ? (
        <div className="h-40 animate-pulse rounded-lg border border-neutral-800 bg-neutral-900" />
      ) : (
        <DataTable rows={readings.map((r) => ({ ...r, id: r.external_id }))} columns={cols} />
      )}

      {discovered.length > 0 && (
        <Card>
          <CardHeader
            title={`Discovered meters (${discovered.length})`}
            subtitle="Seen on MQTT in the last 7 days but not yet linked to a room."
          />
          <div className="px-5 py-4">
            <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {discovered.map((d) => (
                <li
                  key={`${d.influx_measurement}:${d.external_id}`}
                  className="flex items-center justify-between rounded-md border border-neutral-800 bg-neutral-950/40 px-3 py-2 text-base"
                >
                  <div>
                    <p className="font-mono text-neutral-100">{d.external_id}</p>
                    <p className="text-sm text-neutral-500">
                      {d.influx_measurement}
                      {d.category && ` · ${d.category}`}
                    </p>
                  </div>
                  <Pill tone="sky">{d.units ?? "?"}</Pill>
                </li>
              ))}
            </ul>
          </div>
        </Card>
      )}
    </div>
  );
}

function pillTone(utility: string): "emerald" | "sky" | "amber" | "neutral" {
  if (utility === "electricity") return "amber";
  if (utility === "cold_water") return "sky";
  if (utility === "hot_water") return "emerald";
  return "neutral";
}
