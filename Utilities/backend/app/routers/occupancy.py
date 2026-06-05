from fastapi import APIRouter, Depends, Query
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.schemas.occupancy import ApartmentOccupancy, ApartmentOccupancyResponse

router = APIRouter(prefix="/occupancy", tags=["occupancy"])


@router.get("/by-apartment", response_model=ApartmentOccupancyResponse)
async def by_apartment(
    living_type: str = Query(..., description="e.g. 'Apartment Living'"),
    db: AsyncSession = Depends(get_db),
) -> ApartmentOccupancyResponse:
    """Latest per-apartment occupancy roll-up from occupancy_snapshots."""
    latest_date = (await db.execute(
        text(
            "SELECT MAX(snapshot_date) FROM occupancy_snapshots WHERE living_type = :lt"
        ),
        {"lt": living_type},
    )).scalar_one_or_none()

    if latest_date is None:
        return ApartmentOccupancyResponse(
            snapshot_date=None, living_type=living_type, apartments=[]
        )

    rows = (await db.execute(
        text(
            """
            SELECT apartment_number,
                   SUM(occupants)::int AS occupants,
                   SUM(beds)::int      AS beds,
                   COUNT(*)::int       AS rooms
            FROM occupancy_snapshots
            WHERE living_type = :lt AND snapshot_date = :d
            GROUP BY apartment_number
            ORDER BY apartment_number
            """
        ),
        {"lt": living_type, "d": latest_date},
    )).mappings().all()

    return ApartmentOccupancyResponse(
        snapshot_date=latest_date,
        living_type=living_type,
        apartments=[
            ApartmentOccupancy(
                apartment_number=r["apartment_number"],
                living_type=living_type,
                occupants=r["occupants"],
                beds=r["beds"],
                rooms=r["rooms"],
            )
            for r in rows
        ],
    )
