"""One-shot LLM guide for unmatched command-mode utterances."""

from app.llm.base import LLMBackend
from app.llm.prompts import GUIDE_SYSTEM_PROMPT
from app.routing.mode_manager import SessionState
from app.schemas import LLMReply


class GuideAgent:
    """Answer briefly without entering chat mode or consuming chat history."""

    def __init__(self, backend: LLMBackend) -> None:
        self.backend = backend

    async def answer(
        self,
        transcript: str,
        session: SessionState,
    ) -> LLMReply:
        return await self.backend.generate(
            transcript,
            session,
            system_prompt=GUIDE_SYSTEM_PROMPT,
            include_history=False,
        )
