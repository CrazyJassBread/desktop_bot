"""Coordinate global gestures, service context, and session modes."""

from __future__ import annotations

from app.core.events import BotEvent
from app.core.service import ServiceResult
from app.core.service_registry import ServiceRegistry
from app.core.state import BotStateManager
from app.schemas import DeviceAction, InteractionMode


class InteractionCoordinator:
    def __init__(
        self,
        state_manager: BotStateManager,
        services: ServiceRegistry,
    ) -> None:
        self.state_manager = state_manager
        self.services = services

    async def handle_stable_gesture(
        self,
        session_id: str,
        label: str,
        score: float,
    ) -> ServiceResult:
        state = self.state_manager.get(session_id)
        if label == "Victory":
            mode = self.state_manager.toggle_voice_mode(session_id)
            mode_name = "智能问答" if mode == InteractionMode.LLM else "固定功能"
            return ServiceResult(
                handled=True,
                display_text=f"已切换到{mode_name}模式。",
                spoken_text=f"已切换到{mode_name}模式。",
                actions=[
                    DeviceAction(
                        "ui.show_mode",
                        {"mode": mode.value, "session_id": session_id},
                    )
                ],
                state_changes={"voice_mode": mode.value},
            )

        return await self.services.dispatch(
            BotEvent(
                "gesture.stable",
                session_id,
                {"label": label, "score": score},
            ),
            state,
        )

    async def handle_transcript(
        self, session_id: str, transcript: str
    ) -> ServiceResult:
        return await self.services.dispatch(
            BotEvent(
                "transcript.ready",
                session_id,
                {"transcript": transcript},
            ),
            self.state_manager.get(session_id),
        )
