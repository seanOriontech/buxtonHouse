from fastapi import APIRouter
from pydantic import BaseModel

from app.services import influx

router = APIRouter(prefix="/aux-tags", tags=["aux-tags"])


class AuxTag(BaseModel):
    external_id: str
    value: float | None
    units: str | None
    description: str | None
    last_seen: str | None
    stale: bool


@router.get("", response_model=list[AuxTag])
async def list_aux_tags() -> list[AuxTag]:
    """Latest value for every aux_data tag (plant-room / energy-system
    telemetry), one row per meter_id. Read straight from Influx — these tags
    are not modelled in the `meters` table."""
    rows = influx.latest_per_meter(influx.KNOWN_AUX_MEASUREMENT)
    out: list[AuxTag] = []
    for r in rows:
        ext = r.get("external_id")
        if not ext:
            continue
        ts = r.get("ts")
        raw = r.get("value")
        try:
            value = float(raw) if raw is not None else None
        except (TypeError, ValueError):
            value = None
        out.append(
            AuxTag(
                external_id=ext,
                value=value,
                units=r.get("units"),
                description=r.get("description"),
                last_seen=ts.isoformat() if ts is not None else None,
                stale=influx.is_stale(ts),
            )
        )
    out.sort(key=lambda t: t.external_id.lower())
    return out
