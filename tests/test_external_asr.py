from __future__ import annotations

import io
import wave

import numpy as np
import pytest
from aiohttp import web

from app.asr.base import ASRError
from app.asr.openai_http_backend import OpenAIHTTPASRBackend
from app.audio.vad.energy_backend import EnergyVADBackend
from app.config import ASRConfig
from app.models import AudioData


def test_external_asr_requires_credentials(monkeypatch):
    monkeypatch.delenv("AI_BOT_ASR_BASE_URL", raising=False)
    monkeypatch.delenv("AI_BOT_ASR_API_KEY", raising=False)

    with pytest.raises(ASRError):
        OpenAIHTTPASRBackend(ASRConfig(backend="openai_http"))


def test_external_asr_encodes_standard_pcm_wav():
    audio = AudioData(
        samples=np.array([-1.0, 0.0, 1.0], dtype=np.float32),
        sample_rate=16_000,
        duration_seconds=3 / 16_000,
    )

    encoded = OpenAIHTTPASRBackend._wav_bytes(audio)

    with wave.open(io.BytesIO(encoded), "rb") as result:
        assert result.getnchannels() == 1
        assert result.getsampwidth() == 2
        assert result.getframerate() == 16_000
        assert result.getnframes() == 3


@pytest.mark.asyncio
async def test_energy_vad_maps_noise_and_speech_to_probability():
    backend = EnergyVADBackend(noise_floor=0.01, speech_level=0.05)

    silence = await backend.speech_probability(
        np.full(512, 0.005, dtype=np.float32),
        16_000,
    )
    speech = await backend.speech_probability(
        np.full(512, 0.06, dtype=np.float32),
        16_000,
    )

    assert silence == 0.0
    assert speech == 1.0


@pytest.mark.asyncio
async def test_external_asr_posts_openai_compatible_multipart(
    monkeypatch,
    unused_tcp_port,
):
    received: dict[str, object] = {}

    async def transcriptions(request):
        received["authorization"] = request.headers.get("Authorization")
        reader = await request.multipart()
        fields: dict[str, object] = {}
        while part := await reader.next():
            if part.name == "file":
                fields["filename"] = part.filename
                fields["file"] = await part.read()
            else:
                fields[str(part.name)] = await part.text()
        received["fields"] = fields
        return web.json_response({"text": "识别完成"})

    application = web.Application()
    application.router.add_post("/v1/audio/transcriptions", transcriptions)
    runner = web.AppRunner(application)
    await runner.setup()
    site = web.TCPSite(runner, "127.0.0.1", unused_tcp_port)
    await site.start()
    monkeypatch.setenv(
        "AI_BOT_ASR_BASE_URL",
        f"http://127.0.0.1:{unused_tcp_port}/v1",
    )
    monkeypatch.setenv("AI_BOT_ASR_API_KEY", "asr-secret")
    try:
        backend = OpenAIHTTPASRBackend(
            ASRConfig(backend="openai_http", model="whisper-test")
        )
        result = await backend.transcribe(
            AudioData(
                samples=np.zeros(512, dtype=np.float32),
                sample_rate=16_000,
                duration_seconds=0.032,
            )
        )
    finally:
        await runner.cleanup()

    assert result == "识别完成"
    assert received["authorization"] == "Bearer asr-secret"
    fields = received["fields"]
    assert isinstance(fields, dict)
    assert fields["model"] == "whisper-test"
    assert fields["language"] == "zh"
    assert fields["filename"] == "utterance.wav"
    assert bytes(fields["file"]).startswith(b"RIFF")
