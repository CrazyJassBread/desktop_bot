"""Connect wake-word-gated audio to the existing voice pipeline."""

from __future__ import annotations

import asyncio

import numpy as np

from app.audio.wake_gated_pipeline import WakeGatedAudioPipeline
from app.runtime.pipeline import VoicePipeline
from app.runtime.vad_voice_bridge import VADVoiceBridge
from app.schemas import AssistantResponse, AudioRequest, ControlSignal


class WakeGatedVoiceBridge:
    def __init__(
        self,
        audio_pipeline: WakeGatedAudioPipeline,
        voice_pipeline: VoicePipeline,
    ) -> None:
        self.audio_pipeline = audio_pipeline
        self.voice_pipeline = voice_pipeline

    async def accept_frame(
        self,
        samples: np.ndarray,
        session_id: str = "default",
    ) -> AssistantResponse | None:
        utterance = await self.audio_pipeline.accept(samples)
        if utterance is None:
            return None
        path = await asyncio.to_thread(
            VADVoiceBridge._write_temporary_wav,
            utterance.samples,
            utterance.sample_rate,
        )
        try:
            response = await self.voice_pipeline.process(
                AudioRequest(
                    path,
                    session_id=session_id,
                    signal=ControlSignal.AUTO,
                )
            )
        finally:
            path.unlink(missing_ok=True)

        if response.error == "empty_transcript":
            await self.audio_pipeline.complete_processing(
                await_followup=True,
            )
            return None
        await self.audio_pipeline.complete_processing(
            await_followup=not self.audio_pipeline.wake_config.single_turn,
        )
        return response
