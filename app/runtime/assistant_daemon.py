"""Long-running, bounded-queue runtime for audio and vision inputs."""

from __future__ import annotations

import asyncio
from dataclasses import asdict, dataclass
from typing import Final

import numpy as np

from app.output.base import OutputAdapter
from app.runtime.vision_pipeline import VisionPipeline
from app.runtime.wake_voice_bridge import WakeGatedVoiceBridge
from app.schemas import ImageRequest
from app.transport.sources import AudioFrameSource, ImageFrameSource

_END: Final = object()


@dataclass
class RuntimeMetrics:
    audio_frames_received: int = 0
    audio_queue_overflow: int = 0
    asr_responses: int = 0
    image_frames_received: int = 0
    image_frames_dropped: int = 0
    vision_frames_processed: int = 0


class AssistantDaemon:
    def __init__(
        self,
        output: OutputAdapter,
        *,
        audio_source: AudioFrameSource | None = None,
        audio_bridge: WakeGatedVoiceBridge | None = None,
        image_source: ImageFrameSource | None = None,
        vision_pipeline: VisionPipeline | None = None,
        session_id: str = "default",
        audio_queue_size: int = 128,
        image_queue_size: int = 1,
    ) -> None:
        if (audio_source is None) != (audio_bridge is None):
            raise ValueError("audio source and bridge must be configured together")
        if (image_source is None) != (vision_pipeline is None):
            raise ValueError("image source and pipeline must be configured together")
        if audio_queue_size < 1 or image_queue_size < 1:
            raise ValueError("queue sizes must be positive")
        self.output = output
        self.audio_source = audio_source
        self.audio_bridge = audio_bridge
        self.image_source = image_source
        self.vision_pipeline = vision_pipeline
        self.session_id = session_id
        self.audio_queue: asyncio.Queue[np.ndarray | object] = asyncio.Queue(
            maxsize=audio_queue_size
        )
        self.image_queue: asyncio.Queue[ImageRequest | object] = asyncio.Queue(
            maxsize=image_queue_size
        )
        self.metrics = RuntimeMetrics()
        self.running = False

    async def run(self) -> None:
        self.running = True
        try:
            async with asyncio.TaskGroup() as tasks:
                if self.audio_source is not None:
                    tasks.create_task(self._receive_audio())
                    tasks.create_task(self._process_audio())
                if self.image_source is not None:
                    tasks.create_task(self._receive_images())
                    tasks.create_task(self._process_images())
        finally:
            self.running = False

    async def _receive_audio(self) -> None:
        assert self.audio_source is not None
        assert self.audio_bridge is not None
        async for frame in self.audio_source.frames():
            self.metrics.audio_frames_received += 1
            try:
                self.audio_queue.put_nowait(frame)
            except asyncio.QueueFull:
                self.metrics.audio_queue_overflow += 1
                await self.audio_bridge.audio_pipeline.reset()
                self._clear_queue(self.audio_queue)
                self.audio_queue.put_nowait(frame)
        await self.audio_queue.put(_END)

    async def _process_audio(self) -> None:
        assert self.audio_bridge is not None
        while True:
            item = await self.audio_queue.get()
            try:
                if item is _END:
                    return
                response = await self.audio_bridge.accept_frame(
                    item,
                    self.session_id,
                )
                if response is not None:
                    self.metrics.asr_responses += 1
                    await self.output.send_response(response)
            finally:
                self.audio_queue.task_done()

    async def _receive_images(self) -> None:
        assert self.image_source is not None
        async for request in self.image_source.images():
            self.metrics.image_frames_received += 1
            if self.image_queue.full():
                dropped = self.image_queue.get_nowait()
                self.image_queue.task_done()
                if dropped is not _END:
                    self.metrics.image_frames_dropped += 1
            self.image_queue.put_nowait(request)
        await self.image_queue.put(_END)

    async def _process_images(self) -> None:
        assert self.vision_pipeline is not None
        while True:
            item = await self.image_queue.get()
            try:
                if item is _END:
                    return
                response = await self.vision_pipeline.process(item)
                self.metrics.vision_frames_processed += 1
                await self.output.send_response(response)
            finally:
                self.image_queue.task_done()

    @staticmethod
    def _clear_queue(queue: asyncio.Queue[object]) -> None:
        while not queue.empty():
            queue.get_nowait()
            queue.task_done()

    def health(self) -> dict[str, object]:
        cache_size = (
            len(self.vision_pipeline.cache)
            if self.vision_pipeline is not None
            else 0
        )
        audio_state = (
            self.audio_bridge.audio_pipeline.state.value
            if self.audio_bridge is not None
            else "disabled"
        )
        return {
            "running": self.running,
            "audio_state": audio_state,
            "audio_queue_size": self.audio_queue.qsize(),
            "image_queue_size": self.image_queue.qsize(),
            "vision_cache_size": cache_size,
            "metrics": asdict(self.metrics),
        }
