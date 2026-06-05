"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { Card, CardHeader } from "@/components/card";
import { Button } from "@/components/button";
import { Pill } from "@/components/pill";
import { api, type Property, type Room, type RoomRole, type RoomType } from "@/lib/api";

export default function RoomsPage() {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [types, setTypes] = useState<RoomType[]>([]);
  const [properties, setProperties] = useState<Property[]>([]);
  const [roles, setRoles] = useState<RoomRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [propertyFilter, setPropertyFilter] = useState("");

  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [roomTypeId, setRoomTypeId] = useState("");
  const [parentRoomId, setParentRoomId] = useState("");
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [r, t, p, rl] = await Promise.all([
        api.rooms.list(propertyFilter ? { property_id: propertyFilter } : undefined),
        api.roomTypes.list(),
        api.properties.list(),
        api.roomRoles.list(),
      ]);
      setRooms(r);
      setTypes(t);
      setProperties(p);
      setRoles(rl);
      if (!roomTypeId && t[0]) setRoomTypeId(t[0].id);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [propertyFilter]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!code || !name || !roomTypeId) return;
    setSaving(true);
    try {
      await api.rooms.create({
        code,
        name,
        room_type_id: roomTypeId,
        parent_room_id: parentRoomId || null,
        property_id: propertyFilter || properties[0]?.id || null,
      });
      setCode("");
      setName("");
      setParentRoomId("");
      await load();
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    if (!confirm("Delete this room?")) return;
    try {
      await api.rooms.remove(id);
      await load();
    } catch (e) {
      setError(String(e));
    }
  }

  async function setRole(roomId: string, roleId: string) {
    // Optimistic update so the dropdown reflects the change immediately.
    setRooms((prev) =>
      prev.map((r) =>
        r.id === roomId
          ? { ...r, role_id: roleId || null, role: roles.find((x) => x.id === roleId) ?? null }
          : r,
      ),
    );
    try {
      await api.rooms.update(roomId, { role_id: roleId || null });
    } catch (e) {
      setError(String(e));
      await load();
    }
  }

  // Derive: parent rooms (no parent_room_id) grouped by category, with child counts.
  const { roots, childCounts } = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of rooms) {
      if (r.parent_room_id) counts.set(r.parent_room_id, (counts.get(r.parent_room_id) ?? 0) + 1);
    }
    const rootList = rooms.filter((r) => r.parent_room_id == null);
    return { roots: rootList, childCounts: counts };
  }, [rooms]);

  const byCategory = roots.reduce<Record<string, Room[]>>((acc, r) => {
    const cat = r.room_type.category;
    (acc[cat] ??= []).push(r);
    return acc;
  }, {});

  const parentCandidates = roots.filter(
    (r) => r.room_type.category === "apartment" || r.room_type.category === "communal",
  );

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Rooms</h1>
          <p className="text-base text-neutral-500">
            {roots.length} top-level rooms across {rooms.length - roots.length} sub-rooms.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {properties.length > 1 && (
            <select
              value={propertyFilter}
              onChange={(e) => setPropertyFilter(e.target.value)}
              className="rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-base focus:border-emerald-500 focus:outline-none"
            >
              <option value="">All properties</option>
              {properties.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.code}
                </option>
              ))}
            </select>
          )}
          <Link href="/rooms/types" className="text-base text-neutral-400 hover:text-white">
            Manage room types →
          </Link>
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 px-4 py-3 text-base text-red-300">
          {error}
        </div>
      )}

      <Card>
        <CardHeader title="Add room" subtitle="Code is a short, unique identifier (e.g. A-21)." />
        <form onSubmit={create} className="grid grid-cols-1 gap-3 px-5 py-4 sm:grid-cols-5">
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="Code"
            className="rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-base focus:border-emerald-500 focus:outline-none"
            required
          />
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name"
            className="rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-base focus:border-emerald-500 focus:outline-none sm:col-span-2"
            required
          />
          <select
            value={roomTypeId}
            onChange={(e) => setRoomTypeId(e.target.value)}
            className="rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-base focus:border-emerald-500 focus:outline-none"
            required
          >
            {types.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          <select
            value={parentRoomId}
            onChange={(e) => setParentRoomId(e.target.value)}
            className="rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-base focus:border-emerald-500 focus:outline-none"
          >
            <option value="">No parent</option>
            {parentCandidates.map((a) => (
              <option key={a.id} value={a.id}>
                {a.code} — {a.name}
              </option>
            ))}
          </select>
          <Button type="submit" disabled={saving} className="sm:col-span-5 sm:justify-self-end">
            {saving ? "Saving…" : "Add room"}
          </Button>
        </form>
      </Card>

      {loading ? (
        <div className="h-40 animate-pulse rounded-lg border border-neutral-800 bg-neutral-900" />
      ) : (
        Object.entries(byCategory).map(([category, list]) => (
          <Card key={category}>
            <CardHeader
              title={category.replace("_", " ")}
              subtitle={`${list.length} room${list.length === 1 ? "" : "s"}`}
            />
            <ul className="divide-y divide-neutral-800">
              {list.map((r) => {
                const kids = childCounts.get(r.id) ?? 0;
                return (
                  <li
                    key={r.id}
                    className="flex items-center justify-between gap-4 px-5 py-3 hover:bg-neutral-800/40"
                  >
                    <Link href={`/rooms/${r.id}`} className="flex-1">
                      <div className="flex items-center gap-3 flex-wrap">
                        <span className="font-mono text-base text-neutral-100">{r.code}</span>
                        <span className="text-base text-neutral-300">{r.name}</span>
                        {r.room_type.living_type && (
                          <Pill tone="neutral">{r.room_type.living_type.name}</Pill>
                        )}
                        {r.role && <Pill tone={r.role.tone}>{r.role.name}</Pill>}
                        {kids > 0 && <Pill tone="sky">{kids} sub-room{kids === 1 ? "" : "s"}</Pill>}
                      </div>
                    </Link>
                    <select
                      value={r.role_id ?? ""}
                      onChange={(e) => setRole(r.id, e.target.value)}
                      onClick={(e) => e.stopPropagation()}
                      className="rounded-md border border-neutral-700 bg-neutral-950 px-2 py-1 text-sm text-neutral-200 focus:border-emerald-500 focus:outline-none"
                    >
                      <option value="">No role</option>
                      {roles.map((role) => (
                        <option key={role.id} value={role.id}>
                          {role.name}
                        </option>
                      ))}
                    </select>
                    <button
                      onClick={() => remove(r.id)}
                      className="text-sm text-neutral-500 hover:text-red-400"
                    >
                      Delete
                    </button>
                  </li>
                );
              })}
            </ul>
          </Card>
        ))
      )}
    </div>
  );
}
