"use client";

import { useEffect, useMemo, useState } from "react";

import { DataTable, type Column } from "@/components/data-table";
import { Pill } from "@/components/pill";
import { Button } from "@/components/button";
import { api, type AuxTag } from "@/lib/api";

/** Group an aux tag by its name prefix into a human-readable cluster. */
function groupFor(id: string): string {
  if (id.startsWith("Battery")) return "Battery";
  if (id.startsWith("Vebus")) return "Inverter (VE.Bus)";
  if (id.startsWith("MPPT")) return "Solar (MPPT)";
  if (id.startsWith("PM1")) return "Power meter 1";
  if (id.startsWith("PM2")) return "Power meter 2";
  if (id.startsWith("System.Power")) return "Power meter 1";
  if (id.startsWith("HW") || id.startsWith("HT") || id.startsWith("Boiler") ||
      id.startsWith("RingMain") || /OT/.test(id)) return "Hot water / boiler";
  if (id.startsWith("Gas")) return "Gas";
  if (id.startsWith("VSD") || id.includes("Pump") || id.includes("WaterTank") ||
      id.includes("Pressure") || id.startsWith("RMPump")) return "Water / pumps";
  if (/^test/i.test(id) || id.startsWith("Test_")) return "Test / unassigned";
  return "Other";
}

export default function AuxTagsPage() {
  const [tags, setTags] = useState<AuxTag[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");

  async function load() {
    setLoading(true);
    setError(null);
    try {
      setTags(await api.auxTags.list());
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const rows = tags.map((t) => ({ ...t, group: groupFor(t.external_id) }));
    if (!needle) return rows;
    return rows.filter(
      (t) =>
        t.external_id.toLowerCase().includes(needle) ||
        t.group.toLowerCase().includes(needle) ||
        (t.description ?? "").toLowerCase().includes(needle),
    );
  }, [tags, q]);

  type Row = AuxTag & { group: string };

  const cols: Column<Row>[] = [
    {
      key: "external_id",
      header: "Tag",
      render: (r) => <span className="font-mono text-neutral-100">{r.external_id}</span>,
    },
    {
      key: "group",
      header: "Group",
      render: (r) => <Pill tone="neutral">{r.group}</Pill>,
    },
    {
      key: "value",
      header: "Latest",
      className: "text-right",
      render: (r) => (
        <span className="tabular-nums">
          {r.value === null
            ? <span className="text-neutral-500">—</span>
            : r.value.toLocaleString(undefined, { maximumFractionDigits: 2 })}
          {r.units && <span className="ml-1 text-neutral-500">{r.units}</span>}
        </span>
      ),
    },
    {
      key: "last_seen",
      header: "Last seen",
      render: (r) => (
        <span className="text-neutral-400">
          {r.last_seen ? new Date(r.last_seen).toLocaleString() : "—"}
        </span>
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
          <h1 className="text-2xl font-semibold tracking-tight">Aux Tags</h1>
          <p className="text-base text-neutral-500">
            Plant-room &amp; energy-system telemetry from the <span className="font-mono">aux_data</span> measurement — latest value per tag.
          </p>
        </div>
        <Button variant="secondary" onClick={load}>
          Refresh
        </Button>
      </div>

      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Filter by tag, group, or description…"
        className="w-full max-w-md rounded-md border border-neutral-800 bg-neutral-950/60 px-3 py-2 text-base text-neutral-100 placeholder:text-neutral-600 focus:border-emerald-500/50 focus:outline-none"
      />

      {error && (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 px-4 py-3 text-base text-red-300">
          {error}
        </div>
      )}

      {loading ? (
        <div className="h-40 animate-pulse rounded-lg border border-neutral-800 bg-neutral-900" />
      ) : (
        <>
          <p className="text-sm text-neutral-500">
            {filtered.length} of {tags.length} tags
          </p>
          <DataTable
            rows={filtered.map((r) => ({ ...r, id: r.external_id }))}
            columns={cols}
            empty="No matching tags"
          />
        </>
      )}
    </div>
  );
}
