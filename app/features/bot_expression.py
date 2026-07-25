"""Translate runtime events into Bot OLED expressions."""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Awaitable, Callable
from typing import Final

import aiohttp

from app.config import BotExpressionConfig
from app.perception_events import PerceptionEvent

LOGGER = logging.getLogger("desktop_assistant.expression")

PERSISTENT_EXPRESSIONS: Final = frozenset(
    {"happy", "angry", "tired", "default"}
)
ACTION_EXPRESSIONS: Final = frozenset({"blink", "laugh", "confused"})
SUPPORTED_EXPRESSIONS: Final = (
    PERSISTENT_EXPRESSIONS | ACTION_EXPRESSIONS
)
_END: Final = object()

ExpressionSender = Callable[[str], Awaitable[None]]


class BotExpressionClient:
    """Small async client for the ESP OLED expression endpoint."""

    def __init__(self, config: BotExpressionConfig) -> None:
        self.url = (
            f"{config.base_url.rstrip('/')}{config.endpoint}"
        )
        self.timeout = aiohttp.ClientTimeout(
            total=config.timeout_seconds
        )
        self._session: aiohttp.ClientSession | None = None

    async def set_expression(self, expression: str) -> None:
        if expression not in SUPPORTED_EXPRESSIONS:
            raise ValueError(f"unsupported Bot expression: {expression}")
        if self._session is None:
            self._session = aiohttp.ClientSession(timeout=self.timeout)
        async with self._session.post(
            self.url,
            json={"expression": expression},
        ) as response:
            response.raise_for_status()

    async def aclose(self) -> None:
        if self._session is not None:
            await self._session.close()
            self._session = None


class BotExpressionController:
    """Maintain a persistent mood and overlay two-second actions."""

    _PERSISTENT_BY_EVENT: Final[dict[str, str]] = {
        "gesture.victory": "happy",
        "feature.photo_print": "happy",
        "runtime.asr_started": "tired",
        "runtime.asr_completed": "default",
        "llm.session_started": "happy",
        "llm.recipient_set": "happy",
        "llm.transcript_buffered": "happy",
        "llm.generation_started": "tired",
        "photo.captured": "tired",
        "letter.rendered": "tired",
        "llm.session_cancelled": "default",
        "llm.answer_completed": "default",
        "llm.letter_completed": "tired",
        "photo.completed": "default",
        "letter.printed": "default",
        "llm.session_failed": "angry",
        "llm.session_rejected": "angry",
        "runtime.asr_failed": "angry",
        "photo.capture_failed": "angry",
        "photo.print_failed": "angry",
        "letter.render_failed": "angry",
        "letter.print_failed": "angry",
    }
    _ACTION_BY_EVENT: Final[dict[str, str]] = {
        "gesture.victory": "blink",
        "feature.photo_print": "blink",
        "llm.answer_completed": "laugh",
        "photo.completed": "laugh",
        "letter.printed": "laugh",
        "llm.session_failed": "confused",
        "llm.session_rejected": "confused",
        "runtime.asr_failed": "confused",
        "photo.capture_failed": "confused",
        "photo.print_failed": "confused",
        "letter.render_failed": "confused",
        "letter.print_failed": "confused",
    }

    def __init__(
        self,
        config: BotExpressionConfig,
        *,
        sender: ExpressionSender | None = None,
    ) -> None:
        self.config = config
        self._client = (
            None if sender is not None else BotExpressionClient(config)
        )
        self._sender = (
            sender
            if sender is not None
            else self._client.set_expression  # type: ignore[union-attr]
        )
        self._persistent = "default"
        self._last_queued: str | None = None
        self._queue: asyncio.Queue[str | object] = asyncio.Queue()
        self._worker_task: asyncio.Task[None] | None = None
        self._restore_task: asyncio.Task[None] | None = None
        self._closed = False

    @property
    def persistent_expression(self) -> str:
        return self._persistent

    async def start(self) -> None:
        self._ensure_worker()
        self._enqueue("default")

    async def handle(self, event: PerceptionEvent) -> None:
        if self._closed:
            return
        self._ensure_worker()
        persistent = self._PERSISTENT_BY_EVENT.get(event.event_type)
        action = self._ACTION_BY_EVENT.get(event.event_type)
        if persistent is not None:
            self._persistent = persistent
        if action is not None:
            self._enqueue(action, force=True)
            self._schedule_restore()
        elif persistent is not None:
            self._cancel_restore()
            self._enqueue(persistent)

    async def wait_idle(self) -> None:
        """Wait until all currently queued HTTP requests have finished."""
        await self._queue.join()

    def _ensure_worker(self) -> None:
        if self._worker_task is None:
            self._worker_task = asyncio.create_task(self._worker())

    def _enqueue(self, expression: str, *, force: bool = False) -> None:
        if not force and expression == self._last_queued:
            return
        self._last_queued = expression
        self._queue.put_nowait(expression)

    def _schedule_restore(self) -> None:
        self._cancel_restore()
        self._restore_task = asyncio.create_task(self._restore())

    def _cancel_restore(self) -> None:
        if self._restore_task is not None:
            self._restore_task.cancel()
            self._restore_task = None

    async def _restore(self) -> None:
        try:
            await asyncio.sleep(self.config.action_duration_seconds)
            self._enqueue(self._persistent, force=True)
        except asyncio.CancelledError:
            raise
        finally:
            if self._restore_task is asyncio.current_task():
                self._restore_task = None

    async def _worker(self) -> None:
        while True:
            item = await self._queue.get()
            try:
                if item is _END:
                    return
                assert isinstance(item, str)
                try:
                    await self._sender(item)
                except Exception:
                    LOGGER.warning(
                        "failed to send Bot expression=%s",
                        item,
                        exc_info=True,
                    )
            finally:
                self._queue.task_done()

    async def aclose(self) -> None:
        if self._closed:
            return
        self._closed = True
        self._cancel_restore()
        if self._worker_task is not None:
            await self._queue.join()
            self._queue.put_nowait(_END)
            await self._worker_task
            self._worker_task = None
        if self._client is not None:
            await self._client.aclose()
