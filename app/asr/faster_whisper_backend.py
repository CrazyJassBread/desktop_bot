"""Optional local ASR using faster-whisper."""

from __future__ import annotations

import asyncio
from pathlib import Path
from threading import Lock
from typing import Any

from app.asr.base import ASRBackend, ASRError
from app.models import AudioData


class FasterWhisperBackend(ASRBackend):
    """Lazily initialize one Whisper model and run inference off-loop."""

    def __init__(
        self,
        model_name: str = "small",
        model_dir: Path | str = "models",
        device: str = "cpu",
        compute_type: str = "int8",
        language: str = "zh",
    ) -> None:
        self.model_name = model_name
        self.model_dir = Path(model_dir)
        self.device = device
        self.compute_type = compute_type
        self.language = language
        self._model: Any = None
        self._model_lock = Lock()

    def _get_model(self) -> Any:
        if self._model is None:
            with self._model_lock:
                if self._model is None:
                    try:
                        from faster_whisper import WhisperModel
                    except ImportError as exc:
                        raise ASRError(
                            "faster-whisper is not installed; install optional dependencies"
                        ) from exc
                    self.model_dir.mkdir(parents=True, exist_ok=True)
                    self._model = WhisperModel(
                        self.model_name,
                        device=self.device,
                        compute_type=self.compute_type,
                        download_root=str(self.model_dir),
                    )
        return self._model

    def _transcribe_sync(self, audio: AudioData) -> str:
        try:
            segments, _ = self._get_model().transcribe(
                audio.samples,
                language=self.language,
                task="transcribe",
                vad_filter=False,
            )
            return "".join(segment.text for segment in segments).strip()
        except ASRError:
            raise
        except Exception as exc:
            raise ASRError("ASR inference failed") from exc

    async def transcribe(self, audio: AudioData) -> str:
        return await asyncio.to_thread(self._transcribe_sync, audio)
