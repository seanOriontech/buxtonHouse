"use client";

import { useEffect, useMemo, useState } from "react";

import { Card, CardHeader } from "@/components/card";
import { Button } from "@/components/button";
import { Pill } from "@/components/pill";
import { api, type LivingType, type Property, type Tariff, type UtilityType } from "@/lib/api";

const UTILITY_OPTIONS: { value: UtilityType | ""; label: string }[] = [
  { value: "", label: "Accommodation" },
  { value: "electricity", label: "Electricity" },
  { value: "hot_water", label: "Hot water" },
  { value: "cold_water", label: "Cold water" },
  { value: "gas", label: "Gas" },
];

export default function TariffsPage() {
  const [tariffs, setTariffs] = useState<Tariff[]>([]);
  // Property-wide utility tariffs (no living_type) are managed under Rates;
  // here we only show tariffs with a living type assigned (e.g. accommodation rates).
  const visibleTariffs = useMemo(() => tariffs.filter((t) => t.living_type_id), [tariffs]);
  const [properties, setProperties] = useState<Property[]>([]);
  const [livingTypes, setLivingTypes] = useState<LivingType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [propertyId, setPropertyId] = useState("");
  const [livingTypeId, setLivingTypeId] = useState("");
  const [utility, setUtility] = useState<UtilityType | "">("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [unitRate, setUnitRate] = useState("");
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [t, p, l] = await Promise.all([
        api.tariffs.list(),
        api.properties.list(),
        api.livingTypes.list(),
      ]);
      setTariffs(t);
      setProperties(p);
      setLivingTypes(l);
      if (!propertyId && p[0]) setPropertyId(p[0].id);
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
    if (!propertyId || !startsAt || !unitRate) return;
    setSaving(true);
    try {
      await api.tariffs.create({
        property_id: propertyId,
        living_type_id: livingTypeId || null,
        utility_type: (utility || null) as UtilityType | null,
        starts_at: new Date(startsAt).toISOString(),
        ends_at: endsAt ? new Date(endsAt).toISOString() : null,
        unit_rate: unitRate,
        currency: "ZAR",
      });
      setStartsAt("");
      setEndsAt("");
      setUnitRate("");
      await load();
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    if (!confirm("Delete this tariff?")) return;
    try {
      await api.tariffs.remove(id);
      await load();
    } catch (e) {
      setError(String(e));
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Tariffs</h1>
        <p className="text-base text-neutral-500">
          Rates per property, living type and utility — time-bounded.
        </p>
      </div>

      {error && (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 px-4 py-3 text-base text-red-300">
          {error}
        </div>
      )}

      <Card>
        <CardHeader title="Add tariff" subtitle="Leave living type / utility blank for a property-wide rate." />
        <form onSubmit={create} className="grid grid-cols-1 gap-3 px-5 py-4 sm:grid-cols-6">
          <select
            value={propertyId}
            onChange={(e) => setPropertyId(e.target.value)}
            className="rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-base focus:border-emerald-500 focus:outline-none"
            required
          >
            {properties.map((p) => (
              <option key={p.id} value={p.id}>
                {p.code}
              </option>
            ))}
          </select>
          <select
            value={livingTypeId}
            onChange={(e) => setLivingTypeId(e.target.value)}
            className="rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-base focus:border-emerald-500 focus:outline-none"
          >
            <option value="">All living types</option>
            {livingTypes.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
          <select
            value={utility}
            onChange={(e) => setUtility(e.target.value as UtilityType | "")}
            className="rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-base focus:border-emerald-500 focus:outline-none"
          >
            {UTILITY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
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
          <input
            type="number"
            step="0.0001"
            value={unitRate}
            onChange={(e) => setUnitRate(e.target.value)}
            placeholder="ZAR / unit"
            className="rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-base focus:border-emerald-500 focus:outline-none"
            required
          />
          <Button type="submit" disabled={saving} className="sm:col-span-6 sm:justify-self-end">
            {saving ? "Saving…" : "Add tariff"}
          </Button>
        </form>
      </Card>

      {loading ? (
        <div className="h-40 animate-pulse rounded-lg border border-neutral-800 bg-neutral-900" />
      ) : (
        <Card>
          <CardHeader
            title={`Active and historical (${visibleTariffs.length})`}
            subtitle="Per-living-type rates only. Property-wide utility rates are managed under Billing → Rates."
          />
          {visibleTariffs.length === 0 ? (
            <p className="px-5 py-8 text-center text-base text-neutral-500">
              No tariffs with a living type assigned.
            </p>
          ) : (
            <table className="w-full text-base">
              <thead className="text-left text-sm uppercase tracking-wide text-neutral-500">
                <tr>
                  <th className="px-5 py-3">Living type</th>
                  <th className="px-5 py-3">Utility</th>
                  <th className="px-5 py-3">From → to</th>
                  <th className="px-5 py-3 text-right">Rate</th>
                  <th className="px-5 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-800">
                {visibleTariffs.map((t) => (
                  <tr key={t.id}>
                    <td className="px-5 py-3 text-neutral-200">
                      {t.living_type?.name ?? <span className="text-neutral-500">—</span>}
                    </td>
                    <td className="px-5 py-3">
                      {t.utility_type ? (
                        <Pill tone="neutral">{t.utility_type.replace("_", " ")}</Pill>
                      ) : (
                        <Pill tone="sky">accommodation</Pill>
                      )}
                    </td>
                    <td className="px-5 py-3 text-neutral-300">
                      {new Date(t.starts_at).toLocaleDateString()} →{" "}
                      {t.ends_at ? new Date(t.ends_at).toLocaleDateString() : "—"}
                    </td>
                    <td className="px-5 py-3 text-right tabular-nums text-neutral-100">
                      {t.currency} {Number(t.unit_rate).toFixed(2)}
                    </td>
                    <td className="px-5 py-3 text-right">
                      <button
                        onClick={() => remove(t.id)}
                        className="text-sm text-neutral-500 hover:text-red-400"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      )}
    </div>
  );
}
