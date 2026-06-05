"use client";

import { useEffect, useState } from "react";

import { Card, CardHeader } from "@/components/card";
import { Button } from "@/components/button";
import { Pill } from "@/components/pill";
import { api, type LivingType, type RoomCategory, type RoomType } from "@/lib/api";

const CATEGORY_OPTIONS: { value: RoomCategory; label: string }[] = [
  { value: "apartment", label: "Apartment" },
  { value: "apartment_room", label: "Apartment room" },
  { value: "communal", label: "Communal" },
  { value: "facility", label: "Facility" },
];

const CATEGORY_TONE: Record<RoomCategory, "neutral" | "emerald" | "amber" | "red" | "sky"> = {
  apartment: "emerald",
  apartment_room: "sky",
  communal: "amber",
  facility: "neutral",
};

function categoryLabel(c: RoomCategory) {
  return CATEGORY_OPTIONS.find((o) => o.value === c)?.label ?? c;
}

export default function RoomTypesPage() {
  const [roomTypes, setRoomTypes] = useState<RoomType[]>([]);
  const [livingTypes, setLivingTypes] = useState<LivingType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [category, setCategory] = useState<RoomCategory>("apartment_room");
  const [livingTypeId, setLivingTypeId] = useState("");
  const [occupancy, setOccupancy] = useState("1");
  const [shareable, setShareable] = useState(false);
  const [showMessage, setShowMessage] = useState(false);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editCategory, setEditCategory] = useState<RoomCategory>("apartment_room");
  const [editLivingTypeId, setEditLivingTypeId] = useState("");
  const [editOccupancy, setEditOccupancy] = useState("1");
  const [editShareable, setEditShareable] = useState(false);
  const [editShowMessage, setEditShowMessage] = useState(false);
  const [editMessage, setEditMessage] = useState("");

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [rt, lt] = await Promise.all([api.roomTypes.list(), api.livingTypes.list()]);
      setRoomTypes(rt);
      setLivingTypes(lt);
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
      await api.roomTypes.create({
        name: name.trim(),
        category,
        living_type_id: livingTypeId || null,
        occupancy: Number(occupancy) || 1,
        shareable,
        show_message: showMessage,
        message: showMessage ? message.trim() || null : null,
      });
      setName("");
      setCategory("apartment_room");
      setLivingTypeId("");
      setOccupancy("1");
      setShareable(false);
      setShowMessage(false);
      setMessage("");
      await load();
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }

  function startEdit(rt: RoomType) {
    setEditingId(rt.id);
    setEditName(rt.name);
    setEditCategory(rt.category);
    setEditLivingTypeId(rt.living_type_id ?? "");
    setEditOccupancy(String(rt.occupancy));
    setEditShareable(rt.shareable);
    setEditShowMessage(rt.show_message);
    setEditMessage(rt.message ?? "");
  }

  function cancelEdit() {
    setEditingId(null);
  }

  async function saveEdit(id: string) {
    if (!editName.trim()) return;
    try {
      await api.roomTypes.update(id, {
        name: editName.trim(),
        category: editCategory,
        living_type_id: editLivingTypeId || null,
        occupancy: Number(editOccupancy) || 1,
        shareable: editShareable,
        show_message: editShowMessage,
        message: editShowMessage ? editMessage.trim() || null : null,
      });
      cancelEdit();
      await load();
    } catch (e) {
      setError(String(e));
    }
  }

  async function remove(id: string) {
    if (!confirm("Delete this room type?")) return;
    try {
      await api.roomTypes.remove(id);
      await load();
    } catch (e) {
      setError(String(e));
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Room types</h1>
        <p className="text-base text-neutral-500">
          Templates that define what each room is — category, occupancy, sharing rules and an
          optional living type for billing.
        </p>
      </div>

      {error && (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 px-4 py-3 text-base text-red-300">
          {error}
        </div>
      )}

      <Card>
        <CardHeader title="Add room type" />
        <form onSubmit={create} className="grid grid-cols-1 gap-3 px-5 py-4 sm:grid-cols-6">
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
            className="rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-base focus:border-emerald-500 focus:outline-none sm:col-span-2"
            required
          >
            {CATEGORY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <select
            value={livingTypeId}
            onChange={(e) => setLivingTypeId(e.target.value)}
            className="rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-base focus:border-emerald-500 focus:outline-none sm:col-span-2"
          >
            <option value="">No living type</option>
            {livingTypes.map((lt) => (
              <option key={lt.id} value={lt.id}>
                {lt.name}
              </option>
            ))}
          </select>
          <input
            type="number"
            min="1"
            value={occupancy}
            onChange={(e) => setOccupancy(e.target.value)}
            placeholder="Occupancy"
            className="rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-base focus:border-emerald-500 focus:outline-none sm:col-span-2"
            required
          />
          <label className="flex items-center gap-2 text-base text-neutral-300 sm:col-span-2">
            <input
              type="checkbox"
              checked={shareable}
              onChange={(e) => setShareable(e.target.checked)}
              className="h-4 w-4 rounded border-neutral-700 bg-neutral-950 accent-emerald-500"
            />
            Shareable
          </label>
          <label className="flex items-center gap-2 text-base text-neutral-300 sm:col-span-2">
            <input
              type="checkbox"
              checked={showMessage}
              onChange={(e) => setShowMessage(e.target.checked)}
              className="h-4 w-4 rounded border-neutral-700 bg-neutral-950 accent-emerald-500"
            />
            Show message
          </label>
          {showMessage && (
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Message shown for this room type"
              rows={2}
              className="rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-base focus:border-emerald-500 focus:outline-none sm:col-span-6"
            />
          )}
          <Button type="submit" disabled={saving} className="sm:col-span-6 sm:justify-self-end">
            {saving ? "Saving…" : "Add room type"}
          </Button>
        </form>
      </Card>

      {loading ? (
        <div className="h-40 animate-pulse rounded-lg border border-neutral-800 bg-neutral-900" />
      ) : (
        <Card>
          <CardHeader title={`Room types (${roomTypes.length})`} />
          {roomTypes.length === 0 ? (
            <p className="px-5 py-8 text-center text-base text-neutral-500">
              No room types yet.
            </p>
          ) : (
            <table className="w-full text-base">
              <thead className="text-left text-sm uppercase tracking-wide text-neutral-500">
                <tr>
                  <th className="px-5 py-3">Name</th>
                  <th className="px-5 py-3">Category</th>
                  <th className="px-5 py-3">Living type</th>
                  <th className="px-5 py-3 text-right">Occupancy</th>
                  <th className="px-5 py-3">Shareable</th>
                  <th className="px-5 py-3">Message</th>
                  <th className="px-5 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-800">
                {roomTypes.map((rt) => {
                  const isEditing = editingId === rt.id;
                  if (isEditing) {
                    return (
                      <tr key={rt.id} className="align-top">
                        <td className="px-5 py-3">
                          <input
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            className="w-full rounded-md border border-neutral-700 bg-neutral-950 px-2 py-1 text-base focus:border-emerald-500 focus:outline-none"
                          />
                        </td>
                        <td className="px-5 py-3">
                          <select
                            value={editCategory}
                            onChange={(e) => setEditCategory(e.target.value as RoomCategory)}
                            className="w-full rounded-md border border-neutral-700 bg-neutral-950 px-2 py-1 text-base focus:border-emerald-500 focus:outline-none"
                          >
                            {CATEGORY_OPTIONS.map((o) => (
                              <option key={o.value} value={o.value}>
                                {o.label}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="px-5 py-3">
                          <select
                            value={editLivingTypeId}
                            onChange={(e) => setEditLivingTypeId(e.target.value)}
                            className="w-full rounded-md border border-neutral-700 bg-neutral-950 px-2 py-1 text-base focus:border-emerald-500 focus:outline-none"
                          >
                            <option value="">—</option>
                            {livingTypes.map((lt) => (
                              <option key={lt.id} value={lt.id}>
                                {lt.name}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="px-5 py-3 text-right">
                          <input
                            type="number"
                            min="1"
                            value={editOccupancy}
                            onChange={(e) => setEditOccupancy(e.target.value)}
                            className="w-20 rounded-md border border-neutral-700 bg-neutral-950 px-2 py-1 text-right text-base focus:border-emerald-500 focus:outline-none"
                          />
                        </td>
                        <td className="px-5 py-3">
                          <input
                            type="checkbox"
                            checked={editShareable}
                            onChange={(e) => setEditShareable(e.target.checked)}
                            className="h-4 w-4 rounded border-neutral-700 bg-neutral-950 accent-emerald-500"
                          />
                        </td>
                        <td className="px-5 py-3">
                          <label className="flex items-center gap-2 text-sm text-neutral-300">
                            <input
                              type="checkbox"
                              checked={editShowMessage}
                              onChange={(e) => setEditShowMessage(e.target.checked)}
                              className="h-4 w-4 rounded border-neutral-700 bg-neutral-950 accent-emerald-500"
                            />
                            Show
                          </label>
                          {editShowMessage && (
                            <textarea
                              value={editMessage}
                              onChange={(e) => setEditMessage(e.target.value)}
                              rows={2}
                              className="mt-2 w-full rounded-md border border-neutral-700 bg-neutral-950 px-2 py-1 text-base focus:border-emerald-500 focus:outline-none"
                            />
                          )}
                        </td>
                        <td className="px-5 py-3 text-right">
                          <div className="flex justify-end gap-3">
                            <button
                              onClick={() => saveEdit(rt.id)}
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
                        </td>
                      </tr>
                    );
                  }
                  return (
                    <tr key={rt.id}>
                      <td className="px-5 py-3 text-neutral-100">{rt.name}</td>
                      <td className="px-5 py-3">
                        <Pill tone={CATEGORY_TONE[rt.category]}>{categoryLabel(rt.category)}</Pill>
                      </td>
                      <td className="px-5 py-3 text-neutral-300">
                        {rt.living_type?.name ?? <span className="text-neutral-500">—</span>}
                      </td>
                      <td className="px-5 py-3 text-right tabular-nums text-neutral-200">
                        {rt.occupancy}
                      </td>
                      <td className="px-5 py-3">
                        {rt.shareable ? (
                          <Pill tone="emerald">Yes</Pill>
                        ) : (
                          <span className="text-sm text-neutral-500">No</span>
                        )}
                      </td>
                      <td className="px-5 py-3 text-neutral-300">
                        {rt.show_message && rt.message ? (
                          <span title={rt.message} className="line-clamp-1 max-w-xs text-sm">
                            {rt.message}
                          </span>
                        ) : (
                          <span className="text-neutral-500">—</span>
                        )}
                      </td>
                      <td className="px-5 py-3 text-right">
                        <div className="flex justify-end gap-3">
                          <button
                            onClick={() => startEdit(rt)}
                            className="text-sm text-neutral-400 hover:text-white"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => remove(rt.id)}
                            className="text-sm text-neutral-500 hover:text-red-400"
                          >
                            Delete
                          </button>
                        </div>
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
