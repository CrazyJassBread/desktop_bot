from __future__ import annotations

from collections import deque
from io import BytesIO

import numpy as np
import pytest
from PIL import Image

from app.asr.base import ASRBackend
from app.audio.keyword_asr import KeywordASRProcessor
from app.audio.stream_pipeline import StreamingAudioPipeline
from app.audio.vad.mock_backend import MockVADBackend
from app.config import KeywordConfig, PerceptionConfig, VADConfig, VisionConfig
from app.detection.keywords import KeywordDetector
from app.event_cache import EventCache
from app.perception_events import PerceptionEvent
from app.runtime.perception_daemon import PerceptionDaemon
from app.models import AudioData, GestureDetection, ImageRequest
from app.transport.sources import AudioFrameSource
from app.vision.continuous_processor import ContinuousVisionProcessor
from app.vision.mock_backend import MockGestureBackend


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
        frame = np.ones(512, dtype=np.float32) * 0.1
        for _ in range(self.count):
            yield frame


def jpeg_bytes() -> bytes:
    image = Image.new("RGB", (640, 480), color=(10, 20, 30))
    output = BytesIO()
    image.save(output, format="JPEG")
    return output.getvalue()


def gesture(label: str) -> GestureDetection:
    return GestureDetection(label, 0.95, "Right")


def test_keyword_detector_prioritizes_features_and_ignores_chatter():
    detector = KeywordDetector(KeywordConfig())
    match = detector.detect("小 A，帮我写信，内容是明天见")
    assert match is not None
    assert match.event_type == "feature.write_letter"
    assert match.keyword == "帮我写信"
    assert match.payload_text == "内容是明天见"
    assert detector.detect("今天天气不错") is None


def test_event_cache_is_bounded_and_expires_old_events():
    now = [100.0]
    cache = EventCache(2, 10, clock=lambda: now[0])
    cache.append(PerceptionEvent("one", "audio", timestamp_ms=95_000))
    cache.append(PerceptionEvent("two", "audio", timestamp_ms=96_000))
    cache.append(PerceptionEvent("three", "vision", timestamp_ms=97_000))
    assert [item.event_type for item in cache.snapshot()] == ["two", "three"]
    now[0] = 108.0
    assert cache.snapshot() == ()


@pytest.mark.asyncio
async def test_audio_runtime_caches_only_keyword_transcripts(caplog):
    caplog.set_level("INFO", logger="desktop_assistant.asr")
    vad = MockVADBackend([0.9, 0.9, 0.0, 0.0] * 2)
    segmenter = StreamingAudioPipeline(
        VADConfig(
            min_speech_duration_ms=64,
            min_silence_duration_ms=64,
            pre_roll_ms=0,
        ),
        vad,
    )
    asr = SequenceASR(["今天天气不错", "小A，帮我写信"])
    cache = EventCache()
    daemon = PerceptionDaemon(
        cache,
        audio_source=FiniteAudioSource(8),
        audio_segmenter=segmenter,
        audio_processor=KeywordASRProcessor(
            asr,
            KeywordDetector(KeywordConfig()),
        ),
    )

    await daemon.run()

    assert asr.call_count == 2
    assert daemon.metrics.audio_utterances == 2
    assert daemon.metrics.keyword_hits == 1
    assert len(cache) == 1
    assert cache.latest() is not None
    assert cache.latest().event_type == "feature.write_letter"
    assert '"transcript": "今天天气不错"' in caplog.text
    assert '"matched_event": null' in caplog.text
    assert '"transcript": "小A，帮我写信"' in caplog.text
    assert '"matched_event": "feature.write_letter"' in caplog.text


@pytest.mark.asyncio
async def test_vision_emits_once_while_gesture_is_held_and_rearms():
    results = (
        [[gesture("Victory")]] * 7
        + [[]] * 2
        + [[gesture("Victory")]] * 5
    )
    backend = MockGestureBackend(results)
    processor = ContinuousVisionProcessor(
        VisionConfig(),
        PerceptionConfig(vision_max_fps=1_000_000),
        backend,
    )
    events = []
    for _ in results:
        result = await processor.process(ImageRequest(jpeg_bytes(), "bot"))
        assert result.error is None
        events.extend(result.events)

    assert [item.event_type for item in events] == [
        "mode.toggle",
        "mode.toggle",
    ]
