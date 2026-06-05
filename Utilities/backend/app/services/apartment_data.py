"""Shared data loaders + Influx aggregation for per-apartment utility analytics.

Used by:
  - `/usage/apartment-report` — current consumption + cost
  - `/usage/apartment-insights` — heavy-user ranking + EOM forecast + flags

Keep this layer purely data-shape — no formatting, no presentation.
"""
from __future__ import annotations

from datetime import date, datetime, time
from zoneinfo import ZoneInfo

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.services import influx

SAST = ZoneInfo("Africa/Johannesburg")
UTC = ZoneInfo("UTC")

# Utility → (Influx measurement, display unit, raw tariff unit, water?)
UTILITY_MAP: dict[str, tuple[str, str, str, bool]] = {
    "cold_water":  ("water_data",   "litre", "m³",  True),
    "hot_water":   ("water_data",   "litre", "m³",  True),
    "electricity": ("energy_meter", "kWh",   "kWh", False),
}


def sast_midnight_utc(d: date) -> datetime:
    """Midnight SAST on `d`, expressed as a UTC datetime (for Influx queries)."""
    return datetime.combine(d, time.min, tzinfo=SAST).astimezone(UTC)


async def load_apartments(db: AsyncSession, living_type: str) -> dict[str, dict]:
    """Map apartment.id (str) → {apartment_number, room_ids: [apt_id + children]}."""
    rows = (await db.execute(text("""
        SELECT a.id          AS apt_id,
               a.number      AS apt_number,
               ARRAY_REMOVE(ARRAY_AGG(c.id), NULL) AS child_ids
        FROM rooms a
        JOIN room_types art ON art.id = a.room_type_id
        JOIN living_types lt ON lt.id = art.living_type_id
        LEFT JOIN rooms c ON c.parent_room_id = a.id
        WHERE art.category = 'apartment' AND lt.name = :lt
        GROUP BY a.id, a.number
        ORDER BY a.number
    """), {"lt": living_type})).mappings().all()

    out: dict[str, dict] = {}
    for r in rows:
        out[str(r["apt_id"])] = {
            "apartment_number": r["apt_number"],
            "room_ids": [str(r["apt_id"])] + [str(c) for c in r["child_ids"]],
        }
    return out


async def load_meters_for_rooms(
    db: AsyncSession, room_ids: list[str], *, roots_only: bool = True,
) -> list[dict]:
    """Meters attached to any of the given rooms.

    `roots_only=True` (default) returns only meters with parent_meter_id IS
    NULL — used by Apartment Living where main meters + sub-meters would
    double-count. `roots_only=False` returns all meters on the rooms — used
    by Communal Living where each room has its own counter and parent links
    are effectively meaningless (every Comm_* sub-meter points at Comm_9 in
    the source data).
    """
    if not room_ids:
        return []
    sql = """
        SELECT external_id, utility_type, room_id
        FROM meters
        WHERE room_id = ANY(:ids ::uuid[])
    """
    if roots_only:
        sql += " AND parent_meter_id IS NULL"
    rows = (await db.execute(text(sql), {"ids": room_ids})).mappings().all()
    return [dict(r) for r in rows]


async def load_tariffs(db: AsyncSession, on: date) -> dict[str, dict]:
    """Per-utility tariff for the period containing `on`. Returns {utility: {unit_rate}}."""
    out: dict[str, dict] = {}
    for ut in UTILITY_MAP.keys():
        row = (await db.execute(text("""
            SELECT t.unit_rate
            FROM tariffs t
            JOIN allowance_periods ap ON ap.id = t.period_id
            WHERE t.utility_type = :ut
              AND t.living_type_id IS NULL
              AND ap.starts_at <= :d
              AND (ap.ends_at IS NULL OR ap.ends_at >= :d)
            ORDER BY ap.starts_at DESC
            LIMIT 1
        """), {"ut": ut, "d": on})).mappings().first()
        if row is None:
            continue
        out[ut] = {"unit_rate": float(row["unit_rate"])}
    return out


async def load_occupancy(
    db: AsyncSession, living_type: str, on: date
) -> tuple[date | None, dict[int, dict]]:
    """Latest snapshot ≤ `on`. Returns (snapshot_date, {apt_no: {occupants, beds}})."""
    snap_date = (await db.execute(text("""
        SELECT MAX(snapshot_date) FROM occupancy_snapshots
        WHERE living_type = :lt AND snapshot_date <= :d
    """), {"lt": living_type, "d": on})).scalar_one_or_none()

    if snap_date is None:
        return None, {}

    rows = (await db.execute(text("""
        SELECT apartment_number,
               SUM(occupants)::int AS occupants,
               SUM(beds)::int      AS beds
        FROM occupancy_snapshots
        WHERE living_type = :lt AND snapshot_date = :d
        GROUP BY apartment_number
    """), {"lt": living_type, "d": snap_date})).mappings().all()

    return snap_date, {
        r["apartment_number"]: {"occupants": r["occupants"], "beds": r["beds"]}
        for r in rows
    }


async def load_allowances(db: AsyncSession, living_type: str) -> dict[tuple[str, str], float]:
    """Per-utility allowance for the living type, keyed by (utility, period).

    Returns {(utility, period): units_per_person}. Missing rows mean "no fixed
    allowance set" for that combination. Callers must handle that.
    """
    rows = (await db.execute(text("""
        SELECT a.utility_type, a.period, a.units_per_person
        FROM living_type_allowances a
        JOIN living_types lt ON lt.id = a.living_type_id
        WHERE lt.name = :lt
    """), {"lt": living_type})).mappings().all()
    return {(r["utility_type"], r["period"]): float(r["units_per_person"]) for r in rows}


def meter_apt_index(apartments: dict[str, dict], meters: list[dict]) -> dict[str, str]:
    """external_id → apartment_id."""
    room_to_apt: dict[str, str] = {}
    for apt_id, info in apartments.items():
        for rid in info["room_ids"]:
            room_to_apt[rid] = apt_id
    return {
        m["external_id"]: room_to_apt[str(m["room_id"])]
        for m in meters
        if str(m["room_id"]) in room_to_apt
    }


def consumption_per_apartment(
    measurement: str,
    apt_meter_ids: dict[str, list[str]],
    from_utc: datetime,
    to_utc: datetime,
) -> dict[str, float]:
    """Sum Influx consumption per apartment for a single measurement+window.

    `apt_meter_ids` is {apartment_id: [external_id, ...]} pre-filtered to one utility.
    Returns {apartment_id: total_units} in raw Influx units (m³ or kWh).
    """
    per_meter = influx.consumption_by_meter(measurement, from_utc, to_utc)
    return {
        apt_id: sum(per_meter.get(mid, 0.0) for mid in mids)
        for apt_id, mids in apt_meter_ids.items()
    }
