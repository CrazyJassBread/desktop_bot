"""Thermal-printer image conversion and bitmap packing."""

from __future__ import annotations

from io import BytesIO

from PIL import Image, ImageEnhance, ImageOps


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
