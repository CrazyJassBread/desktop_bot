"""Language-model backend contract."""

from abc import ABC, abstractmethod

from app.routing.mode_manager import SessionState
from app.schemas import LLMReply


class LLMError(Exception):
    """Unified language-model service failure."""

    def __init__(
        self,
        message: str = "LLM operation failed",
        *,
        code: str = "llm_error",
    ) -> None:
        self.code = code
        super().__init__(message)


class LLMBackend(ABC):
    @abstractmethod
    async def generate(
        self,
        transcript: str,
        session: SessionState,
        *,
        system_prompt: str | None = None,
        include_history: bool = True,
    ) -> LLMReply:
        raise NotImplementedError
