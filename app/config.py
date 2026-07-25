"""Configuration for the active audio and vision perception pipeline."""

from __future__ import annotations

import re
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
    photo_print: list[str] = field(
        default_factory=lambda: [
            "拍照",
            "照相",
            "给我拍一张",
            "打印照片",
            "photo",
            "take a photo",
            "take a picture",
        ]
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
    photo_delay_seconds: float = 1.0
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
class PrinterConfig:
    enabled: bool = True
    base_url: str = "http://10.76.7.129"
    width: int = 384
    max_chunk_height: int = 1_200
    pixel_size: int = 6
    grayscale_levels: int = 4
    contrast: float = 1.2
    brightness: float = 1.0
    dither: bool = True
    rotate_180: bool = False
    timeout_seconds: float = 30.0
    cooldown_seconds: float = 2.0


@dataclass
class BotExpressionConfig:
    enabled: bool = False
    base_url: str = "http://127.0.0.1"
    endpoint: str = "/oled/expression"
    timeout_seconds: float = 5.0
    action_duration_seconds: float = 2.0


@dataclass
class LetterConfig:
    enabled: bool = True
    auto_print: bool = True
    output_dir: str = "generated_letters"
    font_path: str = ""
    stamp_selection: str = "random"
    stamp_themes: list[str] = field(
        default_factory=lambda: ["flower", "moon", "envelope"]
    )
    postmark_style: str = "wave_date"
    show_signature: bool = True
    max_print_characters: int = 2_000


@dataclass
class LLMSessionConfig:
    idle_timeout_seconds: float = 120.0
    max_duration_seconds: float = 900.0
    max_characters: int = 12_000
    body_prefixes: list[str] = field(
        default_factory=lambda: ["正文：", "正文:"]
    )


def _letter_mode_defaults() -> "LLMModeConfig":
    return LLMModeConfig(
        start_phrases=[
            "开始写信",
            "我要写信",
            "帮我写信",
            "我要写一封信",
        ],
        recipient_templates=[
            "我要给{recipient}写信",
            "帮我给{recipient}写封信",
        ],
        recipient_prefixes=["收件人是", "写给"],
        finish_phrases=["小A，完成写信", "小A，信写完了"],
        cancel_phrases=["小A，取消写信", "小A，放弃这封信"],
    )


def _qa_mode_defaults() -> "LLMModeConfig":
    return LLMModeConfig(
        start_phrases=["进入问答模式", "我有一个问题", "帮我回答"],
        finish_phrases=["小A，请回答", "小A，问题说完了"],
        cancel_phrases=["小A，取消问答", "小A，不要回答了"],
    )


@dataclass
class LLMModeConfig:
    start_phrases: list[str] = field(default_factory=list)
    recipient_templates: list[str] = field(default_factory=list)
    recipient_prefixes: list[str] = field(default_factory=list)
    finish_phrases: list[str] = field(default_factory=list)
    cancel_phrases: list[str] = field(default_factory=list)


@dataclass
class LLMModesConfig:
    letter: LLMModeConfig = field(default_factory=_letter_mode_defaults)
    qa: LLMModeConfig = field(default_factory=_qa_mode_defaults)


@dataclass
class LLMProviderConfig:
    base_url: str = ""
    model: str = ""
    api_key: str = field(default="", repr=False)


@dataclass
class LLMConfig:
    enabled: bool = False
    timeout_seconds: float = 60.0
    temperature: float = 0.4
    max_output_tokens: int = 2_000
    log_path: str = "logs/llm.log"
    user_nickname: str = "用户"
    session: LLMSessionConfig = field(default_factory=LLMSessionConfig)
    modes: LLMModesConfig = field(default_factory=LLMModesConfig)
    provider: LLMProviderConfig | None = field(
        default=None,
        repr=False,
    )

    @property
    def available(self) -> bool:
        return self.enabled and self.provider is not None

    @property
    def unavailable_reason(self) -> str | None:
        if not self.enabled:
            return "disabled"
        if self.provider is None:
            return "not_configured"
        return None


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
    printer: PrinterConfig = field(default_factory=PrinterConfig)
    bot_expression: BotExpressionConfig = field(
        default_factory=BotExpressionConfig
    )
    letter: LetterConfig = field(default_factory=LetterConfig)
    llm: LLMConfig = field(default_factory=LLMConfig)
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
    "printer": PrinterConfig,
    "bot_expression": BotExpressionConfig,
    "letter": LetterConfig,
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


def _build_llm(values: object) -> LLMConfig:
    if values is None:
        return LLMConfig()
    if not isinstance(values, dict):
        raise ConfigurationError("llm must be a mapping")
    root_values = {
        key: value
        for key, value in values.items()
        if key not in {"session", "modes"}
    }
    public_fields = set(LLMConfig.__dataclass_fields__) - {"provider"}
    unknown = set(values) - public_fields
    if unknown:
        raise ConfigurationError(
            f"unknown llm options: {', '.join(sorted(unknown))}"
        )
    config = _build(LLMConfig, root_values, "llm")
    config.session = _build(
        LLMSessionConfig,
        values.get("session"),
        "llm.session",
    )
    modes_values = values.get("modes")
    if modes_values is None:
        modes_values = {}
    if not isinstance(modes_values, dict):
        raise ConfigurationError("llm.modes must be a mapping")
    unknown_modes = set(modes_values) - {"letter", "qa"}
    if unknown_modes:
        raise ConfigurationError(
            "unknown llm.modes options: "
            f"{', '.join(sorted(unknown_modes))}"
        )
    config.modes = LLMModesConfig(
        letter=_build(
            LLMModeConfig,
            modes_values.get("letter"),
            "llm.modes.letter",
        )
        if "letter" in modes_values
        else _letter_mode_defaults(),
        qa=_build(
            LLMModeConfig,
            modes_values.get("qa"),
            "llm.modes.qa",
        )
        if "qa" in modes_values
        else _qa_mode_defaults(),
    )
    return config


_LLM_SEPARATORS = re.compile(
    r"[\s，。！？、,.!?;；:：\"'“”‘’（）()\[\]【】]+"
)


def _normalize_llm_phrase(value: str) -> str:
    return _LLM_SEPARATORS.sub("", value).casefold()


def _validate_phrase_list(
    value: object,
    name: str,
    *,
    allow_empty: bool = False,
) -> None:
    if (
        not isinstance(value, list)
        or (not allow_empty and not value)
        or not all(
        isinstance(item, str) and item.strip()
        for item in value
        )
    ):
        raise ConfigurationError(f"{name} must contain non-empty strings")


def _validate_llm(config: LLMConfig) -> None:
    if not isinstance(config.enabled, bool):
        raise ConfigurationError("llm.enabled must be a boolean")
    if config.enabled:
        for name, value in (
            ("llm.log_path", config.log_path),
            ("llm.user_nickname", config.user_nickname),
        ):
            if not isinstance(value, str) or not value.strip():
                raise ConfigurationError(f"{name} cannot be empty")
    for name, value in (
        ("llm.timeout_seconds", config.timeout_seconds),
        (
            "llm.session.idle_timeout_seconds",
            config.session.idle_timeout_seconds,
        ),
        (
            "llm.session.max_duration_seconds",
            config.session.max_duration_seconds,
        ),
    ):
        _positive(value, name)
    _positive_int(config.max_output_tokens, "llm.max_output_tokens")
    _positive_int(
        config.session.max_characters,
        "llm.session.max_characters",
    )
    if (
        isinstance(config.temperature, bool)
        or not isinstance(config.temperature, (int, float))
        or config.temperature < 0
    ):
        raise ConfigurationError(
            "llm.temperature must be a non-negative number"
        )
    _validate_phrase_list(
        config.session.body_prefixes,
        "llm.session.body_prefixes",
    )

    starts_by_mode: dict[str, set[str]] = {}
    for mode_name, mode in (
        ("letter", config.modes.letter),
        ("qa", config.modes.qa),
    ):
        for field_name in (
            "start_phrases",
            "finish_phrases",
            "cancel_phrases",
        ):
            _validate_phrase_list(
                getattr(mode, field_name),
                f"llm.modes.{mode_name}.{field_name}",
            )
        for field_name in ("recipient_templates", "recipient_prefixes"):
            _validate_phrase_list(
                getattr(mode, field_name),
                f"llm.modes.{mode_name}.{field_name}",
                allow_empty=True,
            )
        if mode_name == "letter" and not (
            mode.start_phrases or mode.recipient_templates
        ):
            raise ConfigurationError(
                "letter mode requires a start phrase or recipient template"
            )
        for template in mode.recipient_templates:
            if template.count("{recipient}") != 1:
                raise ConfigurationError(
                    "each recipient template must contain exactly one "
                    "{recipient}"
                )
        finish = {
            _normalize_llm_phrase(item)
            for item in mode.finish_phrases
        }
        cancel = {
            _normalize_llm_phrase(item)
            for item in mode.cancel_phrases
        }
        if finish & cancel:
            raise ConfigurationError(
                f"llm.modes.{mode_name} finish and cancel phrases overlap"
            )
        starts_by_mode[mode_name] = {
            _normalize_llm_phrase(item)
            for item in (*mode.start_phrases, *mode.recipient_templates)
        }
    if starts_by_mode["letter"] & starts_by_mode["qa"]:
        raise ConfigurationError("letter and qa start rules overlap")


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
        ("keywords.photo_print", config.keywords.photo_print),
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
    if not isinstance(config.printer.enabled, bool):
        raise ConfigurationError("printer.enabled must be a boolean")
    if not isinstance(config.printer.base_url, str) or not (
        config.printer.base_url.strip()
    ):
        raise ConfigurationError("printer.base_url cannot be empty")
    for name, value in (
        ("printer.width", config.printer.width),
        ("printer.max_chunk_height", config.printer.max_chunk_height),
        ("printer.pixel_size", config.printer.pixel_size),
    ):
        _positive_int(value, name)
    if (
        isinstance(config.printer.grayscale_levels, bool)
        or not isinstance(config.printer.grayscale_levels, int)
        or not 2 <= config.printer.grayscale_levels <= 256
    ):
        raise ConfigurationError(
            "printer.grayscale_levels must be between 2 and 256"
        )
    for name, value in (
        ("printer.contrast", config.printer.contrast),
        ("printer.brightness", config.printer.brightness),
        ("printer.timeout_seconds", config.printer.timeout_seconds),
        ("printer.cooldown_seconds", config.printer.cooldown_seconds),
    ):
        _positive(value, name)
    for name, value in (
        ("printer.dither", config.printer.dither),
        ("printer.rotate_180", config.printer.rotate_180),
    ):
        if not isinstance(value, bool):
            raise ConfigurationError(f"{name} must be a boolean")
    if not isinstance(config.bot_expression.enabled, bool):
        raise ConfigurationError("bot_expression.enabled must be a boolean")
    if (
        not isinstance(config.bot_expression.base_url, str)
        or not config.bot_expression.base_url.strip()
    ):
        raise ConfigurationError("bot_expression.base_url cannot be empty")
    if (
        not isinstance(config.bot_expression.endpoint, str)
        or not config.bot_expression.endpoint.startswith("/")
    ):
        raise ConfigurationError(
            "bot_expression.endpoint must start with '/'"
        )
    _positive(
        config.bot_expression.timeout_seconds,
        "bot_expression.timeout_seconds",
    )
    _positive(
        config.bot_expression.action_duration_seconds,
        "bot_expression.action_duration_seconds",
    )
    for name, value in (
        ("letter.enabled", config.letter.enabled),
        ("letter.auto_print", config.letter.auto_print),
        ("letter.show_signature", config.letter.show_signature),
    ):
        if not isinstance(value, bool):
            raise ConfigurationError(f"{name} must be a boolean")
    if not isinstance(config.letter.output_dir, str) or not (
        config.letter.output_dir.strip()
    ):
        raise ConfigurationError("letter.output_dir cannot be empty")
    if not isinstance(config.letter.font_path, str):
        raise ConfigurationError("letter.font_path must be a string")
    if config.letter.stamp_selection not in {"fixed", "random"}:
        raise ConfigurationError(
            "letter.stamp_selection must be 'fixed' or 'random'"
        )
    available_stamps = {"flower", "moon", "envelope"}
    if (
        not isinstance(config.letter.stamp_themes, list)
        or not config.letter.stamp_themes
        or not all(
            isinstance(item, str) and item in available_stamps
            for item in config.letter.stamp_themes
        )
    ):
        raise ConfigurationError(
            "letter.stamp_themes must contain supported stamp names"
        )
    if config.letter.postmark_style not in {"wave_date", "none"}:
        raise ConfigurationError(
            "letter.postmark_style must be 'wave_date' or 'none'"
        )
    _positive_int(
        config.letter.max_print_characters,
        "letter.max_print_characters",
    )
    _validate_llm(config.llm)
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


_LLM_PROVIDER_FIELDS = {"base_url", "model", "api_key"}


def _load_llm_provider(path: Path) -> LLMProviderConfig | None:
    if not path.is_file():
        return None
    loaded = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    if not isinstance(loaded, dict):
        raise ConfigurationError("llm provider config must be a mapping")
    unknown = set(loaded) - _LLM_PROVIDER_FIELDS
    if unknown:
        raise ConfigurationError(
            "unknown llm provider options: "
            f"{', '.join(sorted(unknown))}"
        )
    provider = _build(LLMProviderConfig, loaded, "llm provider")
    for name in ("base_url", "model", "api_key"):
        value = getattr(provider, name)
        if not isinstance(value, str) or not value.strip():
            raise ConfigurationError(
                f"llm provider {name} cannot be empty"
            )
    return provider


def load_config(
    path: Path | str | None = None,
    llm_path: Path | str | None = None,
) -> AppConfig:
    data: dict[str, Any] = {}
    config_path: Path | None = None
    if path is not None:
        config_path = Path(path)
        if not config_path.is_file():
            raise ConfigurationError(f"config file not found: {config_path}")
        loaded = yaml.safe_load(config_path.read_text(encoding="utf-8")) or {}
        if not isinstance(loaded, dict):
            raise ConfigurationError("config root must be a mapping")
        data = loaded
    unknown = set(data) - (set(_SECTIONS) | {"llm"})
    if unknown:
        raise ConfigurationError(
            f"unknown config sections: {', '.join(sorted(unknown))}"
        )
    config = AppConfig(
        **{
            name: _build(cls, data.get(name), name)
            for name, cls in _SECTIONS.items()
        },
        llm=_build_llm(data.get("llm")),
    )
    if config.llm.enabled:
        provider_path = (
            Path(llm_path)
            if llm_path is not None
            else (
                config_path.with_name("llm.yaml")
                if config_path is not None
                else None
            )
        )
        if provider_path is not None:
            config.llm.provider = _load_llm_provider(provider_path)
    _validate(config)
    return config
