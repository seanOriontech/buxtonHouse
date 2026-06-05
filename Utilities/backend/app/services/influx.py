"""Read-only Flux query helpers against the buxtonHouse bucket.

Ingestion/main.py is the sole writer. The tag set this module assumes matches
the writer: `meter_id`, `category`, `apartment`, `sub_meter`, `description`,
`units` on `energy_meter`; `meter_id` (+ optional `description`/`units`) on
other measurements that fall through the generic parser.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from functools import lru_cache
from typing import Any

from influxdb_client import InfluxDBClient

from app.config import get_settings

log = logging.getLogger(__name__)

# Mirrors Ingestion/main.py classification — keep in sync with the writer.
KNOWN_ENERGY_MEASUREMENT = "energy_meter"
KNOWN_WATER_MEASUREMENT = "water_data"
KNOWN_AUX_MEASUREMENT = "aux_data"

DEFAULT_DISCOVERY_LOOKBACK = timedelta(days=7)
STALE_AFTER = timedelta(hours=24)


@lru_cache
def _client() -> InfluxDBClient:
    s = get_settings()
    # Influx client default is a 10s read timeout — way too short for the
    # 90-day daily-aggregate Flux query against Influx Cloud free, which can
    # take well over a minute. Set 180s.
    return InfluxDBClient(
        url=s.influxdb_url,
        token=s.influxdb_token,
        org=s.influxdb_org,
        timeout=180_000,
    )


def _bucket() -> str:
    return get_settings().influxdb_bucket


def _query(flux: str) -> list[Any]:
    api = _client().query_api()
    try:
        return api.query(flux)
    except Exception:
        log.exception("flux query failed: %s", flux)
        raise


def _iso(ts: datetime) -> str:
    if ts.tzinfo is None:
        ts = ts.replace(tzinfo=timezone.utc)
    return ts.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def latest_per_meter(measurement: str) -> list[dict]:
    """One row per meter_id with the latest value seen in the last 30 days."""
    flux = f'''
from(bucket: "{_bucket()}")
  |> range(start: -30d)
  |> filter(fn: (r) => r._measurement == "{measurement}" and r._field == "value")
  |> group(columns: ["meter_id"])
  |> last()
'''
    out: list[dict] = []
    for table in _query(flux):
        for rec in table.records:
            values = rec.values
            out.append({
                "external_id": values.get("meter_id"),
                "measurement": measurement,
                "value": rec.get_value(),
                "ts": rec.get_time(),
                "units": values.get("units"),
                "category": values.get("category"),
                "apartment": values.get("apartment"),
                "sub_meter": values.get("sub_meter"),
                "description": values.get("description"),
            })
    return out


def distinct_meters(measurement: str, since: timedelta = DEFAULT_DISCOVERY_LOOKBACK) -> list[dict]:
    """Distinct meter_id values seen in the window, with their tag context."""
    flux = f'''
from(bucket: "{_bucket()}")
  |> range(start: -{int(since.total_seconds())}s)
  |> filter(fn: (r) => r._measurement == "{measurement}" and r._field == "value")
  |> group(columns: ["meter_id"])
  |> last()
'''
    seen: dict[str, dict] = {}
    for table in _query(flux):
        for rec in table.records:
            v = rec.values
            mid = v.get("meter_id")
            if not mid or mid in seen:
                continue
            seen[mid] = {
                "external_id": mid,
                "influx_measurement": measurement,
                "category": v.get("category"),
                "apartment": v.get("apartment"),
                "sub_meter": v.get("sub_meter"),
                "units": v.get("units"),
                "description": v.get("description"),
                "last_seen": rec.get_time(),
            }
    return list(seen.values())


def sum_by_tag(
    measurement: str,
    from_: datetime,
    to: datetime,
    group_tags: list[str],
    every: str | None = None,
) -> list[dict]:
    """Windowed sum() per tag combo. If `every` is None, returns one total per group."""
    cols = ", ".join(f'"{t}"' for t in group_tags) or '""'
    window = f'|> aggregateWindow(every: {every}, fn: sum, createEmpty: false)' if every else "|> sum()"
    flux = f'''
from(bucket: "{_bucket()}")
  |> range(start: {_iso(from_)}, stop: {_iso(to)})
  |> filter(fn: (r) => r._measurement == "{measurement}" and r._field == "value")
  |> group(columns: [{cols}])
  {window}
'''
    out: list[dict] = []
    for table in _query(flux):
        for rec in table.records:
            v = rec.values
            out.append({
                "value": rec.get_value(),
                # `_time` is dropped by `|> sum()` (no window), so guard the lookup.
                "ts": v.get("_time"),
                **{t: v.get(t) for t in group_tags},
            })
    return out


def consumption_by_meter(
    measurement: str,
    from_: datetime,
    to: datetime,
) -> dict[str, float]:
    """Cumulative-counter consumption per meter_id over the window.

    Implementation: `last(value) - first(value)` per meter (two Flux queries),
    with near-zero glitch readings filtered out beforehand. Tried
    `difference(nonNegative: true) |> sum()` first but the source data has
    occasional drops to 0 followed by the real value, which produced ~26000-kWh
    phantom spikes in MTD totals.
    """
    base_filter = (
        f'|> filter(fn: (r) => r._measurement == "{measurement}" and r._field == "value" and r._value > 1)\n'
        '  |> group(columns: ["meter_id"])'
    )
    first_flux = f'''
from(bucket: "{_bucket()}")
  |> range(start: {_iso(from_)}, stop: {_iso(to)})
  {base_filter}
  |> first()
'''
    last_flux = f'''
from(bucket: "{_bucket()}")
  |> range(start: {_iso(from_)}, stop: {_iso(to)})
  {base_filter}
  |> last()
'''
    firsts: dict[str, float] = {}
    lasts: dict[str, float] = {}
    for table in _query(first_flux):
        for rec in table.records:
            mid = rec.values.get("meter_id")
            v = rec.get_value()
            if mid and v is not None:
                firsts[mid] = float(v)
    for table in _query(last_flux):
        for rec in table.records:
            mid = rec.values.get("meter_id")
            v = rec.get_value()
            if mid and v is not None:
                lasts[mid] = float(v)
    out: dict[str, float] = {}
    for mid, last in lasts.items():
        first = firsts.get(mid)
        if first is None:
            continue
        delta = last - first
        out[mid] = max(0.0, delta)  # ignore counter resets
    return out


def meter_endpoints(
    measurement: str,
    from_: datetime,
    to: datetime,
    meter_ids: list[str] | None = None,
) -> dict[str, dict[str, float]]:
    """First + last raw reading per meter over the window — useful when the
    consumer wants to display both the opening and closing counter values, not
    just the delta. Returns `{meter_id: {first, last}}`.
    """
    meter_filter = ""
    if meter_ids:
        clauses = " or ".join(f'r.meter_id == "{mid}"' for mid in meter_ids)
        meter_filter = f"  |> filter(fn: (r) => {clauses})\n"
    base = (
        f'|> filter(fn: (r) => r._measurement == "{measurement}" and r._field == "value" and r._value > 1)\n'
        f'{meter_filter}'
        '  |> group(columns: ["meter_id"])'
    )
    first_flux = f'from(bucket: "{_bucket()}")\n  |> range(start: {_iso(from_)}, stop: {_iso(to)})\n  {base}\n  |> first()'
    last_flux  = f'from(bucket: "{_bucket()}")\n  |> range(start: {_iso(from_)}, stop: {_iso(to)})\n  {base}\n  |> last()'
    firsts: dict[str, float] = {}
    lasts: dict[str, float] = {}
    for table in _query(first_flux):
        for rec in table.records:
            mid = rec.values.get("meter_id"); v = rec.get_value()
            if mid and v is not None: firsts[mid] = float(v)
    for table in _query(last_flux):
        for rec in table.records:
            mid = rec.values.get("meter_id"); v = rec.get_value()
            if mid and v is not None: lasts[mid] = float(v)
    out: dict[str, dict[str, float]] = {}
    for mid in set(firsts) | set(lasts):
        out[mid] = {"first": firsts.get(mid, 0.0), "last": lasts.get(mid, firsts.get(mid, 0.0))}
    return out


def daily_consumption_by_meter(
    measurement: str,
    from_: datetime,
    to: datetime,
    meter_ids: list[str] | None = None,
) -> dict[str, dict[str, float]]:
    """Daily consumption per meter over the window.

    Returns {meter_id: {ISO_date: units_consumed_on_that_day}}.

    Uses `aggregateWindow(every: 1d, fn: last)` to get the end-of-day cumulative
    reading per meter per day, then `difference(nonNegative: true)` for the
    day-over-day delta. The first day of the window will be missing (no
    previous reading to diff against) — callers should request one extra day
    of `from_` if they need N days of results.

    Windows longer than 30 days are chunked into 30-day slices to stay under
    Influx Cloud's per-query budget on the free tier. `meter_ids`, when given,
    restricts the Flux filter so we only scan the meters we care about — this
    drops ~75% of the data on the Buxton bucket and makes long windows viable.

    SAST midnight is the day boundary.
    """
    out: dict[str, dict[str, float]] = {}

    # Build chunks of at most 30 days. Each chunk overlaps the previous by 1
    # day so `difference()` produces a value for the first real day of the chunk.
    CHUNK_DAYS = 30
    cur = from_
    while cur < to:
        chunk_to = min(cur + timedelta(days=CHUNK_DAYS), to)
        chunk_data = _daily_consumption_chunk(measurement, cur, chunk_to, meter_ids)
        for mid, days in chunk_data.items():
            for d, v in days.items():
                out.setdefault(mid, {})[d] = v
        # Step forward: next chunk starts one day before this chunk's end so
        # difference() has a "first" reading to diff against.
        cur = chunk_to - timedelta(days=1) if chunk_to < to else to
    return out


def _daily_consumption_chunk(
    measurement: str,
    from_: datetime,
    to: datetime,
    meter_ids: list[str] | None,
) -> dict[str, dict[str, float]]:
    meter_filter = ""
    if meter_ids:
        # `r.meter_id == "A1" or r.meter_id == "A2" ...`
        clauses = " or ".join(f'r.meter_id == "{mid}"' for mid in meter_ids)
        meter_filter = f"  |> filter(fn: (r) => {clauses})\n"

    flux = f'''
import "timezone"
option location = timezone.fixed(offset: 2h)

from(bucket: "{_bucket()}")
  |> range(start: {_iso(from_)}, stop: {_iso(to)})
  |> filter(fn: (r) => r._measurement == "{measurement}" and r._field == "value" and r._value > 1)
{meter_filter}  |> group(columns: ["meter_id"])
  |> aggregateWindow(every: 1d, fn: last, createEmpty: false)
  |> difference(nonNegative: true)
'''
    out: dict[str, dict[str, float]] = {}
    for table in _query(flux):
        for rec in table.records:
            mid = rec.values.get("meter_id")
            v = rec.get_value()
            ts = rec.get_time()
            if mid is None or v is None or ts is None:
                continue
            day = ts.date().isoformat()
            out.setdefault(mid, {})[day] = max(0.0, float(v))
    return out


def hourly_consumption_by_meter(
    measurement: str,
    from_: datetime,
    to: datetime,
    meter_ids: list[str] | None = None,
) -> dict[str, dict[str, float]]:
    """Hour-by-hour consumption per meter.

    Returns `{meter_id: {hour_iso_utc: litres_or_kwh_that_hour}}`.

    Same chunking + meter-filter approach as `daily_consumption_by_meter`,
    but at hourly resolution. Used for leak-review drill-downs where you
    need to see the actual flow at e.g. 03:00.
    """
    meter_filter = ""
    if meter_ids:
        clauses = " or ".join(f'r.meter_id == "{mid}"' for mid in meter_ids)
        meter_filter = f"  |> filter(fn: (r) => {clauses})\n"

    flux = f'''
import "timezone"
option location = timezone.fixed(offset: 2h)

from(bucket: "{_bucket()}")
  |> range(start: {_iso(from_)}, stop: {_iso(to)})
  |> filter(fn: (r) => r._measurement == "{measurement}" and r._field == "value" and r._value > 1)
{meter_filter}  |> group(columns: ["meter_id"])
  |> aggregateWindow(every: 1h, fn: last, createEmpty: false)
  |> difference(nonNegative: true)
'''
    out: dict[str, dict[str, float]] = {}
    for table in _query(flux):
        for rec in table.records:
            mid = rec.values.get("meter_id")
            v = rec.get_value()
            ts = rec.get_time()
            if mid is None or v is None or ts is None:
                continue
            out.setdefault(mid, {})[ts.isoformat()] = max(0.0, float(v))
    return out


def nightly_window_consumption_by_meter(
    measurement: str,
    night_starts_utc: list[datetime],
    window_hours: int = 3,
    meter_ids: list[str] | None = None,
) -> dict[str, list[float]]:
    """Per-meter water consumption inside each "deep night" window.

    Caller supplies a list of UTC `datetime`s, each marking the START of a
    window (e.g. SAST 02:00 → UTC 00:00 for each of the last 7 nights). The
    helper runs one Flux query per window (small windows = fast) and returns
    `{meter_id: [litres_window0, litres_window1, ...]}` in the same order as
    `night_starts_utc`.

    Each window uses last − first on cumulative-counter readings, then clamps
    to ≥ 0 (counter resets).
    """
    if meter_ids is None:
        meter_ids = []
    meter_filter = ""
    if meter_ids:
        clauses = " or ".join(f'r.meter_id == "{mid}"' for mid in meter_ids)
        meter_filter = f"  |> filter(fn: (r) => {clauses})\n"

    out: dict[str, list[float]] = {mid: [] for mid in meter_ids}
    for start in night_starts_utc:
        end = start + timedelta(hours=window_hours)
        first_flux = f'''
from(bucket: "{_bucket()}")
  |> range(start: {_iso(start)}, stop: {_iso(end)})
  |> filter(fn: (r) => r._measurement == "{measurement}" and r._field == "value" and r._value > 1)
{meter_filter}  |> group(columns: ["meter_id"])
  |> first()
'''
        last_flux = first_flux.replace("|> first()", "|> last()")
        firsts: dict[str, float] = {}
        lasts: dict[str, float] = {}
        for table in _query(first_flux):
            for rec in table.records:
                mid = rec.values.get("meter_id"); v = rec.get_value()
                if mid and v is not None: firsts[mid] = float(v)
        for table in _query(last_flux):
            for rec in table.records:
                mid = rec.values.get("meter_id"); v = rec.get_value()
                if mid and v is not None: lasts[mid] = float(v)
        for mid in meter_ids:
            delta = lasts.get(mid, 0.0) - firsts.get(mid, lasts.get(mid, 0.0))
            out[mid].append(max(0.0, delta))
    return out


def series_for_meters(
    measurement: str,
    external_ids: list[str],
    from_: datetime,
    to: datetime,
    every: str = "1h",
) -> list[dict]:
    if not external_ids:
        return []
    ids = " or ".join(f'r.meter_id == "{eid}"' for eid in external_ids)
    flux = f'''
from(bucket: "{_bucket()}")
  |> range(start: {_iso(from_)}, stop: {_iso(to)})
  |> filter(fn: (r) => r._measurement == "{measurement}" and r._field == "value")
  |> filter(fn: (r) => {ids})
  |> aggregateWindow(every: {every}, fn: mean, createEmpty: false)
'''
    out: list[dict] = []
    for table in _query(flux):
        for rec in table.records:
            out.append({
                "external_id": rec.values.get("meter_id"),
                "ts": rec.get_time(),
                "value": rec.get_value(),
            })
    return out


def latest_for_all_known_meters() -> dict[str, dict]:
    """One row per meter_id across all known measurements with the latest ts/value/measurement."""
    out: dict[str, dict] = {}
    for measurement in (
        KNOWN_ENERGY_MEASUREMENT,
        KNOWN_WATER_MEASUREMENT,
        KNOWN_AUX_MEASUREMENT,
    ):
        for r in latest_per_meter(measurement):
            ext = r["external_id"]
            if not ext:
                continue
            prev = out.get(ext)
            if prev is None or (r["ts"] and prev["ts"] and r["ts"] > prev["ts"]):
                out[ext] = {
                    "ts": r["ts"],
                    "value": r["value"],
                    "measurement": measurement,
                }
    return out


def is_stale(ts: datetime | None) -> bool:
    if ts is None:
        return True
    if ts.tzinfo is None:
        ts = ts.replace(tzinfo=timezone.utc)
    return (datetime.now(timezone.utc) - ts) > STALE_AFTER
