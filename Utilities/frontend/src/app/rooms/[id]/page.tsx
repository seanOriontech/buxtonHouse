"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { use } from "react";
import {
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { Card, CardHeader } from "@/components/card";
import { Pill } from "@/components/pill";
import { Button } from "@/components/button";
import {
  api,
  periodRange,
  type DiscoveredMeter,
  type Meter,
  type Room,
  type RoomRole,
  type RoomUsageResponse,
  type UtilityType,
} from "@/lib/api";

const SERIES_COLORS: Record<string, string> = {
  electricity: "#f59e0b",
  hot_water: "#10b981",
  cold_water: "#38bdf8",
  gas: "#a855f7",
  other: "#a3a3a3",
};

export default function RoomDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [room, setRoom] = useState<Room | null>(null);
  const [meters, setMeters] = useState<Meter[]>([]);
  const [usage, setUsage] = useState<RoomUsageResponse | null>(null);
  const [discovered, setDiscovered] = useState<DiscoveredMeter[]>([]);
  const [roles, setRoles] = useState<RoomRole[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const [r, m, d, rl] = await Promise.all([
        api.rooms.get(id),
        api.meters.list({ room_id: id }),
        api.meters.discover(),
        api.roomRoles.list(),
      ]);
      setRoom(r);
      setMeters(m);
      setDiscovered(d);
      setRoles(rl);
      const { from, to } = periodRange("month");
      setUsage(await api.usage.byRoom(id, from, to, "1d"));
    } catch (e) {
      setError(String(e));
    }
  }

  async function setRole(roleId: string) {
    if (!room) return;
    const next = roles.find((x) => x.id === roleId) ?? null;
    setRoom({ ...room, role_id: roleId || null, role: next });
    try {
      await api.rooms.update(room.id, { role_id: roleId || null });
    } catch (e) {
      setError(String(e));
      await load();
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function linkMeter(d: DiscoveredMeter, utility: UtilityType) {
    try {
      await api.meters.create({
        external_id: d.external_id,
        utility_type: utility,
        influx_measurement: d.influx_measurement,
        units: d.units,
        description: d.description,
        room_id: id,
      });
      await load();
    } catch (e) {
      setError(String(e));
    }
  }

  async function unlinkMeter(meterId: string) {
    try {
      await api.meters.update(meterId, { room_id: null });
      await load();
    } catch (e) {
      setError(String(e));
    }
  }

  if (error) {
    return (
      <div className="rounded-md border border-red-500/30 bg-red-500/10 px-4 py-3 text-base text-red-300">
        {error}
      </div>
    );
  }
  if (!room) return <div className="text-neutral-500">Loading…</div>;

  const chartData = mergeSeries(usage);

  return (
    <div className="space-y-6">
      <div>
        <Link href="/rooms" className="text-base text-neutral-400 hover:text-white">
          ← All rooms
        </Link>
        <div className="mt-2 flex items-center gap-3 flex-wrap">
          <h1 className="text-2xl font-semibold tracking-tight">
            {room.code} <span className="text-neutral-500">·</span> {room.name}
          </h1>
          <Pill tone="neutral">{room.room_type.name}</Pill>
          {room.room_type.shareable && <Pill tone="sky">shared</Pill>}
          {room.role && <Pill tone={room.role.tone}>{room.role.name}</Pill>}
        </div>
        <div className="mt-3 flex items-center gap-2 text-base text-neutral-400">
          <label htmlFor="role-select" className="text-neutral-500">Role:</label>
          <select
            id="role-select"
            value={room.role_id ?? ""}
            onChange={(e) => setRole(e.target.value)}
            className="rounded-md border border-neutral-700 bg-neutral-950 px-2 py-1 text-sm text-neutral-200 focus:border-emerald-500 focus:outline-none"
          >
            <option value="">No role</option>
            {roles.map((role) => (
              <option key={role.id} value={role.id}>
                {role.name}
              </option>
            ))}
          </select>
        </div>
        {room.notes && <p className="mt-2 text-base text-neutral-400">{room.notes}</p>}
      </div>

      <Card>
        <CardHeader title="Linked meters" subtitle={`${meters.length} meter${meters.length === 1 ? "" : "s"} contributing to this room.`} />
        <ul className="divide-y divide-neutral-800">
          {meters.length === 0 ? (
            <li className="px-5 py-6 text-center text-base text-neutral-500">
              No meters linked yet. Use the picker below.
            </li>
          ) : (
            meters.map((m) => (
              <li
                key={m.id}
                className="flex items-center justify-between gap-4 px-5 py-3"
              >
                <div className="flex items-center gap-3">
                  <span className="font-mono text-base text-neutral-100">{m.external_id}</span>
                  <Pill tone="neutral">{m.utility_type.replace("_", " ")}</Pill>
                  <span className="text-sm text-neutral-500">{m.influx_measurement}</span>
                </div>
                <Button variant="ghost" onClick={() => unlinkMeter(m.id)}>
                  Unlink
                </Button>
              </li>
            ))
          )}
        </ul>
      </Card>

      {discovered.length > 0 && (
        <Card>
          <CardHeader
            title="Link a meter"
            subtitle="Meters seen on MQTT in the last 7 days that aren't linked to any room."
          />
          <ul className="divide-y divide-neutral-800">
            {discovered.map((d) => (
              <li
                key={`${d.influx_measurement}:${d.external_id}`}
                className="flex flex-wrap items-center justify-between gap-3 px-5 py-3"
              >
                <div>
                  <p className="font-mono text-base text-neutral-100">{d.external_id}</p>
                  <p className="text-sm text-neutral-500">
                    {d.influx_measurement}
                    {d.category && ` · ${d.category}`}
                    {d.units && ` · ${d.units}`}
                  </p>
                </div>
                <div className="flex gap-2">
                  {(
                    ["electricity", "cold_water", "hot_water"] as UtilityType[]
                  ).map((u) => (
                    <Button key={u} variant="secondary" onClick={() => linkMeter(d, u)}>
                      Link as {u.replace("_", " ")}
                    </Button>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card>
        <CardHeader title="Last 30 days" subtitle="Daily usage by utility." />
        <div className="px-5 py-4">
          {!usage || chartData.length === 0 ? (
            <p className="py-8 text-center text-base text-neutral-500">No usage data.</p>
          ) : (
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData}>
                  <XAxis
                    dataKey="ts"
                    tick={{ fill: "#737373", fontSize: 11 }}
                    tickFormatter={(v) => new Date(v).toLocaleDateString(undefined, { day: "numeric", month: "short" })}
                  />
                  <YAxis tick={{ fill: "#737373", fontSize: 11 }} />
                  <Tooltip
                    contentStyle={{ background: "#171717", border: "1px solid #262626" }}
                    labelFormatter={(v) => new Date(v).toLocaleDateString()}
                  />
                  {usage.series.map((s) => (
                    <Line
                      key={s.utility_type}
                      type="monotone"
                      dataKey={s.utility_type}
                      stroke={SERIES_COLORS[s.utility_type] ?? "#a3a3a3"}
                      dot={false}
                      strokeWidth={2}
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}

function mergeSeries(usage: RoomUsageResponse | null): Array<Record<string, number | string>> {
  if (!usage) return [];
  const byTs = new Map<string, Record<string, number | string>>();
  for (const s of usage.series) {
    for (const p of s.points) {
      const row = byTs.get(p.ts) ?? { ts: p.ts };
      row[s.utility_type] = p.value;
      byTs.set(p.ts, row);
    }
  }
  return Array.from(byTs.values()).sort((a, b) =>
    String(a.ts).localeCompare(String(b.ts)),
  );
}
