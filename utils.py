from PIL import Image
from PIL import Image, ImageEnhance, ImageOps, ImageDraw, ImageFont

PRINTER_WIDTH = 384


def split_image(image: Image.Image, max_height=1200):
    """
    Splits a PIL Image into pieces of at most max_height pixels.

    Returns:
        List[PIL.Image.Image]
    """
    width, height = image.size

    pieces = []

    for y in range(0, height, max_height):
        bottom = min(y + max_height, height)
        piece = image.crop((0, y, width, bottom))
        pieces.append(piece)

    return pieces

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

def text_to_img(
    text: str,
    font_path: str,
    font_size: int = 48,
    rotate_180: bool = False,
    dither: bool = True,
):
    """
    Render text into a printer-ready 1-bit bitmap.

    Supports:
        ✓ English
        ✓ Chinese
        ✓ Emoji (if the font supports them)
        ✓ Any TrueType/OpenType font
    """

    font = ImageFont.truetype(
        font_path,
        font_size,
    )

    #
    # Determine text size
    #
    dummy = Image.new("L", (1, 1), 255)
    draw = ImageDraw.Draw(dummy)

    left, top, right, bottom = draw.multiline_textbbox(
        (0, 0),
        text,
        font=font,
        spacing=6,
    )

    margin = 12

    width = right - left + margin * 2
    height = bottom - top + margin * 2

    #
    # White background
    #
    image = Image.new(
        "L",
        (width, height),
        255,
    )

    draw = ImageDraw.Draw(image)

    draw.multiline_text(
        (margin - left, margin - top),
        text,
        font=font,
        fill=0,
        spacing=6,
    )

    if rotate_180:
        image = image.rotate(
            180,
            expand=True,
        )

    if dither:
        image = image.convert(
            "1",
            dither=Image.Dither.FLOYDSTEINBERG,
        )
    else:
        image = image.convert("1")

    return image

def pack_bitmap(image: Image.Image) -> bytes:
    """
    Convert a Pillow 1-bit image into ESC/POS raster bitmap bytes.

    Output format:
        Row-major
        1 bit per pixel
        MSB is the leftmost pixel

    Black pixel -> bit = 1
    White pixel -> bit = 0
    """

    if image.mode != "1":
        raise ValueError("Image must be mode '1'.")

    width, height = image.size

    width_bytes = (width + 7) // 8

    output = bytearray(width_bytes * height)

    pixels = image.load()

    for y in range(height):
        row_offset = y * width_bytes

        for x in range(width):

            # Pillow:
            #   0   = black
            #   255 = white
            if pixels[x, y] == 0:

                byte_index = row_offset + x // 8

                bit_index = 7 - (x % 8)

                output[byte_index] |= 1 << bit_index

    return bytes(output)