"""ASR backend contract."""

from abc import ABC, abstractmethod

from app.models import AudioData


class ASRError(Exception):
    """Unified speech-recognition failure."""


class ASRBackend(ABC):
    @abstractmethod
    async def transcribe(self, audio: AudioData) -> str:
        raise NotImplementedError
