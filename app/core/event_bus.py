"""Small in-process asynchronous event bus."""

from __future__ import annotations

import asyncio

from app.core.events import BotEvent


class EventBus:
    def __init__(self, maxsize: int = 100) -> None:
        self._queue: asyncio.Queue[BotEvent] = asyncio.Queue(maxsize=maxsize)

    async def publish(self, event: BotEvent) -> None:
        await self._queue.put(event)

    async def receive(self) -> BotEvent:
        return await self._queue.get()

    def task_done(self) -> None:
        self._queue.task_done()
