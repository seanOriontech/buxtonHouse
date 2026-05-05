import json
import logging
import os
import re
import signal
import sys
from datetime import datetime
from zoneinfo import ZoneInfo

import paho.mqtt.client as mqtt
from dotenv import load_dotenv
from influxdb_client import InfluxDBClient, Point
from influxdb_client.client.write_api import SYNCHRONOUS

load_dotenv()

logging.basicConfig(
    level=os.environ.get("LOG_LEVEL", "INFO").upper(),
    format="%(asctime)s [%(levelname)s] %(message)s",
)
log = logging.getLogger("ingestion")

MQTT_HOST = os.environ["MQTT_HOST"]
MQTT_PORT = int(os.environ.get("MQTT_PORT", "1883"))
MQTT_USE_TLS = os.environ.get("MQTT_USE_TLS", "false").lower() == "true"
MQTT_USERNAME = os.environ.get("MQTT_USERNAME") or None
MQTT_PASSWORD = os.environ.get("MQTT_PASSWORD") or None
MQTT_CLIENT_ID = os.environ.get("MQTT_CLIENT_ID", "buxton-ingestion")
MQTT_TOPIC = os.environ.get("MQTT_TOPIC", "#")
MQTT_QOS = int(os.environ.get("MQTT_QOS", "1"))

INFLUXDB_URL = os.environ["INFLUXDB_URL"]
INFLUXDB_TOKEN = os.environ["INFLUXDB_TOKEN"]
INFLUXDB_ORG = os.environ["INFLUXDB_ORG"]
INFLUXDB_BUCKET = os.environ["INFLUXDB_BUCKET"]

# Source clock for payloads carrying a "time" field with no timezone.
SAST = ZoneInfo("Africa/Johannesburg")

influx = InfluxDBClient(url=INFLUXDB_URL, token=INFLUXDB_TOKEN, org=INFLUXDB_ORG)
write_api = influx.write_api(write_options=SYNCHRONOUS)


# --- meter classification (power_data only) -------------------------------

_RE_APT_SUB = re.compile(r"^A(\d+)_(\d+)$")
_RE_APT_MAIN = re.compile(r"^A(\d+)$")
_RE_COMM = re.compile(r"^Comm_\d+$")
_RE_COMMKB = re.compile(r"^CommKB_\d+$")


def classify_power_meter(meter_id: str) -> dict:
    if m := _RE_APT_SUB.match(meter_id):
        return {"category": "apartment_sub", "apartment": m.group(1), "sub_meter": m.group(2)}
    if m := _RE_APT_MAIN.match(meter_id):
        return {"category": "apartment_main", "apartment": m.group(1)}
    if _RE_COMM.match(meter_id):
        return {"category": "communal"}
    if _RE_COMMKB.match(meter_id):
        return {"category": "communal_kb"}
    return {"category": "facility"}


# --- helpers --------------------------------------------------------------

def parse_sast_ts(value):
    if not isinstance(value, str):
        return None
    try:
        return datetime.strptime(value.strip(), "%Y-%m-%d %H:%M:%S").replace(tzinfo=SAST)
    except ValueError:
        return None


def looks_like_meter_dict(data: dict) -> bool:
    """True if ≥2 entries are dicts with a 'Value' key — the meter snapshot pattern."""
    return sum(
        1 for k, v in data.items()
        if k != "time" and isinstance(v, dict) and "Value" in v
    ) >= 2


def parse_meter_dict(data: dict, measurement: str, classifier=None) -> list[Point]:
    ts = parse_sast_ts(data.get("time"))
    points: list[Point] = []
    for meter_id, entry in data.items():
        if meter_id == "time" or not isinstance(entry, dict):
            continue
        raw_value = entry.get("Value")
        if raw_value is None:
            continue
        try:
            value = float(raw_value)
        except (TypeError, ValueError):
            log.warning("non-numeric value for %s on %s: %r", meter_id, measurement, raw_value)
            continue

        p = Point(measurement).tag("meter_id", meter_id.strip())
        if classifier:
            for k, v in classifier(meter_id).items():
                p.tag(k, v)
        if desc := entry.get("Description"):
            p.tag("description", str(desc).strip())
        if units := entry.get("Units"):
            p.tag("units", str(units).strip())
        p.field("value", value)
        if ts is not None:
            p.time(ts)
        points.append(p)
    return points


# --- topic handlers --------------------------------------------------------

def parse_power_data(raw: bytes) -> list[Point]:
    payload = json.loads(raw.decode("utf-8", errors="replace"), strict=False)
    if not isinstance(payload, dict):
        return []
    return parse_meter_dict(payload, "energy_meter", classifier=classify_power_meter)


def parse_generic(raw: bytes, topic: str) -> list[Point]:
    text = raw.decode("utf-8", errors="replace").strip()
    if not text:
        return []
    measurement = topic.replace("/", "_").strip("_") or "root"
    try:
        data = json.loads(text, strict=False)
    except (json.JSONDecodeError, ValueError):
        try:
            return [Point(measurement).field("value", float(text))]
        except ValueError:
            return [Point(measurement).field("value", text)]

    if isinstance(data, dict):
        if looks_like_meter_dict(data):
            return parse_meter_dict(data, measurement)

        ts = parse_sast_ts(data.get("time"))
        p = Point(measurement)
        has_field = False
        for k, v in data.items():
            if k == "time" or v is None:
                continue
            if isinstance(v, (bool, int, float, str)):
                p.field(k, v)
            else:
                p.field(k, json.dumps(v))
            has_field = True
        if not has_field:
            return []
        if ts is not None:
            p.time(ts)
        return [p]

    if isinstance(data, (bool, int, float)):
        return [Point(measurement).field("value", data)]
    return [Point(measurement).field("value", text)]


HANDLERS = {
    "power_data": parse_power_data,
}


# --- MQTT callbacks --------------------------------------------------------

def on_connect(client, userdata, flags, reason_code, properties=None):
    if reason_code == 0:
        log.info("connected to %s:%s, subscribing to %r qos=%s",
                 MQTT_HOST, MQTT_PORT, MQTT_TOPIC, MQTT_QOS)
        client.subscribe(MQTT_TOPIC, qos=MQTT_QOS)
    else:
        log.error("MQTT connection failed: %s", reason_code)


def on_disconnect(client, userdata, disconnect_flags, reason_code, properties=None):
    log.warning("disconnected from MQTT broker: %s", reason_code)


def on_message(client, userdata, msg):
    handler = HANDLERS.get(msg.topic)
    try:
        points = handler(msg.payload) if handler else parse_generic(msg.payload, msg.topic)
    except Exception:
        log.exception("parse failed for %s", msg.topic)
        return

    if not points:
        log.warning("no points produced from %s", msg.topic)
        return

    try:
        write_api.write(bucket=INFLUXDB_BUCKET, org=INFLUXDB_ORG, record=points)
        log.info("wrote %d points from %s", len(points), msg.topic)
    except Exception:
        log.exception("InfluxDB write failed for %s", msg.topic)


# --- main ------------------------------------------------------------------

def main():
    client = mqtt.Client(
        client_id=MQTT_CLIENT_ID,
        callback_api_version=mqtt.CallbackAPIVersion.VERSION2,
    )
    if MQTT_USERNAME:
        client.username_pw_set(MQTT_USERNAME, MQTT_PASSWORD)
    if MQTT_USE_TLS:
        client.tls_set()

    client.on_connect = on_connect
    client.on_disconnect = on_disconnect
    client.on_message = on_message

    def shutdown(signum, frame):
        log.info("shutting down")
        client.disconnect()
        write_api.close()
        influx.close()
        sys.exit(0)

    signal.signal(signal.SIGINT, shutdown)
    signal.signal(signal.SIGTERM, shutdown)

    log.info("connecting to %s:%s", MQTT_HOST, MQTT_PORT)
    client.connect(MQTT_HOST, MQTT_PORT, keepalive=60)
    client.loop_forever(retry_first_connection=True)


if __name__ == "__main__":
    main()
