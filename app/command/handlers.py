"""Convert command matches to device-action descriptions."""

from __future__ import annotations

from app.command.definitions import CommandDefinition
from app.routing.mode_manager import ModeManager, SessionState
from app.schemas import AssistantResponse, InteractionMode


def handle_command(
    definition: CommandDefinition,
    transcript: str,
    session: SessionState,
    mode_manager: ModeManager,
    metadata: dict[str, object],
) -> AssistantResponse:
    """Apply state-only effects and return, but never operate real hardware."""
    action = definition.action
    response_text = definition.response
    if action == "mode.enter_llm":
        mode_manager.enter_llm(session.session_id)
    elif action == "mode.exit_llm":
        mode_manager.exit_llm(session.session_id)
    elif action == "printer.print_last_response":
        if session.last_assistant_response:
            metadata["print_content"] = session.last_assistant_response
        else:
            action = None
            response_text = "目前没有可以打印的回答。"

    return AssistantResponse(
        success=True,
        mode=InteractionMode.COMMAND.value,
        transcript=transcript,
        display_text=response_text,
        spoken_text=response_text,
        emotion=definition.emotion,
        action=action,
        metadata=metadata,
    )

