"""Synchronize completed App voice letters into the Web letter space."""

from __future__ import annotations

import asyncio
import json
import logging
from collections.abc import Callable
from typing import Awaitable
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from app.config import WebLetterSyncConfig
from app.perception_events import PerceptionEvent

LOGGER = logging.getLogger("desktop_assistant.web_letter_sync")
EventEmitter = Callable[[PerceptionEvent], Awaitable[None]]
Transport = Callable[[dict[str, object]], dict[str, object]]


class WebLetterSyncManager:
    def __init__(
        self,
        config: WebLetterSyncConfig,
        *,
        sender_email: str,
        bridge_token: str,
        transport: Transport | None = None,
    ) -> None:
        self.config = config
        self.sender_email = sender_email
        self.bridge_token = bridge_token
        self.url = f"{config.base_url.rstrip('/')}{config.endpoint}"
        self._transport = transport or self._post
        self._emit: EventEmitter | None = None
        self._tasks: set[asyncio.Task[None]] = set()

    def set_event_emitter(self, emitter: EventEmitter) -> None:
        self._emit = emitter

    def schedule(self, completed: PerceptionEvent) -> bool:
        if completed.event_type != "llm.letter_completed":
            return False
        task = asyncio.create_task(self._sync(completed))
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)
        return True

    async def wait_idle(self) -> None:
        if self._tasks:
            await asyncio.gather(*tuple(self._tasks))

    async def _sync(self, completed: PerceptionEvent) -> None:
        recipient = str(completed.payload.get("recipient", "")).strip()
        content = str(completed.payload.get("content", "")).strip()
        payload: dict[str, object] = {
            "senderEmail": self.sender_email,
            "recipient": recipient,
            "subject": f"写给{recipient}的语音信件",
            "content": content,
            "eventId": completed.event_id,
        }
        try:
            result = await asyncio.to_thread(self._transport, payload)
            letter = result.get("letter", {})
            if not isinstance(letter, dict):
                raise ValueError("invalid_response")
            await self._publish(
                PerceptionEvent(
                    event_type="web.letter_saved",
                    source="web",
                    session_id=completed.session_id,
                    payload={
                        "trigger_event_id": completed.event_id,
                        "web_letter_id": str(letter.get("id", "")),
                        "recipient": recipient,
                        "replayed": bool(result.get("replayed", False)),
                    },
                )
            )
        except Exception as exc:
            reason = getattr(exc, "reason", None) or type(exc).__name__
            LOGGER.warning(
                "Web letter synchronization failed reason=%s recipient=%s",
                reason,
                recipient,
            )
            await self._publish(
                PerceptionEvent(
                    event_type="web.letter_sync_failed",
                    source="web",
                    session_id=completed.session_id,
                    payload={
                        "trigger_event_id": completed.event_id,
                        "recipient": recipient,
                        "reason": str(reason),
                    },
                )
            )

    def _post(self, payload: dict[str, object]) -> dict[str, object]:
        request = Request(
            self.url,
            data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
            method="POST",
            headers={
                "Authorization": f"Bearer {self.bridge_token}",
                "Content-Type": "application/json; charset=utf-8",
            },
        )
        try:
            with urlopen(
                request,
                timeout=self.config.timeout_seconds,
            ) as response:
                body = response.read()
        except HTTPError as exc:
            reason = f"http_{exc.code}"
            try:
                parsed = json.loads(exc.read())
                reason = str(parsed.get("error", {}).get("code", reason))
            except (json.JSONDecodeError, AttributeError, UnicodeDecodeError):
                pass
            error = RuntimeError(reason)
            error.reason = reason  # type: ignore[attr-defined]
            raise error from exc
        except URLError as exc:
            error = RuntimeError("connection_failed")
            error.reason = "connection_failed"  # type: ignore[attr-defined]
            raise error from exc
        parsed = json.loads(body)
        if not isinstance(parsed, dict):
            raise ValueError("invalid_response")
        return parsed

    async def _publish(self, event: PerceptionEvent) -> None:
        if self._emit is None:
            LOGGER.warning(
                "Web letter sync event dropped because no emitter is configured"
            )
            return
        await self._emit(event)

    async def aclose(self) -> None:
        tasks = tuple(self._tasks)
        for task in tasks:
            task.cancel()
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)
