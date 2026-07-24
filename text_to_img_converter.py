from PIL import Image, ImageDraw, ImageFont

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