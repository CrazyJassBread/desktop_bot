from __future__ import annotations

import asyncio
from collections import deque
from io import BytesIO

import numpy as np
import pytest
from PIL import Image

from app.asr.base import ASRBackend
from app.audio.keyword_asr import KeywordASRProcessor
from app.audio.stream_pipeline import StreamingAudioPipeline
from app.audio.vad.mock_backend import MockVADBackend
from app.config import (
    KeywordConfig,
    LLMProviderConfig,
    PerceptionConfig,
    VADConfig,
    VisionConfig,
    load_config,
)
from app.control.application_controller import ApplicationController
from app.detection.keywords import KeywordDetector
from app.event_cache import EventCache
from app.features.photo_capture import LatestFrameStore, PhotoCaptureManager
from app.features.thermal_printer import PrintResult, PrinterError
from app.hardware_main import build_daemon, build_parser
from app.llm.mode_detector import LLMModeDetector
from app.perception_events import PerceptionEvent
from app.runtime.perception_daemon import PerceptionDaemon
from app.models import AudioData, GestureDetection, ImageRequest
from app.transport.sources import AudioFrameSource
from app.transport.hardware_sources import (
    HTTPJPEGImageSource,
    TCPPCMAudioSource,
)
from app.transport.microphone_source import LocalMicrophoneAudioSource
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


class RecordingPrinter:
    def __init__(self, failure: str | None = None) -> None:
        self.failure = failure
        self.calls: list[bytes] = []

    def print_image(self, image_bytes: bytes) -> PrintResult:
        self.calls.append(image_bytes)
        if self.failure is not None:
            raise PrinterError(self.failure)
        return PrintResult(width=384, height=288, chunk_count=1)


class RecordingLLMSessionManager:
    def __init__(self) -> None:
        self.active = False
        self.calls: list[PerceptionEvent] = []
        self.emitter = None
        self.closed = False

    def set_event_emitter(self, emitter) -> None:
        self.emitter = emitter

    async def handle(
        self,
        event: PerceptionEvent,
    ) -> tuple[PerceptionEvent, ...]:
        self.calls.append(event)
        if event.event_type.startswith("llm.") and event.event_type.endswith(
            ".start"
        ):
            self.active = True
            return (
                PerceptionEvent(
                    "llm.session_started",
                    "llm",
                    session_id=event.session_id,
                ),
            )
        if event.event_type == "speech.transcribed":
            return (
                PerceptionEvent(
                    "llm.transcript_buffered",
                    "llm",
                    session_id=event.session_id,
                ),
            )
        return ()

    async def aclose(self) -> None:
        self.closed = True


class RecordingLetterManager:
    def __init__(self) -> None:
        self.events: list[PerceptionEvent] = []
        self.emitter = None
        self.closed = False

    def set_event_emitter(self, emitter) -> None:
        self.emitter = emitter

    def schedule(self, event: PerceptionEvent) -> bool:
        self.events.append(event)
        return True

    async def aclose(self) -> None:
        self.closed = True


def jpeg_bytes() -> bytes:
    image = Image.new("RGB", (640, 480), color=(10, 20, 30))
    output = BytesIO()
    image.save(output, format="JPEG")
    return output.getvalue()


def gesture(label: str) -> GestureDetection:
    return GestureDetection(label, 0.95, "Right")


def test_keyword_detector_only_matches_photo_shortcuts():
    detector = KeywordDetector(KeywordConfig())
    assert detector.detect("小 A，帮我写信，内容是明天见") is None
    assert detector.detect("进入聊天模式") is None
    assert detector.detect("今天天气不错") is None


@pytest.mark.parametrize(
    "transcript",
    [
        "请拍照",
        "给我照相",
        "给我拍一张",
        "打印照片",
        "photo please",
        "take a photo",
        "take a picture",
    ],
)
def test_keyword_detector_recognizes_photo_print_intents(transcript):
    match = KeywordDetector(KeywordConfig()).detect(transcript)

    assert match is not None
    assert match.event_type == "feature.photo_print"


@pytest.mark.asyncio
async def test_llm_mode_detector_starts_letter_session():
    processor = KeywordASRProcessor(
        SequenceASR(["我要写信"]),
        KeywordDetector(KeywordConfig()),
        llm_detector=LLMModeDetector(load_config().llm.modes),
    )

    events = await processor.process(
        AudioData(
            samples=np.zeros(512, dtype=np.float32),
            sample_rate=16_000,
            duration_seconds=0.032,
        )
    )

    assert [event.event_type for event in events] == [
        "llm.letter.start",
        "speech.transcribed",
    ]
    assert events[1].payload["matched_event"] == "llm.letter.start"


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
async def test_audio_runtime_keeps_transcripts_and_keyword_intents(caplog):
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
    asr = SequenceASR(["今天天气不错", "请拍照"])
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
    assert daemon.metrics.speech_transcripts == 2
    assert len(cache) == 3
    assert cache.latest() is not None
    assert [event.event_type for event in cache.snapshot()] == [
        "speech.transcribed",
        "feature.photo_print",
        "speech.transcribed",
    ]
    assert '"transcript": "今天天气不错"' in caplog.text
    assert '"matched_event": null' in caplog.text
    assert '"transcript": "请拍照"' in caplog.text
    assert '"matched_event": "feature.photo_print"' in caplog.text


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
        assert result.rgb_image is not None
        events.extend(result.events)

    assert [item.event_type for item in events] == [
        "gesture.victory",
        "gesture.victory",
    ]


@pytest.mark.asyncio
async def test_controller_ignores_removed_chat_and_language_events():
    controller = ApplicationController()
    removed_chat = PerceptionEvent(
        "mode.enter_chat",
        "audio",
        payload={"payload_text": "什么是强化学习"},
    )
    assert await controller.handle(removed_chat) == ()
    assert await controller.handle(
        PerceptionEvent("gesture.open_palm", "vision")
    ) == ()
    victory = await controller.handle(
        PerceptionEvent("gesture.victory", "vision")
    )
    assert [item.event_type for item in victory] == [
        "photo.capture_failed"
    ]


@pytest.mark.asyncio
async def test_controller_delegates_llm_and_suppresses_only_audio_intents():
    llm_manager = RecordingLLMSessionManager()
    controller = ApplicationController(
        llm_session_manager=llm_manager,
    )

    started = await controller.handle(
        PerceptionEvent("llm.letter.start", "audio")
    )
    buffered = await controller.handle(
        PerceptionEvent(
            "speech.transcribed",
            "audio",
            payload={"transcript": "正文内容"},
        )
    )
    suppressed = await controller.handle(
        PerceptionEvent("feature.photo_print", "audio")
    )
    removed_visual = await controller.handle(
        PerceptionEvent("gesture.open_palm", "vision")
    )

    assert [event.event_type for event in started] == [
        "llm.session_started"
    ]
    assert [event.event_type for event in buffered] == [
        "llm.transcript_buffered"
    ]
    assert suppressed == ()
    assert removed_visual == ()
    assert [event.event_type for event in llm_manager.calls] == [
        "llm.letter.start",
        "speech.transcribed",
    ]
    await controller.aclose()
    assert llm_manager.closed is True


@pytest.mark.asyncio
async def test_controller_rejects_letter_when_computer_has_no_logged_in_user():
    llm_manager = RecordingLLMSessionManager()

    async def no_owner():
        return None

    controller = ApplicationController(
        llm_session_manager=llm_manager,
        letter_owner_resolver=no_owner,
    )

    rejected = await controller.handle(
        PerceptionEvent("llm.letter.start", "audio")
    )

    assert [event.event_type for event in rejected] == [
        "llm.session_rejected"
    ]
    assert rejected[0].payload["reason"] == "user_not_bound"
    assert llm_manager.calls == []
    await controller.aclose()


@pytest.mark.asyncio
async def test_controller_adds_current_user_to_letter_start_event():
    llm_manager = RecordingLLMSessionManager()

    async def owner():
        return {
            "id": "user-one",
            "email": "one@example.test",
            "displayName": "用户一",
        }

    controller = ApplicationController(
        llm_session_manager=llm_manager,
        letter_owner_resolver=owner,
    )

    started = await controller.handle(
        PerceptionEvent(
            "llm.letter.start",
            "audio",
            payload={"payload_text": "小明"},
        )
    )

    assert started[0].event_type == "llm.session_started"
    assert llm_manager.calls[0].payload == {
        "payload_text": "小明",
        "owner_user_id": "user-one",
        "owner_email": "one@example.test",
        "owner_display_name": "用户一",
    }
    await controller.aclose()


@pytest.mark.asyncio
async def test_controller_schedules_completed_llm_letter_for_printing():
    class CompletingLLMManager(RecordingLLMSessionManager):
        async def handle(self, event):
            self.calls.append(event)
            return (
                PerceptionEvent(
                    "llm.letter_completed",
                    "llm",
                    payload={"recipient": "小明", "content": "正文"},
                ),
            )

    llm_manager = CompletingLLMManager()
    letter_manager = RecordingLetterManager()
    controller = ApplicationController(
        llm_session_manager=llm_manager,
        letter_manager=letter_manager,
    )

    completed = await controller.handle(
        PerceptionEvent(
            "speech.transcribed",
            "audio",
            payload={"transcript": "小A，完成写信"},
        )
    )

    assert completed[0].event_type == "llm.letter_completed"
    assert letter_manager.events == [completed[0]]
    await controller.aclose()
    assert letter_manager.closed is True


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("reason", "event_type", "mode"),
    [
        ("not_configured", "llm.letter.start", "letter"),
        ("disabled", "llm.qa.start", "qa"),
    ],
)
async def test_controller_rejects_unavailable_llm_mode(
    reason,
    event_type,
    mode,
):
    controller = ApplicationController(
        llm_unavailable_reason=reason,
    )

    rejected = await controller.handle(
        PerceptionEvent(event_type, "audio", session_id="bot")
    )
    removed = await controller.handle(
        PerceptionEvent("gesture.open_palm", "vision", session_id="bot")
    )

    assert len(rejected) == 1
    assert rejected[0].event_type == "llm.session_rejected"
    assert rejected[0].payload["mode"] == mode
    assert rejected[0].payload["reason"] == reason
    assert removed == ()


@pytest.mark.asyncio
async def test_build_daemon_wires_enabled_llm_components(
    monkeypatch,
    tmp_path,
):
    config = load_config()
    config.llm.enabled = True
    config.llm.provider = LLMProviderConfig(
        base_url="https://example.test/v1",
        model="test-model",
        api_key="sentinel-secret",
    )
    config.llm.log_path = str(tmp_path / "llm.log")
    monkeypatch.setattr(
        "app.hardware_main.build_vad",
        lambda _config: MockVADBackend([]),
    )
    monkeypatch.setattr(
        "app.hardware_main.build_asr",
        lambda _config: SequenceASR([]),
    )

    daemon, gesture_backend = build_daemon(
        config,
        build_parser().parse_args(["--audio-only"]),
    )

    assert gesture_backend is None
    assert daemon.audio_processor is not None
    assert daemon.audio_processor.llm_detector is not None
    controller = daemon.application_controller
    assert controller is not None
    assert controller.llm_session_manager is not None
    await controller.aclose()


@pytest.mark.asyncio
async def test_build_daemon_detects_but_rejects_unconfigured_llm(
    monkeypatch,
):
    config = load_config()
    config.llm.enabled = True
    monkeypatch.setattr(
        "app.hardware_main.build_vad",
        lambda _config: MockVADBackend([]),
    )
    monkeypatch.setattr(
        "app.hardware_main.build_asr",
        lambda _config: SequenceASR([]),
    )

    daemon, gesture_backend = build_daemon(
        config,
        build_parser().parse_args(["--audio-only"]),
    )

    assert gesture_backend is None
    assert daemon.audio_processor is not None
    assert daemon.audio_processor.llm_detector is not None
    controller = daemon.application_controller
    assert controller is not None
    assert controller.llm_session_manager is None
    assert controller.llm_unavailable_reason == "not_configured"


def test_build_daemon_selects_microphone_without_vision(monkeypatch):
    config = load_config()
    config.hardware.audio_enabled = False
    monkeypatch.setattr(
        "app.hardware_main.build_vad",
        lambda _config: MockVADBackend([]),
    )
    monkeypatch.setattr(
        "app.hardware_main.build_asr",
        lambda _config: SequenceASR([]),
    )

    daemon, gesture_backend = build_daemon(
        config,
        build_parser().parse_args(
            ["mic-test", "--input-device", "2"]
        ),
    )

    assert isinstance(daemon.audio_source, LocalMicrophoneAudioSource)
    assert daemon.audio_source.device == 2
    assert daemon.image_source is None
    assert gesture_backend is None
    assert daemon.audio_processor is not None
    assert daemon.audio_processor.llm_detector is not None


def test_build_daemon_run_mode_keeps_hardware_sources(monkeypatch):
    config = load_config()
    monkeypatch.setattr(
        "app.hardware_main.build_vad",
        lambda _config: MockVADBackend([]),
    )
    monkeypatch.setattr(
        "app.hardware_main.build_asr",
        lambda _config: SequenceASR([]),
    )
    monkeypatch.setattr(
        "app.hardware_main.build_gesture",
        lambda _config: MockGestureBackend([]),
    )

    daemon, gesture_backend = build_daemon(
        config,
        build_parser().parse_args(["run"]),
    )

    assert isinstance(daemon.audio_source, TCPPCMAudioSource)
    assert isinstance(daemon.image_source, HTTPJPEGImageSource)
    assert gesture_backend is not None


@pytest.mark.asyncio
async def test_voice_photo_print_ignores_duplicates_until_cooldown_ends(
    tmp_path,
):
    store = LatestFrameStore()
    printer = RecordingPrinter()
    manager = PhotoCaptureManager(
        store,
        delay_seconds=0.01,
        max_frame_age_seconds=1,
        output_dir=tmp_path,
        printer=printer,
        cooldown_seconds=0.03,
    )
    controller = ApplicationController(photo_manager=manager)
    emitted: list[PerceptionEvent] = []

    async def emit(event: PerceptionEvent) -> None:
        emitted.append(event)
        await controller.handle(event)

    controller.set_event_emitter(emit)
    store.update(
        ImageRequest(
            jpeg_bytes(),
            session_id="bot",
            request_id="frame-1",
        )
    )
    commands = await controller.handle(
        PerceptionEvent("feature.photo_print", "audio")
    )
    assert [item.event_type for item in commands] == [
        "command.camera.capture_after"
    ]
    assert controller.state.photo_state == "countdown"
    duplicate = await controller.handle(
        PerceptionEvent("gesture.victory", "vision")
    )
    assert duplicate == ()

    await asyncio.sleep(0.02)

    assert [item.event_type for item in emitted] == [
        "photo.captured",
        "photo.printed",
        "photo.completed",
    ]
    assert len(printer.calls) == 1
    assert len(list(tmp_path.glob("*.jpg"))) == 1

    cooling_duplicate = await controller.handle(
        PerceptionEvent("feature.photo_print", "audio")
    )
    assert cooling_duplicate == ()

    await asyncio.sleep(0.04)

    rearmed = await controller.handle(
        PerceptionEvent("gesture.victory", "vision")
    )
    assert [item.event_type for item in rearmed] == [
        "command.camera.capture_after"
    ]
    await controller.aclose()


@pytest.mark.asyncio
async def test_printer_failure_emits_reason_and_recovers(tmp_path):
    store = LatestFrameStore()
    printer = RecordingPrinter(failure="timeout")
    manager = PhotoCaptureManager(
        store,
        delay_seconds=0.001,
        max_frame_age_seconds=1,
        output_dir=tmp_path,
        printer=printer,
        cooldown_seconds=0.001,
    )
    controller = ApplicationController(photo_manager=manager)
    emitted: list[PerceptionEvent] = []

    async def emit(event: PerceptionEvent) -> None:
        emitted.append(event)
        await controller.handle(event)

    controller.set_event_emitter(emit)
    store.update(ImageRequest(jpeg_bytes(), session_id="bot"))
    await controller.handle(PerceptionEvent("gesture.victory", "vision"))

    await asyncio.sleep(0.02)

    assert [event.event_type for event in emitted] == [
        "photo.captured",
        "photo.print_failed",
    ]
    assert emitted[-1].payload["reason"] == "timeout"
    assert manager.schedule(
        PerceptionEvent("feature.photo_print", "audio")
    ) is True
    await controller.aclose()
