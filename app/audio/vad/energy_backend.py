"""Dependency-light RMS energy voice activity detector."""

from __future__ import annotations

import numpy as np

from app.audio.vad.base import VADBackend


class EnergyVADBackend(VADBackend):
    def __init__(self, noise_floor: float, speech_level: float) -> None:
        if not 0 <= noise_floor < speech_level <= 1:
            raise ValueError("energy VAD levels must satisfy 0 <= noise < speech <= 1")
        self.noise_floor = noise_floor
        self.speech_level = speech_level

    async def speech_probability(
        self,
        samples: np.ndarray,
        sample_rate: int,
    ) -> float:
        del sample_rate
        frame = np.ascontiguousarray(samples, dtype=np.float32).reshape(-1)
        if frame.size == 0:
            return 0.0
        rms = float(np.sqrt(np.mean(np.square(frame))))
        scaled = (rms - self.noise_floor) / (
            self.speech_level - self.noise_floor
        )
        return max(0.0, min(1.0, scaled))
