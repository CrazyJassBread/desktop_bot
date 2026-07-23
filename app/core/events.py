"""Events exchanged between input pipelines and Bot services."""

from __future__ import annotations

from dataclasses import dataclass, field
from time import time
from typing import Any


@dataclass(frozen=True)
class BotEvent:
    event_type: str
    session_id: str = "default"
    payload: dict[str, Any] = field(default_factory=dict)
    timestamp_ms: int = field(default_factory=lambda: int(time() * 1000))
    event_id: str | None = None
