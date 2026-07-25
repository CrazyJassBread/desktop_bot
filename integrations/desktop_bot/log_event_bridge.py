"""Bridge desktop_bot structured log events into the AI Hub OS Web gateway.

This sidecar requires no changes to desktop_bot. Run it beside ``python -m app``.
It forwards only lines emitted as ``perception event {json}``.
"""

from __future__ import annotations

import argparse
import json
import time
from pathlib import Path
from urllib.error import URLError
from urllib.request import Request, urlopen


EVENT_MARKER = "perception event "


def post_event(endpoint: str, event: dict[str, object], timeout: float) -> None:
    body = json.dumps(event, ensure_ascii=False).encode("utf-8")
    request = Request(
        endpoint,
        data=body,
        method="POST",
        headers={"Content-Type": "application/json; charset=utf-8"},
    )
    with urlopen(request, timeout=timeout) as response:
        if response.status != 202:
            raise RuntimeError(f"gateway returned HTTP {response.status}")


def extract_event(line: str) -> dict[str, object] | None:
    marker_index = line.find(EVENT_MARKER)
    if marker_index < 0:
        return None
    candidate = line[marker_index + len(EVENT_MARKER) :].strip()
    try:
        parsed = json.loads(candidate)
    except json.JSONDecodeError:
        return None
    return parsed if isinstance(parsed, dict) else None


def follow(log_path: Path, endpoint: str, timeout: float, from_start: bool) -> None:
    print(f"Waiting for desktop_bot log: {log_path}")
    while not log_path.exists():
        time.sleep(0.5)
    with log_path.open("r", encoding="utf-8", errors="replace") as stream:
        if not from_start:
            stream.seek(0, 2)
        print(f"Forwarding perception events to: {endpoint}")
        while True:
            line = stream.readline()
            if not line:
                time.sleep(0.15)
                continue
            event = extract_event(line)
            if event is None:
                continue
            try:
                post_event(endpoint, event, timeout)
                print(f"Forwarded: {event.get('event_type', 'unknown')}")
            except (URLError, TimeoutError, RuntimeError) as error:
                print(f"Forward failed: {error}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Forward desktop_bot events to AI Hub OS")
    parser.add_argument("--log", type=Path, required=True, help="desktop_bot logs/perception.log path")
    parser.add_argument(
        "--endpoint",
        default="http://127.0.0.1:18000/api/v1/perception/events",
    )
    parser.add_argument("--timeout", type=float, default=3.0)
    parser.add_argument("--from-start", action="store_true")
    args = parser.parse_args()
    try:
        follow(args.log, args.endpoint, args.timeout, args.from_start)
    except KeyboardInterrupt:
        print("Stopped")


if __name__ == "__main__":
    main()

