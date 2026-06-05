"use client";

import { useEffect, useState } from "react";

import { Card, CardHeader } from "@/components/card";
import { Button } from "@/components/button";
import { api, type LivingType } from "@/lib/api";

export default function LivingTypesPage() {
  const [livingTypes, setLivingTypes] = useState<LivingType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [abbreviation, setAbbreviation] = useState("");
  const [saving, setSaving] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editAbbreviation, setEditAbbreviation] = useState("");

  async function load() {
    setLoading(true);
    setError(null);
    try {
      setLivingTypes(await api.livingTypes.list());
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
    if (!name.trim()) return;
    setSaving(true);
    try {
      await api.livingTypes.create({
        name: name.trim(),
        abbreviation: abbreviation.trim() || null,
      });
      setName("");
      setAbbreviation("");
      await load();
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }

  function startEdit(lt: LivingType) {
    setEditingId(lt.id);
    setEditName(lt.name);
    setEditAbbreviation(lt.abbreviation ?? "");
  }
  function cancelEdit() {
    setEditingId(null);
  }
  async function saveEdit(id: string) {
    if (!editName.trim()) return;
    try {
      await api.livingTypes.update(id, {
        name: editName.trim(),
        abbreviation: editAbbreviation.trim() || null,
      });
      cancelEdit();
      await load();
    } catch (e) {
      setError(String(e));
    }
  }
  async function removeLivingType(id: string) {
    if (!confirm("Delete this living type?")) return;
    try {
      await api.livingTypes.remove(id);
      await load();
    } catch (e) {
      setError(String(e));
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Living types</h1>
        <p className="text-base text-neutral-500">
          Categories used to group room types (e.g. Apartment Living, Communal Living).
        </p>
      </div>

      {error && (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 px-4 py-3 text-base text-red-300">
          {error}
        </div>
      )}

      <Card>
        <CardHeader title="Add living type" />
        <form onSubmit={create} className="grid grid-cols-1 gap-3 px-5 py-4 sm:grid-cols-6">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name"
            className="rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-base focus:border-emerald-500 focus:outline-none sm:col-span-3"
            required
          />
          <input
            value={abbreviation}
            onChange={(e) => setAbbreviation(e.target.value)}
            placeholder="Abbreviation (optional)"
            className="rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-base focus:border-emerald-500 focus:outline-none sm:col-span-2"
          />
          <Button type="submit" disabled={saving} className="sm:justify-self-end">
            {saving ? "Saving…" : "Add"}
          </Button>
        </form>
      </Card>

      {loading ? (
        <div className="h-40 animate-pulse rounded-lg border border-neutral-800 bg-neutral-900" />
      ) : (
        <Card>
          <CardHeader title={`Living types (${livingTypes.length})`} />
          {livingTypes.length === 0 ? (
            <p className="px-5 py-8 text-center text-base text-neutral-500">
              No living types yet.
            </p>
          ) : (
            <table className="w-full text-base">
              <thead className="text-left text-sm uppercase tracking-wide text-neutral-500">
                <tr>
                  <th className="px-5 py-3">Name</th>
                  <th className="px-5 py-3">Abbreviation</th>
                  <th className="px-5 py-3">Updated</th>
                  <th className="px-5 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-800">
                {livingTypes.map((lt) => {
                  const isEditing = editingId === lt.id;
                  return (
                    <tr key={lt.id}>
                      <td className="px-5 py-3 text-neutral-100">
                        {isEditing ? (
                          <input
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            className="w-full rounded-md border border-neutral-700 bg-neutral-950 px-2 py-1 text-base focus:border-emerald-500 focus:outline-none"
                          />
                        ) : (
                          lt.name
                        )}
                      </td>
                      <td className="px-5 py-3 text-neutral-300">
                        {isEditing ? (
                          <input
                            value={editAbbreviation}
                            onChange={(e) => setEditAbbreviation(e.target.value)}
                            className="w-full rounded-md border border-neutral-700 bg-neutral-950 px-2 py-1 text-base focus:border-emerald-500 focus:outline-none"
                          />
                        ) : (
                          lt.abbreviation ?? <span className="text-neutral-500">—</span>
                        )}
                      </td>
                      <td className="px-5 py-3 text-neutral-400">
                        {new Date(lt.updated_at).toLocaleDateString()}
                      </td>
                      <td className="px-5 py-3 text-right">
                        {isEditing ? (
                          <div className="flex justify-end gap-3">
                            <button
                              onClick={() => saveEdit(lt.id)}
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
                              onClick={() => startEdit(lt)}
                              className="text-sm text-neutral-400 hover:text-white"
                            >
                              Edit
                            </button>
                            <button
                              onClick={() => removeLivingType(lt.id)}
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
