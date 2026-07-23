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


@dataclass(frozen=True)
class DeviceAction:
    """A transport-neutral request for the Bot device layer."""

    action: str
    parameters: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class GestureDetection:
    label: str
    score: float
    handedness: str | None = None


@dataclass(frozen=True)
class ImageRequest:
    image_bytes: bytes
    session_id: str = "default"
    request_id: str | None = None
    captured_at_ms: int | None = None
    content_type: str = "image/jpeg"


@dataclass
class VisionResponse:
    success: bool
    target_detected: bool
    detections: list[GestureDetection] = field(default_factory=list)
    actions: list[DeviceAction] = field(default_factory=list)
    sequence_id: int | None = None
    cache_size: int = 0
    metadata: dict[str, Any] = field(default_factory=dict)
    error: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(frozen=True)
class LetterReceived:
    event_id: str
    letter_id: str
    recipient_bot_id: str
    subject: str
    content: str
    sender_name: str | None = None
    requested_action: str | None = None


@dataclass(frozen=True)
class PrintJob:
    job_id: str
    source_type: str
    source_id: str
    title: str
    content: str
    copies: int = 1
    status: str = "pending"
