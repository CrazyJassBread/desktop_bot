"""Local microphone audio source used by the mictest mode."""

from __future__ import annotations

import asyncio
import logging
from collections.abc import AsyncIterator

import numpy as np

from app.transport.sources import AudioFrameSource

LOGGER = logging.getLogger("desktop_assistant.mic")


class MicrophoneAudioSource(AudioFrameSource):
    """Yield mono float32 frames captured from the default microphone.

    Frames match the TCPPCMAudioSource contract: 1-D float32 arrays in
    [-1, 1] with ``frame_samples`` samples at ``sample_rate`` Hz, so the
    rest of the VAD/ASR pipeline works unchanged.
    """

    def __init__(
        self,
        *,
        sample_rate: int = 16_000,
        frame_samples: int = 512,
        queue_size: int = 256,
        device: int | str | None = None,
    ) -> None:
        if sample_rate <= 0 or frame_samples <= 0 or queue_size <= 0:
            raise ValueError("microphone source sizes must be positive")
        self.sample_rate = sample_rate
        self.frame_samples = frame_samples
        self.queue_size = queue_size
        self.device = device
        self._queue: asyncio.Queue[np.ndarray] | None = None
        self._dropped_frames = 0

    def _on_audio(self, indata: np.ndarray) -> None:
        # Runs on the event loop thread via call_soon_threadsafe.
        queue = self._queue
        if queue is None:
            return
        frame = np.ascontiguousarray(indata[:, 0], dtype=np.float32)
        if queue.full():
            queue.get_nowait()
            self._dropped_frames += 1
        queue.put_nowait(frame)

    async def frames(self) -> AsyncIterator[np.ndarray]:
        # Imported lazily so the hardware run mode never needs sounddevice.
        import sounddevice as sd

        loop = asyncio.get_running_loop()
        self._queue = asyncio.Queue(maxsize=self.queue_size)

        def callback(indata, frame_count, time_info, status) -> None:
            if status:
                LOGGER.warning("microphone status: %s", status)
            loop.call_soon_threadsafe(self._on_audio, indata.copy())

        stream = sd.InputStream(
            samplerate=self.sample_rate,
            channels=1,
            dtype="float32",
            blocksize=self.frame_samples,
            device=self.device,
            callback=callback,
        )
        LOGGER.info(
            "microphone capture started rate=%d frame_samples=%d",
            self.sample_rate,
            self.frame_samples,
        )
        with stream:
            while True:
                yield await self._queue.get()

    def stats(self) -> dict[str, object]:
        return {
            "sample_rate": self.sample_rate,
            "frame_samples": self.frame_samples,
            "dropped_frames": self._dropped_frames,
        }
