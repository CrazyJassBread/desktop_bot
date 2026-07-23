"""OpenAI-compatible structured-output LLM client."""

from __future__ import annotations

import json
import os
from typing import Any

from app.llm.base import LLMBackend, LLMError
from app.llm.prompts import SYSTEM_PROMPT
from app.routing.mode_manager import SessionState
from app.schemas import LLMReply

FALLBACK_TEXT = "暂时无法生成回答，请稍后重试。"


class OpenAICompatibleBackend(LLMBackend):
    """Call an OpenAI-compatible chat completion endpoint."""

    def __init__(
        self,
        *,
        model: str,
        api_key_env: str = "OPENAI_API_KEY",
        base_url: str | None = None,
        timeout_seconds: float = 30,
    ) -> None:
        if not model:
            raise LLMError("llm.model is required for the OpenAI-compatible backend")
        self.model = model
        self.api_key_env = api_key_env
        self.base_url = base_url
        self.timeout_seconds = timeout_seconds
        self._client: Any = None

    def _get_client(self) -> Any:
        """Initialize the API client only for an actual LLM request."""
        if self._client is not None:
            return self._client
        api_key = os.environ.get(self.api_key_env)
        if not api_key:
            raise LLMError(
                f"missing API key environment variable: {self.api_key_env}",
                code="llm_api_key_missing",
            )
        try:
            from openai import AsyncOpenAI
        except ImportError as exc:
            raise LLMError(
                "openai package is not installed",
                code="llm_dependency_missing",
            ) from exc
        self._client = AsyncOpenAI(
            api_key=api_key,
            base_url=self.base_url,
            timeout=self.timeout_seconds,
        )
        return self._client

    async def generate(
        self,
        transcript: str,
        session: SessionState,
        *,
        system_prompt: str | None = None,
        include_history: bool = True,
    ) -> LLMReply:
        messages: list[dict[str, Any]] = [
            {"role": "system", "content": system_prompt or SYSTEM_PROMPT},
        ]
        if include_history:
            messages.extend(session.conversation_history)
        messages.append({"role": "user", "content": transcript})
        try:
            completion = await self._get_client().chat.completions.create(
                model=self.model,
                messages=messages,
                response_format={"type": "json_object"},
            )
            content = completion.choices[0].message.content or ""
        except LLMError:
            raise
        except Exception as exc:
            raise self._classify_request_error(exc) from exc
        return self._parse(content)

    @staticmethod
    def _classify_request_error(exc: Exception) -> LLMError:
        """Map SDK exceptions to stable codes without exposing response bodies."""
        exception_name = type(exc).__name__
        classifications = {
            "AuthenticationError": (
                "llm_authentication_error",
                "LLM authentication failed",
            ),
            "PermissionDeniedError": (
                "llm_permission_denied",
                "LLM permission denied",
            ),
            "NotFoundError": (
                "llm_model_not_found",
                "LLM model or endpoint was not found",
            ),
            "RateLimitError": (
                "llm_rate_limited",
                "LLM rate limit reached",
            ),
            "APITimeoutError": (
                "llm_timeout",
                "LLM request timed out",
            ),
            "APIConnectionError": (
                "llm_connection_error",
                "LLM connection failed",
            ),
            "BadRequestError": (
                "llm_bad_request",
                "LLM rejected the request",
            ),
        }
        code, message = classifications.get(
            exception_name,
            ("llm_request_error", "LLM request failed"),
        )
        return LLMError(message, code=code)

    @staticmethod
    def _parse(content: str) -> LLMReply:
        try:
            value = json.loads(content)
            if not isinstance(value, dict):
                raise ValueError("reply is not an object")
            display = value.get("display_text")
            spoken = value.get("spoken_text")
            emotion = value.get("emotion", "neutral")
            if not isinstance(display, str) or not isinstance(spoken, str):
                raise ValueError("reply text fields must be strings")
            if not isinstance(emotion, str):
                emotion = "neutral"
            return LLMReply(display, spoken, emotion)
        except (json.JSONDecodeError, ValueError, TypeError):
            return LLMReply(FALLBACK_TEXT, FALLBACK_TEXT, "error")
