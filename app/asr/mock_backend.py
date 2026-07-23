"""Predictable ASR backend for tests and local development."""

from app.asr.base import ASRBackend
from app.models import AudioData


class MockASRBackend(ASRBackend):
    def __init__(self, transcripts: dict[str, str] | None = None) -> None:
        self.transcripts = transcripts or {}

    async def transcribe(self, audio: AudioData) -> str:
        return self.transcripts.get(audio.source_path.name, "")
