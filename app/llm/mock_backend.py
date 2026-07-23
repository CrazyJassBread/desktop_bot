"""Deterministic LLM backend used by tests and offline demos."""

from app.llm.base import LLMBackend
from app.llm.prompts import GUIDE_SYSTEM_PROMPT
from app.routing.mode_manager import SessionState
from app.schemas import LLMReply


class MockLLMBackend(LLMBackend):
    def __init__(self) -> None:
        self.call_count = 0
        self.guide_call_count = 0
        self.last_system_prompt: str | None = None
        self.last_include_history = True

    async def generate(
        self,
        transcript: str,
        session: SessionState,
        *,
        system_prompt: str | None = None,
        include_history: bool = True,
    ) -> LLMReply:
        self.call_count += 1
        self.last_system_prompt = system_prompt
        self.last_include_history = include_history
        if system_prompt == GUIDE_SYSTEM_PROMPT:
            self.guide_call_count += 1
        if "强化学习" in transcript:
            return LLMReply(
                display_text="强化学习通过与环境交互，根据奖励学习决策策略。",
                spoken_text="强化学习通过与环境交互，根据奖励学习如何做出更好的决策。",
                emotion="explaining",
            )
        return LLMReply(
            display_text=f"这是对“{transcript}”的简短回答。",
            spoken_text=f"这是对“{transcript}”的简短回答。",
            emotion="neutral",
        )
