"""Thread-safe bounded cache of frames that completed recognition."""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass
from threading import Lock

import numpy as np

from app.schemas import GestureDetection


@dataclass(frozen=True)
class CachedVisionFrame:
    sequence_id: int
    captured_at_ms: int
    rgb_image: np.ndarray
    detections: tuple[GestureDetection, ...]
    inference_latency_ms: float


class VisionFrameCache:
    def __init__(self, capacity: int = 20) -> None:
        if capacity < 1:
            raise ValueError("capacity must be positive")
        self._frames: deque[CachedVisionFrame] = deque(maxlen=capacity)
        self._lock = Lock()

    def append(self, frame: CachedVisionFrame) -> None:
        with self._lock:
            self._frames.append(frame)

    def latest(self) -> CachedVisionFrame | None:
        with self._lock:
            return self._frames[-1] if self._frames else None

    def snapshot(self) -> tuple[CachedVisionFrame, ...]:
        with self._lock:
            return tuple(self._frames)

    def clear(self) -> None:
        with self._lock:
            self._frames.clear()

    def __len__(self) -> int:
        with self._lock:
            return len(self._frames)
