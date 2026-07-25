"""Save incoming Bot JPEG uploads for firmware diagnostics."""

from __future__ import annotations

import asyncio
from datetime import datetime
from pathlib import Path

from app.transport.hardware_sources import HTTPJPEGImageSource

IMAGE_DIR = Path("received_images")


async def receive() -> None:
    IMAGE_DIR.mkdir(exist_ok=True)
    source = HTTPJPEGImageSource("0.0.0.0", 8082, queue_size=1)
    print("Listening on http://0.0.0.0:8082/upload")
    async for request in source.images():
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S_%f")
        path = IMAGE_DIR / f"{timestamp}.jpg"
        path.write_bytes(request.image_bytes)
        print(f"Received {len(request.image_bytes)} bytes: {path}")


def main() -> None:
    try:
        asyncio.run(receive())
    except KeyboardInterrupt:
        print("Stopped")


if __name__ == "__main__":
    main()
