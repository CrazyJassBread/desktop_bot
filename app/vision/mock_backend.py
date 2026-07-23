"""Deterministic gesture backend for tests."""

from __future__ import annotations

from collections import deque

import numpy as np

from app.schemas import GestureDetection
from app.vision.base import GestureBackend


class MockGestureBackend(GestureBackend):
    def __init__(
        self,
        results: list[list[GestureDetection]] | None = None,
    ) -> None:
        self._results = deque(results or [])
        self.call_count = 0

    async def recognize(
        self, rgb_image: np.ndarray
    ) -> list[GestureDetection]:
        self.call_count += 1
        return self._results.popleft() if self._results else []
