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


@dataclass
class OutputConfig:
    adapter: str = "console"
    json_output_path: str = "output/latest_response.json"


@dataclass
class AppConfig:
    audio: AudioConfig = field(default_factory=AudioConfig)
    asr: ASRConfig = field(default_factory=ASRConfig)
    interaction: InteractionConfig = field(default_factory=InteractionConfig)
    command: CommandConfig = field(default_factory=CommandConfig)
    llm: LLMConfig = field(default_factory=LLMConfig)
    output: OutputConfig = field(default_factory=OutputConfig)


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
        (config.output.adapter, str, "output.adapter"),
        (config.output.json_output_path, str, "output.json_output_path"),
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
    )
    _validate(config)
    return config
