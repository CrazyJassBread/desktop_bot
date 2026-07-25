"""Opt-in smoke test for the physical thermal printer.

Run directly to print once:

    .venv/bin/python tests/test_printer_live.py

Run through pytest:

    RUN_LIVE_PRINTER_TEST=1 .venv/bin/python -m pytest \
        tests/test_printer_live.py -m live -s
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

import pytest
from PIL import Image, ImageDraw, ImageFont

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from app.config import load_config  # noqa: E402
from app.features.thermal_printer import (  # noqa: E402
    PrintResult,
    PrinterError,
    ThermalPrinterClient,
)

APP_CONFIG_PATH = PROJECT_ROOT / "config" / "app.yaml"
LLM_CONFIG_PATH = PROJECT_ROOT / "config" / "llm.yaml"


def build_hello_world_image(width: int) -> Image.Image:
    """Create a compact 1-bit alignment card at the configured paper width."""
    height = 180
    canvas = Image.new("L", (width, height), 255)
    draw = ImageDraw.Draw(canvas)
    title_font = ImageFont.load_default(size=38)
    caption_font = ImageFont.load_default(size=14)

    draw.rounded_rectangle(
        (16, 16, width - 17, height - 17),
        radius=10,
        outline=0,
        width=2,
    )
    title = "Hello World"
    title_box = draw.textbbox((0, 0), title, font=title_font)
    title_width = title_box[2] - title_box[0]
    title_height = title_box[3] - title_box[1]
    draw.text(
        ((width - title_width) / 2, (height - title_height) / 2 - 12),
        title,
        font=title_font,
        fill=0,
    )

    caption = "THERMAL PRINTER TEST"
    caption_box = draw.textbbox((0, 0), caption, font=caption_font)
    caption_width = caption_box[2] - caption_box[0]
    draw.text(
        ((width - caption_width) / 2, height - 48),
        caption,
        font=caption_font,
        fill=0,
    )
    return canvas.convert("1", dither=Image.Dither.NONE)


def print_hello_world() -> PrintResult:
    config = load_config(APP_CONFIG_PATH, LLM_CONFIG_PATH)
    if not config.printer.enabled:
        raise RuntimeError("printer.enabled must be true in config/app.yaml")

    printer = ThermalPrinterClient(
        config.printer.base_url,
        width=config.printer.width,
        max_chunk_height=config.printer.max_chunk_height,
        pixel_size=config.printer.pixel_size,
        contrast=config.printer.contrast,
        brightness=config.printer.brightness,
        grayscale_levels=config.printer.grayscale_levels,
        dither=config.printer.dither,
        rotate_180=config.printer.rotate_180,
        timeout_seconds=config.printer.timeout_seconds,
    )
    image = build_hello_world_image(config.printer.width)
    return printer.print_prepared_image(image)


@pytest.mark.live
@pytest.mark.skipif(
    os.getenv("RUN_LIVE_PRINTER_TEST") != "1",
    reason="set RUN_LIVE_PRINTER_TEST=1 to use the physical printer",
)
def test_physical_printer_prints_hello_world():
    result = print_hello_world()

    assert result.width > 0
    assert result.height == 180
    assert result.chunk_count >= 1


if __name__ == "__main__":
    try:
        printed = print_hello_world()
    except PrinterError as exc:
        raise SystemExit(f"Printer test failed: {exc.reason}") from exc
    print(
        "Printed Hello World "
        f"({printed.width}x{printed.height}, "
        f"chunks={printed.chunk_count})."
    )
