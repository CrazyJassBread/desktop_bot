"""JPEG-to-gesture pipeline with cache and contextual actions."""

from __future__ import annotations

import asyncio
import time

from app.config import VisionConfig
from app.runtime.interaction_coordinator import InteractionCoordinator
from app.schemas import ImageRequest, VisionResponse
from app.vision.base import GestureBackend, VisionError
from app.vision.frame_cache import CachedVisionFrame, VisionFrameCache
from app.vision.gesture_stabilizer import GesturePolicy, GestureStabilizer
from app.vision.image_loader import decode_jpeg


class VisionPipeline:
    def __init__(
        self,
        config: VisionConfig,
        backend: GestureBackend,
        coordinator: InteractionCoordinator,
        cache: VisionFrameCache | None = None,
    ) -> None:
        self.config = config
        self.backend = backend
        self.coordinator = coordinator
        self.cache = cache or VisionFrameCache(config.cache_capacity)
        self.stabilizer = GestureStabilizer(
            {
                "Victory": GesturePolicy(
                    config.mode_window_size,
                    config.mode_required_hits,
                    config.release_frames,
                ),
                "Thumb_Up": GesturePolicy(
                    config.game_window_size,
                    config.game_required_hits,
                    config.release_frames,
                ),
            }
        )
        self._sequence_id = 0
        self._lock = asyncio.Lock()

    async def process(self, request: ImageRequest) -> VisionResponse:
        async with self._lock:
            try:
                rgb = decode_jpeg(
                    request.image_bytes,
                    request.content_type,
                    self.config,
                )
                started = time.perf_counter()
                detections = await self.backend.recognize(rgb)
                latency_ms = (time.perf_counter() - started) * 1000
                detections = [
                    item
                    for item in detections
                    if item.label != "None"
                    and item.score >= self.config.score_threshold
                ]
                self._sequence_id += 1
                captured_at = request.captured_at_ms or int(time.time() * 1000)
                self.cache.append(
                    CachedVisionFrame(
                        self._sequence_id,
                        captured_at,
                        rgb,
                        tuple(detections),
                        latency_ms,
                    )
                )
                score_by_label = {
                    item.label: item.score for item in detections
                }
                stable = self.stabilizer.update(set(score_by_label))
                actions = []
                mode_text = ""
                for label in stable:
                    result = await self.coordinator.handle_stable_gesture(
                        request.session_id,
                        label,
                        score_by_label.get(label, 0.0),
                    )
                    actions.extend(result.actions)
                    mode_text = result.display_text or mode_text
                return VisionResponse(
                    success=True,
                    target_detected=bool(detections),
                    detections=detections,
                    actions=actions,
                    sequence_id=self._sequence_id,
                    cache_size=len(self.cache),
                    metadata={
                        "image_width": self.config.image_width,
                        "image_height": self.config.image_height,
                        "image_format": "RGB",
                        "inference_latency_ms": round(latency_ms, 2),
                        "stable_gestures": list(stable),
                        "status_text": mode_text,
                    },
                )
            except VisionError as exc:
                return VisionResponse(
                    success=False,
                    target_detected=False,
                    cache_size=len(self.cache),
                    error=exc.code,
                )
            except Exception:
                return VisionResponse(
                    success=False,
                    target_detected=False,
                    cache_size=len(self.cache),
                    error="internal_error",
                )
