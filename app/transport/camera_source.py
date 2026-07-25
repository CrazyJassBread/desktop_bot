"""Optional computer webcam source used by the local demonstration."""

from __future__ import annotations

import asyncio
import logging
import time

from app.models import ImageRequest
from app.transport.sources import ImageFrameSource

LOGGER = logging.getLogger("desktop_assistant.gateway")


class ComputerCameraImageSource(ImageFrameSource):
    """Read JPEG frames from a computer webcam without changing Bot protocol."""

    def __init__(
        self,
        device: int = 0,
        *,
        frames_per_second: float = 5.0,
        jpeg_quality: int = 85,
        session_id: str = "bot",
    ) -> None:
        if device < 0:
            raise ValueError("camera device must be non-negative")
        if frames_per_second <= 0:
            raise ValueError("camera frames_per_second must be positive")
        if not 1 <= jpeg_quality <= 100:
            raise ValueError("camera jpeg_quality must be between 1 and 100")
        self.device = device
        self.interval = 1.0 / frames_per_second
        self.jpeg_quality = jpeg_quality
        self.session_id = session_id
        self._capture = None

    async def images(self):
        try:
            import cv2
        except ImportError as exc:
            raise RuntimeError(
                "computer camera requires opencv-python"
            ) from exc

        # AVFoundation must open the camera on macOS's main thread so the
        # operating system can present its permission prompt.
        capture = cv2.VideoCapture(self.device)
        self._capture = capture
        if not capture.isOpened():
            await asyncio.to_thread(capture.release)
            self._capture = None
            raise RuntimeError(
                f"cannot open computer camera device {self.device}"
            )
        LOGGER.info(
            "computer camera source started (device=%s, fps=%.1f)",
            self.device,
            1.0 / self.interval,
        )
        encode_options = [int(cv2.IMWRITE_JPEG_QUALITY), self.jpeg_quality]
        try:
            while True:
                started = time.monotonic()
                ok, frame = await asyncio.to_thread(capture.read)
                if not ok:
                    raise RuntimeError(
                        f"failed to read computer camera device {self.device}"
                    )
                encoded_ok, encoded = await asyncio.to_thread(
                    cv2.imencode,
                    ".jpg",
                    frame,
                    encode_options,
                )
                if not encoded_ok:
                    raise RuntimeError("failed to encode computer camera frame")
                yield ImageRequest(
                    encoded.tobytes(),
                    session_id=self.session_id,
                    captured_at_ms=int(time.time() * 1_000),
                )
                remaining = self.interval - (time.monotonic() - started)
                if remaining > 0:
                    await asyncio.sleep(remaining)
        finally:
            await asyncio.to_thread(capture.release)
            self._capture = None

    async def aclose(self) -> None:
        capture = self._capture
        self._capture = None
        if capture is not None:
            await asyncio.to_thread(capture.release)
