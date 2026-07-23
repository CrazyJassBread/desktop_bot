from __future__ import annotations

import numpy as np
import pytest

from app.audio.stream_pipeline import StreamingAudioPipeline
from app.audio.vad.mock_backend import MockVADBackend
from app.audio.vad.silero_backend import SileroVADBackend
from app.config import VADConfig


@pytest.mark.asyncio
async def test_vad_emits_only_completed_valid_speech():
    config = VADConfig(
        speech_threshold=0.6,
        release_threshold=0.35,
        min_speech_duration_ms=64,
        min_silence_duration_ms=64,
        pre_roll_ms=0,
    )
    backend = MockVADBackend([0.9, 0.9, 0.0, 0.0])
    pipeline = StreamingAudioPipeline(config, backend)
    frame = np.ones(512, dtype=np.float32) * 0.1
    results = [await pipeline.accept(frame) for _ in range(4)]
    assert results[:3] == [None, None, None]
    assert results[3] is not None
    assert results[3].sample_rate == 16_000
    assert results[3].samples.size == 2048


@pytest.mark.asyncio
async def test_vad_does_not_emit_noise_or_silence():
    backend = MockVADBackend([0.1] * 20)
    pipeline = StreamingAudioPipeline(VADConfig(pre_roll_ms=64), backend)
    frame = np.zeros(512, dtype=np.float32)
    for _ in range(20):
        assert await pipeline.accept(frame) is None
    assert backend.call_count == 20


@pytest.mark.asyncio
async def test_vad_forces_endpoint_at_configured_maximum():
    config = VADConfig(
        min_speech_duration_ms=32,
        min_silence_duration_ms=800,
        pre_roll_ms=0,
        max_utterance_seconds=0.096,
    )
    backend = MockVADBackend([0.9, 0.9, 0.9])
    pipeline = StreamingAudioPipeline(config, backend)
    frame = np.ones(512, dtype=np.float32) * 0.1
    assert await pipeline.accept(frame) is None
    assert await pipeline.accept(frame) is None
    utterance = await pipeline.accept(frame)
    assert utterance is not None
    assert utterance.samples.size == 1_536


@pytest.mark.asyncio
async def test_bundled_silero_backend_runs_on_silence():
    backend = SileroVADBackend()
    probability = await backend.speech_probability(
        np.zeros(512, dtype=np.float32),
        16_000,
    )
    assert 0 <= probability < 0.5
