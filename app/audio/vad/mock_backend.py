"""Deterministic VAD used by unit tests."""

from __future__ import annotations

from collections import deque

import numpy as np

from app.audio.vad.base import VADBackend


class MockVADBackend(VADBackend):
    def __init__(self, probabilities: list[float]) -> None:
        self._probabilities = deque(probabilities)
        self.call_count = 0

    async def speech_probability(
        self,
        samples: np.ndarray,
        sample_rate: int,
    ) -> float:
        self.call_count += 1
        return self._probabilities.popleft() if self._probabilities else 0.0
