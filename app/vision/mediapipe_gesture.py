"""Optional MediaPipe Tasks gesture recognizer."""

from __future__ import annotations

import asyncio
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any

import numpy as np

from app.models import GestureDetection
from app.vision.base import GestureBackend, VisionError


class MediaPipeGestureBackend(GestureBackend):
    def __init__(
        self,
        model_path: Path | str,
        score_threshold: float = 0.7,
        max_hands: int = 2,
        executor: ThreadPoolExecutor | None = None,
    ) -> None:
        path = Path(model_path)
        if not path.is_file():
            raise VisionError("gesture_model_not_found")
        try:
            import mediapipe as mp
            from mediapipe.tasks.python.components.processors import (
                ClassifierOptions,
            )
        except ImportError as exc:
            raise VisionError("vision_dependency_missing") from exc
        try:
            options = mp.tasks.vision.GestureRecognizerOptions(
                base_options=mp.tasks.BaseOptions(
                    model_asset_path=str(path),
                    delegate=mp.tasks.BaseOptions.Delegate.CPU,
                ),
                running_mode=mp.tasks.vision.RunningMode.IMAGE,
                num_hands=max_hands,
                canned_gesture_classifier_options=ClassifierOptions(
                    score_threshold=score_threshold
                ),
            )
            self._mp = mp
            self._recognizer: Any = (
                mp.tasks.vision.GestureRecognizer.create_from_options(options)
            )
        except Exception as exc:
            raise VisionError("gesture_model_load_error") from exc
        self._executor = executor

    def _recognize_sync(
        self, rgb_image: np.ndarray
    ) -> list[GestureDetection]:
        try:
            image = self._mp.Image(
                image_format=self._mp.ImageFormat.SRGB,
                data=rgb_image,
            )
            result = self._recognizer.recognize(image)
            detections: list[GestureDetection] = []
            for index, categories in enumerate(result.gestures):
                if not categories:
                    continue
                category = categories[0]
                handedness = None
                if index < len(result.handedness) and result.handedness[index]:
                    handedness = result.handedness[index][0].category_name
                if category.category_name != "None":
                    detections.append(
                        GestureDetection(
                            label=category.category_name,
                            score=float(category.score),
                            handedness=handedness,
                        )
                    )
            return detections
        except Exception as exc:
            raise VisionError("gesture_inference_error") from exc

    async def recognize(
        self, rgb_image: np.ndarray
    ) -> list[GestureDetection]:
        if self._executor is not None:
            loop = asyncio.get_running_loop()
            return await loop.run_in_executor(
                self._executor, self._recognize_sync, rgb_image
            )
        return await asyncio.to_thread(self._recognize_sync, rgb_image)

    async def close(self) -> None:
        await asyncio.to_thread(self._recognizer.close)
