"""Small, durable events emitted by the continuous perception runtime."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from time import time
from typing import Any
from uuid import uuid4


def now_ms() -> int:
    return int(time() * 1000)


@dataclass(frozen=True)
class PerceptionEvent:
    event_type: str
    source: str
    timestamp_ms: int = field(default_factory=now_ms)
    session_id: str = "bot"
    payload: dict[str, Any] = field(default_factory=dict)
    event_id: str = field(default_factory=lambda: uuid4().hex)
    schema_version: int = 1
    sequence: int = 0

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)
