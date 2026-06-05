"""Source attribution endpoints — answers "where is the consumption coming from".

  - /usage/apartment-baseline-draw
        Per-apartment electricity draw between 02:00 and 05:00 SAST, averaged
        across the last N nights. The "always-on" fridge + standby + heater
        load. Cohort percentiles flag the wasteful baselines.

  - /usage/apartment-submeter-breakdown?apartment_number=N
        Within a single apartment, split MTD electricity across the per-room
        sub-meters (A1_1, A1_2, … under main meter A1) so the operator can
        see WHICH ROOM is driving the apartment's heavy reading.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta
from statistics import median

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.schemas.sources import (
    BaselineDrawResponse,
    BaselineRow,
    CommunalBaselineDrawResponse,
    CommunalBaselineRow,
    CommunalSubmeterBreakdownResponse,
    CommunalSubmeterRow,
    SubmeterBreakdownResponse,
    SubmeterRow,
)
from app.services import apartment_data as ad
from app.services import influx as influx_svc
from app.services import room_data as rd

router = APIRouter(prefix="/usage", tags=["usage"])

NIGHT_START_HOUR = 2
NIGHT_END_HOUR = 5
DEFAULT_NIGHTS = 7


def _percentile(sorted_vals: list[float], pct: float) -> float:
    if not sorted_vals:
        return 0.0
    if len(sorted_vals) == 1:
        return sorted_vals[0]
    k = (pct / 100.0) * (len(sorted_vals) - 1)
    lo = int(k); hi = min(lo + 1, len(sorted_vals) - 1)
    return sorted_vals[lo] + (sorted_vals[hi] - sorted_vals[lo]) * (k - lo)


@router.get("/apartment-baseline-draw", response_model=BaselineDrawResponse)
async def apartment_baseline_draw(
    living_type: str = Query("Apartment Living"),
    nights: int = Query(DEFAULT_NIGHTS, ge=3, le=30),
    on: date | None = Query(None),
    db: AsyncSession = Depends(get_db),
) -> BaselineDrawResponse:
    today_sast = datetime.now(ad.SAST).date()
    ref_date = on or today_sast
    yday = ref_date - timedelta(days=1)

    apartments = await ad.load_apartments(db, living_type)
    if not apartments:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"no apartments for living_type={living_type}")

    all_room_ids = [rid for info in apartments.values() for rid in info["room_ids"]]
    meters = await ad.load_meters_for_rooms(db, all_room_ids)  # roots_only=True → main meter per apt
    meter_to_apt = ad.meter_apt_index(apartments, meters)

    elec_main_meters = [m for m in meters if m["utility_type"] == "electricity"]
    elec_ids = [m["external_id"] for m in elec_main_meters]
    _, occ_by_apt = await ad.load_occupancy(db, living_type, ref_date)

    # Night-start UTC datetimes for last N nights — 02:00 SAST = UTC 00:00
    night_starts = [
        ad.sast_midnight_utc(yday - timedelta(days=i)) + timedelta(hours=NIGHT_START_HOUR)
        for i in range(nights - 1, -1, -1)
    ]
    window_hours = NIGHT_END_HOUR - NIGHT_START_HOUR  # 3 h

    per_meter = influx_svc.nightly_window_consumption_by_meter(
        "energy_meter", night_starts, window_hours=window_hours, meter_ids=elec_ids,
    )

    # Build per-apartment series of nightly kWh, then compute average
    rows: list[BaselineRow] = []
    cohort_watts: list[float] = []
    for apt_id, info in apartments.items():
        apt_no = info["apartment_number"]
        # Sum across all electricity main meters for this apartment (usually 1)
        nightly_kwh_arrays: list[list[float]] = []
        for m in elec_main_meters:
            if meter_to_apt.get(m["external_id"]) != apt_id:
                continue
            nightly_kwh_arrays.append(per_meter.get(m["external_id"], [0.0] * nights))
        if not nightly_kwh_arrays:
            continue
        nightly_kwh = [sum(a[i] for a in nightly_kwh_arrays) for i in range(nights)]
        observed = [v for v in nightly_kwh if v > 0]
        avg_kwh = (sum(nightly_kwh) / len(nightly_kwh)) if nightly_kwh else 0.0
        # Convert kWh-per-(3h-window) to average watts: kWh × 1000 / hours
        avg_watts = (avg_kwh * 1000.0 / window_hours) if window_hours > 0 else 0.0

        rows.append(BaselineRow(
            apartment_number=apt_no,
            occupants=occ_by_apt.get(apt_no, {}).get("occupants", 0),
            avg_overnight_kwh=avg_kwh,
            avg_overnight_watts=avg_watts,
            nights_observed=len(observed),
            severity=None,  # filled below after cohort stats
        ))
        cohort_watts.append(avg_watts)

    cohort_watts.sort()
    p50 = _percentile(cohort_watts, 50)
    p75 = _percentile(cohort_watts, 75)
    p90 = _percentile(cohort_watts, 90)

    for r in rows:
        if r.avg_overnight_watts >= p90 and p90 > 0:
            r.severity = "red"
        elif r.avg_overnight_watts >= p75 and p75 > 0:
            r.severity = "amber"

    rows.sort(key=lambda r: -r.avg_overnight_watts)

    return BaselineDrawResponse(
        living_type=living_type,
        report_date=ref_date,
        nights=nights,
        window_start_hour=NIGHT_START_HOUR,
        window_end_hour=NIGHT_END_HOUR,
        cohort_median_watts=p50,
        cohort_p75_watts=p75,
        cohort_p90_watts=p90,
        rows=rows,
    )


@router.get("/apartment-submeter-breakdown", response_model=SubmeterBreakdownResponse)
async def apartment_submeter_breakdown(
    apartment_number: int = Query(...),
    living_type: str = Query("Apartment Living"),
    on: date | None = Query(None),
    db: AsyncSession = Depends(get_db),
) -> SubmeterBreakdownResponse:
    ref_date = on or datetime.now(ad.SAST).date()
    month_start = ref_date.replace(day=1)
    days_elapsed = max(1, (ref_date - month_start).days + 1)

    apartments = await ad.load_apartments(db, living_type)
    apt_id = next(
        (apt_id for apt_id, info in apartments.items() if info["apartment_number"] == apartment_number),
        None,
    )
    if apt_id is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"apartment {apartment_number} not found")

    # Sub-meters: electricity meters whose room is a CHILD of this apartment
    apt_room_id = apt_id
    rows = (await db.execute(text("""
        SELECT m.external_id, r.name AS room_name, r.number AS room_number
        FROM meters m
        JOIN rooms  r ON r.id = m.room_id
        WHERE r.parent_room_id = CAST(:apt_id AS uuid)
          AND m.utility_type = 'electricity'
        ORDER BY r.number
    """), {"apt_id": apt_room_id})).mappings().all()
    sub_ids = [r["external_id"] for r in rows]

    # Main meter (attached to the apartment-level room itself)
    main_row = (await db.execute(text("""
        SELECT external_id
        FROM meters
        WHERE room_id = CAST(:apt_id AS uuid)
          AND utility_type = 'electricity'
          AND parent_meter_id IS NULL
        LIMIT 1
    """), {"apt_id": apt_room_id})).first()
    main_ext = main_row[0] if main_row else None

    # Influx — MTD consumption per meter (one query covers all)
    mtd_from = ad.sast_midnight_utc(month_start)
    mtd_to   = ad.sast_midnight_utc(ref_date + timedelta(days=1))
    per_meter = influx_svc.consumption_by_meter("energy_meter", mtd_from, mtd_to)

    # Tariff for cost calc
    tariffs = await ad.load_tariffs(db, ref_date)
    rate = tariffs.get("electricity", {}).get("unit_rate", 0.0)

    sub_kwh_total = sum(per_meter.get(ext, 0.0) for ext in sub_ids)
    submeter_rows: list[SubmeterRow] = []
    for r in rows:
        kwh = per_meter.get(r["external_id"], 0.0)
        submeter_rows.append(SubmeterRow(
            external_id=r["external_id"],
            room_number=r["room_number"],
            room_name=r["room_name"],
            mtd_kwh=kwh,
            mtd_cost=kwh * rate,
            pct_of_apartment_total=(kwh / sub_kwh_total * 100.0) if sub_kwh_total > 0 else 0.0,
        ))
    submeter_rows.sort(key=lambda x: -x.mtd_kwh)

    return SubmeterBreakdownResponse(
        apartment_number=apartment_number,
        living_type=living_type,
        report_date=ref_date,
        days_elapsed_mtd=days_elapsed,
        total_submeter_mtd_kwh=sub_kwh_total,
        total_submeter_mtd_cost=sub_kwh_total * rate,
        main_meter_external_id=main_ext,
        main_meter_mtd_kwh=per_meter.get(main_ext, 0.0) if main_ext else None,
        submeters=submeter_rows,
    )


# --- Communal variants -------------------------------------------------------

COMMUNAL_LIVING_TYPE = "Communal Living"


@router.get("/communal-baseline-draw", response_model=CommunalBaselineDrawResponse)
async def communal_baseline_draw(
    nights: int = Query(DEFAULT_NIGHTS, ge=3, le=30),
    on: date | None = Query(None),
    db: AsyncSession = Depends(get_db),
) -> CommunalBaselineDrawResponse:
    """Same overnight-load detector as `/apartment-baseline-draw`, but the
    cohort is the 36 Communal Living rooms instead of the 19 apartments.
    Catches always-on heaters / fridges / chargers in the common-area rooms.
    """
    today_sast = datetime.now(ad.SAST).date()
    ref_date = on or today_sast
    yday = ref_date - timedelta(days=1)

    rooms = await rd.load_communal_rooms(db, COMMUNAL_LIVING_TYPE)
    if not rooms:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"no rooms for living_type={COMMUNAL_LIVING_TYPE}")

    room_ids = list(rooms.keys())
    # Communal: include all meters (no parent/child hierarchy that double-counts)
    meters = await ad.load_meters_for_rooms(db, room_ids, roots_only=False)
    elec_meters = [m for m in meters if m["utility_type"] == "electricity"]
    elec_ids = [m["external_id"] for m in elec_meters]

    # room_id (str) → [external_id, ...]
    room_to_elec: dict[str, list[str]] = {}
    for m in elec_meters:
        room_to_elec.setdefault(str(m["room_id"]), []).append(m["external_id"])

    _, occ_by_room = await rd.load_occupancy_per_room(db, COMMUNAL_LIVING_TYPE, ref_date)

    night_starts = [
        ad.sast_midnight_utc(yday - timedelta(days=i)) + timedelta(hours=NIGHT_START_HOUR)
        for i in range(nights - 1, -1, -1)
    ]
    window_hours = NIGHT_END_HOUR - NIGHT_START_HOUR

    per_meter = influx_svc.nightly_window_consumption_by_meter(
        "energy_meter", night_starts, window_hours=window_hours, meter_ids=elec_ids,
    )

    rows: list[CommunalBaselineRow] = []
    cohort_watts: list[float] = []
    for rid, info in rooms.items():
        mids = room_to_elec.get(rid, [])
        if not mids:
            continue
        nightly_kwh = [sum(per_meter.get(mid, [0.0] * nights)[i] for mid in mids) for i in range(nights)]
        observed = [v for v in nightly_kwh if v > 0]
        avg_kwh = (sum(nightly_kwh) / len(nightly_kwh)) if nightly_kwh else 0.0
        avg_watts = (avg_kwh * 1000.0 / window_hours) if window_hours > 0 else 0.0

        rows.append(CommunalBaselineRow(
            room_id=rid,
            room_number=info["room_number"],
            room_name=info["name"],
            room_type=info["room_type"],
            occupants=occ_by_room.get(info["room_number"], {}).get("occupants", 0),
            avg_overnight_kwh=avg_kwh,
            avg_overnight_watts=avg_watts,
            nights_observed=len(observed),
            severity=None,
        ))
        cohort_watts.append(avg_watts)

    cohort_watts.sort()
    p50 = _percentile(cohort_watts, 50)
    p75 = _percentile(cohort_watts, 75)
    p90 = _percentile(cohort_watts, 90)

    for r in rows:
        if r.avg_overnight_watts >= p90 and p90 > 0:
            r.severity = "red"
        elif r.avg_overnight_watts >= p75 and p75 > 0:
            r.severity = "amber"

    rows.sort(key=lambda r: -r.avg_overnight_watts)

    return CommunalBaselineDrawResponse(
        living_type=COMMUNAL_LIVING_TYPE,
        report_date=ref_date,
        nights=nights,
        window_start_hour=NIGHT_START_HOUR,
        window_end_hour=NIGHT_END_HOUR,
        cohort_median_watts=p50,
        cohort_p75_watts=p75,
        cohort_p90_watts=p90,
        rows=rows,
    )


@router.get("/communal-submeter-breakdown", response_model=CommunalSubmeterBreakdownResponse)
async def communal_submeter_breakdown(
    room_id: str = Query(..., description="Communal room UUID"),
    on: date | None = Query(None),
    db: AsyncSession = Depends(get_db),
) -> CommunalSubmeterBreakdownResponse:
    """Split this communal room's MTD electricity across the meters attached
    to it. Most communal rooms only have a single meter — in that case the
    breakdown table is one row showing the whole consumption. Rooms with
    multiple meters (e.g. Comm_9 with its Comm_9_* children) get a split.
    """
    ref_date = on or datetime.now(ad.SAST).date()
    month_start = ref_date.replace(day=1)
    days_elapsed = max(1, (ref_date - month_start).days + 1)

    rooms = await rd.load_communal_rooms(db, COMMUNAL_LIVING_TYPE)
    info = rooms.get(room_id)
    if info is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"communal room {room_id} not found")

    meters = await ad.load_meters_for_rooms(db, [room_id], roots_only=False)
    elec_meters = [m for m in meters if m["utility_type"] == "electricity"]
    if not elec_meters:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"no electricity meters on room {room_id}")

    main_row = (await db.execute(text("""
        SELECT external_id
        FROM meters
        WHERE room_id = CAST(:rid AS uuid)
          AND utility_type = 'electricity'
          AND parent_meter_id IS NULL
        ORDER BY external_id
        LIMIT 1
    """), {"rid": room_id})).first()
    main_ext = main_row[0] if main_row else None

    mtd_from = ad.sast_midnight_utc(month_start)
    mtd_to   = ad.sast_midnight_utc(ref_date + timedelta(days=1))
    per_meter = influx_svc.consumption_by_meter("energy_meter", mtd_from, mtd_to)

    tariffs = await ad.load_tariffs(db, ref_date)
    rate = tariffs.get("electricity", {}).get("unit_rate", 0.0)

    rows: list[CommunalSubmeterRow] = []
    total_kwh = 0.0
    for m in elec_meters:
        kwh = per_meter.get(m["external_id"], 0.0)
        total_kwh += kwh
        rows.append(CommunalSubmeterRow(
            external_id=m["external_id"],
            mtd_kwh=kwh,
            mtd_cost=kwh * rate,
            pct_of_room_total=0.0,  # filled below
        ))
    for r in rows:
        r.pct_of_room_total = (r.mtd_kwh / total_kwh * 100.0) if total_kwh > 0 else 0.0
    rows.sort(key=lambda x: -x.mtd_kwh)

    return CommunalSubmeterBreakdownResponse(
        room_id=room_id,
        room_number=info["room_number"],
        room_name=info["name"],
        living_type=COMMUNAL_LIVING_TYPE,
        report_date=ref_date,
        days_elapsed_mtd=days_elapsed,
        total_submeter_mtd_kwh=total_kwh,
        total_submeter_mtd_cost=total_kwh * rate,
        main_meter_external_id=main_ext,
        main_meter_mtd_kwh=per_meter.get(main_ext, 0.0) if main_ext else None,
        submeters=rows,
    )


# suppress unused import warning
_ = median
