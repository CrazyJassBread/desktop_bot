"""Minimal long-running VAD/ASR and vision runtime."""

from __future__ import annotations

import asyncio
import json
import logging
from dataclasses import asdict, dataclass, replace
from typing import Final

from app.asr.base import ASRError
from app.audio.keyword_asr import KeywordASRProcessor
from app.audio.stream_pipeline import StreamingAudioPipeline
from app.event_cache import EventCache
from app.events.event_bus import EventBus
from app.features.photo_capture import LatestFrameStore
from app.models import AudioData
from app.perception_events import PerceptionEvent
from app.transport.sources import AudioFrameSource, ImageFrameSource
from app.vision.continuous_processor import ContinuousVisionProcessor

LOGGER = logging.getLogger("desktop_assistant.perception")
_END: Final = object()


@dataclass
class PerceptionMetrics:
    audio_frames_received: int = 0
    audio_utterances: int = 0
    audio_utterances_dropped: int = 0
    asr_calls: int = 0
    asr_errors: int = 0
    keyword_hits: int = 0
    speech_transcripts: int = 0
    vision_frames_received: int = 0
    vision_frames_processed: int = 0
    vision_errors: int = 0
    vision_events: int = 0


class PerceptionDaemon:
    def __init__(
        self,
        cache: EventCache,
        *,
        audio_source: AudioFrameSource | None = None,
        audio_segmenter: StreamingAudioPipeline | None = None,
        audio_processor: KeywordASRProcessor | None = None,
        image_source: ImageFrameSource | None = None,
        vision_processor: ContinuousVisionProcessor | None = None,
        utterance_queue_size: int = 4,
        event_bus: EventBus | None = None,
        application_controller: object | None = None,
        latest_frame_store: LatestFrameStore | None = None,
    ) -> None:
        audio_parts = (audio_source, audio_segmenter, audio_processor)
        if any(item is not None for item in audio_parts) and not all(
            item is not None for item in audio_parts
        ):
            raise ValueError("audio source, segmenter and processor belong together")
        if (image_source is None) != (vision_processor is None):
            raise ValueError("image source and processor belong together")
        if utterance_queue_size < 1:
            raise ValueError("utterance_queue_size must be positive")
        self.cache = cache
        self.audio_source = audio_source
        self.audio_segmenter = audio_segmenter
        self.audio_processor = audio_processor
        self.image_source = image_source
        self.vision_processor = vision_processor
        self.event_bus = event_bus or EventBus()
        self.application_controller = application_controller
        self.latest_frame_store = latest_frame_store
        self._utterances: asyncio.Queue[AudioData | object] = asyncio.Queue(
            maxsize=utterance_queue_size
        )
        self.metrics = PerceptionMetrics()
        self.running = False
        self._asr_busy = False
        self._event_sequence = 0
        if self.application_controller is not None:
            getattr(
                self.application_controller,
                "set_event_emitter",
            )(self.emit)

    async def run(self) -> None:
        self.running = True
        try:
            async with asyncio.TaskGroup() as tasks:
                if self.audio_source is not None:
                    tasks.create_task(self._segment_audio())
                    tasks.create_task(self._recognize_audio())
                if self.image_source is not None:
                    tasks.create_task(self._process_vision())
        finally:
            self.running = False

    async def _segment_audio(self) -> None:
        assert self.audio_source is not None
        assert self.audio_segmenter is not None
        async for frame in self.audio_source.frames():
            self.metrics.audio_frames_received += 1
            utterance = await self.audio_segmenter.accept(frame)
            if utterance is None:
                continue
            self.metrics.audio_utterances += 1
            try:
                self._utterances.put_nowait(utterance)
            except asyncio.QueueFull:
                self.metrics.audio_utterances_dropped += 1
        await self._utterances.put(_END)

    async def _recognize_audio(self) -> None:
        assert self.audio_processor is not None
        while True:
            item = await self._utterances.get()
            self._asr_busy = True
            try:
                if item is _END:
                    return
                assert isinstance(item, AudioData)
                self.metrics.asr_calls += 1
                try:
                    events = await self.audio_processor.process(item)
                except ASRError:
                    self.metrics.asr_errors += 1
                    LOGGER.exception("ASR failed; continuing with the next utterance")
                    continue
                for event in events:
                    if event.event_type == "speech.transcribed":
                        self.metrics.speech_transcripts += 1
                    else:
                        self.metrics.keyword_hits += 1
                    await self.emit(event)
            finally:
                self._asr_busy = False
                self._utterances.task_done()

    @property
    def audio_busy(self) -> bool:
        """True while speech is being captured, queued or transcribed."""
        capturing = (
            self.audio_segmenter is not None and self.audio_segmenter.is_active
        )
        return capturing or not self._utterances.empty() or self._asr_busy

    async def _process_vision(self) -> None:
        assert self.image_source is not None
        assert self.vision_processor is not None
        async for request in self.image_source.images():
            self.metrics.vision_frames_received += 1
            result = await self.vision_processor.process(request)
            self.metrics.vision_frames_processed += 1
            if result.error is not None:
                self.metrics.vision_errors += 1
                LOGGER.warning("vision frame rejected: %s", result.error)
                continue
            if self.latest_frame_store is not None:
                self.latest_frame_store.update(request)
            for event in result.events:
                self.metrics.vision_events += 1
                await self.emit(event)

    async def emit(self, event: PerceptionEvent) -> None:
        event = self._record(event)
        if self.application_controller is None:
            return
        derived = await getattr(self.application_controller, "handle")(event)
        for derived_event in derived:
            self._record(derived_event)

    def _record(self, event: PerceptionEvent) -> PerceptionEvent:
        self._event_sequence += 1
        if event.sequence == 0:
            event = replace(event, sequence=self._event_sequence)
        self.cache.append(event)
        self.event_bus.publish(event)
        LOGGER.info(
            "perception event %s",
            json.dumps(event.to_dict(), ensure_ascii=False),
        )
        return event

    def health(self) -> dict[str, object]:
        result: dict[str, object] = {
            "running": self.running,
            "cached_events": len(self.cache),
            "event_subscribers": self.event_bus.subscriber_count,
            "utterance_queue_size": self._utterances.qsize(),
            "metrics": asdict(self.metrics),
        }
        diagnostics = getattr(self.audio_source, "diagnostics", None)
        if callable(diagnostics):
            result["audio"] = diagnostics()
        return result
