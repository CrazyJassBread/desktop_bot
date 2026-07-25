"""Forward desktop_bot PerceptionEvent objects to AI Hub OS.

Copy this module into the desktop_bot repository (for example under app/), then
call ``await forwarder.send(event)`` immediately after EventCache.append().
Only structured event JSON is forwarded; PCM and JPEG frames stay local.
"""

from __future__ import annotations

import asyncio
import json
from dataclasses import dataclass
from urllib.request import Request, urlopen


@dataclass(frozen=True)
class WebEventForwarder:
    endpoint: str = "http://127.0.0.1:18000/api/v1/perception/events"
    timeout_seconds: float = 3.0

    async def send(self, event: object) -> None:
        payload = event.to_dict() if hasattr(event, "to_dict") else event
        await asyncio.to_thread(self._post_json, payload)

    def _post_json(self, payload: object) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        request = Request(
            self.endpoint,
            data=body,
            method="POST",
            headers={"Content-Type": "application/json; charset=utf-8"},
        )
        with urlopen(request, timeout=self.timeout_seconds) as response:
            if response.status != 202:
                raise RuntimeError(f"event gateway returned HTTP {response.status}")

