"""Long-running Bot perception entry point."""

from __future__ import annotations

import argparse
import asyncio
import logging
from pathlib import Path

from app.audio.keyword_asr import KeywordASRProcessor
from app.audio.stream_pipeline import StreamingAudioPipeline
from app.audio.vad.base import VADError
from app.config import AppConfig, ConfigurationError, load_config
from app.control.application_controller import ApplicationController
from app.detection.keywords import KeywordDetector
from app.event_cache import EventCache
from app.events.event_bus import EventBus
from app.factories import (
    build_asr,
    build_gesture,
    build_vad,
    setup_llm_logging,
    setup_logging,
)
from app.features.photo_capture import LatestFrameStore, PhotoCaptureManager
from app.features.bot_expression import BotExpressionController
from app.features.letter_print import LetterPrintManager
from app.features.letter_rendering import LetterRenderer
from app.features.thermal_printer import ThermalPrinterClient
from app.llm.client import OpenAICompatibleClient
from app.llm.mode_detector import LLMModeDetector
from app.llm.session import LLMSessionManager
from app.runtime.perception_daemon import PerceptionDaemon
from app.transport.hardware_sources import (
    HTTPJPEGImageSource,
    TCPPCMAudioSource,
)
from app.transport.microphone_source import (
    LocalMicrophoneAudioSource,
    MicrophoneError,
    list_input_devices,
    parse_input_device,
)
from app.vision.base import GestureBackend, VisionError
from app.vision.continuous_processor import ContinuousVisionProcessor

LOGGER = logging.getLogger("desktop_assistant.hardware")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Continuously detect meaningful audio and vision events."
    )
    parser.add_argument(
        "mode",
        nargs="?",
        choices=("run", "test", "mic-test"),
        default="run",
        help="run the service, test Vision, or test LLM with a microphone",
    )
    parser.add_argument(
        "--config",
        type=Path,
        default=Path("config/app.yaml"),
    )
    parser.add_argument(
        "--llm-config",
        type=Path,
        default=Path("config/llm.yaml"),
    )
    parser.add_argument("--session", default=None)
    channel = parser.add_mutually_exclusive_group()
    channel.add_argument("--audio-only", action="store_true")
    channel.add_argument("--vision-only", action="store_true")
    parser.add_argument("--audio-host", default=None)
    parser.add_argument("--audio-port", type=int, default=None)
    parser.add_argument("--vision-host", default=None)
    parser.add_argument("--vision-port", type=int, default=None)
    parser.add_argument(
        "--scale",
        type=float,
        default=1.25,
        help="display scale used by test mode",
    )
    parser.add_argument(
        "--input-device",
        type=parse_input_device,
        default=None,
        help="microphone device index or name used by mic-test",
    )
    parser.add_argument(
        "--list-input-devices",
        action="store_true",
        help="list microphones and exit (mic-test only)",
    )
    return parser


def validate_mode_arguments(args: argparse.Namespace) -> None:
    if args.mode != "mic-test" and (
        args.input_device is not None or args.list_input_devices
    ):
        raise ConfigurationError("microphone options require mic-test mode")
    if args.mode == "mic-test" and (
        args.audio_only
        or args.vision_only
        or args.audio_host is not None
        or args.audio_port is not None
        or args.vision_host is not None
        or args.vision_port is not None
    ):
        raise ConfigurationError(
            "hardware channel options are not valid in mic-test mode"
        )


def format_input_devices() -> str:
    devices = list_input_devices()
    if not devices:
        return "No input-capable audio devices found."
    return "\n".join(
        f"{item.index}: {item.name} "
        f"(inputs={item.max_input_channels}, "
        f"default_rate={item.default_samplerate:g})"
        for item in devices
    )


def build_daemon(
    config: AppConfig,
    args: argparse.Namespace,
) -> tuple[PerceptionDaemon, GestureBackend | None]:
    microphone_mode = args.mode == "mic-test"
    audio_enabled = (
        True
        if microphone_mode
        else config.hardware.audio_enabled and not args.vision_only
    )
    vision_enabled = (
        False
        if microphone_mode
        else config.hardware.vision_enabled and not args.audio_only
    )
    if not audio_enabled and not vision_enabled:
        raise ConfigurationError("both hardware input channels are disabled")

    session_id = args.session or config.hardware.session_id
    cache = EventCache(
        config.perception.event_cache_capacity,
        config.perception.event_ttl_seconds,
    )
    audio_source = None
    segmenter = None
    audio_processor = None
    image_source = None
    vision_processor = None
    gesture_backend: GestureBackend | None = None
    event_bus = EventBus(config.perception.event_cache_capacity)
    latest_frame_store = LatestFrameStore()
    photo_manager = None
    letter_manager = None
    llm_detector = None
    llm_session_manager = None
    printer = None
    expression_controller = None

    if config.bot_expression.enabled:
        expression_controller = BotExpressionController(
            config.bot_expression
        )

    if config.printer.enabled:
        printer = ThermalPrinterClient(
            config.printer.base_url,
            width=config.printer.width,
            max_chunk_height=config.printer.max_chunk_height,
            pixel_size=config.printer.pixel_size,
            contrast=config.printer.contrast,
            brightness=config.printer.brightness,
            grayscale_levels=config.printer.grayscale_levels,
            dither=config.printer.dither,
            rotate_180=config.printer.rotate_180,
            timeout_seconds=config.printer.timeout_seconds,
        )

    if audio_enabled:
        if not config.vad.enabled:
            raise ConfigurationError("hardware audio requires vad.enabled=true")
        if microphone_mode:
            audio_source = LocalMicrophoneAudioSource(
                device=args.input_device,
                sample_rate=config.audio.target_sample_rate,
                frame_samples=config.hardware.audio_frame_samples,
                queue_size=config.hardware.audio_queue_size,
            )
        else:
            audio_source = TCPPCMAudioSource(
                args.audio_host or config.hardware.audio_host,
                (
                    args.audio_port
                    if args.audio_port is not None
                    else config.hardware.audio_port
                ),
                sample_rate=config.audio.target_sample_rate,
                frame_samples=config.hardware.audio_frame_samples,
                queue_size=config.hardware.audio_queue_size,
            )
        segmenter = StreamingAudioPipeline(
            config.vad,
            build_vad(config),
            config.audio.target_sample_rate,
        )
        llm_detector = LLMModeDetector(config.llm.modes)
        if config.llm.available:
            llm_session_manager = LLMSessionManager(
                config.llm,
                OpenAICompatibleClient.from_config(config.llm),
                logger=setup_llm_logging(config.llm.log_path),
            )
            if config.letter.enabled:
                letter_manager = LetterPrintManager(
                    config.letter,
                    LetterRenderer(
                        config.letter,
                        width=config.printer.width,
                        max_chunk_height=config.printer.max_chunk_height,
                    ),
                    signature=config.llm.user_nickname,
                    printer=printer,
                )
        audio_processor = KeywordASRProcessor(
            build_asr(config),
            KeywordDetector(config.keywords),
            session_id=session_id,
            llm_detector=llm_detector,
        )

    if vision_enabled:
        if not config.vision.enabled:
            raise ConfigurationError(
                "hardware vision requires vision.enabled=true"
            )
        image_source = HTTPJPEGImageSource(
            args.vision_host or config.hardware.vision_host,
            (
                args.vision_port
                if args.vision_port is not None
                else config.hardware.vision_port
            ),
            upload_path=config.hardware.vision_upload_path,
            max_image_bytes=config.vision.max_image_bytes,
            queue_size=1,
            default_session_id=session_id,
        )
        gesture_backend = build_gesture(config)
        vision_processor = ContinuousVisionProcessor(
            config.vision,
            config.perception,
            gesture_backend,
        )
        if config.application.photo_enabled:
            photo_manager = PhotoCaptureManager(
                latest_frame_store,
                delay_seconds=config.application.photo_delay_seconds,
                max_frame_age_seconds=(
                    config.application.photo_frame_max_age_seconds
                ),
                output_dir=config.application.photo_output_dir,
                processor_url=config.application.photo_processor_url,
                timeout_seconds=(
                    config.application.downstream_timeout_seconds
                ),
                printer=printer,
                cooldown_seconds=config.printer.cooldown_seconds,
            )

    controller = ApplicationController(
        default_language=config.application.default_language,
        photo_manager=photo_manager,
        llm_session_manager=llm_session_manager,
        letter_manager=letter_manager,
        llm_unavailable_reason=config.llm.unavailable_reason,
    )

    daemon = PerceptionDaemon(
        cache,
        audio_source=audio_source,
        audio_segmenter=segmenter,
        audio_processor=audio_processor,
        image_source=image_source,
        vision_processor=vision_processor,
        utterance_queue_size=config.perception.utterance_queue_size,
        event_bus=event_bus,
        application_controller=controller,
        latest_frame_store=latest_frame_store,
        expression_controller=expression_controller,
    )
    return daemon, gesture_backend


async def run(args: argparse.Namespace) -> None:
    setup_logging()
    config = load_config(args.config, args.llm_config)
    if config.llm.unavailable_reason == "not_configured":
        LOGGER.warning(
            "LLM provider is not configured; LLM modes will be rejected"
        )
    daemon, gesture_backend = build_daemon(config, args)
    api_server = None
    try:
        if config.api.enabled:
            from app.api.server import EventAPIServer

            controller = daemon.application_controller
            assert isinstance(controller, ApplicationController)
            api_server = EventAPIServer(
                host=config.api.host,
                port=config.api.port,
                websocket_path=config.api.websocket_path,
                cache=daemon.cache,
                event_bus=daemon.event_bus,
                controller=controller,
                health=daemon.health,
                emit=daemon.emit,
                photo_output_dir=Path(config.application.photo_output_dir),
                letter_output_dir=Path(config.letter.output_dir),
            )
            await api_server.start()
        LOGGER.info(
            "perception runtime starting audio=%s vision=%s",
            daemon.audio_source is not None,
            daemon.image_source is not None,
        )
        if args.mode == "mic-test":
            LOGGER.info(
                "mic-test active device=%s; ASR/events=logs/perception.log; "
                "LLM sessions/results=%s; press Ctrl+C to stop",
                (
                    args.input_device
                    if args.input_device is not None
                    else "default"
                ),
                config.llm.log_path,
            )
        await daemon.run()
    finally:
        if api_server is not None:
            await api_server.stop()
        if daemon.application_controller is not None:
            await daemon.application_controller.aclose()
        if gesture_backend is not None:
            await gesture_backend.close()
        LOGGER.info("perception runtime stopped health=%s", daemon.health())


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()
    try:
        validate_mode_arguments(args)
        if args.list_input_devices:
            print(format_input_devices())
            return
        if args.mode == "test":
            from scripts.vision_live import run_live_view

            asyncio.run(
                run_live_view(
                    args.config,
                    host=args.vision_host,
                    port=args.vision_port,
                    session_id=args.session,
                    scale=args.scale,
                )
            )
        else:
            asyncio.run(run(args))
    except KeyboardInterrupt:
        LOGGER.info("stopped by user")
    except (
        ConfigurationError,
        MicrophoneError,
        OSError,
        RuntimeError,
        VADError,
        VisionError,
    ) as exc:
        parser.error(str(exc))


if __name__ == "__main__":
    main()
