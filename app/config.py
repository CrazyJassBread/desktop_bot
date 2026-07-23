"""Configuration loading with defaults and lightweight type validation."""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, TypeVar

import yaml

from app.schemas import InteractionMode

T = TypeVar("T")


class ConfigurationError(ValueError):
    """Raised when configuration values are invalid."""


@dataclass
class AudioConfig:
    target_sample_rate: int = 16_000
    min_duration_seconds: float = 0.25
    max_duration_seconds: float = 30.0
    normalize: bool = True
    trim_silence: bool = False


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
class InteractionConfig:
    default_mode: str = "command"
    unmatched_command_behavior: str = "guide"
    max_history_turns: int = 6


@dataclass
class CommandConfig:
    fuzzy_match: bool = True
    fuzzy_threshold: float = 82.0
    ambiguity_margin: float = 8.0
    dangerous_action_threshold: float = 90.0


@dataclass
class LLMConfig:
    backend: str = "mock"
    model: str = ""
    base_url: str | None = None
    api_key_env: str = "OPENAI_API_KEY"
    timeout_seconds: float = 30.0
    max_display_chars: int = 120
    max_spoken_chars: int = 180
    history_enabled: bool = True


@dataclass
class OutputConfig:
    adapter: str = "console"
    json_output_path: str = "output/latest_response.json"


@dataclass
class VADConfig:
    enabled: bool = True
    backend: str = "silero"
    model: str = "bundled"
    speech_threshold: float = 0.60
    release_threshold: float = 0.35
    min_speech_duration_ms: int = 250
    min_silence_duration_ms: int = 800
    speech_pad_ms: int = 200
    pre_roll_ms: int = 200
    max_utterance_seconds: float = 45.0


@dataclass
class WakeWordConfig:
    enabled: bool = True
    backend: str = "mock"
    phrase: str = "小A"
    aliases: list[str] = field(
        default_factory=lambda: ["小a", "小 A", "小诶", "小爱"]
    )
    score_threshold: float = 0.70
    cooldown_ms: int = 1_500
    pre_roll_ms: int = 2_000
    activation_timeout_seconds: float = 5.0
    single_turn: bool = True


@dataclass
class VisionConfig:
    enabled: bool = False
    backend: str = "mediapipe"
    gesture_model: str = "models/gesture_recognizer.task"
    image_width: int = 640
    image_height: int = 480
    max_image_bytes: int = 2_097_152
    cache_capacity: int = 20
    max_hands: int = 2
    score_threshold: float = 0.70
    mode_window_size: int = 5
    mode_required_hits: int = 3
    release_frames: int = 2
    game_window_size: int = 3
    game_required_hits: int = 2


@dataclass
class ServicesConfig:
    time_enabled: bool = True
    runner_game_enabled: bool = True
    letter_enabled: bool = False


@dataclass
class PrintingConfig:
    enabled: bool = False
    adapter: str = "mock"
    max_pages_per_job: int = 10
    max_pending_jobs: int = 20
    letter_print_policy: str = "require_confirmation"


@dataclass
class RemoteConfig:
    enabled: bool = False
    adapter: str = "webhook"
    timestamp_tolerance_seconds: int = 300


@dataclass
class AppConfig:
    audio: AudioConfig = field(default_factory=AudioConfig)
    asr: ASRConfig = field(default_factory=ASRConfig)
    interaction: InteractionConfig = field(default_factory=InteractionConfig)
    command: CommandConfig = field(default_factory=CommandConfig)
    llm: LLMConfig = field(default_factory=LLMConfig)
    output: OutputConfig = field(default_factory=OutputConfig)
    vad: VADConfig = field(default_factory=VADConfig)
    wake_word: WakeWordConfig = field(default_factory=WakeWordConfig)
    vision: VisionConfig = field(default_factory=VisionConfig)
    services: ServicesConfig = field(default_factory=ServicesConfig)
    printing: PrintingConfig = field(default_factory=PrintingConfig)
    remote: RemoteConfig = field(default_factory=RemoteConfig)


def _section(data: dict[str, Any], name: str) -> dict[str, Any]:
    value = data.get(name, {})
    if not isinstance(value, dict):
        raise ConfigurationError(f"{name} must be a mapping")
    return value


def _build(cls: type[T], values: dict[str, Any]) -> T:
    allowed = cls.__dataclass_fields__  # type: ignore[attr-defined]
    unknown = set(values) - set(allowed)
    if unknown:
        raise ConfigurationError(
            f"unknown {cls.__name__} options: {', '.join(sorted(unknown))}"
        )
    try:
        return cls(**values)
    except TypeError as exc:
        raise ConfigurationError(str(exc)) from exc


def _validate(config: AppConfig) -> None:
    scalar_types = (
        (config.audio.target_sample_rate, int, "audio.target_sample_rate"),
        (config.audio.min_duration_seconds, (int, float), "audio.min_duration_seconds"),
        (config.audio.max_duration_seconds, (int, float), "audio.max_duration_seconds"),
        (config.audio.normalize, bool, "audio.normalize"),
        (config.audio.trim_silence, bool, "audio.trim_silence"),
        (config.asr.backend, str, "asr.backend"),
        (config.asr.model, str, "asr.model"),
        (config.asr.model_dir, str, "asr.model_dir"),
        (config.asr.device, str, "asr.device"),
        (config.asr.compute_type, str, "asr.compute_type"),
        (config.asr.language, str, "asr.language"),
        (config.interaction.default_mode, str, "interaction.default_mode"),
        (
            config.interaction.unmatched_command_behavior,
            str,
            "interaction.unmatched_command_behavior",
        ),
        (
            config.interaction.max_history_turns,
            int,
            "interaction.max_history_turns",
        ),
        (config.command.fuzzy_match, bool, "command.fuzzy_match"),
        (
            config.command.fuzzy_threshold,
            (int, float),
            "command.fuzzy_threshold",
        ),
        (
            config.command.ambiguity_margin,
            (int, float),
            "command.ambiguity_margin",
        ),
        (
            config.command.dangerous_action_threshold,
            (int, float),
            "command.dangerous_action_threshold",
        ),
        (config.llm.backend, str, "llm.backend"),
        (config.llm.model, str, "llm.model"),
        (config.llm.api_key_env, str, "llm.api_key_env"),
        (config.llm.timeout_seconds, (int, float), "llm.timeout_seconds"),
        (config.llm.max_display_chars, int, "llm.max_display_chars"),
        (config.llm.max_spoken_chars, int, "llm.max_spoken_chars"),
        (config.llm.history_enabled, bool, "llm.history_enabled"),
        (config.output.adapter, str, "output.adapter"),
        (config.output.json_output_path, str, "output.json_output_path"),
        (config.vad.enabled, bool, "vad.enabled"),
        (config.vad.backend, str, "vad.backend"),
        (config.vad.model, str, "vad.model"),
        (config.vad.speech_threshold, (int, float), "vad.speech_threshold"),
        (config.vad.release_threshold, (int, float), "vad.release_threshold"),
        (config.vad.min_speech_duration_ms, int, "vad.min_speech_duration_ms"),
        (config.vad.min_silence_duration_ms, int, "vad.min_silence_duration_ms"),
        (config.vad.speech_pad_ms, int, "vad.speech_pad_ms"),
        (config.vad.pre_roll_ms, int, "vad.pre_roll_ms"),
        (
            config.vad.max_utterance_seconds,
            (int, float),
            "vad.max_utterance_seconds",
        ),
        (config.wake_word.enabled, bool, "wake_word.enabled"),
        (config.wake_word.backend, str, "wake_word.backend"),
        (config.wake_word.phrase, str, "wake_word.phrase"),
        (
            config.wake_word.score_threshold,
            (int, float),
            "wake_word.score_threshold",
        ),
        (config.wake_word.cooldown_ms, int, "wake_word.cooldown_ms"),
        (config.wake_word.pre_roll_ms, int, "wake_word.pre_roll_ms"),
        (
            config.wake_word.activation_timeout_seconds,
            (int, float),
            "wake_word.activation_timeout_seconds",
        ),
        (config.wake_word.single_turn, bool, "wake_word.single_turn"),
        (config.vision.enabled, bool, "vision.enabled"),
        (config.vision.backend, str, "vision.backend"),
        (config.vision.gesture_model, str, "vision.gesture_model"),
        (config.vision.image_width, int, "vision.image_width"),
        (config.vision.image_height, int, "vision.image_height"),
        (config.vision.max_image_bytes, int, "vision.max_image_bytes"),
        (config.vision.cache_capacity, int, "vision.cache_capacity"),
        (config.vision.max_hands, int, "vision.max_hands"),
        (
            config.vision.score_threshold,
            (int, float),
            "vision.score_threshold",
        ),
        (config.vision.mode_window_size, int, "vision.mode_window_size"),
        (config.vision.mode_required_hits, int, "vision.mode_required_hits"),
        (config.vision.release_frames, int, "vision.release_frames"),
        (config.vision.game_window_size, int, "vision.game_window_size"),
        (config.vision.game_required_hits, int, "vision.game_required_hits"),
        (config.services.time_enabled, bool, "services.time_enabled"),
        (
            config.services.runner_game_enabled,
            bool,
            "services.runner_game_enabled",
        ),
        (config.services.letter_enabled, bool, "services.letter_enabled"),
        (config.printing.enabled, bool, "printing.enabled"),
        (config.printing.adapter, str, "printing.adapter"),
        (
            config.printing.max_pages_per_job,
            int,
            "printing.max_pages_per_job",
        ),
        (
            config.printing.max_pending_jobs,
            int,
            "printing.max_pending_jobs",
        ),
        (
            config.printing.letter_print_policy,
            str,
            "printing.letter_print_policy",
        ),
        (config.remote.enabled, bool, "remote.enabled"),
        (config.remote.adapter, str, "remote.adapter"),
        (
            config.remote.timestamp_tolerance_seconds,
            int,
            "remote.timestamp_tolerance_seconds",
        ),
    )
    for value, expected, name in scalar_types:
        if not isinstance(value, expected) or (
            isinstance(value, bool) and expected != bool
        ):
            raise ConfigurationError(f"{name} has an invalid type")
    if config.llm.base_url is not None and not isinstance(
        config.llm.base_url, str
    ):
        raise ConfigurationError("llm.base_url has an invalid type")
    if not isinstance(config.asr.mock_transcripts, dict) or not all(
        isinstance(key, str) and isinstance(value, str)
        for key, value in config.asr.mock_transcripts.items()
    ):
        raise ConfigurationError("asr.mock_transcripts must map strings to strings")
    if config.audio.target_sample_rate <= 0:
        raise ConfigurationError("audio.target_sample_rate must be positive")
    if not config.asr.model_dir.strip():
        raise ConfigurationError("asr.model_dir cannot be empty")
    if config.audio.min_duration_seconds < 0:
        raise ConfigurationError("audio.min_duration_seconds cannot be negative")
    if config.audio.max_duration_seconds <= config.audio.min_duration_seconds:
        raise ConfigurationError("audio maximum duration must exceed minimum duration")
    if config.interaction.default_mode not in set(InteractionMode):
        raise ConfigurationError("interaction.default_mode must be command or llm")
    if config.interaction.unmatched_command_behavior not in {
        "prompt",
        "guide",
        "llm",
    }:
        raise ConfigurationError(
            "interaction.unmatched_command_behavior must be prompt, guide, or llm"
        )
    if config.interaction.max_history_turns < 1:
        raise ConfigurationError("interaction.max_history_turns must be positive")
    if not 0 <= config.command.fuzzy_threshold <= 100:
        raise ConfigurationError("command.fuzzy_threshold must be between 0 and 100")
    if config.command.ambiguity_margin < 0:
        raise ConfigurationError("command.ambiguity_margin cannot be negative")
    if config.llm.max_display_chars < 1 or config.llm.max_spoken_chars < 1:
        raise ConfigurationError("LLM response limits must be positive")
    if not 0 <= config.vad.release_threshold <= config.vad.speech_threshold <= 1:
        raise ConfigurationError(
            "VAD thresholds must satisfy 0 <= release <= speech <= 1"
        )
    if (
        config.vad.min_speech_duration_ms < 0
        or config.vad.min_silence_duration_ms < 0
        or config.vad.pre_roll_ms < 0
        or config.vad.speech_pad_ms < 0
        or config.vad.max_utterance_seconds <= 0
    ):
        raise ConfigurationError("VAD durations must be non-negative and bounded")
    if not config.wake_word.phrase.strip():
        raise ConfigurationError("wake_word.phrase cannot be empty")
    if not isinstance(config.wake_word.aliases, list) or not all(
        isinstance(item, str) and item.strip()
        for item in config.wake_word.aliases
    ):
        raise ConfigurationError("wake_word.aliases must be non-empty strings")
    if not 0 <= config.wake_word.score_threshold <= 1:
        raise ConfigurationError(
            "wake_word.score_threshold must be between 0 and 1"
        )
    if (
        config.wake_word.cooldown_ms < 0
        or config.wake_word.pre_roll_ms < 0
        or config.wake_word.activation_timeout_seconds <= 0
    ):
        raise ConfigurationError("wake word timings are invalid")
    if (
        config.vision.image_width <= 0
        or config.vision.image_height <= 0
        or config.vision.max_image_bytes <= 0
        or config.vision.cache_capacity <= 0
        or config.vision.max_hands <= 0
    ):
        raise ConfigurationError("vision sizes and capacities must be positive")
    if not 0 <= config.vision.score_threshold <= 1:
        raise ConfigurationError("vision.score_threshold must be between 0 and 1")
    if not 1 <= config.vision.mode_required_hits <= config.vision.mode_window_size:
        raise ConfigurationError("invalid vision mode temporal filter")
    if not 1 <= config.vision.game_required_hits <= config.vision.game_window_size:
        raise ConfigurationError("invalid vision game temporal filter")
    if config.vision.release_frames < 1:
        raise ConfigurationError("vision.release_frames must be positive")
    if config.printing.max_pages_per_job < 1 or config.printing.max_pending_jobs < 1:
        raise ConfigurationError("printing limits must be positive")
    if config.printing.letter_print_policy not in {
        "notify_only",
        "require_confirmation",
        "auto_print",
    }:
        raise ConfigurationError("invalid printing.letter_print_policy")
    if config.remote.timestamp_tolerance_seconds < 0:
        raise ConfigurationError(
            "remote.timestamp_tolerance_seconds cannot be negative"
        )


def load_config(path: Path | str | None = None) -> AppConfig:
    """Load YAML configuration, applying defaults for omitted options."""
    data: dict[str, Any] = {}
    if path is not None:
        config_path = Path(path)
        if not config_path.is_file():
            raise ConfigurationError(f"config file not found: {config_path}")
        loaded = yaml.safe_load(config_path.read_text(encoding="utf-8")) or {}
        if not isinstance(loaded, dict):
            raise ConfigurationError("config root must be a mapping")
        data = loaded
    known_sections = {
        "audio",
        "asr",
        "interaction",
        "command",
        "llm",
        "output",
        "vad",
        "wake_word",
        "vision",
        "services",
        "printing",
        "remote",
    }
    unknown_sections = set(data) - known_sections
    if unknown_sections:
        raise ConfigurationError(
            f"unknown config sections: {', '.join(sorted(unknown_sections))}"
        )

    config = AppConfig(
        audio=_build(AudioConfig, _section(data, "audio")),
        asr=_build(ASRConfig, _section(data, "asr")),
        interaction=_build(InteractionConfig, _section(data, "interaction")),
        command=_build(CommandConfig, _section(data, "command")),
        llm=_build(LLMConfig, _section(data, "llm")),
        output=_build(OutputConfig, _section(data, "output")),
        vad=_build(VADConfig, _section(data, "vad")),
        wake_word=_build(WakeWordConfig, _section(data, "wake_word")),
        vision=_build(VisionConfig, _section(data, "vision")),
        services=_build(ServicesConfig, _section(data, "services")),
        printing=_build(PrintingConfig, _section(data, "printing")),
        remote=_build(RemoteConfig, _section(data, "remote")),
    )
    _validate(config)
    return config
