"""Print a generated "hello world" image on the ESP32 thermal printer.

Reads the printer address from config/printer.yaml, draws a simple test
card with Pillow, converts it through the same pixel pipeline used by the
photo feature, and posts it to POST {base_url}/printer/image.

    python scripts/printer_hello.py                 # send to the printer
    python scripts/printer_hello.py --save-only     # only write the PNG
    python scripts/printer_hello.py --base-url http://10.76.14.192
"""

from __future__ import annotations

import argparse
import sys
from dataclasses import replace
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from PIL import Image, ImageDraw, ImageFont

from app.config import load_config
from app.features.photo_printer import PRINTER_WIDTH, ThermalPrinterClient

DEFAULT_OUTPUT = Path("logs/hello_world.png")


def load_font(size: int) -> ImageFont.ImageFont | ImageFont.FreeTypeFont:
    # Pillow >= 10.1 can scale the built-in font; fall back to the tiny
    # bitmap font on older versions.
    try:
        return ImageFont.load_default(size=size)
    except TypeError:
        return ImageFont.load_default()


def build_hello_image() -> Image.Image:
    width, height = PRINTER_WIDTH, 240
    image = Image.new("L", (width, height), 255)
    draw = ImageDraw.Draw(image)

    # Double border so paper alignment problems are easy to spot.
    draw.rectangle((4, 4, width - 5, height - 5), outline=0, width=3)
    draw.rectangle((14, 14, width - 15, height - 15), outline=0, width=1)

    def centered(text: str, y: int, size: int) -> None:
        font = load_font(size)
        box = draw.textbbox((0, 0), text, font=font)
        x = (width - (box[2] - box[0])) // 2 - box[0]
        draw.text((x, y), text, fill=0, font=font)

    centered("HELLO", 36, 64)
    centered("WORLD", 108, 64)
    centered("desktop_bot printer test", 186, 20)
    return image


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--base-url",
        default=None,
        help="override printer.base_url from config/printer.yaml",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=DEFAULT_OUTPUT,
        help=f"where to save the generated PNG (default: {DEFAULT_OUTPUT})",
    )
    parser.add_argument(
        "--save-only",
        action="store_true",
        help="generate the image without contacting the printer",
    )
    args = parser.parse_args()

    printer_config = load_config("config").printer
    if args.base_url:
        printer_config = replace(printer_config, base_url=args.base_url)
    # Text needs crisp 1:1 pixels; the photo defaults (pixel blocks and
    # dithering) would smear the glyphs.
    printer_config = replace(printer_config, pixel_size=1, dither=False)

    args.output.parent.mkdir(parents=True, exist_ok=True)
    build_hello_image().save(args.output)
    print(f"image saved to {args.output}")

    if args.save_only:
        return

    print(f"printing via {printer_config.base_url} ...")
    result = ThermalPrinterClient(printer_config).print_photo(args.output)
    print(
        f"done: {result['width']}x{result['height']} px "
        f"in {result['chunks']} chunk(s)"
    )
    for response in result["responses"]:
        print(f"  printer response: {response}")


if __name__ == "__main__":
    main()
