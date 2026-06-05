"""One-shot MQTT sniffer for aux_data — prints raw payload + parser analysis, then exits."""
import json
import re
import signal
import sys
from datetime import datetime
from zoneinfo import ZoneInfo

import paho.mqtt.client as mqtt

HOST = "wetsolutions.dedicated.co.za"
PORT = 1883
TOPIC = "#"
TARGET = "aux_data"
TIMEOUT_S = 90
SAST = ZoneInfo("Africa/Johannesburg")


def looks_like_meter_dict(data: dict) -> bool:
    return (
        sum(
            1 for k, v in data.items()
            if k != "time" and isinstance(v, dict) and "Value" in v
        )
        >= 2
    )


def parse_sast_ts(value):
    if not isinstance(value, str):
        return None
    try:
        return datetime.strptime(value.strip(), "%Y-%m-%d %H:%M:%S").replace(tzinfo=SAST)
    except ValueError:
        return None


def analyse(raw: bytes) -> None:
    text = raw.decode("utf-8", errors="replace")
    print("\n=== RAW PAYLOAD ===")
    print(text[:2000])
    if len(text) > 2000:
        print(f"... (truncated, total {len(text)} bytes)")

    try:
        data = json.loads(text, strict=False)
    except Exception as e:
        print(f"\n=== PARSE: not JSON ({e}) ===")
        return

    print(f"\n=== TYPE: {type(data).__name__} ===")
    if isinstance(data, dict):
        time_raw = data.get("time")
        print(f"time field: {time_raw!r}")
        parsed = parse_sast_ts(time_raw)
        print(f"parse_sast_ts: {parsed.isoformat() if parsed else 'FAILED'}")
        if parsed:
            now_sast = datetime.now(SAST)
            delta = now_sast - parsed
            print(f"age vs now: {delta} (now SAST: {now_sast.isoformat()})")
        is_meter_dict = looks_like_meter_dict(data)
        print(f"looks_like_meter_dict: {is_meter_dict}")
        # show first 5 non-'time' entries
        sample = [(k, v) for k, v in data.items() if k != "time"][:5]
        print("first 5 entries:")
        for k, v in sample:
            if isinstance(v, dict):
                print(f"  {k!r}: keys={list(v.keys())}, Value={v.get('Value')!r}, Units={v.get('Units')!r}")
            else:
                print(f"  {k!r}: {v!r}")
        if is_meter_dict:
            print("\nVerdict: will hit parse_meter_dict — points get meter_id tag + _field='value'.")
        else:
            print("\nVerdict: falls into FLAT branch — single point, fields named after keys, NO meter_id tag.")
            print("This is the smoking gun: latest_per_meter() filters _field=='value' so finds nothing.")


def main():
    seen: dict[str, int] = {}
    target_done = {"v": False}
    client_ref: dict = {}

    def on_connect(client, userdata, flags, reason_code, properties=None):
        if reason_code == 0:
            print(f"connected to {HOST}:{PORT}, subscribing to {TOPIC!r} for {TIMEOUT_S}s; targeting {TARGET!r}")
            client.subscribe(TOPIC, qos=1)
        else:
            print(f"connect failed: {reason_code}", file=sys.stderr)
            sys.exit(1)

    def on_message(client, userdata, msg):
        seen[msg.topic] = seen.get(msg.topic, 0) + 1
        if msg.topic == TARGET and not target_done["v"]:
            print(f"\n>>> CAPTURED target {msg.topic!r}, {len(msg.payload)} bytes")
            analyse(msg.payload)
            target_done["v"] = True

    def on_timeout(signum, frame):
        c = client_ref.get("c")
        if c is not None:
            try:
                c.disconnect()
            except Exception:
                pass
        print("\n=== TOPIC TALLY (last %ds) ===" % TIMEOUT_S)
        for t, n in sorted(seen.items(), key=lambda kv: -kv[1]):
            print(f"  {n:4d}  {t}")
        if not target_done["v"]:
            print(f"\nno {TARGET!r} message arrived. either the publisher is slow, or the topic name is different.")
        sys.exit(0 if target_done["v"] else 2)

    signal.signal(signal.SIGALRM, on_timeout)
    signal.alarm(TIMEOUT_S)

    c = mqtt.Client(
        client_id="buxton-aux-sniff",
        callback_api_version=mqtt.CallbackAPIVersion.VERSION2,
    )
    client_ref["c"] = c
    c.on_connect = on_connect
    c.on_message = on_message
    c.connect(HOST, PORT, keepalive=30)
    c.loop_forever(retry_first_connection=True)


if __name__ == "__main__":
    main()
