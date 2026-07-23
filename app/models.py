"""Small data objects shared by the active perception pipeline."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import numpy as np


@dataclass(frozen=True)
class AudioData:
    samples: np.ndarray
    sample_rate: int
    duration_seconds: float
    source_path: Path = Path("<stream>")


@dataclass(frozen=True)
class GestureDetection:
    label: str
    score: float
    handedness: str | None = None


@dataclass(frozen=True)
class ImageRequest:
    image_bytes: bytes
    session_id: str = "bot"
    request_id: str | None = None
    captured_at_ms: int | None = None
    content_type: str = "image/jpeg"

