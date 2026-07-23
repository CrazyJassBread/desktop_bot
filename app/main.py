"""Command-line entry point for local WAV processing."""

from __future__ import annotations

import argparse
import asyncio
import logging
from pathlib import Path

from app.asr.base import ASRBackend
from app.asr.faster_whisper_backend import FasterWhisperBackend
from app.asr.mock_backend import MockASRBackend
from app.audio.vad.base import VADBackend
from app.audio.vad.silero_backend import SileroVADBackend
from app.config import AppConfig, ConfigurationError, load_config
from app.llm.base import LLMBackend, LLMError
from app.llm.client import OpenAICompatibleBackend
from app.llm.mock_backend import MockLLMBackend
from app.output.base import OutputAdapter
from app.output.console_adapter import ConsoleOutputAdapter
from app.output.json_file_adapter import JsonFileOutputAdapter
from app.runtime.pipeline import VoicePipeline
from app.schemas import AudioRequest, ControlSignal
from app.vision.base import GestureBackend
from app.vision.mediapipe_gesture import MediaPipeGestureBackend


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Process one local WAV file through the desktop AI assistant."
    )
    parser.add_argument("--wav", type=Path, required=True, help="input WAV path")
    parser.add_argument(
        "--signal",
        choices=[item.value for item in ControlSignal],
        default=ControlSignal.AUTO.value,
    )
    parser.add_argument("--session", default="default")
    parser.add_argument("--output", choices=("console", "json"), default=None)
    parser.add_argument("--config", type=Path, default=None)
    return parser


def setup_logging(log_path: Path = Path("logs/assistant.log")) -> None:
    log_path.parent.mkdir(parents=True, exist_ok=True)
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
        handlers=[
            logging.FileHandler(log_path, encoding="utf-8"),
            logging.StreamHandler(),
        ],
    )


def build_asr(config: AppConfig) -> ASRBackend:
    if config.asr.backend == "mock":
        return MockASRBackend(config.asr.mock_transcripts)
    if config.asr.backend == "faster_whisper":
        return FasterWhisperBackend(
            config.asr.model,
            config.asr.model_dir,
            config.asr.device,
            config.asr.compute_type,
            config.asr.language,
        )
    raise ConfigurationError(f"unsupported ASR backend: {config.asr.backend}")


def build_llm(config: AppConfig) -> LLMBackend:
    backend = config.llm.backend.strip()
    base_url = config.llm.base_url
    if backend.startswith(("https://", "http://")):
        logging.getLogger("desktop_assistant").warning(
            "llm.backend contains a URL; treating it as an OpenAI-compatible "
            "base_url. Prefer backend=openai_compatible and llm.base_url."
        )
        base_url = base_url or backend
        backend = "openai_compatible"
    if backend == "mock":
        return MockLLMBackend()
    if backend in {"openai", "openai_compatible"}:
        return OpenAICompatibleBackend(
            model=config.llm.model,
            api_key_env=config.llm.api_key_env,
            base_url=base_url,
            timeout_seconds=config.llm.timeout_seconds,
        )
    raise ConfigurationError(
        "unsupported LLM backend: "
        f"{config.llm.backend}; expected mock, openai, or openai_compatible"
    )


def build_vad(config: AppConfig) -> VADBackend:
    if config.vad.backend == "silero":
        return SileroVADBackend(config.vad.model)
    raise ConfigurationError(
        f"unsupported VAD backend: {config.vad.backend}; expected silero"
    )


def build_gesture(config: AppConfig) -> GestureBackend:
    if config.vision.backend == "mediapipe":
        return MediaPipeGestureBackend(
            config.vision.gesture_model,
            config.vision.score_threshold,
            config.vision.max_hands,
        )
    raise ConfigurationError(
        "unsupported vision backend: "
        f"{config.vision.backend}; expected mediapipe"
    )


def build_output(config: AppConfig, selected: str | None) -> OutputAdapter:
    adapter = selected or config.output.adapter
    if adapter == "console":
        return ConsoleOutputAdapter()
    if adapter == "json":
        return JsonFileOutputAdapter(config.output.json_output_path)
    raise ConfigurationError(f"unsupported output adapter: {adapter}")


async def run(args: argparse.Namespace) -> bool:
    default_config = Path("config.yaml")
    config_path = args.config
    if config_path is None and default_config.is_file():
        config_path = default_config
    config = load_config(config_path)
    setup_logging()
    pipeline = VoicePipeline(config, build_asr(config), build_llm(config))
    adapter = build_output(config, args.output)
    response = await pipeline.process(
        AudioRequest(
            audio_path=args.wav,
            session_id=args.session,
            signal=ControlSignal(args.signal),
        )
    )
    await adapter.send_response(response)
    return response.success


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()
    try:
        success = asyncio.run(run(args))
    except (ConfigurationError, LLMError) as exc:
        parser.error(str(exc))
    raise SystemExit(0 if success else 1)


if __name__ == "__main__":
    main()
