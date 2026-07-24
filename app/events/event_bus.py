"""Small in-process broadcast bus for API and feature consumers."""

from __future__ import annotations

import asyncio

from app.perception_events import PerceptionEvent


class EventSubscription:
    def __init__(
        self,
        bus: "EventBus",
        queue: asyncio.Queue[PerceptionEvent],
    ) -> None:
        self._bus = bus
        self._queue = queue
        self._closed = False

    async def get(self) -> PerceptionEvent:
        return await self._queue.get()

    def close(self) -> None:
        if not self._closed:
            self._closed = True
            self._bus.unsubscribe(self._queue)

    async def __aenter__(self) -> "EventSubscription":
        return self

    async def __aexit__(self, *_: object) -> None:
        self.close()


class EventBus:
    def __init__(self, subscriber_queue_size: int = 100) -> None:
        if subscriber_queue_size < 1:
            raise ValueError("subscriber queue size must be positive")
        self._queue_size = subscriber_queue_size
        self._subscribers: set[asyncio.Queue[PerceptionEvent]] = set()

    def subscribe(self) -> EventSubscription:
        queue: asyncio.Queue[PerceptionEvent] = asyncio.Queue(
            maxsize=self._queue_size
        )
        self._subscribers.add(queue)
        return EventSubscription(self, queue)

    def unsubscribe(self, queue: asyncio.Queue[PerceptionEvent]) -> None:
        self._subscribers.discard(queue)

    def publish(self, event: PerceptionEvent) -> None:
        for queue in tuple(self._subscribers):
            if queue.full():
                queue.get_nowait()
            queue.put_nowait(event)

    @property
    def subscriber_count(self) -> int:
        return len(self._subscribers)
