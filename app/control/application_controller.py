"""Interpret perception events using the current application state."""

from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Awaitable, Callable

from app.perception_events import PerceptionEvent

EventEmitter = Callable[[PerceptionEvent], Awaitable[None]]
LanguageListener = Callable[[str], None]


@dataclass
class AppState:
    language: str = "zh"
    chat_active: bool = False
    chat_session_id: str | None = None
    photo_state: str = "idle"
    active_feature: str | None = None
    llm_mode: str | None = None

    def to_dict(self) -> dict[str, object]:
        return asdict(self)


class ApplicationController:
    def __init__(
        self,
        *,
        default_language: str = "zh",
        photo_manager: object | None = None,
        llm_manager: object | None = None,
        language_listener: LanguageListener | None = None,
    ) -> None:
        self.state = AppState(language=default_language)
        self.photo_manager = photo_manager
        self.llm_manager = llm_manager
        self.language_listener = language_listener
        self._emit: EventEmitter | None = None

    def set_event_emitter(self, emitter: EventEmitter) -> None:
        self._emit = emitter
        if self.photo_manager is not None:
            set_emitter = getattr(self.photo_manager, "set_event_emitter")
            set_emitter(emitter)
        if self.llm_manager is not None:
            set_emitter = getattr(self.llm_manager, "set_event_emitter")
            set_emitter(emitter)

    async def handle(
        self,
        event: PerceptionEvent,
    ) -> tuple[PerceptionEvent, ...]:
        if event.event_type.startswith("llm."):
            return self._track_llm_state(event)
        if self._llm_session_active():
            consumed = await self._route_to_llm_session(event)
            if consumed:
                return ()
        if event.event_type in {"wake", "mode.enter_chat"}:
            return self._start_chat(event)
        if event.event_type == "mode.exit_chat":
            return self._stop_chat(event)
        if event.event_type == "speech.transcribed":
            return self._route_transcript(event)
        if event.event_type == "feature.write_letter":
            return await self._start_llm_session("letter", event)
        if event.event_type == "feature.start_qa":
            return await self._start_llm_session("qa", event)
        if event.event_type in {"feature.end_letter", "feature.end_qa"}:
            # There is no active dictation session to end.
            return ()
        if event.event_type == "feature.take_photo":
            return self._take_photo_by_voice(event)
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
        if event.event_type == "mode.switch_english":
            return self._set_language("en", event)
        if event.event_type == "mode.switch_chinese":
            return self._set_language("zh", event)
        if event.event_type == "gesture.open_palm":
            return self._switch_language(event)
        if event.event_type == "gesture.victory":
            if self.photo_manager is None:
                return (
                    self._result(
                        "photo.capture_failed",
                        event,
                        {"reason": "photo_feature_disabled"},
                    ),
                )
            schedule = getattr(self.photo_manager, "schedule")
            started = schedule(event)
            if not started:
                return ()
            self.state.photo_state = "countdown"
            return (
                self._command(
                    "camera.capture_after",
                    event,
                    {
                        "delay_ms": int(
                            getattr(self.photo_manager, "delay_seconds") * 1000
                        )
                    },
                ),
            )
        if event.event_type == "photo.captured":
            self.state.photo_state = "processing"
            self.state.active_feature = "photo"
            return ()
        if event.event_type in {"photo.completed", "photo.capture_failed"}:
            self.state.photo_state = "idle"
            if self.state.active_feature == "photo":
                self.state.active_feature = (
                    "chat" if self.state.chat_active else None
                )
            return ()
        return ()

    def _take_photo_by_voice(
        self,
        event: PerceptionEvent,
    ) -> tuple[PerceptionEvent, ...]:
        """Capture the camera frame shortly after the keyword and print it."""
        if self.photo_manager is None:
            return (
                self._result(
                    "photo.capture_failed",
                    event,
                    {"reason": "photo_feature_disabled"},
                ),
            )
        delay_seconds = float(
            getattr(self.photo_manager, "voice_delay_seconds")
        )
        schedule = getattr(self.photo_manager, "schedule")
        started = schedule(
            event,
            delay_seconds=delay_seconds,
            print_photo=True,
        )
        if not started:
            return ()
        self.state.photo_state = "countdown"
        return (
            self._command(
                "camera.capture_after",
                event,
                {"delay_ms": int(delay_seconds * 1000)},
            ),
        )

    def _llm_session_active(self) -> bool:
        return self.llm_manager is not None and bool(
            getattr(self.llm_manager, "active")
        )

    async def _start_llm_session(
        self,
        mode: str,
        event: PerceptionEvent,
    ) -> tuple[PerceptionEvent, ...]:
        initial_text = str(event.payload.get("payload_text", ""))
        if self.llm_manager is None:
            if mode == "letter":
                # Degraded mode without an LLM: forward the dictated text as-is.
                return (
                    self._command(
                        "letter.compose",
                        event,
                        {"content": initial_text},
                    ),
                )
            return ()
        await getattr(self.llm_manager, "start")(
            mode,
            event,
            initial_text,
            language=self.state.language,
        )
        self.state.llm_mode = getattr(self.llm_manager, "mode")
        return ()

    async def _route_to_llm_session(self, event: PerceptionEvent) -> bool:
        """Feed speech into the active dictation session. Returns True when consumed."""
        assert self.llm_manager is not None
        mode = getattr(self.llm_manager, "mode")
        end_event = (
            "feature.end_letter" if mode == "letter" else "feature.end_qa"
        )
        if event.event_type == end_event:
            await getattr(self.llm_manager, "finish")(
                final_text=str(event.payload.get("payload_text", "")),
                reason="end_keyword",
            )
            return True
        if event.event_type == "speech.transcribed":
            if event.payload.get("matched_event") is None:
                await getattr(self.llm_manager, "add_transcript")(
                    str(event.payload.get("transcript", ""))
                )
            return True
        spoken_intents = {
            "wake",
            "mode.enter_chat",
            "mode.exit_chat",
            "mode.switch_english",
            "mode.switch_chinese",
            "feature.write_letter",
            "feature.start_qa",
            "feature.end_letter",
            "feature.end_qa",
            "feature.take_photo",
        }
        if event.event_type in spoken_intents or event.event_type.startswith(
            "intent."
        ):
            # Any other spoken command counts as dictated content.
            await getattr(self.llm_manager, "add_transcript")(
                str(event.payload.get("transcript", ""))
            )
            return True
        return False

    def _track_llm_state(
        self,
        event: PerceptionEvent,
    ) -> tuple[PerceptionEvent, ...]:
        if event.event_type == "llm.session_started":
            mode = event.payload.get("mode")
            self.state.llm_mode = str(mode) if mode else None
            self.state.active_feature = "llm"
        elif event.event_type in {
            "llm.letter_completed",
            "llm.answer_completed",
            "llm.failed",
        }:
            self.state.llm_mode = None
            if self.state.active_feature == "llm":
                self.state.active_feature = (
                    "chat" if self.state.chat_active else None
                )
        return ()

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
        target = "en" if self.state.language == "zh" else "zh"
        return self._set_language(target, event)

    def _set_language(
        self,
        target: str,
        event: PerceptionEvent,
    ) -> tuple[PerceptionEvent, ...]:
        previous = self.state.language
        if target == previous:
            return ()
        self.state.language = target
        if self.language_listener is not None:
            # Keep downstream consumers (such as the ASR backend) in sync.
            self.language_listener(target)
        return (
            self._command(
                "language.set",
                event,
                {"language": target},
            ),
            self._result(
                "language.changed",
                event,
                {
                    "previous": previous,
                    "current": target,
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
        if self.llm_manager is not None:
            await getattr(self.llm_manager, "aclose")()
