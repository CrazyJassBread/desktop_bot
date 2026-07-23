"""Optional Bot services registered with the runtime."""

from app.services.runner_game_service import RunnerGameService
from app.services.time_service import TimeService

__all__ = ["RunnerGameService", "TimeService"]
