"""Configuration for the active audio and vision perception pipeline."""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, TypeVar

import yaml

T = TypeVar("T")


class ConfigurationError(ValueError):
    pass


@dataclass
class AudioConfig:
    target_sample_rate: int = 16_000


@dataclass
class ASRConfig:
    backend: str = "mock"
    model: str = "small"
    model_dir: str = "models"
    device: str = "cpu"
    compute_type: str = "int8"
    language: str = "zh"
    mock_transcripts: dict[str, str] = field(default_factory=dict)


@dataclass
class HardwareConfig:
    audio_enabled: bool = True
    audio_host: str = "0.0.0.0"
    audio_port: int = 8080
    audio_frame_samples: int = 512
    audio_queue_size: int = 256
    vision_enabled: bool = True
    vision_host: str = "0.0.0.0"
    vision_port: int = 8081
    vision_upload_path: str = "/upload"
    session_id: str = "bot"


@dataclass
class VADConfig:
    enabled: bool = True
    backend: str = "silero"
    model: str = "bundled"
    speech_threshold: float = 0.60
    release_threshold: float = 0.35
    min_speech_duration_ms: int = 250
    min_silence_duration_ms: int = 800
    pre_roll_ms: int = 200
    max_utterance_seconds: float = 45.0


@dataclass
class KeywordConfig:
    wake: list[str] = field(
        default_factory=lambda: ["小A", "小爱", "小诶"]
    )
    enter_chat: list[str] = field(
        default_factory=lambda: ["进入聊天模式", "开始聊天", "智能问答"]
    )
    exit_chat: list[str] = field(
        default_factory=lambda: ["退出聊天模式", "结束聊天", "返回普通模式"]
    )
    write_letter: list[str] = field(
        default_factory=lambda: ["帮我写信", "我要写一封信"]
    )
    custom: dict[str, list[str]] = field(default_factory=dict)


@dataclass
class PerceptionConfig:
    event_cache_capacity: int = 100
    event_ttl_seconds: float = 1_800
    utterance_queue_size: int = 4
    vision_max_fps: float = 5.0


@dataclass
class VisionConfig:
    enabled: bool = True
    backend: str = "mediapipe"
    gesture_model: str = "models/gesture_recognizer.task"
    image_width: int = 640
    image_height: int = 480
    max_image_bytes: int = 2_097_152
    max_hands: int = 2
    score_threshold: float = 0.70
    mode_window_size: int = 5
    mode_required_hits: int = 3
    release_frames: int = 2
    gesture_window_size: int = 3
    gesture_required_hits: int = 2


@dataclass
class ApplicationConfig:
    default_language: str = "zh"
    photo_enabled: bool = True
    photo_delay_seconds: float = 2.0
    photo_frame_max_age_seconds: float = 1.0
    photo_output_dir: str = "captured_photos"
    photo_processor_url: str = ""
    downstream_timeout_seconds: float = 10.0


@dataclass
class APIConfig:
    enabled: bool = False
    host: str = "0.0.0.0"
    port: int = 8090
    websocket_path: str = "/api/events"


@dataclass
class AppConfig:
    audio: AudioConfig = field(default_factory=AudioConfig)
    asr: ASRConfig = field(default_factory=ASRConfig)
    hardware: HardwareConfig = field(default_factory=HardwareConfig)
    vad: VADConfig = field(default_factory=VADConfig)
    keywords: KeywordConfig = field(default_factory=KeywordConfig)
    perception: PerceptionConfig = field(default_factory=PerceptionConfig)
    vision: VisionConfig = field(default_factory=VisionConfig)
    application: ApplicationConfig = field(default_factory=ApplicationConfig)
    api: APIConfig = field(default_factory=APIConfig)


_SECTIONS: dict[str, type[Any]] = {
    "audio": AudioConfig,
    "asr": ASRConfig,
    "hardware": HardwareConfig,
    "vad": VADConfig,
    "keywords": KeywordConfig,
    "perception": PerceptionConfig,
    "vision": VisionConfig,
    "application": ApplicationConfig,
    "api": APIConfig,
}


def _build(cls: type[T], values: object, section: str) -> T:
    if values is None:
        values = {}
    if not isinstance(values, dict):
        raise ConfigurationError(f"{section} must be a mapping")
    unknown = set(values) - set(cls.__dataclass_fields__)  # type: ignore[attr-defined]
    if unknown:
        raise ConfigurationError(
            f"unknown {section} options: {', '.join(sorted(unknown))}"
        )
    try:
        return cls(**values)
    except TypeError as exc:
        raise ConfigurationError(str(exc)) from exc


def _positive(value: object, name: str) -> None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ConfigurationError(f"{name} must be a number")
    if value <= 0:
        raise ConfigurationError(f"{name} must be positive")


def _positive_int(value: object, name: str) -> None:
    if isinstance(value, bool) or not isinstance(value, int):
        raise ConfigurationError(f"{name} must be an integer")
    if value <= 0:
        raise ConfigurationError(f"{name} must be positive")


def _validate(config: AppConfig) -> None:
    _positive_int(config.audio.target_sample_rate, "audio.target_sample_rate")
    _positive_int(
        config.hardware.audio_frame_samples,
        "hardware.audio_frame_samples",
    )
    _positive_int(
        config.hardware.audio_queue_size,
        "hardware.audio_queue_size",
    )
    _positive_int(
        config.perception.event_cache_capacity,
        "perception.event_cache_capacity",
    )
    _positive(
        config.perception.event_ttl_seconds,
        "perception.event_ttl_seconds",
    )
    _positive_int(
        config.perception.utterance_queue_size,
        "perception.utterance_queue_size",
    )
    _positive(config.perception.vision_max_fps, "perception.vision_max_fps")
    for name, port in (
        ("hardware.audio_port", config.hardware.audio_port),
        ("hardware.vision_port", config.hardware.vision_port),
    ):
        if isinstance(port, bool) or not isinstance(port, int):
            raise ConfigurationError(f"{name} must be an integer")
        if not 1 <= port <= 65_535:
            raise ConfigurationError(f"{name} must be between 1 and 65535")
    if config.hardware.audio_port == config.hardware.vision_port:
        raise ConfigurationError("hardware audio and vision ports must differ")
    if not config.hardware.vision_upload_path.startswith("/"):
        raise ConfigurationError("hardware.vision_upload_path must start with '/'")
    if not config.hardware.session_id.strip():
        raise ConfigurationError("hardware.session_id cannot be empty")
    if config.hardware.audio_frame_samples != 512:
        raise ConfigurationError("Silero VAD requires 512-sample audio frames")
    if config.audio.target_sample_rate != 16_000:
        raise ConfigurationError("Silero VAD requires 16000 Hz audio")
    if not 0 <= config.vad.release_threshold <= config.vad.speech_threshold <= 1:
        raise ConfigurationError(
            "VAD thresholds must satisfy 0 <= release <= speech <= 1"
        )
    for name, value in (
        ("vad.min_speech_duration_ms", config.vad.min_speech_duration_ms),
        ("vad.min_silence_duration_ms", config.vad.min_silence_duration_ms),
        ("vad.pre_roll_ms", config.vad.pre_roll_ms),
    ):
        if isinstance(value, bool) or not isinstance(value, int) or value < 0:
            raise ConfigurationError(f"{name} must be a non-negative integer")
    _positive(config.vad.max_utterance_seconds, "vad.max_utterance_seconds")
    for name, phrases in (
        ("keywords.wake", config.keywords.wake),
        ("keywords.enter_chat", config.keywords.enter_chat),
        ("keywords.exit_chat", config.keywords.exit_chat),
        ("keywords.write_letter", config.keywords.write_letter),
    ):
        if not isinstance(phrases, list) or not all(
            isinstance(item, str) and item.strip() for item in phrases
        ):
            raise ConfigurationError(f"{name} must contain non-empty strings")
    if not isinstance(config.keywords.custom, dict):
        raise ConfigurationError("keywords.custom must be a mapping")
    for command_type, phrases in config.keywords.custom.items():
        if (
            not isinstance(command_type, str)
            or not command_type.strip()
            or not isinstance(phrases, list)
            or not all(
                isinstance(item, str) and item.strip() for item in phrases
            )
        ):
            raise ConfigurationError(
                "keywords.custom must map command names to phrase lists"
            )
    for name, value in (
        ("vision.image_width", config.vision.image_width),
        ("vision.image_height", config.vision.image_height),
        ("vision.max_image_bytes", config.vision.max_image_bytes),
        ("vision.max_hands", config.vision.max_hands),
        ("vision.mode_window_size", config.vision.mode_window_size),
        ("vision.mode_required_hits", config.vision.mode_required_hits),
        ("vision.release_frames", config.vision.release_frames),
        ("vision.gesture_window_size", config.vision.gesture_window_size),
        ("vision.gesture_required_hits", config.vision.gesture_required_hits),
    ):
        _positive_int(value, name)
    if not 0 <= config.vision.score_threshold <= 1:
        raise ConfigurationError("vision.score_threshold must be between 0 and 1")
    if config.vision.mode_required_hits > config.vision.mode_window_size:
        raise ConfigurationError("invalid vision mode temporal filter")
    if config.vision.gesture_required_hits > config.vision.gesture_window_size:
        raise ConfigurationError("invalid vision gesture temporal filter")
    if config.application.default_language not in {"zh", "en"}:
        raise ConfigurationError(
            "application.default_language must be 'zh' or 'en'"
        )
    _positive(
        config.application.photo_delay_seconds,
        "application.photo_delay_seconds",
    )
    _positive(
        config.application.photo_frame_max_age_seconds,
        "application.photo_frame_max_age_seconds",
    )
    _positive(
        config.application.downstream_timeout_seconds,
        "application.downstream_timeout_seconds",
    )
    if not config.application.photo_output_dir.strip():
        raise ConfigurationError(
            "application.photo_output_dir cannot be empty"
        )
    if isinstance(config.api.port, bool) or not isinstance(config.api.port, int):
        raise ConfigurationError("api.port must be an integer")
    if not 1 <= config.api.port <= 65_535:
        raise ConfigurationError("api.port must be between 1 and 65535")
    if config.api.port in {
        config.hardware.audio_port,
        config.hardware.vision_port,
    }:
        raise ConfigurationError("api port must differ from hardware ports")
    if not config.api.websocket_path.startswith("/"):
        raise ConfigurationError("api.websocket_path must start with '/'")
    if not isinstance(config.asr.mock_transcripts, dict) or not all(
        isinstance(key, str) and isinstance(value, str)
        for key, value in config.asr.mock_transcripts.items()
    ):
        raise ConfigurationError("asr.mock_transcripts must map strings to strings")


def load_config(path: Path | str | None = None) -> AppConfig:
    data: dict[str, Any] = {}
    if path is not None:
        config_path = Path(path)
        if not config_path.is_file():
            raise ConfigurationError(f"config file not found: {config_path}")
        loaded = yaml.safe_load(config_path.read_text(encoding="utf-8")) or {}
        if not isinstance(loaded, dict):
            raise ConfigurationError("config root must be a mapping")
        data = loaded
    unknown = set(data) - set(_SECTIONS)
    if unknown:
        raise ConfigurationError(
            f"unknown config sections: {', '.join(sorted(unknown))}"
        )
    config = AppConfig(
        **{
            name: _build(cls, data.get(name), name)
            for name, cls in _SECTIONS.items()
        }
    )
    _validate(config)
    return config
