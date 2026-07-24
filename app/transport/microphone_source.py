"""Computer microphone input adapted to the async audio source contract."""

from __future__ import annotations

import asyncio
import importlib
import logging
from dataclasses import dataclass
from typing import Any

import numpy as np

from app.transport.sources import AudioFrameSource

LOGGER = logging.getLogger("desktop_assistant.microphone")


class MicrophoneError(RuntimeError):
    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


@dataclass(frozen=True)
class InputDevice:
    index: int
    name: str
    max_input_channels: int
    default_samplerate: float


def parse_input_device(value: str) -> int | str:
    """Accept either a PortAudio device index or a device name."""
    normalized = value.strip()
    if not normalized:
        raise ValueError("input device cannot be empty")
    try:
        return int(normalized)
    except ValueError:
        return normalized


def _load_sounddevice() -> Any:
    try:
        return importlib.import_module("sounddevice")
    except (ImportError, OSError) as exc:
        raise MicrophoneError("sounddevice_unavailable") from exc


def list_input_devices(
    sounddevice_module: Any | None = None,
) -> tuple[InputDevice, ...]:
    sounddevice = sounddevice_module or _load_sounddevice()
    try:
        devices = sounddevice.query_devices()
    except Exception as exc:
        raise MicrophoneError("microphone_unavailable") from exc
    return tuple(
        InputDevice(
            index=index,
            name=str(device["name"]),
            max_input_channels=int(device["max_input_channels"]),
            default_samplerate=float(device["default_samplerate"]),
        )
        for index, device in enumerate(devices)
        if int(device["max_input_channels"]) > 0
    )


def _open_failure_reason(exc: Exception) -> str:
    message = str(exc).casefold()
    unavailable_hints = (
        "permission",
        "not permitted",
        "invalid device",
        "device unavailable",
        "no default input",
    )
    if any(hint in message for hint in unavailable_hints):
        return "microphone_unavailable"
    return "microphone_open_failed"


class LocalMicrophoneAudioSource(AudioFrameSource):
    """Bridge PortAudio's callback thread into an asyncio frame stream."""

    def __init__(
        self,
        device: int | str | None = None,
        *,
        sample_rate: int = 16_000,
        frame_samples: int = 512,
        queue_size: int = 256,
        sounddevice_module: Any | None = None,
    ) -> None:
        if sample_rate <= 0 or frame_samples <= 0 or queue_size <= 0:
            raise ValueError("microphone source sizes must be positive")
        self.device = device
        self.sample_rate = sample_rate
        self.frame_samples = frame_samples
        self.queue_size = queue_size
        self._sounddevice = sounddevice_module
        self._queue: asyncio.Queue[np.ndarray] | None = None
        self._loop: asyncio.AbstractEventLoop | None = None
        self._stream: Any | None = None
        self.dropped_frames = 0

    async def frames(self):
        if self._stream is not None:
            raise MicrophoneError("microphone_already_running")
        sounddevice = self._sounddevice or _load_sounddevice()
        self._loop = asyncio.get_running_loop()
        self._queue = asyncio.Queue(maxsize=self.queue_size)
        try:
            self._stream = sounddevice.InputStream(
                device=self.device,
                samplerate=self.sample_rate,
                channels=1,
                dtype="float32",
                blocksize=self.frame_samples,
                callback=self._audio_callback,
            )
            self._stream.start()
        except Exception as exc:
            await self.aclose()
            raise MicrophoneError(_open_failure_reason(exc)) from exc
        LOGGER.info(
            "computer microphone started device=%s sample_rate=%s "
            "frame_samples=%s",
            self.device if self.device is not None else "default",
            self.sample_rate,
            self.frame_samples,
        )
        try:
            assert self._queue is not None
            while True:
                yield await self._queue.get()
        finally:
            await self.aclose()

    def _audio_callback(
        self,
        indata: np.ndarray,
        _frames: int,
        _time_info: object,
        status: object,
    ) -> None:
        if status:
            LOGGER.warning("microphone callback status: %s", status)
        frame = np.ascontiguousarray(
            np.asarray(indata, dtype=np.float32).reshape(-1)
        ).copy()
        loop = self._loop
        if loop is None or loop.is_closed():
            return
        try:
            loop.call_soon_threadsafe(self._offer_frame, frame)
        except RuntimeError:
            LOGGER.warning("microphone frame arrived after loop shutdown")

    def _offer_frame(self, frame: np.ndarray) -> None:
        queue = self._queue
        if queue is None:
            return
        if queue.full():
            queue.get_nowait()
            self.dropped_frames += 1
        queue.put_nowait(frame)

    async def aclose(self) -> None:
        stream = self._stream
        self._stream = None
        self._queue = None
        self._loop = None
        if stream is None:
            return
        try:
            try:
                stream.stop()
            except Exception:
                LOGGER.warning("microphone stream stop failed", exc_info=True)
        finally:
            try:
                stream.close()
            except Exception:
                LOGGER.warning("microphone stream close failed", exc_info=True)
        LOGGER.info(
            "computer microphone stopped dropped_frames=%s",
            self.dropped_frames,
        )
