"""Conversation-history helpers."""

from app.routing.mode_manager import SessionState


def append_turn(
    session: SessionState,
    user_text: str,
    assistant_text: str,
    max_turns: int,
) -> None:
    """Append one turn and retain the most recent configured number of turns."""
    session.conversation_history.extend(
        (
            {"role": "user", "content": user_text},
            {"role": "assistant", "content": assistant_text},
        )
    )
    del session.conversation_history[: -max_turns * 2]

