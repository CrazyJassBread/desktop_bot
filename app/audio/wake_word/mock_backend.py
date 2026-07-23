"""Deterministic wake-word backend for integration tests."""

from __future__ import annotations

from collections import deque

import numpy as np

from app.audio.wake_word.base import WakeWordBackend, WakeWordResult


class MockWakeWordBackend(WakeWordBackend):
    def __init__(self, scores: list[float]) -> None:
        self._scores = deque(scores)
        self.call_count = 0
        self.reset_count = 0

    async def process_frame(
        self,
        samples: np.ndarray,
        sample_rate: int,
    ) -> WakeWordResult:
        self.call_count += 1
        score = self._scores.popleft() if self._scores else 0.0
        return WakeWordResult(detected=score > 0, score=score)

    async def reset(self) -> None:
        self.reset_count += 1
