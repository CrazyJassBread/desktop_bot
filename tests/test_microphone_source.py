from __future__ import annotations

import asyncio

import numpy as np
import pytest

from app.transport.microphone_source import (
    LocalMicrophoneAudioSource,
    MicrophoneError,
    list_input_devices,
    parse_input_device,
)


class FakeInputStream:
    def __init__(self, owner, **kwargs):
        self.owner = owner
        self.kwargs = kwargs
        self.started = False
        self.stopped = False
        self.closed = False
        owner.streams.append(self)

    def start(self):
        if self.owner.start_error is not None:
            raise self.owner.start_error
        self.started = True

    def stop(self):
        self.stopped = True

    def close(self):
        self.closed = True

    def emit(self, samples, status=None):
        data = np.asarray(samples, dtype=np.float32).reshape(-1, 1)
        self.kwargs["callback"](data, len(data), None, status)


class FakeSoundDevice:
    def __init__(self):
        self.streams = []
        self.start_error = None
        self.devices = [
            {
                "name": "Output only",
                "max_input_channels": 0,
                "default_samplerate": 48_000,
            },
            {
                "name": "Built-in Mic",
                "max_input_channels": 2,
                "default_samplerate": 48_000,
            },
        ]

    def InputStream(self, **kwargs):
        return FakeInputStream(self, **kwargs)

    def query_devices(self):
        return self.devices


def test_parse_and_list_input_devices():
    assert parse_input_device("2") == 2
    assert parse_input_device(" Built-in Mic ") == "Built-in Mic"
    devices = list_input_devices(FakeSoundDevice())
    assert [(item.index, item.name) for item in devices] == [
        (1, "Built-in Mic")
    ]


@pytest.mark.asyncio
async def test_microphone_source_yields_mono_float32_and_closes():
    sounddevice = FakeSoundDevice()
    source = LocalMicrophoneAudioSource(
        device=1,
        queue_size=1,
        sounddevice_module=sounddevice,
    )
    iterator = source.frames().__aiter__()
    pending = asyncio.create_task(anext(iterator))
    await asyncio.sleep(0)
    stream = sounddevice.streams[0]
    stream.emit([0.25, -0.5])

    frame = await asyncio.wait_for(pending, timeout=1)

    assert frame.dtype == np.float32
    assert frame.flags.c_contiguous
    np.testing.assert_array_equal(
        frame, np.array([0.25, -0.5], dtype=np.float32)
    )
    stream.emit([1.0])
    stream.emit([2.0])
    await asyncio.sleep(0)
    np.testing.assert_array_equal(
        await anext(iterator), np.array([2.0], dtype=np.float32)
    )
    assert source.dropped_frames == 1
    await iterator.aclose()
    assert stream.stopped is True
    assert stream.closed is True


@pytest.mark.asyncio
async def test_microphone_source_maps_open_failure():
    sounddevice = FakeSoundDevice()
    sounddevice.start_error = RuntimeError("Permission denied")
    source = LocalMicrophoneAudioSource(sounddevice_module=sounddevice)

    with pytest.raises(MicrophoneError) as captured:
        await anext(source.frames().__aiter__())

    assert captured.value.reason == "microphone_unavailable"
    assert sounddevice.streams[0].closed is True
