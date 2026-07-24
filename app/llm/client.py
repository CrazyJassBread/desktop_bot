"""OpenAI-compatible non-streaming chat completion client."""

from __future__ import annotations

import asyncio
import json
import os
import socket
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from app.config import LLMConfig


class LLMError(RuntimeError):
    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


class OpenAICompatibleClient:
    def __init__(
        self,
        *,
        base_url: str,
        api_key_env: str,
        model: str,
        timeout_seconds: float,
        temperature: float,
        max_output_tokens: int,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.api_key_env = api_key_env
        self.model = model
        self.timeout_seconds = timeout_seconds
        self.temperature = temperature
        self.max_output_tokens = max_output_tokens

    @classmethod
    def from_config(cls, config: LLMConfig) -> "OpenAICompatibleClient":
        return cls(
            base_url=config.base_url,
            api_key_env=config.api_key_env,
            model=config.model,
            timeout_seconds=config.timeout_seconds,
            temperature=config.temperature,
            max_output_tokens=config.max_output_tokens,
        )

    async def complete(
        self,
        *,
        system_prompt: str,
        user_prompt: str,
    ) -> str:
        api_key = os.environ.get(self.api_key_env, "").strip()
        if not api_key:
            raise LLMError("api_key_missing")
        return await asyncio.to_thread(
            self._complete_sync,
            api_key,
            system_prompt,
            user_prompt,
        )

    def _complete_sync(
        self,
        api_key: str,
        system_prompt: str,
        user_prompt: str,
    ) -> str:
        body = json.dumps(
            {
                "model": self.model,
                "temperature": self.temperature,
                "max_tokens": self.max_output_tokens,
                "stream": False,
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
            },
            ensure_ascii=False,
        ).encode("utf-8")
        request = Request(
            f"{self.base_url}/chat/completions",
            data=body,
            method="POST",
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
        )
        try:
            with urlopen(request, timeout=self.timeout_seconds) as response:
                response_body = response.read()
        except HTTPError as exc:
            raise LLMError("http_error") from exc
        except (socket.timeout, TimeoutError) as exc:
            raise LLMError("request_timeout") from exc
        except URLError as exc:
            reason = (
                "request_timeout"
                if isinstance(exc.reason, (socket.timeout, TimeoutError))
                else "connection_error"
            )
            raise LLMError(reason) from exc
        except OSError as exc:
            raise LLMError("connection_error") from exc

        try:
            parsed = json.loads(response_body)
            content = parsed["choices"][0]["message"]["content"]
        except (
            json.JSONDecodeError,
            UnicodeDecodeError,
            KeyError,
            IndexError,
            TypeError,
        ) as exc:
            raise LLMError("invalid_response") from exc
        if not isinstance(content, str) or not content.strip():
            raise LLMError("invalid_response")
        return content.strip()
