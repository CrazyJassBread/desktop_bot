"""Long-running audio and image source contracts."""

from __future__ import annotations

from abc import ABC, abstractmethod
from collections.abc import AsyncIterator

import numpy as np

from app.schemas import ImageRequest


class AudioFrameSource(ABC):
    @abstractmethod
    def frames(self) -> AsyncIterator[np.ndarray]:
        raise NotImplementedError


class ImageFrameSource(ABC):
    @abstractmethod
    def images(self) -> AsyncIterator[ImageRequest]:
        raise NotImplementedError
