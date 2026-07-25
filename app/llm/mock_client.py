"""Deterministic LLM backend for tests and offline demos."""

from __future__ import annotations

from app.llm.base import LLMBackend


class MockLLMBackend(LLMBackend):
    def __init__(self, template: str = "[mock:{prompt_head}] {text}") -> None:
        self.template = template
        self.calls: list[tuple[str, str]] = []

    async def complete(self, system_prompt: str, user_text: str) -> str:
        self.calls.append((system_prompt, user_text))
        return self.template.format(
            prompt_head=system_prompt[:8],
            text=user_text,
        )
