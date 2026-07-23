from __future__ import annotations

import numpy as np
import pytest

from app.asr.base import ASRBackend
from app.audio.loader import AudioData
from app.audio.stream_pipeline import StreamingAudioPipeline
from app.audio.vad.mock_backend import MockVADBackend
from app.audio.vad.silero_backend import SileroVADBackend
from app.config import VADConfig
from app.config import AppConfig
from app.llm.mock_backend import MockLLMBackend
from app.runtime.assistant_runtime import AssistantRuntime
from app.runtime.vad_voice_bridge import VADVoiceBridge


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
    config = VADConfig(pre_roll_ms=64)
    backend = MockVADBackend([0.1] * 20)
    pipeline = StreamingAudioPipeline(config, backend)
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


class CountingASR(ASRBackend):
    def __init__(self) -> None:
        self.call_count = 0

    async def transcribe(self, audio: AudioData) -> str:
        self.call_count += 1
        return "返回主页"


@pytest.mark.asyncio
async def test_vad_bridge_calls_asr_only_after_endpoint():
    config = AppConfig()
    config.audio.min_duration_seconds = 0.05
    config.vad.min_speech_duration_ms = 64
    config.vad.min_silence_duration_ms = 64
    config.vad.pre_roll_ms = 0
    vad = MockVADBackend([0.9, 0.9, 0.0, 0.0])
    stream = StreamingAudioPipeline(config.vad, vad)
    asr = CountingASR()
    runtime = AssistantRuntime(config)
    voice = runtime.create_voice_pipeline(asr, MockLLMBackend())
    bridge = VADVoiceBridge(stream, voice)
    frame = np.ones(512, dtype=np.float32) * 0.1

    assert await bridge.accept_frame(frame, "bot") is None
    assert await bridge.accept_frame(frame, "bot") is None
    assert await bridge.accept_frame(frame, "bot") is None
    response = await bridge.accept_frame(frame, "bot")

    assert response is not None
    assert response.action == "ui.home"
    assert asr.call_count == 1
