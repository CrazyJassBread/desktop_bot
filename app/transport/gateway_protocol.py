"""Binary protocol shared by the cloud runtime and the local Bot gateway."""

from __future__ import annotations

import json
import struct
from dataclasses import dataclass

HEADER = struct.Struct("!BI")

AUDIO = 1
IMAGE = 2
COMMAND = 3
ACK = 4


@dataclass(frozen=True)
class GatewayMessage:
    kind: int
    metadata: dict[str, object]
    payload: bytes


def encode_message(
    kind: int,
    metadata: dict[str, object] | None = None,
    payload: bytes = b"",
) -> bytes:
    header = json.dumps(
        metadata or {},
        ensure_ascii=False,
        separators=(",", ":"),
    ).encode("utf-8")
    return HEADER.pack(kind, len(header)) + header + payload


def decode_message(data: bytes) -> GatewayMessage:
    if len(data) < HEADER.size:
        raise ValueError("gateway message is too short")
    kind, header_size = HEADER.unpack_from(data)
    header_end = HEADER.size + header_size
    if header_end > len(data):
        raise ValueError("gateway message header is incomplete")
    metadata = json.loads(data[HEADER.size:header_end].decode("utf-8"))
    if not isinstance(metadata, dict):
        raise ValueError("gateway metadata must be an object")
    return GatewayMessage(kind, metadata, data[header_end:])
