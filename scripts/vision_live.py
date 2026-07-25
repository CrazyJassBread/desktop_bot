"""Live Vision window using the same pipeline as ``python -m app``."""

from __future__ import annotations

import argparse
import asyncio
import logging
from pathlib import Path

import numpy as np

from app.config import ConfigurationError, load_config
from app.factories import build_gesture, setup_logging
from app.transport.hardware_sources import HTTPJPEGImageSource
from app.vision.continuous_processor import (
    ContinuousVisionProcessor,
    VisionProcessingResult,
)

LOGGER = logging.getLogger("desktop_assistant.vision_live")
WINDOW_NAME = "AI Bot - Vision Test"


def _waiting_frame(width: int, height: int) -> np.ndarray:
    frame = np.zeros((height, width, 3), dtype=np.uint8)
    return frame


def _draw_overlay(
    frame: np.ndarray,
    result: VisionProcessingResult | None,
    frame_number: int,
) -> np.ndarray:
    import cv2

    display = np.ascontiguousarray(frame.copy())
    if result is None:
        lines = ["Waiting for POST /upload ..."]
    elif result.error is not None:
        lines = [f"ERROR: {result.error}"]
    else:
        lines = [f"Frame: {frame_number}"]
        if result.detections:
            lines.extend(
                (
                    f"{item.label} score={item.score:.3f} "
                    f"hand={item.handedness or '-'}"
                )
                for item in result.detections
            )
        else:
            lines.append("Gesture: none")
        if result.events:
            lines.append(
                "EVENT: "
                + ", ".join(event.event_type for event in result.events)
            )

    overlay_height = 16 + 28 * len(lines)
    cv2.rectangle(
        display,
        (0, 0),
        (display.shape[1], overlay_height),
        (0, 0, 0),
        -1,
    )
    for index, line in enumerate(lines):
        color = (80, 230, 80)
        if line.startswith("ERROR"):
            color = (50, 50, 255)
        elif line.startswith("EVENT"):
            color = (0, 220, 255)
        cv2.putText(
            display,
            line,
            (12, 27 + index * 28),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.62,
            color,
            2,
            cv2.LINE_AA,
        )
    return display


async def run_live_view(
    config_path: Path | str = Path("config.yaml"),
    *,
    host: str | None = None,
    port: int | None = None,
    session_id: str | None = None,
    scale: float = 1.25,
) -> None:
    if scale <= 0:
        raise ConfigurationError("scale must be positive")
    try:
        import cv2
    except ImportError as exc:
        raise RuntimeError(
            "OpenCV is required for test mode; install requirements.txt"
        ) from exc

    config = load_config(config_path)
    if not config.vision.enabled:
        raise ConfigurationError("test mode requires vision.enabled=true")
    setup_logging()

    backend = build_gesture(config)
    processor = ContinuousVisionProcessor(
        config.vision,
        config.perception,
        backend,
    )
    source = HTTPJPEGImageSource(
        host or config.hardware.vision_host,
        port if port is not None else config.hardware.vision_port,
        upload_path=config.hardware.vision_upload_path,
        max_image_bytes=config.vision.max_image_bytes,
        queue_size=1,
        default_session_id=session_id or config.hardware.session_id,
    )
    stream = source.images()
    next_image = asyncio.create_task(anext(stream))
    last_result: VisionProcessingResult | None = None
    last_frame = _waiting_frame(
        config.vision.image_width,
        config.vision.image_height,
    )
    frame_number = 0

    try:
        cv2.namedWindow(WINDOW_NAME, cv2.WINDOW_NORMAL)
        cv2.resizeWindow(
            WINDOW_NAME,
            round(config.vision.image_width * scale),
            round(config.vision.image_height * scale),
        )
    except cv2.error as exc:
        next_image.cancel()
        await asyncio.gather(next_image, return_exceptions=True)
        await stream.aclose()
        await backend.close()
        raise RuntimeError("failed to open the Vision test window") from exc

    LOGGER.info(
        "Vision test ready: http://%s:%s%s; press q or Esc to stop",
        source.host,
        source.port,
        source.upload_path,
    )
    try:
        while True:
            if next_image.done():
                request = next_image.result()
                last_result = await processor.process(request)
                frame_number += 1
                if last_result.rgb_image is not None:
                    last_frame = cv2.cvtColor(
                        last_result.rgb_image,
                        cv2.COLOR_RGB2BGR,
                    )
                LOGGER.info(
                    "vision frame=%s detections=%s events=%s error=%s",
                    frame_number,
                    [
                        f"{item.label}:{item.score:.3f}"
                        for item in last_result.detections
                    ],
                    [item.event_type for item in last_result.events],
                    last_result.error,
                )
                next_image = asyncio.create_task(anext(stream))

            display = _draw_overlay(
                last_frame,
                last_result,
                frame_number,
            )
            cv2.imshow(WINDOW_NAME, display)
            key = cv2.waitKey(1) & 0xFF
            if key in {ord("q"), 27}:
                break
            try:
                if cv2.getWindowProperty(
                    WINDOW_NAME,
                    cv2.WND_PROP_VISIBLE,
                ) < 1:
                    break
            except cv2.error:
                break
            await asyncio.sleep(0.01)
    finally:
        next_image.cancel()
        await asyncio.gather(next_image, return_exceptions=True)
        await stream.aclose()
        await backend.close()
        cv2.destroyAllWindows()


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Open the live Vision window.")
    parser.add_argument("--config", type=Path, default=Path("config.yaml"))
    parser.add_argument("--host", default=None)
    parser.add_argument("--port", type=int, default=None)
    parser.add_argument("--session", default=None)
    parser.add_argument("--scale", type=float, default=1.25)
    return parser


def main() -> None:
    args = build_parser().parse_args()
    try:
        asyncio.run(
            run_live_view(
                args.config,
                host=args.host,
                port=args.port,
                session_id=args.session,
                scale=args.scale,
            )
        )
    except KeyboardInterrupt:
        LOGGER.info("stopped by user")


if __name__ == "__main__":
    main()
