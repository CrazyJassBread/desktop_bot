"""Shared events, actions, state, and service contracts."""

from app.core.events import BotEvent
from app.core.service import BotService, ServiceResult
from app.core.state import BotState, BotStateManager

__all__ = [
    "BotEvent",
    "BotService",
    "BotState",
    "BotStateManager",
    "ServiceResult",
]
