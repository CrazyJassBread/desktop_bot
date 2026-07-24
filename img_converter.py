from PIL import Image, ImageEnhance, ImageOps


PRINTER_WIDTH = 384


def convert_to_printer_image(
    image: Image.Image,
    printer_width: int = PRINTER_WIDTH,
    pixel_size: int = 4,
    contrast: float = 1.2,
    brightness: float = 1.0,
    dither: bool = True,
    rotate_180: bool = False,
) -> Image.Image:
    """
    Convert a normal Pillow image into a printer-ready 1-bit Pillow image.

    The result:
        - fits the printer width
        - preserves aspect ratio
        - removes transparency
        - converts to grayscale
        - optionally creates a pixel-art look
        - optionally rotates 180 degrees
        - uses dithering to simulate grey
        - returns Pillow mode "1"

    Parameters:
        image:
            Input Pillow image.

        printer_width:
            Output width in pixels. Use 384 for your printer.

        pixel_size:
            Size of the visible pixel-art blocks.

            1 = no pixelation
            2 = light pixel-art effect
            4 = balanced pixel-art effect
            8 = strong pixel-art effect

        contrast:
            Contrast multiplier.

        brightness:
            Brightness multiplier.

        dither:
            True uses black-dot density to simulate grey.

        rotate_180:
            True turns the final image upside down.
    """

    if not isinstance(image, Image.Image):
        raise TypeError("image must be a Pillow Image")

    if printer_width <= 0:
        raise ValueError("printer_width must be greater than 0")

    if pixel_size < 1:
        raise ValueError("pixel_size must be at least 1")

    if contrast <= 0:
        raise ValueError("contrast must be greater than 0")

    if brightness <= 0:
        raise ValueError("brightness must be greater than 0")

    # Correct orientation from phone-camera EXIF metadata.
    image = ImageOps.exif_transpose(image)

    # Remove transparency by placing the image on white.
    if image.mode in ("RGBA", "LA") or (
        image.mode == "P" and "transparency" in image.info
    ):
        rgba = image.convert("RGBA")

        background = Image.new(
            "RGBA",
            rgba.size,
            (255, 255, 255, 255),
        )

        image = Image.alpha_composite(
            background,
            rgba,
        ).convert("RGB")
    else:
        image = image.convert("RGB")

    # Preserve aspect ratio.
    target_height = max(
        1,
        round(
            image.height
            * printer_width
            / image.width
        ),
    )

    image = image.resize(
        (printer_width, target_height),
        Image.Resampling.LANCZOS,
    )

    # Convert to grayscale.
    image = ImageOps.grayscale(image)

    # Adjust appearance for thermal printing.
    image = ImageEnhance.Brightness(
        image
    ).enhance(brightness)

    image = ImageEnhance.Contrast(
        image
    ).enhance(contrast)

    # Create pixel-art blocks.
    if pixel_size > 1:
        small_width = max(
            1,
            printer_width // pixel_size,
        )

        small_height = max(
            1,
            target_height // pixel_size,
        )

        image = image.resize(
            (small_width, small_height),
            Image.Resampling.LANCZOS,
        )

        image = image.resize(
            (printer_width, target_height),
            Image.Resampling.NEAREST,
        )

    if rotate_180:
        image = image.rotate(
            180,
            expand=False,
        )

    # Convert to black and white.
    if dither:
        image = image.convert(
            "1",
            dither=Image.Dither.FLOYDSTEINBERG,
        )
    else:
        image = image.point(
            lambda value: 255
            if value >= 128
            else 0,
            mode="1",
        )

    return image