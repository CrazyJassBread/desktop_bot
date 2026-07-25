from app.transport.gateway_protocol import (
    AUDIO,
    COMMAND,
    decode_message,
    encode_message,
)
from app.transport.remote_gateway import RemoteAudioSource
import numpy as np
import pytest


def test_gateway_protocol_round_trip_binary_payload():
    encoded = encode_message(
        AUDIO,
        {"session_id": "bot-一号"},
        b"\x00\x01\x02",
    )

    decoded = decode_message(encoded)

    assert decoded.kind == AUDIO
    assert decoded.metadata == {"session_id": "bot-一号"}
    assert decoded.payload == b"\x00\x01\x02"


def test_gateway_protocol_round_trip_command():
    decoded = decode_message(
        encode_message(
            COMMAND,
            {"request_id": "abc", "command": "expression"},
        )
    )

    assert decoded.metadata["command"] == "expression"
    assert decoded.payload == b""


@pytest.mark.asyncio
async def test_remote_audio_source_restores_pcm_frames():
    source = RemoteAudioSource(frame_samples=4)
    expected = np.array([-32768, -1, 0, 32767], dtype="<i2")

    await source.put(expected.tobytes())
    frame = await anext(source.frames())

    assert np.allclose(frame, expected.astype(np.float32) / 32768.0)
