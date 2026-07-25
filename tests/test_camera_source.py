import sys
from types import SimpleNamespace

import numpy as np
import pytest

from app.transport.camera_source import ComputerCameraImageSource


@pytest.mark.asyncio
async def test_computer_camera_emits_jpeg_and_releases(monkeypatch):
    class FakeCapture:
        released = False

        def isOpened(self):
            return True

        def read(self):
            return True, np.zeros((4, 6, 3), dtype=np.uint8)

        def release(self):
            self.released = True

    capture = FakeCapture()
    fake_cv2 = SimpleNamespace(
        IMWRITE_JPEG_QUALITY=1,
        VideoCapture=lambda _device: capture,
        imencode=lambda _extension, _frame, _options: (
            True,
            np.frombuffer(b"jpeg-data", dtype=np.uint8),
        ),
    )
    monkeypatch.setitem(sys.modules, "cv2", fake_cv2)
    source = ComputerCameraImageSource(
        2,
        frames_per_second=1_000,
        session_id="demo",
    )

    stream = source.images()
    request = await anext(stream)
    await stream.aclose()

    assert request.image_bytes == b"jpeg-data"
    assert request.session_id == "demo"
    assert request.captured_at_ms is not None
    assert capture.released is True


@pytest.mark.parametrize(
    "kwargs",
    [
        {"device": -1},
        {"frames_per_second": 0},
        {"jpeg_quality": 0},
        {"jpeg_quality": 101},
    ],
)
def test_computer_camera_rejects_invalid_settings(kwargs):
    with pytest.raises(ValueError):
        ComputerCameraImageSource(**kwargs)
