from PIL import Image


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