"""Room-level data loaders — the cohort is the individual room rather than
the apartment. Used by the Communal Insights endpoints.

Mirrors the shape of `apartment_data` so the front-end pages can stay similar.
"""
from __future__ import annotations

from datetime import date

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


async def load_communal_rooms(db: AsyncSession, living_type: str = "Communal Living") -> dict[str, dict]:
    """{room_id_str → {room_number, name, room_type, beds}} for all child rooms
    under the Communal Living collection.
    """
    rows = (await db.execute(text("""
        SELECT r.id, r.number AS room_number, r.name, rt.name AS room_type, rt.occupancy AS beds
        FROM rooms r
        JOIN rooms p             ON p.id = r.parent_room_id
        JOIN room_types prt      ON prt.id = p.room_type_id
        JOIN living_types lt     ON lt.id = prt.living_type_id
        JOIN room_types rt       ON rt.id = r.room_type_id
        WHERE lt.name = :lt
        ORDER BY r.number
    """), {"lt": living_type})).mappings().all()
    return {
        str(r["id"]): {
            "room_number": r["room_number"],
            "name": r["name"],
            "room_type": r["room_type"],
            "beds": r["beds"],
        }
        for r in rows
    }


async def load_occupancy_per_room(
    db: AsyncSession, living_type: str, on: date
) -> tuple[date | None, dict[int, dict]]:
    """Latest snapshot ≤ `on`. {room_number → {occupants, beds, room_type}}."""
    snap_date = (await db.execute(text("""
        SELECT MAX(snapshot_date) FROM occupancy_snapshots
        WHERE living_type = :lt AND snapshot_date <= :d
    """), {"lt": living_type, "d": on})).scalar_one_or_none()

    if snap_date is None:
        return None, {}

    rows = (await db.execute(text("""
        SELECT room_number, occupants, beds, room_type
        FROM occupancy_snapshots
        WHERE living_type = :lt AND snapshot_date = :d
    """), {"lt": living_type, "d": snap_date})).mappings().all()

    return snap_date, {
        r["room_number"]: {
            "occupants": r["occupants"],
            "beds": r["beds"],
            "room_type": r["room_type"],
        }
        for r in rows
    }
