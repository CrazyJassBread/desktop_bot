"""Voice-driven LLM sessions and OpenAI-compatible integration."""

from app.llm.client import LLMError, OpenAICompatibleClient
from app.llm.mode_detector import LLMModeDetector

__all__ = [
    "LLMError",
    "LLMModeDetector",
    "OpenAICompatibleClient",
]
