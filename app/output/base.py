"""Transport-neutral response adapter contract."""

from abc import ABC, abstractmethod

from app.schemas import AssistantResponse


class OutputAdapter(ABC):
    @abstractmethod
    async def send_response(self, response: AssistantResponse) -> None:
        raise NotImplementedError

