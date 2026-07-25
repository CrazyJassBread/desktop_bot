"""Route the three supported product flows."""

from __future__ import annotations

from dataclasses import asdict, dataclass, replace
from typing import Awaitable, Callable

from app.perception_events import PerceptionEvent

EventEmitter = Callable[[PerceptionEvent], Awaitable[None]]
OwnerResolver = Callable[[], Awaitable[dict[str, str] | None]]


@dataclass
class AppState:
    photo_state: str = "idle"

    def to_dict(self) -> dict[str, object]:
        return asdict(self)


class ApplicationController:
    def __init__(
        self,
        *,
        photo_manager: object | None = None,
        llm_session_manager: object | None = None,
        letter_manager: object | None = None,
        web_letter_manager: object | None = None,
        letter_owner_resolver: OwnerResolver | None = None,
        llm_unavailable_reason: str | None = None,
    ) -> None:
        self.state = AppState()
        self.photo_manager = photo_manager
        self.llm_session_manager = llm_session_manager
        self.letter_manager = letter_manager
        self.web_letter_manager = web_letter_manager
        self.letter_owner_resolver = letter_owner_resolver
        self.llm_unavailable_reason = llm_unavailable_reason
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
        if self.letter_manager is not None:
            set_emitter = getattr(self.letter_manager, "set_event_emitter")
            set_emitter(emitter)
        if self.web_letter_manager is not None:
            set_emitter = getattr(
                self.web_letter_manager,
                "set_event_emitter",
            )
            set_emitter(emitter)

    async def handle(
        self,
        event: PerceptionEvent,
    ) -> tuple[PerceptionEvent, ...]:
        if event.event_type in {"llm.letter.start", "llm.qa.start"}:
            if self.llm_session_manager is not None:
                if (
                    event.event_type == "llm.letter.start"
                    and self.letter_owner_resolver is not None
                ):
                    try:
                        owner = await self.letter_owner_resolver()
                    except Exception:
                        return (
                            self._result(
                                "llm.session_rejected",
                                event,
                                {
                                    "mode": "letter",
                                    "reason": "user_identity_unavailable",
                                },
                            ),
                        )
                    if owner is None:
                        return (
                            self._result(
                                "llm.session_rejected",
                                event,
                                {
                                    "mode": "letter",
                                    "reason": "user_not_bound",
                                },
                            ),
                        )
                    event = replace(
                        event,
                        payload={
                            **event.payload,
                            "owner_user_id": owner["id"],
                            "owner_email": owner["email"],
                            "owner_display_name": owner["displayName"],
                        },
                    )
                events = await getattr(
                    self.llm_session_manager,
                    "handle",
                )(event)
                self._schedule_completed_letters(events)
                return events
            mode = (
                "letter"
                if event.event_type == "llm.letter.start"
                else "qa"
            )
            return (
                self._result(
                    "llm.session_rejected",
                    event,
                    {
                        "mode": mode,
                        "reason": self.llm_unavailable_reason or "disabled",
                    },
                ),
            )
        if self.llm_session_manager is not None:
            if event.event_type == "speech.transcribed":
                events = await getattr(
                    self.llm_session_manager,
                    "handle",
                )(event)
                self._schedule_completed_letters(events)
                return events
            if (
                getattr(self.llm_session_manager, "active")
                and event.source == "audio"
            ):
                return ()
        if event.event_type in {"gesture.victory", "feature.photo_print"}:
            return self._start_photo_print(event)
        if event.event_type == "photo.captured":
            self.state.photo_state = "processing"
            return ()
        if event.event_type in {
            "photo.completed",
            "photo.capture_failed",
            "photo.print_failed",
        }:
            self.state.photo_state = "idle"
            return ()
        return ()

    def _schedule_completed_letters(
        self,
        events: tuple[PerceptionEvent, ...],
    ) -> None:
        for item in events:
            if item.event_type == "llm.letter_completed":
                if self.letter_manager is not None:
                    getattr(self.letter_manager, "schedule")(item)
                if self.web_letter_manager is not None:
                    getattr(self.web_letter_manager, "schedule")(item)

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
        if self.letter_manager is not None:
            await getattr(self.letter_manager, "aclose")()
        if self.web_letter_manager is not None:
            await getattr(self.web_letter_manager, "aclose")()
