"""Service interface used by the multi-service runtime."""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field

from app.core.events import BotEvent
from app.core.state import BotState
from app.schemas import DeviceAction


@dataclass
class ServiceResult:
    handled: bool
    display_text: str = ""
    spoken_text: str = ""
    actions: list[DeviceAction] = field(default_factory=list)
    state_changes: dict[str, object] = field(default_factory=dict)
    metadata: dict[str, object] = field(default_factory=dict)


class BotService(ABC):
    service_id: str
    priority: int = 100

    @abstractmethod
    def can_handle(self, event: BotEvent, state: BotState) -> bool:
        raise NotImplementedError

    @abstractmethod
    async def handle(self, event: BotEvent, state: BotState) -> ServiceResult:
        raise NotImplementedError
