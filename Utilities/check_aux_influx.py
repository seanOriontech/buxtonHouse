"""Probe Influx directly with the backend's credentials."""
import os
import sys
from datetime import datetime, timezone

from dotenv import load_dotenv
from influxdb_client import InfluxDBClient

load_dotenv("/Users/seanstrydom/Documents/Projects/Buxton_House_2026/buxtonHouse/Utilities/backend/.env")

url = os.environ["INFLUXDB_URL"]
token = os.environ["INFLUXDB_TOKEN"]
org = os.environ["INFLUXDB_ORG"]
bucket = os.environ["INFLUXDB_BUCKET"]

print(f"url={url} bucket={bucket} org={org}\n")

now = datetime.now(timezone.utc)

queries = {
    "aux_data: distinct meter_ids in last 30d, with last _time":
        f'from(bucket: "{bucket}") |> range(start: -30d) '
        f'|> filter(fn: (r) => r._measurement == "aux_data" and r._field == "value") '
        f'|> group(columns: ["meter_id"]) |> last() '
        f'|> keep(columns: ["_time","meter_id","_value"])',
    "aux_data: any non-'value' fields seen in last 30d":
        f'from(bucket: "{bucket}") |> range(start: -30d) '
        f'|> filter(fn: (r) => r._measurement == "aux_data") '
        f'|> keep(columns: ["_field"]) |> group() |> distinct(column: "_field")',
    "aux_data: all _measurements containing 'aux' in last 30d":
        f'import "influxdata/influxdb/schema" '
        f'schema.measurements(bucket: "{bucket}", start: -30d)',
}

with InfluxDBClient(url=url, token=token, org=org) as client:
    qapi = client.query_api()

    for label, flux in queries.items():
        print(f"=== {label} ===")
        try:
            tables = qapi.query(flux)
        except Exception as e:
            print(f"  query failed: {e}")
            continue
        rows = []
        for t in tables:
            for r in t.records:
                rows.append(r.values)
        if not rows:
            print("  (no rows)")
        else:
            for r in rows[:40]:
                t = r.get("_time")
                age = (now - t).total_seconds() / 3600 if t else None
                age_s = f"  age={age:.1f}h" if age is not None else ""
                print(f"  {r.get('meter_id') or r.get('_field') or r.get('_value')!r:40}  _time={t}{age_s}")
            if len(rows) > 40:
                print(f"  ... +{len(rows)-40} more")
        print()
