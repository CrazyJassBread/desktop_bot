"""Wake-word-gated VAD state machine for long-running microphone input."""

from __future__ import annotations

from collections import deque
from enum import StrEnum

import numpy as np

from app.audio.loader import AudioData
from app.audio.stream_pipeline import StreamingAudioPipeline
from app.audio.vad.base import VADBackend
from app.audio.wake_word.base import WakeWordBackend
from app.config import VADConfig, WakeWordConfig


class WakeAudioState(StrEnum):
    SLEEPING = "sleeping"
    ACTIVATED = "activated"
    CAPTURING = "capturing"
    PROCESSING = "processing"


class WakeGatedAudioPipeline:
    def __init__(
        self,
        wake_config: WakeWordConfig,
        vad_config: VADConfig,
        wake_backend: WakeWordBackend,
        vad_backend: VADBackend,
        sample_rate: int = 16_000,
    ) -> None:
        self.wake_config = wake_config
        self.vad_config = vad_config
        self.wake_backend = wake_backend
        self.vad_backend = vad_backend
        self.sample_rate = sample_rate
        self.state = WakeAudioState.SLEEPING
        self._pre_roll: deque[np.ndarray] = deque()
        self._pre_roll_samples = 0
        self._activation_samples = 0
        self._cooldown_samples = 0
        self._vad_pipeline = self._new_vad_pipeline()

    def _new_vad_pipeline(self) -> StreamingAudioPipeline:
        return StreamingAudioPipeline(
            self.vad_config,
            self.vad_backend,
            self.sample_rate,
        )

    async def accept(self, samples: np.ndarray) -> AudioData | None:
        frame = np.ascontiguousarray(samples, dtype=np.float32).reshape(-1)
        if frame.size == 0:
            return None
        if self.state == WakeAudioState.PROCESSING:
            return None
        if self.state == WakeAudioState.SLEEPING:
            prior = tuple(self._pre_roll)
            self._remember(frame)
            if self._cooldown_samples > 0:
                self._cooldown_samples = max(
                    0,
                    self._cooldown_samples - frame.size,
                )
                return None
            if self.wake_config.enabled:
                result = await self.wake_backend.process_frame(
                    frame,
                    self.sample_rate,
                )
                if (
                    not result.detected
                    or result.score < self.wake_config.score_threshold
                ):
                    return None
            self.state = WakeAudioState.ACTIVATED
            self._activation_samples = 0
            await self.vad_backend.reset()
            self._vad_pipeline = self._new_vad_pipeline()
            self._vad_pipeline.seed_pre_roll(prior)
            return await self._capture(frame)
        return await self._capture(frame)

    async def _capture(self, frame: np.ndarray) -> AudioData | None:
        self._activation_samples += frame.size
        utterance = await self._vad_pipeline.accept(frame)
        if utterance is not None:
            self.state = WakeAudioState.PROCESSING
            return utterance
        if self._vad_pipeline.is_active:
            self.state = WakeAudioState.CAPTURING
        if self.state == WakeAudioState.ACTIVATED:
            timeout_samples = int(
                self.wake_config.activation_timeout_seconds * self.sample_rate
            )
            if self._activation_samples >= timeout_samples:
                await self.reset()
        return None

    async def complete_processing(
        self,
        *,
        await_followup: bool = False,
    ) -> None:
        if await_followup:
            await self.vad_backend.reset()
            self._vad_pipeline = self._new_vad_pipeline()
            self._activation_samples = 0
            self.state = WakeAudioState.ACTIVATED
            return
        await self.reset()

    async def reset(self) -> None:
        await self.wake_backend.reset()
        await self.vad_backend.reset()
        self._vad_pipeline = self._new_vad_pipeline()
        self._pre_roll.clear()
        self._pre_roll_samples = 0
        self._activation_samples = 0
        self._cooldown_samples = int(
            self.wake_config.cooldown_ms * self.sample_rate / 1000
        )
        self.state = WakeAudioState.SLEEPING

    def _remember(self, frame: np.ndarray) -> None:
        limit = int(
            self.wake_config.pre_roll_ms * self.sample_rate / 1000
        )
        if limit <= 0:
            return
        self._pre_roll.append(frame)
        self._pre_roll_samples += frame.size
        while self._pre_roll and self._pre_roll_samples > limit:
            removed = self._pre_roll.popleft()
            self._pre_roll_samples -= removed.size

    @property
    def pre_roll_samples(self) -> int:
        return self._pre_roll_samples
