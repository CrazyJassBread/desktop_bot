"""OpenAI Whisper API ASR backend."""

from __future__ import annotations

import io
import logging
import os
import struct

import httpx
import numpy as np

from app.asr.base import ASRBackend, ASRError
from app.models import AudioData

LOGGER = logging.getLogger("desktop_assistant.asr.openai_whisper")
_TRANSCRIPTION_URL = "https://api.openai.com/v1/audio/transcriptions"


class OpenAIWhisperBackend(ASRBackend):
    """Transcribe audio via the OpenAI Whisper REST API.

    PCM *s16le 16 kHz mono* samples are wrapped in a minimal WAV container
    before being POSTed as a ``multipart/form-data`` file upload.
    """

    def __init__(self, model: str = "whisper-1") -> None:
        self.model = model
        self._api_key = os.environ.get("OPENAI_API_KEY", "")
        if not self._api_key:
            raise ASRError("OPENAI_API_KEY environment variable is not set")

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _pcm_to_wav(samples: np.ndarray, sample_rate: int) -> bytes:
        """Convert a 1-D float32 numpy array to an in-memory WAV byte string."""
        pcm16 = np.clip(samples, -1.0, 1.0)
        pcm16 = (pcm16 * 32767).astype("<i2")
        raw = pcm16.tobytes()
        data_size = len(raw)
        buf = io.BytesIO()
        # -- RIFF header --
        buf.write(b"RIFF")
        buf.write(struct.pack("<I", 36 + data_size))
        buf.write(b"WAVE")
        # -- fmt sub-chunk --
        buf.write(b"fmt ")
        buf.write(struct.pack("<I", 16))  # sub-chunk size
        buf.write(struct.pack("<H", 1))  # PCM
        buf.write(struct.pack("<H", 1))  # mono
        buf.write(struct.pack("<I", sample_rate))
        buf.write(struct.pack("<I", sample_rate * 2))  # byte rate
        buf.write(struct.pack("<H", 2))  # block align
        buf.write(struct.pack("<H", 16))  # bits per sample
        # -- data sub-chunk --
        buf.write(b"data")
        buf.write(struct.pack("<I", data_size))
        buf.write(raw)
        return buf.getvalue()

    # ------------------------------------------------------------------
    # Public interface
    # ------------------------------------------------------------------

    async def transcribe(self, audio: AudioData) -> str:
        wav_bytes = self._pcm_to_wav(audio.samples, audio.sample_rate)

        headers = {"Authorization": f"Bearer {self._api_key}"}
        files = {"file": ("audio.wav", wav_bytes, "audio/wav")}
        data = {"model": self.model}

        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.post(
                    _TRANSCRIPTION_URL,
                    headers=headers,
                    files=files,
                    data=data,
                )
                response.raise_for_status()
                result = response.json()
                return result.get("text", "").strip()
        except httpx.HTTPStatusError as exc:
            LOGGER.error(
                "OpenAI Whisper API HTTP error %s: %s",
                exc.response.status_code,
                exc.response.text[:500],
            )
            return ""
        except Exception:
            LOGGER.exception("OpenAI Whisper API request failed")
            return ""
