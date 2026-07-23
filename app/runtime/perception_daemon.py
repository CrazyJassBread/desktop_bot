"""Minimal long-running VAD/ASR and vision runtime."""

from __future__ import annotations

import asyncio
import json
import logging
from dataclasses import asdict, dataclass
from typing import Final

from app.asr.base import ASRError
from app.audio.keyword_asr import KeywordASRProcessor
from app.audio.stream_pipeline import StreamingAudioPipeline
from app.event_cache import EventCache
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
        self._utterances: asyncio.Queue[AudioData | object] = asyncio.Queue(
            maxsize=utterance_queue_size
        )
        self.metrics = PerceptionMetrics()
        self.running = False

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
            try:
                if item is _END:
                    return
                assert isinstance(item, AudioData)
                self.metrics.asr_calls += 1
                try:
                    event = await self.audio_processor.process(item)
                except ASRError:
                    self.metrics.asr_errors += 1
                    LOGGER.exception("ASR failed; continuing with the next utterance")
                    continue
                if event is not None:
                    self.metrics.keyword_hits += 1
                    self._record(event)
            finally:
                self._utterances.task_done()

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
            for event in result.events:
                self.metrics.vision_events += 1
                self._record(event)

    def _record(self, event: PerceptionEvent) -> None:
        self.cache.append(event)
        LOGGER.info(
            "perception event %s",
            json.dumps(event.to_dict(), ensure_ascii=False),
        )

    def health(self) -> dict[str, object]:
        return {
            "running": self.running,
            "cached_events": len(self.cache),
            "utterance_queue_size": self._utterances.qsize(),
            "metrics": asdict(self.metrics),
        }
