"""Priority-ordered Bot service registry."""

from __future__ import annotations

from app.core.events import BotEvent
from app.core.service import BotService, ServiceResult
from app.core.state import BotState


class ServiceRegistry:
    def __init__(self) -> None:
        self._services: dict[str, BotService] = {}

    def register(self, service: BotService) -> None:
        if service.service_id in self._services:
            raise ValueError(f"service already registered: {service.service_id}")
        self._services[service.service_id] = service

    def get(self, service_id: str) -> BotService | None:
        return self._services.get(service_id)

    async def dispatch(self, event: BotEvent, state: BotState) -> ServiceResult:
        services = sorted(self._services.values(), key=lambda item: item.priority)
        for service in services:
            if service.can_handle(event, state):
                return await service.handle(event, state)
        return ServiceResult(handled=False)

    @property
    def service_ids(self) -> tuple[str, ...]:
        return tuple(self._services)
