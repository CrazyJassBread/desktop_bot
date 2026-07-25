"""OpenAI-compatible HTTP speech-to-text backend."""

from __future__ import annotations

import io
import os
import wave

import aiohttp
import numpy as np

from app.asr.base import ASRBackend, ASRError
from app.config import ASRConfig
from app.models import AudioData


class OpenAIHTTPASRBackend(ASRBackend):
    def __init__(self, config: ASRConfig) -> None:
        self.base_url = (
            os.environ.get(config.base_url_env, "").strip()
            or config.base_url.strip()
        ).rstrip("/")
        self.api_key = os.environ.get(config.api_key_env, "").strip()
        self.model = (
            os.environ.get(config.model_env, "").strip()
            or config.model.strip()
        )
        self.endpoint = config.endpoint
        self.language = config.language
        self.timeout = aiohttp.ClientTimeout(total=config.timeout_seconds)
        if not self.base_url:
            raise ASRError(f"{config.base_url_env} is required")
        if not self.api_key:
            raise ASRError(f"{config.api_key_env} is required")
        if not self.model:
            raise ASRError("ASR model cannot be empty")

    @staticmethod
    def _wav_bytes(audio: AudioData) -> bytes:
        samples = np.clip(audio.samples, -1.0, 1.0)
        pcm = (samples * 32767.0).astype("<i2")
        output = io.BytesIO()
        with wave.open(output, "wb") as wav_file:
            wav_file.setnchannels(1)
            wav_file.setsampwidth(2)
            wav_file.setframerate(audio.sample_rate)
            wav_file.writeframes(pcm.tobytes())
        return output.getvalue()

    async def transcribe(self, audio: AudioData) -> str:
        form = aiohttp.FormData()
        form.add_field("model", self.model)
        if self.language:
            form.add_field("language", self.language)
        form.add_field(
            "file",
            self._wav_bytes(audio),
            filename="utterance.wav",
            content_type="audio/wav",
        )
        try:
            async with aiohttp.ClientSession(timeout=self.timeout) as session:
                async with session.post(
                    f"{self.base_url}{self.endpoint}",
                    data=form,
                    headers={"Authorization": f"Bearer {self.api_key}"},
                ) as response:
                    if response.status >= 400:
                        raise ASRError(f"http_{response.status}")
                    payload = await response.json()
        except ASRError:
            raise
        except TimeoutError as exc:
            raise ASRError("request_timeout") from exc
        except (aiohttp.ClientError, ValueError) as exc:
            raise ASRError("connection_or_response_error") from exc
        text = payload.get("text") if isinstance(payload, dict) else None
        if not isinstance(text, str) or not text.strip():
            raise ASRError("invalid_response")
        return text.strip()
