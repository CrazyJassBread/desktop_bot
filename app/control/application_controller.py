"""Interpret perception events using the current application state."""

from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Awaitable, Callable

from app.perception_events import PerceptionEvent

EventEmitter = Callable[[PerceptionEvent], Awaitable[None]]


@dataclass
class AppState:
    language: str = "zh"
    chat_active: bool = False
    chat_session_id: str | None = None
    photo_state: str = "idle"
    active_feature: str | None = None

    def to_dict(self) -> dict[str, object]:
        return asdict(self)


class ApplicationController:
    def __init__(
        self,
        *,
        default_language: str = "zh",
        photo_manager: object | None = None,
        llm_session_manager: object | None = None,
    ) -> None:
        self.state = AppState(language=default_language)
        self.photo_manager = photo_manager
        self.llm_session_manager = llm_session_manager
        self._emit: EventEmitter | None = None

    def set_event_emitter(self, emitter: EventEmitter) -> None:
        self._emit = emitter
        if self.photo_manager is not None:
            set_emitter = getattr(self.photo_manager, "set_event_emitter")
            set_emitter(emitter)
        if self.llm_session_manager is not None:
            set_emitter = getattr(
                self.llm_session_manager,
                "set_event_emitter",
            )
            set_emitter(emitter)

    async def handle(
        self,
        event: PerceptionEvent,
    ) -> tuple[PerceptionEvent, ...]:
        if self.llm_session_manager is not None:
            if event.event_type in {
                "llm.letter.start",
                "llm.qa.start",
                "speech.transcribed",
            }:
                return await getattr(
                    self.llm_session_manager,
                    "handle",
                )(event)
            if (
                getattr(self.llm_session_manager, "active")
                and event.source == "audio"
            ):
                return ()
        if event.event_type in {"wake", "mode.enter_chat"}:
            return self._start_chat(event)
        if event.event_type == "mode.exit_chat":
            return self._stop_chat(event)
        if event.event_type == "speech.transcribed":
            return self._route_transcript(event)
        if event.event_type == "feature.write_letter":
            return (
                self._command(
                    "letter.compose",
                    event,
                    {"content": event.payload.get("payload_text", "")},
                ),
            )
        if event.event_type.startswith("intent."):
            command_type = event.event_type.removeprefix("intent.")
            return (
                self._command(
                    command_type,
                    event,
                    {
                        "text": event.payload.get("payload_text", ""),
                        "language": self.state.language,
                    },
                ),
            )
        if event.event_type == "gesture.open_palm":
            return self._switch_language(event)
        if event.event_type in {"gesture.victory", "feature.photo_print"}:
            return self._start_photo_print(event)
        if event.event_type == "photo.captured":
            self.state.photo_state = "processing"
            self.state.active_feature = "photo"
            return ()
        if event.event_type in {
            "photo.completed",
            "photo.capture_failed",
            "photo.print_failed",
        }:
            self.state.photo_state = "idle"
            if self.state.active_feature == "photo":
                self.state.active_feature = (
                    "chat" if self.state.chat_active else None
                )
            return ()
        return ()

    def _start_photo_print(
        self,
        event: PerceptionEvent,
    ) -> tuple[PerceptionEvent, ...]:
        if self.photo_manager is None:
            return (
                self._result(
                    "photo.capture_failed",
                    event,
                    {"reason": "photo_feature_disabled"},
                ),
            )
        schedule = getattr(self.photo_manager, "schedule")
        if not schedule(event):
            return ()
        self.state.photo_state = "countdown"
        return (
            self._command(
                "camera.capture_after",
                event,
                {
                    "delay_ms": int(
                        getattr(self.photo_manager, "delay_seconds") * 1_000
                    )
                },
            ),
        )

    def _start_chat(
        self,
        event: PerceptionEvent,
    ) -> tuple[PerceptionEvent, ...]:
        self.state.chat_active = True
        self.state.chat_session_id = event.session_id
        self.state.active_feature = "chat"
        events = [
            self._command(
                "chat.start",
                event,
                {"language": self.state.language},
            )
        ]
        question = str(event.payload.get("payload_text", "")).strip()
        if question:
            events.append(
                self._command(
                    "chat.ask",
                    event,
                    {
                        "question": question,
                        "language": self.state.language,
                    },
                )
            )
        return tuple(events)

    def _stop_chat(
        self,
        event: PerceptionEvent,
    ) -> tuple[PerceptionEvent, ...]:
        was_active = self.state.chat_active
        self.state.chat_active = False
        self.state.chat_session_id = None
        if self.state.active_feature == "chat":
            self.state.active_feature = None
        if not was_active:
            return ()
        return (self._command("chat.stop", event, {}),)

    def _route_transcript(
        self,
        event: PerceptionEvent,
    ) -> tuple[PerceptionEvent, ...]:
        # A matching keyword has its own event and is routed there. This avoids
        # sending "退出聊天" or "开始聊天" as a normal question as well.
        if event.payload.get("matched_event") is not None:
            return ()
        transcript = str(event.payload.get("transcript", "")).strip()
        if not self.state.chat_active or not transcript:
            return ()
        return (
            self._command(
                "chat.ask",
                event,
                {
                    "question": transcript,
                    "language": self.state.language,
                },
            ),
        )

    def _switch_language(
        self,
        event: PerceptionEvent,
    ) -> tuple[PerceptionEvent, ...]:
        previous = self.state.language
        self.state.language = "en" if previous == "zh" else "zh"
        return (
            self._command(
                "language.set",
                event,
                {"language": self.state.language},
            ),
            self._result(
                "language.changed",
                event,
                {
                    "previous": previous,
                    "current": self.state.language,
                },
            ),
        )

    @staticmethod
    def _command(
        command_type: str,
        trigger: PerceptionEvent,
        parameters: dict[str, object],
    ) -> PerceptionEvent:
        return PerceptionEvent(
            event_type=f"command.{command_type}",
            source="controller",
            session_id=trigger.session_id,
            payload={
                "trigger_event_id": trigger.event_id,
                "command_type": command_type,
                "parameters": parameters,
            },
        )

    @staticmethod
    def _result(
        event_type: str,
        trigger: PerceptionEvent,
        payload: dict[str, object],
    ) -> PerceptionEvent:
        return PerceptionEvent(
            event_type=event_type,
            source="controller",
            session_id=trigger.session_id,
            payload={
                "trigger_event_id": trigger.event_id,
                **payload,
            },
        )

    async def aclose(self) -> None:
        if self.photo_manager is not None:
            await getattr(self.photo_manager, "aclose")()
        if self.llm_session_manager is not None:
            await getattr(self.llm_session_manager, "aclose")()
