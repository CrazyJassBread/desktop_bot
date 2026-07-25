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
    audio_port: int = 8081
    audio_frame_samples: int = 512
    audio_queue_size: int = 256
    vision_enabled: bool = True
    vision_host: str = "0.0.0.0"
    vision_port: int = 8082
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
        default_factory=lambda: ["进入聊天模式", "开始聊天"]
    )
    exit_chat: list[str] = field(
        default_factory=lambda: ["退出聊天模式", "结束聊天", "返回普通模式"]
    )
    write_letter: list[str] = field(
        default_factory=lambda: ["开始写信", "帮我写信", "我要写一封信"]
    )
    end_letter: list[str] = field(
        default_factory=lambda: ["结束写信", "写完了", "信写完了"]
    )
    start_qa: list[str] = field(
        default_factory=lambda: ["我有一个问题", "智能问答", "请回答我的问题"]
    )
    end_qa: list[str] = field(
        default_factory=lambda: ["结束问答", "问完了"]
    )
    take_photo: list[str] = field(
        default_factory=lambda: [
            # Longer phrases first so the plain "拍照" fallback does not
            # leave leading words behind in the payload text.
            "帮我拍照",
            "拍张照",
            "拍照",
            "take a photo",
            "take a picture",
        ]
    )
    switch_to_english: list[str] = field(
        default_factory=lambda: [
            "切换英文",
            "切换到英文",
            "英文模式",
            "switch to English",
            "English mode",
        ]
    )
    switch_to_chinese: list[str] = field(
        default_factory=lambda: [
            "切换中文",
            "切换到中文",
            "中文模式",
            "switch to Chinese",
            "Chinese mode",
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
    photo_delay_seconds: float = 2.0
    voice_photo_delay_seconds: float = 1.0
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


_DEFAULT_LETTER_PROMPT = (
    "你是一位文笔优美的书信作者。请把用户口述的零散内容整理成一封完整的中文信件："
    "清除口语赘词与重复，保留原意与关键信息，文风文艺优美、真挚自然。"
    "同时从口述内容中识别收信人是谁。只输出一个 JSON 对象，不要任何解释，格式为："
    '{"recipient": "收信人称呼，识别不出时为 null", "subject": "简短主题", '
    '"body": "信件正文"}'
)
_DEFAULT_QA_PROMPT = (
    "你是一个简洁的语音问答助手。请从用户口述内容中找出问题，"
    "用简短、直接的中文回答。只输出答案本身，不要重复问题，不要多余解释。"
)
_DEFAULT_LETTER_PROMPT_EN = (
    "You are a letter writer with a graceful style. Turn the user's dictated "
    "fragments into one complete English letter: remove filler words and "
    "repetition, keep the original meaning and key details, and do not "
    "embellish or invent content. Also identify the recipient from the "
    "dictation. Output exactly one JSON object with no explanation, in the "
    'format: {"recipient": "name or null when unknown", '
    '"subject": "short subject", "body": "letter body"}'
)
_DEFAULT_QA_PROMPT_EN = (
    "You are a concise voice Q&A assistant. Find the question in the user's "
    "dictation and answer it in short, direct English. Output only the "
    "answer itself, without repeating the question or adding explanations."
)


@dataclass
class LLMConfig:
    backend: str = "disabled"
    base_url: str = "https://api.deepseek.com"
    model: str = "deepseek-v4-flash"
    api_key: str = ""
    api_key_env: str = "DEEPSEEK_API_KEY"
    temperature: float = 1.0
    max_tokens: int = 900
    timeout_seconds: float = 40.0
    silence_timeout_seconds: float = 10.0
    letter_system_prompt: str = _DEFAULT_LETTER_PROMPT
    qa_system_prompt: str = _DEFAULT_QA_PROMPT
    letter_system_prompt_en: str = _DEFAULT_LETTER_PROMPT_EN
    qa_system_prompt_en: str = _DEFAULT_QA_PROMPT_EN


@dataclass
class UIConfig:
    enabled: bool = False
    base_url: str = "http://127.0.0.1:18000"
    device_token: str = ""
    timeout_seconds: float = 15.0


@dataclass
class PrinterConfig:
    enabled: bool = False
    base_url: str = "http://10.76.10.141"
    timeout_seconds: float = 30.0
    pixel_size: int = 4
    grayscale_levels: int = 4
    contrast: float = 1.2
    brightness: float = 1.0
    dither: bool = True
    rotate_180: bool = False
    max_chunk_height: int = 1200
    print_answers: bool = False
    font_path: str = "/System/Library/Fonts/Hiragino Sans GB.ttc"
    letter_batch_height: int = 900


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
    llm: LLMConfig = field(default_factory=LLMConfig)
    ui: UIConfig = field(default_factory=UIConfig)
    printer: PrinterConfig = field(default_factory=PrinterConfig)


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
    "llm": LLMConfig,
    "ui": UIConfig,
    "printer": PrinterConfig,
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
        ("keywords.end_letter", config.keywords.end_letter),
        ("keywords.start_qa", config.keywords.start_qa),
        ("keywords.end_qa", config.keywords.end_qa),
        ("keywords.take_photo", config.keywords.take_photo),
        ("keywords.switch_to_english", config.keywords.switch_to_english),
        ("keywords.switch_to_chinese", config.keywords.switch_to_chinese),
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
        config.application.voice_photo_delay_seconds,
        "application.voice_photo_delay_seconds",
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
    if config.llm.backend not in {"deepseek", "mock", "disabled"}:
        raise ConfigurationError(
            "llm.backend must be one of: deepseek, mock, disabled"
        )
    _positive(config.llm.timeout_seconds, "llm.timeout_seconds")
    _positive(
        config.llm.silence_timeout_seconds,
        "llm.silence_timeout_seconds",
    )
    _positive_int(config.llm.max_tokens, "llm.max_tokens")
    if isinstance(config.llm.temperature, bool) or not isinstance(
        config.llm.temperature, (int, float)
    ):
        raise ConfigurationError("llm.temperature must be a number")
    if config.llm.temperature < 0:
        raise ConfigurationError("llm.temperature must be non-negative")
    if config.llm.backend != "disabled":
        for name, value in (
            ("llm.letter_system_prompt", config.llm.letter_system_prompt),
            ("llm.qa_system_prompt", config.llm.qa_system_prompt),
            (
                "llm.letter_system_prompt_en",
                config.llm.letter_system_prompt_en,
            ),
            ("llm.qa_system_prompt_en", config.llm.qa_system_prompt_en),
        ):
            if not isinstance(value, str) or not value.strip():
                raise ConfigurationError(f"{name} cannot be empty")
    if config.llm.backend == "deepseek":
        for name, value in (
            ("llm.base_url", config.llm.base_url),
            ("llm.model", config.llm.model),
        ):
            if not isinstance(value, str) or not value.strip():
                raise ConfigurationError(f"{name} cannot be empty")
        if not isinstance(config.llm.api_key, str) or not isinstance(
            config.llm.api_key_env, str
        ):
            raise ConfigurationError(
                "llm.api_key and llm.api_key_env must be strings"
            )
        if not config.llm.api_key.strip() and not config.llm.api_key_env.strip():
            raise ConfigurationError(
                "llm.api_key or llm.api_key_env must be provided"
            )
    _positive(config.ui.timeout_seconds, "ui.timeout_seconds")
    if config.ui.enabled:
        for name, value in (
            ("ui.base_url", config.ui.base_url),
            ("ui.device_token", config.ui.device_token),
        ):
            if not isinstance(value, str) or not value.strip():
                raise ConfigurationError(f"{name} cannot be empty")
    _positive(config.printer.timeout_seconds, "printer.timeout_seconds")
    _positive(config.printer.contrast, "printer.contrast")
    _positive(config.printer.brightness, "printer.brightness")
    _positive_int(config.printer.pixel_size, "printer.pixel_size")
    _positive_int(config.printer.max_chunk_height, "printer.max_chunk_height")
    _positive_int(config.printer.grayscale_levels, "printer.grayscale_levels")
    if not 2 <= config.printer.grayscale_levels <= 256:
        raise ConfigurationError(
            "printer.grayscale_levels must be between 2 and 256"
        )
    _positive_int(
        config.printer.letter_batch_height, "printer.letter_batch_height"
    )
    if config.printer.print_answers and not config.printer.enabled:
        raise ConfigurationError(
            "printer.print_answers requires printer.enabled=true"
        )
    if config.printer.enabled:
        if not isinstance(config.printer.base_url, str) or not (
            config.printer.base_url.strip()
        ):
            raise ConfigurationError("printer.base_url cannot be empty")


def _load_file(config_path: Path) -> dict[str, Any]:
    loaded = yaml.safe_load(config_path.read_text(encoding="utf-8")) or {}
    if not isinstance(loaded, dict):
        raise ConfigurationError(f"config root must be a mapping: {config_path}")
    return loaded


def _load_directory(config_dir: Path) -> dict[str, Any]:
    files = sorted(
        item
        for item in config_dir.iterdir()
        if item.is_file() and item.suffix in {".yaml", ".yml"}
    )
    if not files:
        raise ConfigurationError(f"no yaml files found in: {config_dir}")
    data: dict[str, Any] = {}
    seen: dict[str, Path] = {}
    for file_path in files:
        loaded = _load_file(file_path)
        for section in loaded:
            if section in seen:
                raise ConfigurationError(
                    f"config section '{section}' is defined in both "
                    f"{seen[section].name} and {file_path.name}"
                )
            seen[section] = file_path
        data.update(loaded)
    return data


def load_config(path: Path | str | None = None) -> AppConfig:
    data: dict[str, Any] = {}
    if path is not None:
        config_path = Path(path)
        if config_path.is_dir():
            data = _load_directory(config_path)
        elif config_path.is_file():
            data = _load_file(config_path)
        else:
            raise ConfigurationError(f"config path not found: {config_path}")
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
