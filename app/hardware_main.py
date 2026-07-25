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
    build_llm,
    build_vad,
    setup_logging,
)
from app.features.llm_session import LLMSessionManager
from app.features.photo_capture import LatestFrameStore, PhotoCaptureManager
from app.features.photo_printer import ThermalPrinterClient
from app.runtime.perception_daemon import PerceptionDaemon
from app.transport.hardware_sources import (
    HTTPJPEGImageSource,
    TCPPCMAudioSource,
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
        choices=("run", "test", "mictest"),
        default="run",
        help=(
            "run the service, open the live Vision test window, or test "
            "ASR+LLM with the local microphone"
        ),
    )
    parser.add_argument("--config", type=Path, default=Path("config"))
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
    return parser


def build_daemon(
    config: AppConfig,
    args: argparse.Namespace,
) -> tuple[PerceptionDaemon, GestureBackend | None]:
    mictest = args.mode == "mictest"
    audio_enabled = (
        mictest or config.hardware.audio_enabled
    ) and not args.vision_only
    vision_enabled = (
        config.hardware.vision_enabled
        and not args.audio_only
        and not mictest
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
    asr_backend = None
    image_source = None
    vision_processor = None
    gesture_backend: GestureBackend | None = None
    event_bus = EventBus(config.perception.event_cache_capacity)
    latest_frame_store = LatestFrameStore()
    photo_manager = None

    if audio_enabled:
        if not config.vad.enabled:
            raise ConfigurationError("hardware audio requires vad.enabled=true")
        if mictest:
            from app.transport.mic_source import MicrophoneAudioSource

            audio_source = MicrophoneAudioSource(
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
        asr_backend = build_asr(config)
        audio_processor = KeywordASRProcessor(
            asr_backend,
            KeywordDetector(config.keywords),
            session_id=session_id,
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
            printer_client = None
            if config.printer.enabled:
                printer_client = ThermalPrinterClient(config.printer)
            photo_manager = PhotoCaptureManager(
                latest_frame_store,
                delay_seconds=config.application.photo_delay_seconds,
                voice_delay_seconds=(
                    config.application.voice_photo_delay_seconds
                ),
                max_frame_age_seconds=(
                    config.application.photo_frame_max_age_seconds
                ),
                output_dir=config.application.photo_output_dir,
                processor_url=config.application.photo_processor_url,
                timeout_seconds=(
                    config.application.downstream_timeout_seconds
                ),
                printer=printer_client,
            )

    llm_manager = None
    llm_backend = build_llm(config)
    if llm_backend is not None:
        llm_manager = LLMSessionManager(
            llm_backend,
            silence_timeout_seconds=config.llm.silence_timeout_seconds,
            letter_system_prompt=config.llm.letter_system_prompt,
            qa_system_prompt=config.llm.qa_system_prompt,
            letter_system_prompt_en=config.llm.letter_system_prompt_en,
            qa_system_prompt_en=config.llm.qa_system_prompt_en,
        )

    controller = ApplicationController(
        default_language=config.application.default_language,
        photo_manager=photo_manager,
        llm_manager=llm_manager,
        language_listener=(
            asr_backend.set_language if asr_backend is not None else None
        ),
    )
    if asr_backend is not None:
        # Align the ASR transcription language with the initial app language.
        asr_backend.set_language(config.application.default_language)

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
    )
    if llm_manager is not None:
        # Defer the silence countdown while speech is still being captured
        # or transcribed, so long dictations are not cut off mid-sentence.
        llm_manager.set_activity_probe(lambda: daemon.audio_busy)
    return daemon, gesture_backend


async def run(args: argparse.Namespace) -> None:
    config = load_config(args.config)
    setup_logging()
    daemon, gesture_backend = build_daemon(config, args)
    api_server = None
    recorder = None
    outbox = None
    try:
        if args.mode == "mictest":
            from app.features.result_recorder import ResultRecorder

            recorder = ResultRecorder(daemon.event_bus)
            recorder.start()
            LOGGER.info(
                "mictest recording ASR to %s and LLM to %s",
                recorder.asr_path,
                recorder.llm_path,
            )
        if config.ui.enabled:
            from app.features.letter_outbox import LetterOutbox

            outbox = LetterOutbox(
                daemon.event_bus,
                base_url=config.ui.base_url,
                device_token=config.ui.device_token,
                timeout_seconds=config.ui.timeout_seconds,
            )
            outbox.set_event_emitter(daemon.emit)
            outbox.start()
            LOGGER.info("letter outbox delivering to %s", config.ui.base_url)
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
            )
            await api_server.start()
        LOGGER.info(
            "perception runtime starting audio=%s vision=%s",
            daemon.audio_source is not None,
            daemon.image_source is not None,
        )
        await daemon.run()
    finally:
        if outbox is not None:
            await outbox.aclose()
        if recorder is not None:
            await recorder.aclose()
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
        OSError,
        RuntimeError,
        VADError,
        VisionError,
    ) as exc:
        parser.error(str(exc))


if __name__ == "__main__":
    main()
