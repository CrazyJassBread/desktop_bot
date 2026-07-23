"""Transport-neutral response adapter contract."""

from abc import ABC, abstractmethod

from app.schemas import AssistantResponse, VisionResponse

BotResponse = AssistantResponse | VisionResponse


class OutputAdapter(ABC):
    @abstractmethod
    async def send_response(self, response: BotResponse) -> None:
        raise NotImplementedError
