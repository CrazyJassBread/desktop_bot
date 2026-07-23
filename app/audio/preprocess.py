"""Small, dependency-light waveform transformations."""

from __future__ import annotations

import numpy as np


def to_mono(samples: np.ndarray) -> np.ndarray:
    """Average channel data while preserving a one-dimensional waveform."""
    if samples.ndim == 1:
        return samples
    return samples.mean(axis=1, dtype=np.float32)


def resample(samples: np.ndarray, source_rate: int, target_rate: int) -> np.ndarray:
    """Linearly resample a mono waveform."""
    if source_rate == target_rate or samples.size == 0:
        return samples.astype(np.float32, copy=False)
    target_length = max(1, round(samples.size * target_rate / source_rate))
    old_positions = np.linspace(0.0, 1.0, samples.size, endpoint=False)
    new_positions = np.linspace(0.0, 1.0, target_length, endpoint=False)
    return np.interp(new_positions, old_positions, samples).astype(np.float32)


def normalize_amplitude(samples: np.ndarray) -> np.ndarray:
    """Peak-normalize non-silent audio without applying noise reduction."""
    peak = float(np.max(np.abs(samples))) if samples.size else 0.0
    if peak <= 1e-8:
        return samples.astype(np.float32, copy=False)
    return (samples / peak * 0.95).astype(np.float32)

