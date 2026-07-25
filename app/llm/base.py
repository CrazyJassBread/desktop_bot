"""LLM backend contract."""

from abc import ABC, abstractmethod


class LLMError(Exception):
    """Unified LLM completion failure."""


class LLMBackend(ABC):
    @abstractmethod
    async def complete(self, system_prompt: str, user_text: str) -> str:
        raise NotImplementedError

    async def aclose(self) -> None:
        return None
