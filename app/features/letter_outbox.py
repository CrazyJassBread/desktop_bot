"""Deliver finished letters from the event bus to the Paper Bridge web UI."""

from __future__ import annotations

import asyncio
import logging
from typing import Any, Awaitable, Callable

from app.events.event_bus import EventBus
from app.perception_events import PerceptionEvent

LOGGER = logging.getLogger("desktop_assistant.letter_outbox")

EventEmitter = Callable[[PerceptionEvent], Awaitable[None]]
# poster(url, headers, payload) -> (status_code, response_body)
Poster = Callable[[str, dict[str, str], dict[str, Any]], Awaitable[tuple[int, Any]]]


class LetterOutbox:
    """Post llm.letter_completed events to the ui device letter endpoint."""

    def __init__(
        self,
        event_bus: EventBus,
        *,
        base_url: str,
        device_token: str,
        timeout_seconds: float = 15.0,
        poster: Poster | None = None,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.device_token = device_token
        self.timeout_seconds = timeout_seconds
        self.event_bus = event_bus
        self._poster = poster
        self._emit: EventEmitter | None = None
        self._session = None
        self._task: asyncio.Task[None] | None = None

    def set_event_emitter(self, emitter: EventEmitter) -> None:
        self._emit = emitter

    def start(self) -> None:
        if self._task is None:
            self._task = asyncio.create_task(self._consume())

    async def _consume(self) -> None:
        async with self.event_bus.subscribe() as subscription:
            while True:
                event = await subscription.get()
                if event.event_type == "llm.letter_completed":
                    await self._deliver(event)

    async def _deliver(self, event: PerceptionEvent) -> None:
        payload = {
            "recipientName": event.payload.get("recipient"),
            "subject": event.payload.get("subject") or "",
            "body": event.payload.get("letter") or "",
            "rawTranscript": event.payload.get("raw_transcript") or "",
            "sessionId": event.session_id,
        }
        url = f"{self.base_url}/api/v1/device/letters"
        headers = {"Authorization": f"Bearer {self.device_token}"}
        try:
            status, body = await self._post(url, headers, payload)
        except Exception as exc:  # network errors must never break the runtime
            LOGGER.warning("letter delivery failed: %s", exc)
            await self._publish_failed(event, f"unable to reach the ui server: {exc}")
            return
        if status >= 300 or not isinstance(body, dict):
            reason = ""
            if isinstance(body, dict):
                reason = str(body.get("title") or body.get("code") or "")
            await self._publish_failed(
                event, f"ui server rejected the letter ({status}): {reason}"
            )
            return
        await self._publish(
            PerceptionEvent(
                event_type="letter.delivered",
                source="letter_outbox",
                session_id=event.session_id,
                payload={
                    "letter_id": body.get("letterId"),
                    "status": body.get("status"),
                    "recipient": body.get("matchedRecipient"),
                    "trigger_event_id": event.event_id,
                },
            )
        )

    async def _post(
        self,
        url: str,
        headers: dict[str, str],
        payload: dict[str, Any],
    ) -> tuple[int, Any]:
        if self._poster is not None:
            return await self._poster(url, headers, payload)
        import aiohttp

        if self._session is None or self._session.closed:
            self._session = aiohttp.ClientSession(
                timeout=aiohttp.ClientTimeout(total=self.timeout_seconds)
            )
        async with self._session.post(url, json=payload, headers=headers) as response:
            body = await response.json(content_type=None)
            return response.status, body

    async def _publish_failed(self, event: PerceptionEvent, reason: str) -> None:
        await self._publish(
            PerceptionEvent(
                event_type="letter.delivery_failed",
                source="letter_outbox",
                session_id=event.session_id,
                payload={
                    "reason": reason,
                    "trigger_event_id": event.event_id,
                },
            )
        )

    async def _publish(self, event: PerceptionEvent) -> None:
        if self._emit is None:
            LOGGER.warning("letter event dropped because no emitter is configured")
            return
        await self._emit(event)

    async def aclose(self) -> None:
        if self._task is not None:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None
        if self._session is not None and not self._session.closed:
            await self._session.close()
