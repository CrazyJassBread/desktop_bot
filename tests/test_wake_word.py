from __future__ import annotations

from collections import deque

import numpy as np
import pytest

from app.asr.base import ASRBackend
from app.audio.loader import AudioData
from app.audio.vad.mock_backend import MockVADBackend
from app.audio.wake_gated_pipeline import (
    WakeAudioState,
    WakeGatedAudioPipeline,
)
from app.audio.wake_word.mock_backend import MockWakeWordBackend
from app.audio.wake_word.text import strip_leading_wake_word
from app.config import AppConfig, VADConfig, WakeWordConfig, load_config
from app.llm.mock_backend import MockLLMBackend
from app.output.base import BotResponse, OutputAdapter
from app.runtime.assistant_daemon import AssistantDaemon
from app.runtime.assistant_runtime import AssistantRuntime
from app.schemas import InteractionMode
from app.transport.sources import AudioFrameSource


FRAME = np.ones(512, dtype=np.float32) * 0.1


class SequenceASR(ASRBackend):
    def __init__(self, transcripts: list[str]) -> None:
        self.transcripts = deque(transcripts)
        self.call_count = 0

    async def transcribe(self, audio: AudioData) -> str:
        self.call_count += 1
        return self.transcripts.popleft()


class FiniteAudioSource(AudioFrameSource):
    def __init__(self, count: int) -> None:
        self.count = count

    async def frames(self):
        for _ in range(self.count):
            yield FRAME


class CollectingOutput(OutputAdapter):
    def __init__(self) -> None:
        self.responses: list[BotResponse] = []

    async def send_response(self, response: BotResponse) -> None:
        self.responses.append(response)


def short_configs() -> tuple[WakeWordConfig, VADConfig]:
    return (
        WakeWordConfig(
            score_threshold=0.7,
            cooldown_ms=0,
            pre_roll_ms=2_000,
            activation_timeout_seconds=0.15,
        ),
        VADConfig(
            speech_threshold=0.6,
            release_threshold=0.35,
            min_speech_duration_ms=64,
            min_silence_duration_ms=64,
            pre_roll_ms=0,
            max_utterance_seconds=45,
        ),
    )


def test_wake_word_text_is_removed_only_at_the_start():
    config = WakeWordConfig()
    assert strip_leading_wake_word("小A，现在几点了", config) == "现在几点了"
    assert strip_leading_wake_word("小爱 帮我打开游戏", config) == "帮我打开游戏"
    assert strip_leading_wake_word("介绍一下小爱同学", config) == "介绍一下小爱同学"


def test_project_config_enables_long_wake_gated_stateless_audio():
    config = load_config("config.yaml")
    assert config.wake_word.enabled is True
    assert config.wake_word.phrase == "小A"
    assert config.wake_word.pre_roll_ms == 2_000
    assert config.vad.max_utterance_seconds == 45
    assert config.llm.history_enabled is False


@pytest.mark.asyncio
async def test_long_idle_audio_never_reaches_vad_or_asr_stage():
    wake_config, vad_config = short_configs()
    wake = MockWakeWordBackend([0.0] * 1_000)
    vad = MockVADBackend([])
    pipeline = WakeGatedAudioPipeline(
        wake_config,
        vad_config,
        wake,
        vad,
    )
    for _ in range(1_000):
        assert await pipeline.accept(FRAME) is None
    assert wake.call_count == 1_000
    assert vad.call_count == 0
    assert pipeline.state == WakeAudioState.SLEEPING
    assert pipeline.pre_roll_samples <= 32_000


@pytest.mark.asyncio
async def test_wake_word_opens_vad_and_emits_one_utterance():
    wake_config, vad_config = short_configs()
    wake = MockWakeWordBackend([0.0, 0.0, 0.9])
    vad = MockVADBackend([0.9, 0.9, 0.0, 0.0])
    pipeline = WakeGatedAudioPipeline(
        wake_config,
        vad_config,
        wake,
        vad,
    )
    results = [await pipeline.accept(FRAME) for _ in range(6)]
    utterance = results[-1]
    assert utterance is not None
    assert utterance.samples.size == 6 * 512
    assert pipeline.state == WakeAudioState.PROCESSING
    assert vad.call_count == 4


@pytest.mark.asyncio
async def test_activation_timeout_returns_to_sleeping():
    wake_config, vad_config = short_configs()
    wake = MockWakeWordBackend([0.9])
    vad = MockVADBackend([0.0] * 10)
    pipeline = WakeGatedAudioPipeline(
        wake_config,
        vad_config,
        wake,
        vad,
    )
    for _ in range(5):
        await pipeline.accept(FRAME)
    assert pipeline.state == WakeAudioState.SLEEPING
    assert pipeline.pre_roll_samples == 0


@pytest.mark.asyncio
async def test_activation_timeout_does_not_cut_active_long_speech():
    wake_config, vad_config = short_configs()
    wake_config.activation_timeout_seconds = 0.05
    vad_config.max_utterance_seconds = 0.192
    wake = MockWakeWordBackend([0.9])
    vad = MockVADBackend([0.9] * 6)
    pipeline = WakeGatedAudioPipeline(
        wake_config,
        vad_config,
        wake,
        vad,
    )
    utterance = None
    for _ in range(6):
        utterance = await pipeline.accept(FRAME) or utterance
    assert utterance is not None
    assert utterance.samples.size == 3_072
    assert pipeline.state == WakeAudioState.PROCESSING


@pytest.mark.asyncio
async def test_bridge_calls_asr_only_after_wake_and_routes_clean_text():
    config = AppConfig()
    config.audio.min_duration_seconds = 0.05
    config.wake_word.cooldown_ms = 0
    config.vad.min_speech_duration_ms = 64
    config.vad.min_silence_duration_ms = 64
    config.vad.pre_roll_ms = 0
    wake = MockWakeWordBackend([0.0, 0.0, 0.9])
    vad = MockVADBackend([0.9, 0.9, 0.0, 0.0])
    asr = SequenceASR(["小A，返回主页"])
    runtime = AssistantRuntime(config)
    bridge = runtime.create_wake_voice_bridge(
        wake,
        vad,
        asr,
        MockLLMBackend(),
    )
    for _ in range(5):
        assert await bridge.accept_frame(FRAME, "bot") is None
        assert asr.call_count == 0
    response = await bridge.accept_frame(FRAME, "bot")
    assert response is not None
    assert response.transcript == "返回主页"
    assert response.action == "ui.home"
    assert asr.call_count == 1
    assert bridge.audio_pipeline.state == WakeAudioState.SLEEPING


@pytest.mark.asyncio
async def test_wake_only_waits_for_followup_and_llm_has_no_history():
    config = AppConfig()
    config.audio.min_duration_seconds = 0.05
    config.llm.history_enabled = False
    config.wake_word.cooldown_ms = 0
    config.vad.min_speech_duration_ms = 64
    config.vad.min_silence_duration_ms = 64
    config.vad.pre_roll_ms = 0
    wake = MockWakeWordBackend([0.9])
    vad = MockVADBackend(
        [0.9, 0.9, 0.0, 0.0, 0.9, 0.9, 0.0, 0.0]
    )
    asr = SequenceASR(["小A", "什么是强化学习"])
    llm = MockLLMBackend()
    runtime = AssistantRuntime(config)
    runtime.mode_manager.enter_llm("bot")
    bridge = runtime.create_wake_voice_bridge(wake, vad, asr, llm)

    for _ in range(4):
        assert await bridge.accept_frame(FRAME, "bot") is None
    assert bridge.audio_pipeline.state == WakeAudioState.ACTIVATED

    response = None
    for _ in range(4):
        response = await bridge.accept_frame(FRAME, "bot") or response
    assert response is not None
    assert response.mode == InteractionMode.LLM
    assert llm.last_include_history is False
    session = runtime.mode_manager.get_session("bot")
    assert session.conversation_history == []
    assert session.last_assistant_response == response.display_text


@pytest.mark.asyncio
async def test_daemon_runs_long_lived_audio_source_without_unwanted_asr():
    config = AppConfig()
    config.audio.min_duration_seconds = 0.05
    wake = MockWakeWordBackend([0.0] * 10)
    vad = MockVADBackend([])
    asr = SequenceASR([])
    runtime = AssistantRuntime(config)
    bridge = runtime.create_wake_voice_bridge(
        wake,
        vad,
        asr,
        MockLLMBackend(),
    )
    output = CollectingOutput()
    daemon = AssistantDaemon(
        output,
        audio_source=FiniteAudioSource(10),
        audio_bridge=bridge,
        audio_queue_size=16,
    )
    await daemon.run()
    assert daemon.running is False
    assert daemon.metrics.audio_frames_received == 10
    assert daemon.metrics.asr_responses == 0
    assert asr.call_count == 0
    assert output.responses == []
