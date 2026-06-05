"use client";

import { useEffect, useMemo, useState } from "react";

import { Card, CardHeader } from "@/components/card";
import { Button } from "@/components/button";
import { Pill } from "@/components/pill";
import {
  api,
  type LivingType,
  type Meter,
  type Room,
  type UtilityType,
} from "@/lib/api";

type SlotUtility = "electricity" | "cold_water" | "hot_water";

const SLOTS: { value: SlotUtility; short: string; tone: "amber" | "sky" | "emerald" }[] = [
  { value: "electricity", short: "Elec", tone: "amber" },
  { value: "cold_water", short: "Cold", tone: "sky" },
  { value: "hot_water", short: "Hot", tone: "emerald" },
];

const UTILITY_FILTER_OPTIONS: { value: UtilityType | ""; label: string }[] = [
  { value: "", label: "All utilities" },
  { value: "electricity", label: "Electricity" },
  { value: "cold_water", label: "Cold water" },
  { value: "hot_water", label: "Hot water" },
  { value: "gas", label: "Gas" },
  { value: "aux", label: "Aux" },
  { value: "temperature", label: "Temperature" },
  { value: "level", label: "Level" },
];

const NO_LIVING_KEY = "__no_living__";

function utilityTone(u: string): "amber" | "sky" | "emerald" | "neutral" {
  if (u === "electricity") return "amber";
  if (u === "cold_water") return "sky";
  if (u === "hot_water") return "emerald";
  return "neutral";
}

const DRAG_MIME = "application/x-meter-id";

export default function RoomsByTypePage() {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [livingTypes, setLivingTypes] = useState<LivingType[]>([]);
  const [allMeters, setAllMeters] = useState<Meter[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Room-side filters
  const [roomSearch, setRoomSearch] = useState("");
  const [livingFilter, setLivingFilter] = useState("");
  const [completeness, setCompleteness] = useState<"all" | "missing_any" | "missing_elec" | "missing_water">("all");

  // Meter-panel filters
  const [meterSearch, setMeterSearch] = useState("");
  const [meterUtility, setMeterUtility] = useState<UtilityType | "">("");
  const [unassignedOnly, setUnassignedOnly] = useState(true);
  const [meterSort, setMeterSort] = useState<"utility" | "external_id" | "room">("utility");

  // Collapsed living-type group keys and collapsed parent-room ids.
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [collapsedParents, setCollapsedParents] = useState<Set<string>>(new Set());

  // Drag state
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [hoverTarget, setHoverTarget] = useState<string | null>(null); // "roomId:slot"

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [r, lt, m] = await Promise.all([
        api.rooms.list(),
        api.livingTypes.list(),
        api.meters.list(),
      ]);
      setRooms(r);
      setLivingTypes(lt);
      setAllMeters(m);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const metersByRoom = useMemo(() => {
    const map = new Map<string, Meter[]>();
    for (const m of allMeters) {
      if (!m.room_id) continue;
      const arr = map.get(m.room_id) ?? [];
      arr.push(m);
      map.set(m.room_id, arr);
    }
    return map;
  }, [allMeters]);

  const roomById = useMemo(() => {
    const map = new Map<string, Room>();
    for (const r of rooms) map.set(r.id, r);
    return map;
  }, [rooms]);

  const childrenByParent = useMemo(() => {
    const map = new Map<string, Room[]>();
    for (const r of rooms) {
      if (!r.parent_room_id) continue;
      const arr = map.get(r.parent_room_id) ?? [];
      arr.push(r);
      map.set(r.parent_room_id, arr);
    }
    for (const arr of map.values()) {
      arr.sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));
    }
    return map;
  }, [rooms]);

  const filteredMeters = useMemo(() => {
    const q = meterSearch.trim().toLowerCase();
    const out = allMeters.filter((m) => {
      if (unassignedOnly && m.room_id) return false;
      if (meterUtility && m.utility_type !== meterUtility) return false;
      if (q) {
        const hay = `${m.external_id} ${m.name ?? ""} ${m.description ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    out.sort((a, b) => {
      if (meterSort === "utility") {
        if (a.utility_type !== b.utility_type) return a.utility_type.localeCompare(b.utility_type);
        return a.external_id.localeCompare(b.external_id, undefined, { numeric: true });
      }
      if (meterSort === "room") {
        const ra = a.room_id ? roomById.get(a.room_id)?.code ?? "~" : "~";
        const rb = b.room_id ? roomById.get(b.room_id)?.code ?? "~" : "~";
        if (ra !== rb) return ra.localeCompare(rb, undefined, { numeric: true });
        return a.external_id.localeCompare(b.external_id, undefined, { numeric: true });
      }
      return a.external_id.localeCompare(b.external_id, undefined, { numeric: true });
    });
    return out;
  }, [allMeters, meterSearch, meterUtility, unassignedOnly, meterSort, roomById]);

  // Build the tree: Living Type → root rooms (with their children as a separate lookup).
  const tree = useMemo(() => {
    const q = roomSearch.trim().toLowerCase();
    const passSearch = (r: Room) =>
      !q ||
      r.code.toLowerCase().includes(q) ||
      r.name.toLowerCase().includes(q) ||
      r.room_type.name.toLowerCase().includes(q) ||
      (r.room_type.living_type?.name ?? "").toLowerCase().includes(q);

    const passCompleteness = (r: Room) => {
      if (completeness === "all") return true;
      const ms = metersByRoom.get(r.id) ?? [];
      const hasElec = ms.some((m) => m.utility_type === "electricity");
      const hasWater = ms.some((m) => m.utility_type === "cold_water" || m.utility_type === "hot_water");
      if (completeness === "missing_elec") return !hasElec;
      if (completeness === "missing_water") return !hasWater;
      return !hasElec || !hasWater;
    };

    const livingKey = (r: Room) => r.room_type.living_type?.id ?? NO_LIVING_KEY;

    const passLiving = (r: Room) => !livingFilter || livingKey(r) === livingFilter;

    // A row is "shown" if it passes search + completeness + living filter, OR if any descendant does.
    const shown = new Set<string>();
    const directHit = new Set<string>();
    for (const r of rooms) {
      if (passSearch(r) && passCompleteness(r) && passLiving(r)) {
        directHit.add(r.id);
        shown.add(r.id);
        // Bubble up: ensure the parent (if any) is shown so this child renders inside its tree.
        let cur: Room | undefined = r;
        while (cur?.parent_room_id) {
          const parent = roomById.get(cur.parent_room_id);
          if (!parent) break;
          shown.add(parent.id);
          cur = parent;
        }
      }
    }

    type Group = { key: string; label: string; abbreviation: string | null; rootRooms: Room[] };
    const groups = new Map<string, Group>();
    for (const r of rooms) {
      if (r.parent_room_id) continue;
      if (!shown.has(r.id)) continue;
      const key = livingKey(r);
      if (!groups.has(key)) {
        const lt = r.room_type.living_type;
        groups.set(key, {
          key,
          label: lt?.name ?? "(no living type)",
          abbreviation: lt?.abbreviation ?? null,
          rootRooms: [],
        });
      }
      groups.get(key)!.rootRooms.push(r);
    }
    const groupList = Array.from(groups.values())
      .sort((a, b) => {
        if (a.key === NO_LIVING_KEY) return 1;
        if (b.key === NO_LIVING_KEY) return -1;
        return a.label.localeCompare(b.label);
      })
      .map((g) => ({
        ...g,
        rootRooms: g.rootRooms
          .slice()
          .sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true })),
      }));

    return { groupList, shown, directHit };
  }, [rooms, roomSearch, livingFilter, completeness, metersByRoom, roomById]);

  const totals = useMemo(() => {
    const matched = tree.directHit.size;
    const unassigned = allMeters.filter((m) => !m.room_id).length;
    return { matched, total: rooms.length, unassigned };
  }, [tree, rooms, allMeters]);

  // --- Drag helpers --------------------------------------------------------

  function onMeterDragStart(e: React.DragEvent<HTMLElement>, m: Meter) {
    e.dataTransfer.setData(DRAG_MIME, m.id);
    e.dataTransfer.effectAllowed = "move";
    setDraggingId(m.id);
  }
  function onMeterDragEnd() {
    setDraggingId(null);
    setHoverTarget(null);
  }
  function slotKey(roomId: string, slot: SlotUtility) {
    return `${roomId}:${slot}`;
  }
  function draggedMeter(): Meter | null {
    return draggingId ? allMeters.find((m) => m.id === draggingId) ?? null : null;
  }
  function slotAcceptsDragged(slot: SlotUtility): boolean {
    const m = draggedMeter();
    return m ? m.utility_type === slot : false;
  }

  async function assignMeter(meterId: string, roomId: string | null) {
    const previous = allMeters;
    setAllMeters((prev) => prev.map((m) => (m.id === meterId ? { ...m, room_id: roomId } : m)));
    try {
      await api.meters.update(meterId, { room_id: roomId });
    } catch (e) {
      setError(String(e));
      setAllMeters(previous);
    }
  }

  function onSlotDragOver(e: React.DragEvent, roomId: string, slot: SlotUtility) {
    if (!slotAcceptsDragged(slot)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setHoverTarget(slotKey(roomId, slot));
  }
  function onSlotDragLeave(roomId: string, slot: SlotUtility) {
    if (hoverTarget === slotKey(roomId, slot)) setHoverTarget(null);
  }
  function onSlotDrop(e: React.DragEvent, roomId: string, slot: SlotUtility) {
    e.preventDefault();
    const meterId = e.dataTransfer.getData(DRAG_MIME);
    setHoverTarget(null);
    setDraggingId(null);
    if (!meterId) return;
    const m = allMeters.find((x) => x.id === meterId);
    if (!m || m.utility_type !== slot) return;
    if (m.room_id === roomId) return;
    assignMeter(meterId, roomId);
  }

  function toggleGroup(key: string) {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }
  function toggleParent(id: string) {
    setCollapsedParents((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  // --- Render --------------------------------------------------------------

  function renderSlotRow(r: Room, depth = 0) {
    const linked = metersByRoom.get(r.id) ?? [];
    const extras = linked.filter((m) => !SLOTS.some((s) => s.value === m.utility_type));
    return (
      <div className={depth > 0 ? "border-l border-neutral-800 pl-4" : ""}>
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-base text-neutral-100">{r.code}</span>
          <span className="text-base text-neutral-300">{r.name}</span>
          <Pill tone="neutral">{r.room_type.name}</Pill>
          {depth === 0 && r.room_type.category && (
            <span className="text-xs uppercase tracking-wide text-neutral-500">
              {r.room_type.category.replace("_", " ")}
            </span>
          )}
        </div>
        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
          {SLOTS.map((slot) => {
            const meter = linked.find((m) => m.utility_type === slot.value);
            const hovered = hoverTarget === slotKey(r.id, slot.value);
            const accepts = draggingId ? slotAcceptsDragged(slot.value) : false;
            const baseBorder =
              slot.tone === "amber"
                ? "border-amber-500/30"
                : slot.tone === "sky"
                  ? "border-sky-500/30"
                  : "border-emerald-500/30";
            return (
              <div
                key={slot.value}
                onDragOver={(e) => onSlotDragOver(e, r.id, slot.value)}
                onDragLeave={() => onSlotDragLeave(r.id, slot.value)}
                onDrop={(e) => onSlotDrop(e, r.id, slot.value)}
                className={`rounded-md border px-3 py-2 transition-colors ${
                  hovered
                    ? "border-emerald-500 bg-emerald-500/10"
                    : accepts
                      ? `${baseBorder} bg-neutral-900`
                      : draggingId
                        ? "border-neutral-800 bg-neutral-950 opacity-50"
                        : "border-neutral-800 bg-neutral-950"
                }`}
              >
                <div className="flex items-center justify-between">
                  <Pill tone={slot.tone}>{slot.short}</Pill>
                  {meter && (
                    <button
                      onClick={() => assignMeter(meter.id, null)}
                      className="text-xs text-neutral-500 hover:text-red-400"
                    >
                      unlink
                    </button>
                  )}
                </div>
                {meter ? (
                  <p
                    className="mt-1 truncate font-mono text-sm text-neutral-100"
                    title={meter.description || meter.external_id}
                  >
                    {meter.external_id}
                  </p>
                ) : (
                  <p className="mt-1 text-xs text-neutral-500">
                    {accepts ? "drop here" : "empty"}
                  </p>
                )}
              </div>
            );
          })}
        </div>
        {extras.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {extras.map((m) => (
              <button
                key={m.id}
                onClick={() => assignMeter(m.id, null)}
                title="Click to unlink"
                className="group flex items-center gap-1"
              >
                <Pill tone={utilityTone(m.utility_type)}>
                  <span className="font-mono">{m.external_id}</span>
                  <span className="ml-1 text-xs text-neutral-400 group-hover:text-red-300">×</span>
                </Pill>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Rooms by living type</h1>
          <p className="text-base text-neutral-500">
            Tree by living type → apartment / communal → sub-rooms. Drag a meter from the left onto a slot.
          </p>
        </div>
        <div className="text-sm text-neutral-500">
          {totals.matched} of {totals.total} rooms match · {totals.unassigned} unassigned meters
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 px-4 py-3 text-base text-red-300">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[320px_minmax(0,1fr)] xl:grid-cols-[360px_minmax(0,1fr)]">
        {/* === LEFT: meter panel ============================================= */}
        <aside className="lg:sticky lg:top-20 lg:max-h-[calc(100vh-6rem)] lg:overflow-hidden">
          <Card className="flex h-full max-h-[calc(100vh-6rem)] flex-col">
            <CardHeader title="Meters" subtitle={`${filteredMeters.length} shown`} />
            <div className="space-y-2 border-b border-neutral-800 px-4 py-3">
              <input
                value={meterSearch}
                onChange={(e) => setMeterSearch(e.target.value)}
                placeholder="Search meters (id, name, description)…"
                className="w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-base focus:border-emerald-500 focus:outline-none"
              />
              <div className="grid grid-cols-2 gap-2">
                <select
                  value={meterUtility}
                  onChange={(e) => setMeterUtility(e.target.value as UtilityType | "")}
                  className="rounded-md border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-sm focus:border-emerald-500 focus:outline-none"
                >
                  {UTILITY_FILTER_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
                <select
                  value={meterSort}
                  onChange={(e) => setMeterSort(e.target.value as typeof meterSort)}
                  className="rounded-md border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-sm focus:border-emerald-500 focus:outline-none"
                >
                  <option value="utility">Sort by utility</option>
                  <option value="external_id">Sort by ID</option>
                  <option value="room">Sort by room</option>
                </select>
              </div>
              <label className="flex items-center gap-2 text-sm text-neutral-300">
                <input
                  type="checkbox"
                  checked={unassignedOnly}
                  onChange={(e) => setUnassignedOnly(e.target.checked)}
                  className="h-3.5 w-3.5 rounded border-neutral-700 bg-neutral-950 accent-emerald-500"
                />
                Unassigned only
              </label>
            </div>
            <ul
              className="flex-1 overflow-y-auto divide-y divide-neutral-800"
              onDragOver={(e) => {
                if (draggingId) {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                }
              }}
              onDrop={(e) => {
                const id = e.dataTransfer.getData(DRAG_MIME);
                setHoverTarget(null);
                setDraggingId(null);
                if (!id) return;
                const m = allMeters.find((x) => x.id === id);
                if (m && m.room_id) assignMeter(id, null);
              }}
            >
              {loading ? (
                <li className="px-4 py-6 text-center text-sm text-neutral-500">Loading…</li>
              ) : filteredMeters.length === 0 ? (
                <li className="px-4 py-6 text-center text-sm text-neutral-500">
                  No meters match the filters.
                </li>
              ) : (
                filteredMeters.map((m) => {
                  const linkedTo = m.room_id ? roomById.get(m.room_id) : null;
                  const dragging = draggingId === m.id;
                  return (
                    <li
                      key={m.id}
                      draggable
                      onDragStart={(e) => onMeterDragStart(e, m)}
                      onDragEnd={onMeterDragEnd}
                      className={`group cursor-grab px-4 py-2 active:cursor-grabbing ${
                        dragging ? "opacity-50" : "hover:bg-neutral-800/40"
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <Pill tone={utilityTone(m.utility_type)}>
                          {m.utility_type.replace("_", " ")}
                        </Pill>
                        <span className="truncate font-mono text-sm text-neutral-100">
                          {m.external_id}
                        </span>
                      </div>
                      {(m.description || m.name) && (
                        <p className="mt-0.5 line-clamp-1 text-xs text-neutral-500">
                          {m.description || m.name}
                        </p>
                      )}
                      {linkedTo && (
                        <p className="mt-0.5 text-xs text-neutral-500">
                          on <span className="font-mono text-neutral-300">{linkedTo.code}</span>{" "}
                          <span className="text-neutral-500">— drag here to unlink</span>
                        </p>
                      )}
                    </li>
                  );
                })
              )}
            </ul>
          </Card>
        </aside>

        {/* === RIGHT: tree by living type ==================================== */}
        <div className="space-y-6">
          <Card>
            <div className="grid grid-cols-1 gap-3 px-5 py-4 sm:grid-cols-[1fr_auto_auto_auto]">
              <input
                value={roomSearch}
                onChange={(e) => setRoomSearch(e.target.value)}
                placeholder="Search rooms (code, name, type, living type)…"
                className="rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-base focus:border-emerald-500 focus:outline-none"
              />
              <select
                value={livingFilter}
                onChange={(e) => setLivingFilter(e.target.value)}
                className="rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-base focus:border-emerald-500 focus:outline-none"
              >
                <option value="">All living types</option>
                {livingTypes
                  .slice()
                  .sort((a, b) => a.name.localeCompare(b.name))
                  .map((lt) => (
                    <option key={lt.id} value={lt.id}>
                      {lt.name}
                    </option>
                  ))}
                <option value={NO_LIVING_KEY}>(no living type)</option>
              </select>
              <select
                value={completeness}
                onChange={(e) => setCompleteness(e.target.value as typeof completeness)}
                className="rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-base focus:border-emerald-500 focus:outline-none"
              >
                <option value="all">All rooms</option>
                <option value="missing_any">Missing any meter</option>
                <option value="missing_elec">Missing electricity</option>
                <option value="missing_water">Missing water</option>
              </select>
              <Button variant="secondary" onClick={load}>
                Refresh
              </Button>
            </div>
          </Card>

          {loading ? (
            <div className="h-40 animate-pulse rounded-lg border border-neutral-800 bg-neutral-900" />
          ) : tree.groupList.length === 0 ? (
            <Card>
              <p className="px-5 py-12 text-center text-base text-neutral-500">
                No rooms match the current filters.
              </p>
            </Card>
          ) : (
            tree.groupList.map((group) => {
              const collapsed = collapsedGroups.has(group.key);
              return (
                <Card key={group.key}>
                  <button
                    onClick={() => toggleGroup(group.key)}
                    className="flex w-full items-center justify-between gap-3 border-b border-neutral-800 px-5 py-4 text-left hover:bg-neutral-800/30"
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-neutral-500">{collapsed ? "▸" : "▾"}</span>
                      <div>
                        <h2 className="text-base font-medium text-neutral-100">{group.label}</h2>
                        <p className="mt-0.5 text-sm text-neutral-500">
                          {group.rootRooms.length} root room{group.rootRooms.length === 1 ? "" : "s"}
                          {group.abbreviation && ` · abbr ${group.abbreviation}`}
                        </p>
                      </div>
                    </div>
                  </button>
                  {!collapsed && (
                    <ul className="divide-y divide-neutral-800">
                      {group.rootRooms.map((root) => {
                        const kids = (childrenByParent.get(root.id) ?? []).filter((c) =>
                          tree.shown.has(c.id),
                        );
                        const hasKids = kids.length > 0;
                        const parentCollapsed = collapsedParents.has(root.id);
                        return (
                          <li key={root.id} className="px-5 py-3">
                            <div className="flex items-start gap-2">
                              {hasKids ? (
                                <button
                                  onClick={() => toggleParent(root.id)}
                                  className="mt-0.5 text-neutral-500 hover:text-neutral-200"
                                  aria-label={parentCollapsed ? "Expand" : "Collapse"}
                                >
                                  {parentCollapsed ? "▸" : "▾"}
                                </button>
                              ) : (
                                <span className="mt-0.5 text-neutral-700">·</span>
                              )}
                              <div className="flex-1">{renderSlotRow(root, 0)}</div>
                            </div>
                            {hasKids && !parentCollapsed && (
                              <ul className="ml-6 mt-3 space-y-3">
                                {kids.map((child) => (
                                  <li key={child.id}>{renderSlotRow(child, 1)}</li>
                                ))}
                              </ul>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </Card>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
