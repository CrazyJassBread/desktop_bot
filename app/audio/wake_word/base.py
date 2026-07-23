"""Frame-level wake-word detector contract."""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass

import numpy as np


@dataclass(frozen=True)
class WakeWordResult:
    detected: bool
    score: float = 0.0


class WakeWordBackend(ABC):
    @abstractmethod
    async def process_frame(
        self,
        samples: np.ndarray,
        sample_rate: int,
    ) -> WakeWordResult:
        raise NotImplementedError

    async def reset(self) -> None:
        return None
