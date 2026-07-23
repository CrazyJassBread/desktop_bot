"""Strict JPEG decoding for camera frames."""

from __future__ import annotations

from io import BytesIO

import numpy as np

from app.config import VisionConfig
from app.vision.base import VisionError


def decode_jpeg(
    image_bytes: bytes,
    content_type: str,
    config: VisionConfig,
) -> np.ndarray:
    if content_type.lower() not in {"image/jpeg", "image/jpg"}:
        raise VisionError("unsupported_image_type")
    if not image_bytes:
        raise VisionError("empty_image")
    if len(image_bytes) > config.max_image_bytes:
        raise VisionError("image_too_large")
    try:
        from PIL import Image, ImageOps, UnidentifiedImageError
    except ImportError as exc:
        raise VisionError("vision_dependency_missing") from exc
    try:
        with Image.open(BytesIO(image_bytes)) as image:
            if image.format != "JPEG":
                raise VisionError("unsupported_image_type")
            image = ImageOps.exif_transpose(image)
            if image.size != (config.image_width, config.image_height):
                raise VisionError("invalid_image_dimensions")
            rgb = np.asarray(image.convert("RGB"), dtype=np.uint8)
    except VisionError:
        raise
    except (UnidentifiedImageError, OSError, ValueError) as exc:
        raise VisionError("corrupted_image") from exc
    if rgb.shape != (config.image_height, config.image_width, 3):
        raise VisionError("invalid_image_dimensions")
    return np.ascontiguousarray(rgb)
