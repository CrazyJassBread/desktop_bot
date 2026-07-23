"""Session-scoped state shared by services and input pipelines."""

from __future__ import annotations

from dataclasses import dataclass

from app.routing.mode_manager import ModeManager
from app.schemas import InteractionMode


@dataclass
class BotState:
    session_id: str
    active_service: str = "home"
    game_running: bool = False
    audio_busy: bool = False


class BotStateManager:
    def __init__(self, mode_manager: ModeManager | None = None) -> None:
        self.mode_manager = mode_manager or ModeManager()
        self._states: dict[str, BotState] = {}

    def get(self, session_id: str) -> BotState:
        if not session_id or not session_id.strip():
            raise ValueError("session_id cannot be empty")
        self.mode_manager.get_session(session_id)
        return self._states.setdefault(session_id, BotState(session_id))

    def voice_mode(self, session_id: str) -> InteractionMode:
        return self.mode_manager.get_session(session_id).mode

    def toggle_voice_mode(self, session_id: str) -> InteractionMode:
        if self.voice_mode(session_id) == InteractionMode.LLM:
            self.mode_manager.exit_llm(session_id)
            return InteractionMode.COMMAND
        self.mode_manager.enter_llm(session_id)
        return InteractionMode.LLM
