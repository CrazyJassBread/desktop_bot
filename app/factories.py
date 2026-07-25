"""Construct the model backends used by the perception entry point."""

from __future__ import annotations

import logging
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from app.asr.base import ASRBackend
from app.asr.faster_whisper_backend import FasterWhisperBackend
from app.asr.mock_backend import MockASRBackend
from app.asr.openai_whisper_backend import OpenAIWhisperBackend
from app.audio.vad.base import VADBackend
from app.audio.vad.silero_backend import SileroVADBackend
from app.config import AppConfig, ConfigurationError
from app.vision.base import GestureBackend
from app.vision.mediapipe_gesture import MediaPipeGestureBackend


def setup_logging(log_path: Path = Path("logs/perception.log")) -> None:
    log_path.parent.mkdir(parents=True, exist_ok=True)
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
        handlers=[
            logging.FileHandler(log_path, encoding="utf-8"),
            logging.StreamHandler(),
        ],
    )


def build_asr(
    config: AppConfig, executor: ThreadPoolExecutor | None = None
) -> ASRBackend:
    if config.asr.backend == "mock":
        return MockASRBackend(config.asr.mock_transcripts)
    if config.asr.backend == "faster_whisper":
        return FasterWhisperBackend(
            config.asr.model,
            config.asr.model_dir,
            config.asr.device,
            config.asr.compute_type,
            config.asr.language,
            executor=executor,
        )
    if config.asr.backend == "openai_whisper":
        return OpenAIWhisperBackend(config.asr.model)
    raise ConfigurationError(f"unsupported ASR backend: {config.asr.backend}")


def build_vad(
    config: AppConfig, executor: ThreadPoolExecutor | None = None
) -> VADBackend:
    if config.vad.backend == "silero":
        return SileroVADBackend(config.vad.model, executor=executor)
    raise ConfigurationError(
        f"unsupported VAD backend: {config.vad.backend}; expected silero"
    )


def build_gesture(
    config: AppConfig, executor: ThreadPoolExecutor | None = None
) -> GestureBackend:
    if config.vision.backend == "mediapipe":
        return MediaPipeGestureBackend(
            config.vision.gesture_model,
            config.vision.score_threshold,
            config.vision.max_hands,
            executor=executor,
        )
    raise ConfigurationError(
        "unsupported vision backend: "
        f"{config.vision.backend}; expected mediapipe"
    )
