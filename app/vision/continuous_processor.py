"""Stateless frame inference plus small temporal gesture state."""

from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass

import numpy as np

from app.config import PerceptionConfig, VisionConfig
from app.models import GestureDetection, ImageRequest
from app.perception_events import PerceptionEvent
from app.vision.base import GestureBackend, VisionError
from app.vision.gesture_stabilizer import GesturePolicy, GestureStabilizer
from app.vision.image_loader import decode_jpeg


@dataclass(frozen=True)
class VisionProcessingResult:
    detections: tuple[GestureDetection, ...] = ()
    events: tuple[PerceptionEvent, ...] = ()
    rgb_image: np.ndarray | None = None
    error: str | None = None


class ContinuousVisionProcessor:
    def __init__(
        self,
        vision_config: VisionConfig,
        perception_config: PerceptionConfig,
        backend: GestureBackend,
    ) -> None:
        self.config = vision_config
        self.backend = backend
        self._minimum_interval = 1.0 / perception_config.vision_max_fps
        self._last_started = 0.0
        self._stabilizer = GestureStabilizer(
            {
                "Victory": GesturePolicy(
                    vision_config.mode_window_size,
                    vision_config.mode_required_hits,
                    vision_config.release_frames,
                ),
                "Thumb_Up": GesturePolicy(
                    vision_config.gesture_window_size,
                    vision_config.gesture_required_hits,
                    vision_config.release_frames,
                ),
                "Thumb_Down": GesturePolicy(
                    vision_config.gesture_window_size,
                    vision_config.gesture_required_hits,
                    vision_config.release_frames,
                ),
                "Open_Palm": GesturePolicy(
                    vision_config.gesture_window_size,
                    vision_config.gesture_required_hits,
                    vision_config.release_frames,
                ),
            }
        )

    async def process(self, request: ImageRequest) -> VisionProcessingResult:
        delay = self._minimum_interval - (
            time.monotonic() - self._last_started
        )
        if delay > 0:
            await asyncio.sleep(delay)
        self._last_started = time.monotonic()
        try:
            rgb = decode_jpeg(
                request.image_bytes,
                request.content_type,
                self.config,
            )
            detections = tuple(
                item
                for item in await self.backend.recognize(rgb)
                if item.label != "None"
                and item.score >= self.config.score_threshold
            )
            scores = {item.label: item.score for item in detections}
            stable = self._stabilizer.update(set(scores))
            captured_at = request.captured_at_ms
            events = tuple(
                PerceptionEvent(
                    event_type=(
                        "gesture.victory" if label == "Victory"
                        else f"gesture.{label.casefold()}"
                    ),
                    source="vision",
                    timestamp_ms=captured_at or int(time.time() * 1_000),
                    session_id=request.session_id,
                    payload={
                        "label": label,
                        "confidence": round(scores.get(label, 0.0), 4),
                    },
                )
                for label in stable
            )
            return VisionProcessingResult(detections, events, rgb)
        except VisionError as exc:
            return VisionProcessingResult(error=exc.code)
        except Exception:
            return VisionProcessingResult(error="internal_error")
