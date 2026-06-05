"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { Card, CardHeader } from "@/components/card";
import { Button } from "@/components/button";
import { Pill } from "@/components/pill";
import { api, type RoomCategory, type RoomType } from "@/lib/api";

const CATEGORIES: RoomCategory[] = ["apartment", "apartment_room", "communal", "facility"];
const CATEGORY_LABEL: Record<RoomCategory, string> = {
  apartment: "Apartment",
  apartment_room: "Apartment room",
  communal: "Communal",
  facility: "Facility",
};

export default function RoomTypesPage() {
  const [types, setTypes] = useState<RoomType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [category, setCategory] = useState<RoomCategory>("apartment_room");
  const [shareable, setShareable] = useState(false);
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      setTypes(await api.roomTypes.list());
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!name) return;
    setSaving(true);
    try {
      await api.roomTypes.create({ name, category, shareable });
      setName("");
      setShareable(false);
      await load();
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }

  async function toggleShareable(t: RoomType) {
    try {
      await api.roomTypes.update(t.id, { shareable: !t.shareable });
      await load();
    } catch (e) {
      setError(String(e));
    }
  }

  async function remove(id: string) {
    if (!confirm("Delete this room type? Rooms still referencing it will block deletion.")) return;
    try {
      await api.roomTypes.remove(id);
      await load();
    } catch (e) {
      setError(String(e));
    }
  }

  const byCategory = types.reduce<Record<string, RoomType[]>>((acc, t) => {
    (acc[t.category] ??= []).push(t);
    return acc;
  }, {});

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <Link href="/rooms" className="text-base text-neutral-400 hover:text-white">
            ← Rooms
          </Link>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Room types</h1>
          <p className="text-base text-neutral-500">
            Templates rooms reference (Apartment, Single Bedroom, Gym…).
          </p>
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 px-4 py-3 text-base text-red-300">
          {error}
        </div>
      )}

      <Card>
        <CardHeader title="Add type" subtitle="Mark shareable for spaces used by multiple residents." />
        <form onSubmit={create} className="grid grid-cols-1 gap-3 px-5 py-4 sm:grid-cols-5">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name"
            className="rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-base focus:border-emerald-500 focus:outline-none sm:col-span-2"
            required
          />
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value as RoomCategory)}
            className="rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-base focus:border-emerald-500 focus:outline-none"
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABEL[c]}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-2 text-base text-neutral-300">
            <input
              type="checkbox"
              checked={shareable}
              onChange={(e) => setShareable(e.target.checked)}
              className="h-4 w-4 rounded border-neutral-700 bg-neutral-950 accent-emerald-500"
            />
            Shareable
          </label>
          <Button type="submit" disabled={saving} className="sm:justify-self-end">
            {saving ? "Saving…" : "Add type"}
          </Button>
        </form>
      </Card>

      {loading ? (
        <div className="h-40 animate-pulse rounded-lg border border-neutral-800 bg-neutral-900" />
      ) : (
        CATEGORIES.map((cat) => {
          const list = byCategory[cat] ?? [];
          return (
            <Card key={cat}>
              <CardHeader
                title={CATEGORY_LABEL[cat]}
                subtitle={`${list.length} type${list.length === 1 ? "" : "s"}`}
              />
              {list.length === 0 ? (
                <p className="px-5 py-6 text-center text-base text-neutral-500">
                  No types in this category yet.
                </p>
              ) : (
                <ul className="divide-y divide-neutral-800">
                  {list.map((t) => (
                    <li
                      key={t.id}
                      className="flex items-center justify-between px-5 py-3"
                    >
                      <div className="flex items-center gap-3 flex-wrap">
                        <span className="text-base text-neutral-100">{t.name}</span>
                        <span className="text-sm text-neutral-500">
                          occ {t.occupancy ?? 1}
                        </span>
                        {t.living_type && (
                          <Pill tone="neutral">{t.living_type.name}</Pill>
                        )}
                        {t.shareable && <Pill tone="sky">shared</Pill>}
                      </div>
                      <div className="flex items-center gap-3">
                        <button
                          onClick={() => toggleShareable(t)}
                          className="text-sm text-neutral-400 hover:text-white"
                        >
                          {t.shareable ? "Mark private" : "Mark shareable"}
                        </button>
                        <button
                          onClick={() => remove(t.id)}
                          className="text-sm text-neutral-500 hover:text-red-400"
                        >
                          Delete
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          );
        })
      )}
    </div>
  );
}
