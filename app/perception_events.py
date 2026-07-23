"""Small, durable events emitted by the continuous perception runtime."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from time import time
from typing import Any


def now_ms() -> int:
    return int(time() * 1000)


@dataclass(frozen=True)
class PerceptionEvent:
    event_type: str
    source: str
    timestamp_ms: int = field(default_factory=now_ms)
    session_id: str = "bot"
    payload: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

