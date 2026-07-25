from io import BytesIO
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread
from urllib.parse import parse_qs, urlsplit

import pytest
from PIL import Image

from app.features.thermal_printer import (
    PrinterError,
    ThermalPrinterClient,
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


@pytest.fixture
def recording_server():
    requests: list[dict[str, object]] = []
    response_status = [200]

    class Handler(BaseHTTPRequestHandler):
        def do_POST(self) -> None:
            length = int(self.headers["Content-Length"])
            parsed = urlsplit(self.path)
            requests.append(
                {
                    "path": parsed.path,
                    "query": parse_qs(parsed.query),
                    "content_type": self.headers["Content-Type"],
                    "body": self.rfile.read(length),
                }
            )
            self.send_response(response_status[0])
            self.end_headers()
            self.wfile.write(b'{"success":true}')

        def log_message(self, *_args) -> None:
            return

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield {
        "url": f"http://127.0.0.1:{server.server_port}",
        "requests": requests,
        "response_status": response_status,
    }
    server.shutdown()
    thread.join()
    server.server_close()


def test_client_posts_each_chunk_in_order(recording_server):
    client = ThermalPrinterClient(
        recording_server["url"],
        width=8,
        max_chunk_height=2,
        pixel_size=1,
        grayscale_levels=2,
        dither=False,
    )

    result = client.print_image(encoded_image(size=(8, 5)))

    assert result.chunk_count == 3
    assert result.width == 8
    assert result.height == 5
    assert [
        request["query"]["height"][0]
        for request in recording_server["requests"]
    ] == ["2", "2", "1"]
    assert all(
        request["path"] == "/printer/image"
        for request in recording_server["requests"]
    )
    assert all(
        request["content_type"] == "application/octet-stream"
        for request in recording_server["requests"]
    )


def test_client_maps_non_success_response_to_printer_error(recording_server):
    recording_server["response_status"][0] = 500
    client = ThermalPrinterClient(
        recording_server["url"],
        width=8,
        pixel_size=1,
    )

    with pytest.raises(PrinterError) as captured:
        client.print_image(encoded_image())

    assert captured.value.reason == "http_error"


def test_client_prints_prepared_letter_without_resizing(monkeypatch):
    client = ThermalPrinterClient(
        "http://printer.test",
        width=16,
        max_chunk_height=3,
        rotate_180=False,
    )
    posted: list[Image.Image] = []
    monkeypatch.setattr(
        client,
        "_post_chunk",
        lambda chunk: posted.append(chunk.copy()),
    )
    prepared = Image.new("1", (16, 7), 255)
    prepared.putpixel((3, 2), 0)

    result = client.print_prepared_image(prepared)

    assert result == type(result)(width=16, height=7, chunk_count=3)
    assert [chunk.size for chunk in posted] == [
        (16, 3),
        (16, 3),
        (16, 1),
    ]
    assert posted[0].getpixel((3, 2)) == 0
