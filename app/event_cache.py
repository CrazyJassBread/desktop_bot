"""Bounded in-memory cache for meaningful perception events."""

from __future__ import annotations

from collections import deque
from collections.abc import Callable
from time import time

from app.perception_events import PerceptionEvent


class EventCache:
    def __init__(
        self,
        capacity: int = 100,
        ttl_seconds: float = 1_800,
        *,
        clock: Callable[[], float] = time,
    ) -> None:
        if capacity < 1:
            raise ValueError("capacity must be positive")
        if ttl_seconds <= 0:
            raise ValueError("ttl_seconds must be positive")
        self._events: deque[PerceptionEvent] = deque(maxlen=capacity)
        self._ttl_ms = int(ttl_seconds * 1_000)
        self._clock = clock

    def append(self, event: PerceptionEvent) -> None:
        self._evict_expired()
        self._events.append(event)

    def snapshot(self) -> tuple[PerceptionEvent, ...]:
        self._evict_expired()
        return tuple(self._events)

    def latest(self) -> PerceptionEvent | None:
        self._evict_expired()
        return self._events[-1] if self._events else None

    def clear(self) -> None:
        self._events.clear()

    def _evict_expired(self) -> None:
        cutoff = int(self._clock() * 1_000) - self._ttl_ms
        while self._events and self._events[0].timestamp_ms < cutoff:
            self._events.popleft()

    def __len__(self) -> int:
        self._evict_expired()
        return len(self._events)

