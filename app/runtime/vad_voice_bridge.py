"""Bridge streaming VAD utterances into the existing WAV voice pipeline."""

from __future__ import annotations

import asyncio
import tempfile
import wave
from pathlib import Path

import numpy as np

from app.audio.stream_pipeline import StreamingAudioPipeline
from app.runtime.pipeline import VoicePipeline
from app.schemas import AssistantResponse, AudioRequest, ControlSignal


class VADVoiceBridge:
    def __init__(
        self,
        vad_pipeline: StreamingAudioPipeline,
        voice_pipeline: VoicePipeline,
    ) -> None:
        self.vad_pipeline = vad_pipeline
        self.voice_pipeline = voice_pipeline

    async def accept_frame(
        self,
        samples: np.ndarray,
        session_id: str = "default",
    ) -> AssistantResponse | None:
        utterance = await self.vad_pipeline.accept(samples)
        if utterance is None:
            return None
        path = await asyncio.to_thread(
            self._write_temporary_wav,
            utterance.samples,
            utterance.sample_rate,
        )
        try:
            return await self.voice_pipeline.process(
                AudioRequest(
                    path,
                    session_id=session_id,
                    signal=ControlSignal.AUTO,
                )
            )
        finally:
            path.unlink(missing_ok=True)

    @staticmethod
    def _write_temporary_wav(
        samples: np.ndarray,
        sample_rate: int,
    ) -> Path:
        pcm = (
            np.clip(samples, -1.0, 1.0) * 32767
        ).astype("<i2", copy=False)
        with tempfile.NamedTemporaryFile(
            suffix=".wav",
            prefix="bot-utterance-",
            delete=False,
        ) as temporary:
            path = Path(temporary.name)
        with wave.open(str(path), "wb") as output:
            output.setnchannels(1)
            output.setsampwidth(2)
            output.setframerate(sample_rate)
            output.writeframes(pcm.tobytes())
        return path
