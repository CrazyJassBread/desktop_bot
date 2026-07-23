"""In-memory, session-isolated interaction state."""

from __future__ import annotations

from dataclasses import dataclass, field

from app.schemas import InteractionMode


@dataclass
class SessionState:
    session_id: str
    mode: InteractionMode = InteractionMode.COMMAND
    conversation_history: list[dict[str, str]] = field(default_factory=list)
    last_assistant_response: str | None = None


class ModeManager:
    """Own session state without relying on module-level mutable storage."""

    def __init__(self, default_mode: InteractionMode = InteractionMode.COMMAND) -> None:
        self.default_mode = default_mode
        self._sessions: dict[str, SessionState] = {}

    def get_session(self, session_id: str) -> SessionState:
        if not session_id or not session_id.strip():
            raise ValueError("session_id cannot be empty")
        return self._sessions.setdefault(
            session_id,
            SessionState(session_id=session_id, mode=self.default_mode),
        )

    def enter_llm(self, session_id: str) -> SessionState:
        session = self.get_session(session_id)
        session.mode = InteractionMode.LLM
        return session

    def exit_llm(self, session_id: str) -> SessionState:
        session = self.get_session(session_id)
        session.mode = InteractionMode.COMMAND
        self.clear_history(session_id)
        return session

    def clear_history(self, session_id: str) -> None:
        self.get_session(session_id).conversation_history.clear()

