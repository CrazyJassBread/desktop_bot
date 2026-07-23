"""Gate streaming PCM into complete utterances before ASR."""

from __future__ import annotations

from collections import deque
from pathlib import Path

import numpy as np

from app.audio.loader import AudioData
from app.audio.vad.base import VADBackend
from app.config import VADConfig


class StreamingAudioPipeline:
    """Return AudioData only when a valid utterance reaches an endpoint."""

    def __init__(
        self,
        config: VADConfig,
        backend: VADBackend,
        sample_rate: int = 16_000,
    ) -> None:
        self.config = config
        self.backend = backend
        self.sample_rate = sample_rate
        self._pre_roll: deque[np.ndarray] = deque()
        self._pre_roll_samples = 0
        self._speech_frames: list[np.ndarray] = []
        self._speech_samples = 0
        self._silence_samples = 0
        self._active = False

    async def accept(self, samples: np.ndarray) -> AudioData | None:
        frame = np.ascontiguousarray(samples, dtype=np.float32).reshape(-1)
        if frame.size == 0:
            return None
        probability = await self.backend.speech_probability(
            frame,
            self.sample_rate,
        )
        if not self._active:
            prior = tuple(self._pre_roll)
            self._remember_pre_roll(frame)
            if probability >= self.config.speech_threshold:
                self._active = True
                self._speech_frames = [*prior, frame]
                self._speech_samples = sum(item.size for item in prior) + frame.size
                self._silence_samples = 0
            return None

        self._speech_frames.append(frame)
        self._speech_samples += frame.size
        if probability <= self.config.release_threshold:
            self._silence_samples += frame.size
        else:
            self._silence_samples = 0

        max_samples = int(
            self.config.max_utterance_seconds * self.sample_rate
        )
        silence_limit = int(
            self.config.min_silence_duration_ms * self.sample_rate / 1000
        )
        if self._speech_samples >= max_samples:
            return await self._finish()
        if self._silence_samples >= silence_limit:
            return await self._finish()
        return None

    def seed_pre_roll(self, frames: tuple[np.ndarray, ...]) -> None:
        """Seed wake-word audio without running historical frames through VAD."""
        if self._active:
            raise RuntimeError("cannot seed an active VAD pipeline")
        self._pre_roll.clear()
        self._pre_roll_samples = 0
        for samples in frames:
            frame = np.ascontiguousarray(
                samples,
                dtype=np.float32,
            ).reshape(-1)
            if frame.size:
                self._pre_roll.append(frame)
                self._pre_roll_samples += frame.size

    def _remember_pre_roll(self, frame: np.ndarray) -> None:
        limit = int(self.config.pre_roll_ms * self.sample_rate / 1000)
        if limit <= 0:
            return
        self._pre_roll.append(frame)
        self._pre_roll_samples += frame.size
        while self._pre_roll and self._pre_roll_samples > limit:
            removed = self._pre_roll.popleft()
            self._pre_roll_samples -= removed.size

    async def _finish(self) -> AudioData | None:
        combined = np.concatenate(self._speech_frames)
        effective_samples = max(0, self._speech_samples - self._silence_samples)
        minimum = int(
            self.config.min_speech_duration_ms * self.sample_rate / 1000
        )
        self._active = False
        self._speech_frames = []
        self._speech_samples = 0
        self._silence_samples = 0
        self._pre_roll.clear()
        self._pre_roll_samples = 0
        await self.backend.reset()
        if effective_samples < minimum:
            return None
        return AudioData(
            samples=np.ascontiguousarray(combined, dtype=np.float32),
            sample_rate=self.sample_rate,
            duration_seconds=combined.size / self.sample_rate,
            source_path=Path("<stream>"),
        )

    @property
    def is_active(self) -> bool:
        return self._active

    @property
    def buffered_samples(self) -> int:
        return self._speech_samples
