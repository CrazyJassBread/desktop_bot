from io import BytesIO

from PIL import Image

from app.features.thermal_printer import (
    convert_to_printer_image,
    pack_bitmap,
    split_image,
)


def encoded_image(
    size: tuple[int, int] = (8, 4),
    color: tuple[int, int, int] = (32, 64, 96),
) -> bytes:
    output = BytesIO()
    Image.new("RGB", size, color).save(output, "PNG")
    return output.getvalue()


def test_conversion_is_one_bit_pixel_art_at_printer_width():
    result = convert_to_printer_image(
        encoded_image(),
        printer_width=16,
        pixel_size=2,
        grayscale_levels=4,
    )

    assert result.mode == "1"
    assert result.size == (16, 8)


def test_pack_bitmap_uses_msb_and_black_is_one():
    image = Image.new("1", (8, 1), 255)
    image.putpixel((0, 0), 0)
    image.putpixel((7, 0), 0)

    assert pack_bitmap(image) == bytes([0b10000001])


def test_split_image_preserves_order_and_height_limit():
    image = Image.new("1", (8, 5), 255)

    chunks = split_image(image, 2)

    assert [chunk.size for chunk in chunks] == [(8, 2), (8, 2), (8, 1)]
