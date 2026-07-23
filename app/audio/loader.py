"""PCM WAV reader and preprocessing entry point."""

from __future__ import annotations

import wave
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from app.audio.preprocess import normalize_amplitude, resample, to_mono
from app.audio.validator import AudioProcessingError, validate_audio_path
from app.config import AudioConfig


@dataclass
class AudioData:
    samples: np.ndarray
    sample_rate: int
    duration_seconds: float
    source_path: Path


def _decode_pcm(raw: bytes, sample_width: int) -> np.ndarray:
    if sample_width == 1:
        return (np.frombuffer(raw, dtype=np.uint8).astype(np.float32) - 128) / 128
    if sample_width == 2:
        return np.frombuffer(raw, dtype="<i2").astype(np.float32) / 32768
    if sample_width == 3:
        values = np.frombuffer(raw, dtype=np.uint8).reshape(-1, 3)
        decoded = (
            values[:, 0].astype(np.int32)
            | (values[:, 1].astype(np.int32) << 8)
            | (values[:, 2].astype(np.int32) << 16)
        )
        decoded = (decoded ^ 0x800000) - 0x800000
        return decoded.astype(np.float32) / 8_388_608
    if sample_width == 4:
        return np.frombuffer(raw, dtype="<i4").astype(np.float32) / 2_147_483_648
    raise AudioProcessingError("unsupported_audio_format")


def load_wav(path: Path, config: AudioConfig) -> AudioData:
    """Read, validate, mono-mix, resample, and normalize a PCM WAV file."""
    path = Path(path)
    validate_audio_path(path)
    try:
        with wave.open(str(path), "rb") as wav:
            if wav.getcomptype() != "NONE":
                raise AudioProcessingError("unsupported_audio_format")
            channels = wav.getnchannels()
            source_rate = wav.getframerate()
            sample_width = wav.getsampwidth()
            frame_count = wav.getnframes()
            raw = wav.readframes(frame_count)
    except AudioProcessingError:
        raise
    except (EOFError, wave.Error, OSError) as exc:
        raise AudioProcessingError("corrupted_audio") from exc

    if channels < 1 or source_rate < 1 or frame_count < 1 or not raw:
        raise AudioProcessingError("empty_audio")
    duration = frame_count / source_rate
    if duration < config.min_duration_seconds:
        raise AudioProcessingError("audio_too_short")
    if duration > config.max_duration_seconds:
        raise AudioProcessingError("audio_too_long")

    try:
        samples = _decode_pcm(raw, sample_width).reshape(-1, channels)
    except (ValueError, TypeError) as exc:
        raise AudioProcessingError("corrupted_audio") from exc
    samples = to_mono(samples)
    samples = resample(samples, source_rate, config.target_sample_rate)
    if config.normalize:
        samples = normalize_amplitude(samples)
    if samples.size == 0:
        raise AudioProcessingError("empty_audio")
    return AudioData(
        samples=np.ascontiguousarray(samples, dtype=np.float32),
        sample_rate=config.target_sample_rate,
        duration_seconds=duration,
        source_path=path,
    )

