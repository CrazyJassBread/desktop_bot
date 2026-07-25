"""Pixel-art processing and delivery of photos to the ESP32 thermal printer."""

from __future__ import annotations

import json
import logging
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from PIL import Image, ImageEnhance, ImageOps

from app.config import PrinterConfig

LOGGER = logging.getLogger("desktop_assistant.printer")

PRINTER_WIDTH = 384


def split_image(
    image: Image.Image,
    max_height: int = 1200,
) -> list[Image.Image]:
    """Split an image into pieces of at most max_height pixels."""
    width, height = image.size
    pieces: list[Image.Image] = []
    for y in range(0, height, max_height):
        bottom = min(y + max_height, height)
        pieces.append(image.crop((0, y, width, bottom)))
    return pieces


def quantize_grayscale(image: Image.Image, levels: int) -> Image.Image:
    """Clamp a grayscale ("L" mode) image to a fixed number of grey levels."""
    if image.mode != "L":
        image = image.convert("L")
    if not 2 <= levels <= 256:
        raise ValueError("levels must be between 2 and 256")
    step = 255 / (levels - 1)
    lookup_table = [
        round(round(value / step) * step) for value in range(256)
    ]
    return image.point(lookup_table)


def convert_to_printer_image(
    image: Image.Image,
    printer_width: int = PRINTER_WIDTH,
    pixel_size: int = 4,
    contrast: float = 1.2,
    brightness: float = 1.0,
    grayscale_levels: int = 4,
    dither: bool = True,
    rotate_180: bool = False,
) -> Image.Image:
    """Convert a Pillow image into a printer-ready 1-bit pixel-art image."""
    if printer_width <= 0:
        raise ValueError("printer_width must be greater than 0")
    if pixel_size < 1:
        raise ValueError("pixel_size must be at least 1")
    if contrast <= 0 or brightness <= 0:
        raise ValueError("contrast and brightness must be greater than 0")

    # Correct camera orientation and remove transparency on white.
    image = ImageOps.exif_transpose(image)
    if image.mode in ("RGBA", "LA") or (
        image.mode == "P" and "transparency" in image.info
    ):
        rgba = image.convert("RGBA")
        background = Image.new("RGBA", rgba.size, (255, 255, 255, 255))
        image = Image.alpha_composite(background, rgba).convert("RGB")
    else:
        image = image.convert("RGB")

    # Resize to the printer width while preserving the aspect ratio.
    target_height = max(
        1,
        round(image.height * printer_width / image.width),
    )
    image = image.resize(
        (printer_width, target_height),
        Image.Resampling.LANCZOS,
    )

    image = ImageOps.grayscale(image)
    image = ImageEnhance.Brightness(image).enhance(brightness)
    image = ImageEnhance.Contrast(image).enhance(contrast)

    # Create pixel-art blocks.
    if pixel_size > 1:
        small_width = max(1, printer_width // pixel_size)
        small_height = max(1, target_height // pixel_size)
        image = image.resize(
            (small_width, small_height),
            Image.Resampling.LANCZOS,
        )
        image = image.resize(
            (printer_width, target_height),
            Image.Resampling.NEAREST,
        )

    image = quantize_grayscale(image, grayscale_levels)

    if rotate_180:
        image = image.rotate(180, expand=False)

    # Convert to the printer's 1-bit format; intermediate greys are
    # represented through dithering.
    if dither:
        return image.convert("1", dither=Image.Dither.FLOYDSTEINBERG)
    return image.point(
        lambda value: 255 if value >= 128 else 0,
        mode="1",
    )


def pack_bitmap(image: Image.Image) -> bytes:
    """Convert a 1-bit image into ESC/POS raster bytes (MSB = left pixel)."""
    if image.mode != "1":
        raise ValueError("Image must be mode '1'.")
    width, height = image.size
    width_bytes = (width + 7) // 8
    output = bytearray(width_bytes * height)
    pixels = image.load()
    for y in range(height):
        row_offset = y * width_bytes
        for x in range(width):
            # Pillow: 0 = black (printed), 255 = white.
            if pixels[x, y] == 0:
                byte_index = row_offset + x // 8
                bit_index = 7 - (x % 8)
                output[byte_index] |= 1 << bit_index
    return bytes(output)


class ThermalPrinterClient:
    """Send pixel-processed photos to the ESP32 printer over HTTP."""

    def __init__(self, config: PrinterConfig) -> None:
        self.config = config

    def print_photo(self, path: Path) -> dict[str, object]:
        """Process and upload a photo. Blocking; run via asyncio.to_thread."""
        with Image.open(path) as source:
            printer_image = convert_to_printer_image(
                source,
                pixel_size=self.config.pixel_size,
                contrast=self.config.contrast,
                brightness=self.config.brightness,
                grayscale_levels=self.config.grayscale_levels,
                dither=self.config.dither,
                rotate_180=self.config.rotate_180,
            )
        chunks = split_image(printer_image, self.config.max_chunk_height)
        responses: list[object] = []
        for chunk in chunks:
            responses.append(self._post_chunk(chunk))
        return {
            "chunks": len(chunks),
            "width": printer_image.width,
            "height": printer_image.height,
            "responses": responses,
        }

    def _post_chunk(self, chunk: Image.Image) -> object:
        query = urlencode({"width": chunk.width, "height": chunk.height})
        url = f"{self.config.base_url.rstrip('/')}/printer/image?{query}"
        request = Request(
            url,
            data=pack_bitmap(chunk),
            method="POST",
            headers={"Content-Type": "application/octet-stream"},
        )
        with urlopen(
            request,
            timeout=self.config.timeout_seconds,
        ) as response:
            body = response.read()
            status = response.status
        if not body:
            return {"status": status}
        try:
            parsed = json.loads(body)
        except (json.JSONDecodeError, UnicodeDecodeError):
            return {
                "status": status,
                "response": body.decode("utf-8", errors="replace"),
            }
        if isinstance(parsed, dict):
            return {"status": status, **parsed}
        return {"status": status, "response": parsed}
