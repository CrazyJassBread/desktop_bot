"""Shared request and response schemas."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from enum import StrEnum
from pathlib import Path
from typing import Any


class InteractionMode(StrEnum):
    COMMAND = "command"
    LLM = "llm"


class ControlSignal(StrEnum):
    AUTO = "auto"
    COMMAND_MODE = "command_mode"
    LLM_MODE = "llm_mode"
    ENTER_LLM_MODE = "enter_llm_mode"
    EXIT_LLM_MODE = "exit_llm_mode"
    CANCEL = "cancel"


@dataclass
class AudioRequest:
    audio_path: Path
    session_id: str = "default"
    signal: ControlSignal = ControlSignal.AUTO


@dataclass
class AssistantResponse:
    success: bool
    mode: str
    transcript: str
    display_text: str
    spoken_text: str
    emotion: str = "neutral"
    action: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)
    error: str | None = None

    def to_dict(self) -> dict[str, Any]:
        """Return a JSON-serializable representation."""
        return asdict(self)


@dataclass
class LLMReply:
    display_text: str
    spoken_text: str
    emotion: str = "neutral"

