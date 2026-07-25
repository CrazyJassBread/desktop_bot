"""OpenAI-compatible chat completion client for DeepSeek."""

from __future__ import annotations

import os

import aiohttp

from app.llm.base import LLMBackend, LLMError


class DeepSeekBackend(LLMBackend):
    def __init__(
        self,
        *,
        base_url: str = "https://api.deepseek.com",
        model: str = "deepseek-v4-flash",
        api_key: str = "",
        api_key_env: str = "DEEPSEEK_API_KEY",
        temperature: float = 1.0,
        max_tokens: int = 900,
        timeout_seconds: float = 40.0,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.model = model
        self.api_key = api_key.strip()
        self.api_key_env = api_key_env
        self.temperature = temperature
        self.max_tokens = max_tokens
        self.timeout_seconds = timeout_seconds
        self._session: aiohttp.ClientSession | None = None

    def _get_session(self) -> aiohttp.ClientSession:
        if self._session is None or self._session.closed:
            self._session = aiohttp.ClientSession(
                timeout=aiohttp.ClientTimeout(total=self.timeout_seconds)
            )
        return self._session

    def _resolve_api_key(self) -> str:
        # An explicit key from the configuration wins over the environment.
        if self.api_key:
            return self.api_key
        api_key = os.environ.get(self.api_key_env, "").strip()
        if not api_key:
            raise LLMError(
                "no API key configured: set llm.api_key or the "
                f"environment variable {self.api_key_env}"
            )
        return api_key

    async def complete(self, system_prompt: str, user_text: str) -> str:
        api_key = self._resolve_api_key()
        payload = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_text},
            ],
            "temperature": self.temperature,
            "max_tokens": self.max_tokens,
            "stream": False,
        }
        try:
            async with self._get_session().post(
                f"{self.base_url}/chat/completions",
                json=payload,
                headers={"Authorization": f"Bearer {api_key}"},
            ) as response:
                body = await response.json(content_type=None)
                if response.status != 200:
                    message = (
                        body.get("error", {}).get("message", "")
                        if isinstance(body, dict)
                        else ""
                    )
                    raise LLMError(
                        f"LLM request failed with {response.status}: {message}"
                    )
        except aiohttp.ClientError as exc:
            raise LLMError(f"unable to reach the LLM service: {exc}") from exc
        except TimeoutError as exc:
            raise LLMError("LLM request timed out") from exc
        try:
            content = body["choices"][0]["message"]["content"]
        except (KeyError, IndexError, TypeError) as exc:
            raise LLMError("LLM returned a malformed response") from exc
        text = str(content or "").strip()
        if not text:
            raise LLMError("LLM returned an empty response")
        return text

    async def aclose(self) -> None:
        if self._session is not None and not self._session.closed:
            await self._session.close()
