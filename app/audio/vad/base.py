"""Streaming VAD contract."""

from __future__ import annotations

from abc import ABC, abstractmethod

import numpy as np


class VADError(Exception):
    pass


class VADBackend(ABC):
    @abstractmethod
    async def speech_probability(
        self,
        samples: np.ndarray,
        sample_rate: int,
    ) -> float:
        raise NotImplementedError

    async def reset(self) -> None:
        return None
