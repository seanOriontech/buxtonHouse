"""Per-entity anomaly detection — surfaces over-usage vs an entity's own past.

Two endpoints, both on the fly:
  - GET /usage/apartment-anomalies?living_type=Apartment Living&days=14
  - GET /usage/communal-anomalies?days=14

For each apartment / room we compute:
  - Spike (rolling baseline) on per-person water (combined cold+hot) and electricity
  - Day-of-week deviation on the same per-person values
  - (Apartments only) Night-time water leak signal

Composite score sorts the response so flagged entities float to the top.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.schemas.anomalies import (
    ApartmentAnomaliesResponse,
    ApartmentAnomaly,
    CommunalAnomaliesResponse,
    DailyPoint,
    DowFlag,
    LeakFlag,
    RoomAnomaly,
    SpikeFlag,
)
from app.services import anomaly_detection as ad_algo
from app.services import apartment_data as ad
from app.services import influx as influx_svc
from app.services import room_data as rd

router = APIRouter(prefix="/usage", tags=["usage"])

_DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]


def _to_spike_flag(utility: str, outcome) -> SpikeFlag:
    return SpikeFlag(
        utility=utility,
        severity=outcome.severity,
        today_per_person=outcome.today,
        baseline_median=outcome.baseline_median,
        threshold_amber=outcome.threshold_amber,
        threshold_red=outcome.threshold_red,
        robust_z=outcome.robust_z,
    )


def _to_dow_flag(utility: str, outcome, day_name: str) -> DowFlag:
    return DowFlag(
        utility=utility,
        severity=outcome.severity,
        today_per_person=outcome.today,
        dow_median_per_person=outcome.dow_median,
        ratio=outcome.ratio,
        day_name=day_name,
    )


@router.get("/apartment-anomalies", response_model=ApartmentAnomaliesResponse)
async def apartment_anomalies(
    living_type: str = Query("Apartment Living"),
    days: int = Query(14, ge=7, le=60, description="Baseline window length in days."),
    dow_lookback_weeks: int = Query(8, ge=3, le=20),
    on: date | None = Query(None),
    db: AsyncSession = Depends(get_db),
) -> ApartmentAnomaliesResponse:
    today_sast = datetime.now(ad.SAST).date()
    ref_date = on or today_sast
    yday = ref_date - timedelta(days=1)              # "today" for anomaly purposes = the last complete day
    baseline_end = yday
    baseline_start = yday - timedelta(days=days - 1)  # 14 days incl. yday
    dow_start = yday - timedelta(weeks=dow_lookback_weeks)

    # Pull the longer of the two windows so we only do one Flux call per measurement.
    series_from = ad.sast_midnight_utc(min(baseline_start, dow_start) - timedelta(days=1))
    series_to   = ad.sast_midnight_utc(ref_date)

    apartments = await ad.load_apartments(db, living_type)
    if not apartments:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"no apartments for living_type={living_type}")

    all_room_ids = [rid for info in apartments.values() for rid in info["room_ids"]]
    meters = await ad.load_meters_for_rooms(db, all_room_ids)
    meter_to_apt = ad.meter_apt_index(apartments, meters)
    _, occ_by_apt = await ad.load_occupancy(db, living_type, ref_date)

    # apt → meters by utility
    apt_meters_by_util: dict[str, dict[str, list[str]]] = {ut: {} for ut in ad.UTILITY_MAP}
    for m in meters:
        ut = m["utility_type"]
        if ut not in apt_meters_by_util:
            continue
        apt_id = meter_to_apt.get(m["external_id"])
        if apt_id is None:
            continue
        apt_meters_by_util[ut].setdefault(apt_id, []).append(m["external_id"])

    water_meter_ids = [m["external_id"] for m in meters if m["utility_type"] in ("cold_water", "hot_water")]
    elec_meter_ids  = [m["external_id"] for m in meters if m["utility_type"] == "electricity"]

    # Daily consumption per meter — one query per measurement covering the longer window
    daily_water  = influx_svc.daily_consumption_by_meter("water_data",   series_from, series_to, meter_ids=water_meter_ids)
    daily_energy = influx_svc.daily_consumption_by_meter("energy_meter", series_from, series_to, meter_ids=elec_meter_ids)

    # Nightly water — last 7 nights, 02:00–05:00 SAST = UTC 00:00–03:00
    night_starts = [
        ad.sast_midnight_utc(yday - timedelta(days=i)) + timedelta(hours=2)
        for i in range(6, -1, -1)   # 6 days ago … yesterday
    ]
    nightly_water = influx_svc.nightly_window_consumption_by_meter(
        "water_data", night_starts, window_hours=3, meter_ids=water_meter_ids,
    )

    # Helper: aggregate per-apt daily values for a given measurement, in m³ → litres
    def per_apt_daily(measurement_dict: dict[str, dict[str, float]], utility: str, multiplier: float):
        apt_to_day: dict[str, dict[str, float]] = {apt_id: {} for apt_id in apartments}
        for apt_id, mids in apt_meters_by_util[utility].items():
            for mid in mids:
                for d_iso, val in measurement_dict.get(mid, {}).items():
                    apt_to_day[apt_id][d_iso] = apt_to_day[apt_id].get(d_iso, 0.0) + val * multiplier
        return apt_to_day

    apt_cold = per_apt_daily(daily_water,  "cold_water",  1000.0)
    apt_hot  = per_apt_daily(daily_water,  "hot_water",   1000.0)
    apt_elec = per_apt_daily(daily_energy, "electricity", 1.0)

    today_dow = yday.weekday()
    today_day_name = _DAY_NAMES[today_dow]

    entries: list[ApartmentAnomaly] = []
    red_count = amber_count = 0

    for apt_id, info in apartments.items():
        apt_no = info["apartment_number"]
        occ_data = occ_by_apt.get(apt_no, {})
        occ_count = occ_data.get("occupants", 0)
        occ = max(1, occ_count)

        # Build daily per-person arrays + per-day arrays for the full series window
        day_isos = sorted({*apt_cold[apt_id].keys(), *apt_hot[apt_id].keys(), *apt_elec[apt_id].keys()})
        # Only keep dates that are in our [baseline_start..yday] range
        baseline_iso  = baseline_start.isoformat()
        yday_iso      = yday.isoformat()
        dow_start_iso = dow_start.isoformat()

        baseline_water_pp: list[float] = []
        baseline_elec_pp: list[float] = []
        dow_water_pp: list[float] = []
        dow_elec_pp: list[float] = []
        chart_points: list[DailyPoint] = []
        today_water_pp = 0.0
        today_elec_pp  = 0.0

        for d_iso in day_isos:
            cold = apt_cold[apt_id].get(d_iso, 0.0)
            hot  = apt_hot[apt_id].get(d_iso, 0.0)
            elec = apt_elec[apt_id].get(d_iso, 0.0)
            water_pp = (cold + hot) / occ
            elec_pp = elec / occ

            d = date.fromisoformat(d_iso)
            # Chart shows last `days` days
            if baseline_iso <= d_iso <= yday_iso:
                chart_points.append(DailyPoint(date=d, water_pp=water_pp, electricity_pp=elec_pp))

            # Baseline: last 14 days (incl yday)
            if baseline_iso <= d_iso <= yday_iso:
                if d_iso == yday_iso:
                    today_water_pp = water_pp
                    today_elec_pp = elec_pp
                else:
                    baseline_water_pp.append(water_pp)
                    baseline_elec_pp.append(elec_pp)

            # DOW: last 8 weeks of matching weekday (excluding yday itself)
            if dow_start_iso <= d_iso < yday_iso and d.weekday() == today_dow:
                dow_water_pp.append(water_pp)
                dow_elec_pp.append(elec_pp)

        # Spike flags
        water_stats = ad_algo.baseline_stats(baseline_water_pp)
        elec_stats  = ad_algo.baseline_stats(baseline_elec_pp)
        spikes: list[SpikeFlag] = []
        spike_zs: list[float] = []
        s_water = ad_algo.spike_flag(today_water_pp, water_stats) if water_stats else None
        if s_water:
            spikes.append(_to_spike_flag("water", s_water))
            spike_zs.append(s_water.robust_z)
        s_elec = ad_algo.spike_flag(today_elec_pp, elec_stats) if elec_stats else None
        if s_elec:
            spikes.append(_to_spike_flag("electricity", s_elec))
            spike_zs.append(s_elec.robust_z)

        # DOW flags
        dow_flags: list[DowFlag] = []
        dow_ratios: list[float] = []
        d_water = ad_algo.dow_flag(today_water_pp, dow_water_pp)
        if d_water:
            dow_flags.append(_to_dow_flag("water", d_water, today_day_name))
            dow_ratios.append(d_water.ratio - 1.0)
        d_elec = ad_algo.dow_flag(today_elec_pp, dow_elec_pp)
        if d_elec:
            dow_flags.append(_to_dow_flag("electricity", d_elec, today_day_name))
            dow_ratios.append(d_elec.ratio - 1.0)

        # Leak — sum cold + hot per night across the apt's water meters
        apt_water_meter_ids = (apt_meters_by_util["cold_water"].get(apt_id, [])
                               + apt_meters_by_util["hot_water"].get(apt_id, []))
        overnight_per_night = []
        for night_idx in range(7):
            total = sum(nightly_water.get(mid, [0]*7)[night_idx] for mid in apt_water_meter_ids) * 1000.0
            # Per-person normalisation isn't useful for leak signal — leak is per-apartment plumbing
            overnight_per_night.append(total)
        leak = ad_algo.leak_flag(overnight_per_night)
        leak_out = None
        leak_consec = 0
        if leak:
            leak_out = LeakFlag(
                severity=leak.severity,
                avg_overnight_litres=leak.avg_overnight_litres,
                consecutive_nights=leak.consecutive_nights,
                peak_night_litres=leak.peak_night_litres,
                nights_over_threshold=leak.nights_over_threshold,
                threshold_litres=leak.threshold_litres,
            )
            leak_consec = leak.consecutive_nights

        score = ad_algo.composite_score(spike_zs, dow_ratios, leak_consec)

        # Tally severities
        for f in spikes + dow_flags:
            if f.severity == "red":   red_count   += 1
            if f.severity == "amber": amber_count += 1
        if leak_out:
            if leak_out.severity == "red":   red_count   += 1
            if leak_out.severity == "amber": amber_count += 1

        entries.append(ApartmentAnomaly(
            apartment_number=apt_no,
            occupants=occ_count,
            spikes=spikes,
            leak=leak_out,
            dow=dow_flags,
            anomaly_score=score,
            daily_series=chart_points,
            baseline_median_water_pp=water_stats.median if water_stats else None,
            baseline_q1_water_pp=water_stats.q1 if water_stats else None,
            baseline_q3_water_pp=water_stats.q3 if water_stats else None,
            baseline_median_elec_pp=elec_stats.median if elec_stats else None,
            baseline_q1_elec_pp=elec_stats.q1 if elec_stats else None,
            baseline_q3_elec_pp=elec_stats.q3 if elec_stats else None,
        ))

    entries.sort(key=lambda e: (-e.anomaly_score, e.apartment_number))

    caveats = [
        f"Baseline window: last {days} days, compared to yesterday ({yday}).",
        f"Day-of-week comparison uses up to {dow_lookback_weeks} weeks of same-{today_day_name} history (≥3 samples required).",
        "Leak detection sums water 02:00–05:00 SAST per night; ≥5 ℓ per night counts as offending.",
    ]

    return ApartmentAnomaliesResponse(
        living_type=living_type,
        report_date=ref_date,
        baseline_window_days=days,
        entries=entries,
        cohort_red_count=red_count,
        cohort_amber_count=amber_count,
        caveats=caveats,
    )


@router.get("/communal-anomalies", response_model=CommunalAnomaliesResponse)
async def communal_anomalies(
    days: int = Query(14, ge=7, le=60),
    dow_lookback_weeks: int = Query(8, ge=3, le=20),
    on: date | None = Query(None),
    db: AsyncSession = Depends(get_db),
) -> CommunalAnomaliesResponse:
    living_type = "Communal Living"
    today_sast = datetime.now(ad.SAST).date()
    ref_date = on or today_sast
    yday = ref_date - timedelta(days=1)
    baseline_start = yday - timedelta(days=days - 1)
    dow_start = yday - timedelta(weeks=dow_lookback_weeks)
    series_from = ad.sast_midnight_utc(min(baseline_start, dow_start) - timedelta(days=1))
    series_to   = ad.sast_midnight_utc(ref_date)

    rooms = await rd.load_communal_rooms(db, living_type)
    if not rooms:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"no rooms for living_type={living_type}")
    room_ids = list(rooms.keys())
    meters = await ad.load_meters_for_rooms(db, room_ids, roots_only=False)
    elec_meters = [m for m in meters if m["utility_type"] == "electricity"]
    elec_meter_ids = [m["external_id"] for m in elec_meters]

    _, occ_by_room = await rd.load_occupancy_per_room(db, living_type, ref_date)

    room_to_meters: dict[str, list[str]] = {}
    for m in elec_meters:
        room_to_meters.setdefault(str(m["room_id"]), []).append(m["external_id"])

    daily_energy = influx_svc.daily_consumption_by_meter(
        "energy_meter", series_from, series_to, meter_ids=elec_meter_ids,
    )

    today_dow = yday.weekday()
    today_day_name = _DAY_NAMES[today_dow]
    baseline_iso = baseline_start.isoformat()
    yday_iso     = yday.isoformat()
    dow_start_iso = dow_start.isoformat()

    entries: list[RoomAnomaly] = []
    red_count = amber_count = 0

    for rid, info in rooms.items():
        occ_data = occ_by_room.get(info["room_number"], {})
        occ_count = occ_data.get("occupants", 0)
        occ = max(1, occ_count)

        per_day: dict[str, float] = {}
        for mid in room_to_meters.get(rid, []):
            for d_iso, val in daily_energy.get(mid, {}).items():
                per_day[d_iso] = per_day.get(d_iso, 0.0) + val

        baseline_elec_pp: list[float] = []
        dow_elec_pp: list[float] = []
        chart_points: list[DailyPoint] = []
        today_elec_pp = 0.0

        for d_iso, kwh in sorted(per_day.items()):
            elec_pp = kwh / occ
            d = date.fromisoformat(d_iso)
            if baseline_iso <= d_iso <= yday_iso:
                chart_points.append(DailyPoint(date=d, water_pp=0.0, electricity_pp=elec_pp))
                if d_iso == yday_iso:
                    today_elec_pp = elec_pp
                else:
                    baseline_elec_pp.append(elec_pp)
            if dow_start_iso <= d_iso < yday_iso and d.weekday() == today_dow:
                dow_elec_pp.append(elec_pp)

        elec_stats = ad_algo.baseline_stats(baseline_elec_pp)
        spikes: list[SpikeFlag] = []
        spike_zs: list[float] = []
        s_elec = ad_algo.spike_flag(today_elec_pp, elec_stats) if elec_stats else None
        if s_elec:
            spikes.append(_to_spike_flag("electricity", s_elec))
            spike_zs.append(s_elec.robust_z)

        dow_flags: list[DowFlag] = []
        dow_ratios: list[float] = []
        d_elec = ad_algo.dow_flag(today_elec_pp, dow_elec_pp)
        if d_elec:
            dow_flags.append(_to_dow_flag("electricity", d_elec, today_day_name))
            dow_ratios.append(d_elec.ratio - 1.0)

        score = ad_algo.composite_score(spike_zs, dow_ratios, 0)

        for f in spikes + dow_flags:
            if f.severity == "red":   red_count   += 1
            if f.severity == "amber": amber_count += 1

        entries.append(RoomAnomaly(
            room_number=info["room_number"],
            room_type=info["room_type"],
            occupants=occ_count,
            spikes=spikes,
            dow=dow_flags,
            anomaly_score=score,
            daily_series=chart_points,
            baseline_median_elec_pp=elec_stats.median if elec_stats else None,
            baseline_q1_elec_pp=elec_stats.q1 if elec_stats else None,
            baseline_q3_elec_pp=elec_stats.q3 if elec_stats else None,
        ))

    entries.sort(key=lambda e: (-e.anomaly_score, e.room_number))

    caveats = [
        f"Baseline window: last {days} days, compared to yesterday ({yday}).",
        f"Day-of-week comparison uses up to {dow_lookback_weeks} weeks of same-{today_day_name} history (≥3 samples required).",
        "Communal rooms have no individual water meters — leak detection is apartment-only.",
    ]

    return CommunalAnomaliesResponse(
        living_type=living_type,
        report_date=ref_date,
        baseline_window_days=days,
        entries=entries,
        cohort_red_count=red_count,
        cohort_amber_count=amber_count,
        caveats=caveats,
    )
