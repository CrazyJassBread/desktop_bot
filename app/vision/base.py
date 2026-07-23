"""Gesture backend contract and stable vision errors."""

from __future__ import annotations

from abc import ABC, abstractmethod

import numpy as np

from app.models import GestureDetection


class VisionError(Exception):
    def __init__(self, code: str, message: str | None = None) -> None:
        self.code = code
        super().__init__(message or code)


class GestureBackend(ABC):
    @abstractmethod
    async def recognize(
        self, rgb_image: np.ndarray
    ) -> list[GestureDetection]:
        raise NotImplementedError

    async def close(self) -> None:
        return None
