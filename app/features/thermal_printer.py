"""Thermal-printer image conversion and bitmap packing."""

from __future__ import annotations

import socket
from dataclasses import dataclass
from io import BytesIO
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from PIL import Image, ImageEnhance, ImageOps, UnidentifiedImageError


class PrinterError(RuntimeError):
    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


@dataclass(frozen=True)
class PrintResult:
    width: int
    height: int
    chunk_count: int


def quantize_grayscale(image: Image.Image, levels: int) -> Image.Image:
    if not 2 <= levels <= 256:
        raise ValueError("grayscale_levels must be between 2 and 256")
    grayscale = image if image.mode == "L" else image.convert("L")
    step = 255 / (levels - 1)
    lookup = [
        round(round(value / step) * step)
        for value in range(256)
    ]
    return grayscale.point(lookup)


def convert_to_printer_image(
    image_bytes: bytes,
    *,
    printer_width: int = 384,
    pixel_size: int = 6,
    contrast: float = 1.2,
    brightness: float = 1.0,
    grayscale_levels: int = 4,
    dither: bool = True,
    rotate_180: bool = False,
) -> Image.Image:
    if printer_width <= 0:
        raise ValueError("printer_width must be positive")
    if pixel_size <= 0:
        raise ValueError("pixel_size must be positive")
    if contrast <= 0 or brightness <= 0:
        raise ValueError("contrast and brightness must be positive")
    if not 2 <= grayscale_levels <= 256:
        raise ValueError("grayscale_levels must be between 2 and 256")

    with Image.open(BytesIO(image_bytes)) as source:
        image = ImageOps.exif_transpose(source)
        if image.mode in {"RGBA", "LA"} or (
            image.mode == "P" and "transparency" in image.info
        ):
            rgba = image.convert("RGBA")
            background = Image.new("RGBA", rgba.size, (255, 255, 255, 255))
            image = Image.alpha_composite(background, rgba).convert("RGB")
        else:
            image = image.convert("RGB")

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

    if pixel_size > 1:
        small_size = (
            max(1, printer_width // pixel_size),
            max(1, target_height // pixel_size),
        )
        image = image.resize(small_size, Image.Resampling.LANCZOS)
        image = image.resize(
            (printer_width, target_height),
            Image.Resampling.NEAREST,
        )

    image = quantize_grayscale(image, grayscale_levels)
    if rotate_180:
        image = image.rotate(180, expand=False)
    if dither:
        return image.convert("1", dither=Image.Dither.FLOYDSTEINBERG)
    return image.point(lambda value: 255 if value >= 128 else 0, mode="1")


def split_image(
    image: Image.Image,
    max_height: int,
) -> tuple[Image.Image, ...]:
    if max_height <= 0:
        raise ValueError("max_height must be positive")
    return tuple(
        image.crop((0, top, image.width, min(top + max_height, image.height)))
        for top in range(0, image.height, max_height)
    )


def pack_bitmap(image: Image.Image) -> bytes:
    if image.mode != "1":
        raise ValueError("image must use Pillow mode '1'")
    width_bytes = (image.width + 7) // 8
    output = bytearray(width_bytes * image.height)
    pixels = image.load()
    for y in range(image.height):
        row_offset = y * width_bytes
        for x in range(image.width):
            if pixels[x, y] == 0:
                output[row_offset + x // 8] |= 1 << (7 - (x % 8))
    return bytes(output)


class ThermalPrinterClient:
    def __init__(
        self,
        base_url: str,
        *,
        width: int = 384,
        max_chunk_height: int = 1200,
        pixel_size: int = 6,
        contrast: float = 1.2,
        brightness: float = 1.0,
        grayscale_levels: int = 4,
        dither: bool = True,
        rotate_180: bool = False,
        timeout_seconds: float = 30.0,
    ) -> None:
        if not base_url.strip():
            raise ValueError("base_url cannot be empty")
        if max_chunk_height <= 0:
            raise ValueError("max_chunk_height must be positive")
        if timeout_seconds <= 0:
            raise ValueError("timeout_seconds must be positive")
        self.base_url = base_url.rstrip("/")
        self.width = width
        self.max_chunk_height = max_chunk_height
        self.pixel_size = pixel_size
        self.contrast = contrast
        self.brightness = brightness
        self.grayscale_levels = grayscale_levels
        self.dither = dither
        self.rotate_180 = rotate_180
        self.timeout_seconds = timeout_seconds

    def print_image(self, image_bytes: bytes) -> PrintResult:
        try:
            image = convert_to_printer_image(
                image_bytes,
                printer_width=self.width,
                pixel_size=self.pixel_size,
                contrast=self.contrast,
                brightness=self.brightness,
                grayscale_levels=self.grayscale_levels,
                dither=self.dither,
                rotate_180=self.rotate_180,
            )
        except (OSError, UnidentifiedImageError, ValueError) as exc:
            raise PrinterError("invalid_image") from exc

        chunks = split_image(image, self.max_chunk_height)
        for chunk in chunks:
            self._post_chunk(chunk)
        return PrintResult(image.width, image.height, len(chunks))

    def _post_chunk(self, chunk: Image.Image) -> None:
        query = urlencode(
            {
                "width": chunk.width,
                "height": chunk.height,
            }
        )
        request = Request(
            f"{self.base_url}/printer/image?{query}",
            data=pack_bitmap(chunk),
            method="POST",
            headers={"Content-Type": "application/octet-stream"},
        )
        try:
            with urlopen(request, timeout=self.timeout_seconds) as response:
                response.read()
        except HTTPError as exc:
            raise PrinterError("http_error") from exc
        except (socket.timeout, TimeoutError) as exc:
            raise PrinterError("timeout") from exc
        except URLError as exc:
            reason = (
                "timeout"
                if isinstance(exc.reason, (socket.timeout, TimeoutError))
                else "connection_error"
            )
            raise PrinterError(reason) from exc
        except OSError as exc:
            raise PrinterError("connection_error") from exc
