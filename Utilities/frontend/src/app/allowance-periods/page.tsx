"use client";

import { useEffect, useMemo, useState } from "react";

import { Card, CardHeader } from "@/components/card";
import { Button } from "@/components/button";
import { Pill } from "@/components/pill";
import {
  api,
  type AllowancePeriod,
  type Property,
  type Tariff,
  type UtilityType,
} from "@/lib/api";

const RATE_UTILITIES: { value: UtilityType; label: string; unit: string; tone: "amber" | "sky" | "emerald" }[] = [
  { value: "electricity", label: "Electricity", unit: "kWh", tone: "amber" },
  { value: "cold_water", label: "Cold water", unit: "kL", tone: "sky" },
  { value: "hot_water", label: "Hot water", unit: "kL", tone: "emerald" },
];

function toInputDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

function fromInputDate(date: string): string {
  // Start-of-day UTC; we don't need finer than that for billing windows.
  return new Date(`${date}T00:00:00Z`).toISOString();
}

export default function AllowancePeriodsPage() {
  const [periods, setPeriods] = useState<AllowancePeriod[]>([]);
  const [tariffs, setTariffs] = useState<Tariff[]>([]);
  const [properties, setProperties] = useState<Property[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // New-period form state
  const [name, setName] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [newRates, setNewRates] = useState<Partial<Record<UtilityType, string>>>({});
  const [saving, setSaving] = useState(false);

  // Inline period edit
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editStart, setEditStart] = useState("");
  const [editEnd, setEditEnd] = useState("");

  // Per-row rate drafts: key = `${periodId}:${utility}`
  const [rateDrafts, setRateDrafts] = useState<Record<string, string>>({});
  const [ratePending, setRatePending] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [prds, ts, props] = await Promise.all([
        api.allowancePeriods.list(),
        api.tariffs.list(),
        api.properties.list(),
      ]);
      setPeriods(prds);
      setTariffs(ts);
      setProperties(props);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const propertyId = properties[0]?.id ?? null;

  // (period_id, utility) -> tariff. Only consider global (living_type_id is null) tariffs.
  const tariffByPeriodUtility = useMemo(() => {
    const map = new Map<string, Tariff>();
    for (const t of tariffs) {
      if (!t.period_id || t.living_type_id || !t.utility_type) continue;
      map.set(`${t.period_id}:${t.utility_type}`, t);
    }
    return map;
  }, [tariffs]);

  function rateKey(periodId: string, utility: UtilityType) {
    return `${periodId}:${utility}`;
  }
  function rateDraftFor(periodId: string, utility: UtilityType): string {
    const key = rateKey(periodId, utility);
    if (key in rateDrafts) return rateDrafts[key];
    const t = tariffByPeriodUtility.get(key);
    return t ? String(t.unit_rate) : "";
  }

  async function commitRate(periodId: string, utility: UtilityType) {
    if (!propertyId) {
      setError("No property configured yet.");
      return;
    }
    const key = rateKey(periodId, utility);
    if (!(key in rateDrafts)) return;
    const raw = rateDrafts[key].trim();
    const period = periods.find((p) => p.id === periodId);
    if (!period) return;
    const existing = tariffByPeriodUtility.get(key);

    setRatePending(key);
    try {
      if (raw === "") {
        if (existing) await api.tariffs.remove(existing.id);
      } else {
        const num = Number(raw);
        if (!Number.isFinite(num) || num < 0) {
          setError("Rate must be a non-negative number");
          return;
        }
        if (existing) {
          await api.tariffs.update(existing.id, {
            unit_rate: String(num),
            starts_at: period.starts_at,
            ends_at: period.ends_at,
          });
        } else {
          await api.tariffs.create({
            property_id: propertyId,
            period_id: periodId,
            living_type_id: null,
            utility_type: utility,
            starts_at: period.starts_at,
            ends_at: period.ends_at,
            unit_rate: num,
            currency: "ZAR",
          });
        }
      }
      setRateDrafts((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      await load();
    } catch (e) {
      setError(String(e));
    } finally {
      setRatePending(null);
    }
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!startsAt) return;
    if (!propertyId) {
      setError("No property configured yet.");
      return;
    }
    setSaving(true);
    try {
      const period = await api.allowancePeriods.create({
        name: name.trim() || null,
        starts_at: fromInputDate(startsAt),
        ends_at: endsAt ? fromInputDate(endsAt) : null,
      });
      // Persist any rates the user entered alongside the period.
      const rateOps: Promise<unknown>[] = [];
      for (const u of RATE_UTILITIES) {
        const raw = (newRates[u.value] ?? "").trim();
        if (!raw) continue;
        const num = Number(raw);
        if (!Number.isFinite(num) || num < 0) continue;
        rateOps.push(
          api.tariffs.create({
            property_id: propertyId,
            period_id: period.id,
            living_type_id: null,
            utility_type: u.value,
            starts_at: period.starts_at,
            ends_at: period.ends_at,
            unit_rate: num,
            currency: "ZAR",
          }),
        );
      }
      if (rateOps.length) await Promise.all(rateOps);
      setName("");
      setStartsAt("");
      setEndsAt("");
      setNewRates({});
      await load();
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }

  function startEdit(p: AllowancePeriod) {
    setEditingId(p.id);
    setEditName(p.name ?? "");
    setEditStart(toInputDate(p.starts_at));
    setEditEnd(toInputDate(p.ends_at));
  }
  function cancelEdit() {
    setEditingId(null);
  }
  async function saveEdit(id: string) {
    if (!editStart) return;
    try {
      await api.allowancePeriods.update(id, {
        name: editName.trim() || null,
        starts_at: fromInputDate(editStart),
        ends_at: editEnd ? fromInputDate(editEnd) : null,
      });
      cancelEdit();
      await load();
    } catch (e) {
      setError(String(e));
    }
  }

  async function remove(id: string) {
    if (!confirm("Delete this period? Allowances and linked rates inside it will also be removed.")) return;
    try {
      // Cascading delete on allowance_periods removes allowances; tariffs have
      // ON DELETE SET NULL, so clean up the tariffs scoped to this period too.
      const orphanRates = tariffs.filter((t) => t.period_id === id && !t.living_type_id);
      for (const r of orphanRates) await api.tariffs.remove(r.id);
      await api.allowancePeriods.remove(id);
      await load();
    } catch (e) {
      setError(String(e));
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Allowance periods</h1>
        <p className="text-base text-neutral-500">
          Each period is a date window with property-wide utility rates plus per-living-type allowances
          (set on the Living types page).
        </p>
      </div>

      {error && (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 px-4 py-3 text-base text-red-300">
          {error}
        </div>
      )}

      <Card>
        <CardHeader
          title="Add period"
          subtitle="Optional name, start date required. Rates can be filled in here or later from the table below."
        />
        <form onSubmit={create} className="space-y-3 px-5 py-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-5">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Name (e.g. 2026)"
              className="rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-base focus:border-emerald-500 focus:outline-none sm:col-span-2"
            />
            <input
              type="date"
              value={startsAt}
              onChange={(e) => setStartsAt(e.target.value)}
              className="rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-base focus:border-emerald-500 focus:outline-none"
              required
            />
            <input
              type="date"
              value={endsAt}
              onChange={(e) => setEndsAt(e.target.value)}
              placeholder="End (optional)"
              className="rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-base focus:border-emerald-500 focus:outline-none"
            />
            <Button type="submit" disabled={saving} className="sm:justify-self-end">
              {saving ? "Saving…" : "Add"}
            </Button>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {RATE_UTILITIES.map((u) => (
              <div
                key={u.value}
                className="rounded-md border border-neutral-800 bg-neutral-950 px-3 py-3"
              >
                <Pill tone={u.tone}>{u.label}</Pill>
                <div className="mt-2 flex items-center gap-2">
                  <span className="text-sm text-neutral-500">R</span>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={newRates[u.value] ?? ""}
                    onChange={(e) =>
                      setNewRates((prev) => ({ ...prev, [u.value]: e.target.value }))
                    }
                    placeholder="rate (optional)"
                    className="w-full rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1 text-right text-base tabular-nums focus:border-emerald-500 focus:outline-none"
                  />
                  <span className="text-sm text-neutral-500">/ {u.unit}</span>
                </div>
              </div>
            ))}
          </div>
        </form>
      </Card>

      {loading ? (
        <div className="h-40 animate-pulse rounded-lg border border-neutral-800 bg-neutral-900" />
      ) : (
        <Card>
          <CardHeader
            title={`Periods (${periods.length})`}
            subtitle="Rates save on blur or Enter. Clear a rate to remove it."
          />
          {periods.length === 0 ? (
            <p className="px-5 py-8 text-center text-base text-neutral-500">
              No periods yet — add one above.
            </p>
          ) : (
            <table className="w-full text-base">
              <thead className="text-left text-sm uppercase tracking-wide text-neutral-500">
                <tr>
                  <th className="px-5 py-3">Name</th>
                  <th className="px-5 py-3">Start</th>
                  <th className="px-5 py-3">End</th>
                  {RATE_UTILITIES.map((u) => (
                    <th key={u.value} className="px-3 py-3">
                      <Pill tone={u.tone}>{u.label}</Pill>
                      <span className="ml-1 text-neutral-500">R / {u.unit}</span>
                    </th>
                  ))}
                  <th className="px-5 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-800">
                {periods.map((p) => {
                  const isEditing = editingId === p.id;
                  return (
                    <tr key={p.id} className="align-middle">
                      <td className="px-5 py-3 text-neutral-100">
                        {isEditing ? (
                          <input
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            className="w-full rounded-md border border-neutral-700 bg-neutral-950 px-2 py-1 text-base focus:border-emerald-500 focus:outline-none"
                          />
                        ) : (
                          p.name ?? <span className="text-neutral-500">—</span>
                        )}
                      </td>
                      <td className="px-5 py-3 text-neutral-300">
                        {isEditing ? (
                          <input
                            type="date"
                            value={editStart}
                            onChange={(e) => setEditStart(e.target.value)}
                            className="rounded-md border border-neutral-700 bg-neutral-950 px-2 py-1 text-base focus:border-emerald-500 focus:outline-none"
                          />
                        ) : (
                          new Date(p.starts_at).toLocaleDateString()
                        )}
                      </td>
                      <td className="px-5 py-3 text-neutral-300">
                        {isEditing ? (
                          <input
                            type="date"
                            value={editEnd}
                            onChange={(e) => setEditEnd(e.target.value)}
                            className="rounded-md border border-neutral-700 bg-neutral-950 px-2 py-1 text-base focus:border-emerald-500 focus:outline-none"
                          />
                        ) : p.ends_at ? (
                          new Date(p.ends_at).toLocaleDateString()
                        ) : (
                          <span className="text-neutral-500">open</span>
                        )}
                      </td>
                      {RATE_UTILITIES.map((u) => {
                        const key = rateKey(p.id, u.value);
                        const value = rateDraftFor(p.id, u.value);
                        const isPending = ratePending === key;
                        return (
                          <td key={u.value} className="px-3 py-3">
                            <div className="flex items-center gap-1.5">
                              <span className="text-xs text-neutral-500">R</span>
                              <input
                                type="number"
                                min="0"
                                step="any"
                                value={value}
                                onChange={(e) =>
                                  setRateDrafts((prev) => ({ ...prev, [key]: e.target.value }))
                                }
                                onBlur={() => {
                                  if (key in rateDrafts) commitRate(p.id, u.value);
                                }}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") {
                                    e.currentTarget.blur();
                                  } else if (e.key === "Escape") {
                                    setRateDrafts((prev) => {
                                      const next = { ...prev };
                                      delete next[key];
                                      return next;
                                    });
                                    e.currentTarget.blur();
                                  }
                                }}
                                placeholder="—"
                                disabled={isPending || !propertyId}
                                className="w-24 rounded-md border border-neutral-700 bg-neutral-950 px-2 py-1 text-right text-base tabular-nums focus:border-emerald-500 focus:outline-none disabled:opacity-40"
                              />
                            </div>
                          </td>
                        );
                      })}
                      <td className="px-5 py-3 text-right">
                        {isEditing ? (
                          <div className="flex justify-end gap-3">
                            <button
                              onClick={() => saveEdit(p.id)}
                              className="text-sm text-emerald-400 hover:text-emerald-300"
                            >
                              Save
                            </button>
                            <button
                              onClick={cancelEdit}
                              className="text-sm text-neutral-500 hover:text-neutral-300"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <div className="flex justify-end gap-3">
                            <button
                              onClick={() => startEdit(p)}
                              className="text-sm text-neutral-400 hover:text-white"
                            >
                              Edit
                            </button>
                            <button
                              onClick={() => remove(p.id)}
                              className="text-sm text-neutral-500 hover:text-red-400"
                            >
                              Delete
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </Card>
      )}
    </div>
  );
}
