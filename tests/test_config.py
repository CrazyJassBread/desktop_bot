import pytest

from app.config import ConfigurationError, load_config
from app.hardware_main import build_parser


def test_config_defaults():
    config = load_config()
    assert config.audio.target_sample_rate == 16_000
    assert config.hardware.audio_port == 8080
    assert config.hardware.vision_port == 8081
    assert config.keywords.wake
    assert config.perception.vision_max_fps == 5
    assert config.application.photo_delay_seconds == 2
    assert config.application.default_language == "zh"
    assert config.api.port == 8090


def test_repository_config_loads():
    config = load_config("config.yaml")
    assert config.asr.backend == "faster_whisper"
    assert config.vision.enabled is True


def test_config_rejects_wrong_type(tmp_path):
    path = tmp_path / "config.yaml"
    path.write_text("audio:\n  target_sample_rate: sixteen\n", encoding="utf-8")
    with pytest.raises(ConfigurationError):
        load_config(path)


def test_config_rejects_unknown_section(tmp_path):
    path = tmp_path / "config.yaml"
    path.write_text("llm:\n  backend: mock\n", encoding="utf-8")
    with pytest.raises(ConfigurationError):
        load_config(path)


def test_config_rejects_unknown_option(tmp_path):
    path = tmp_path / "config.yaml"
    path.write_text("audio:\n  surprise: true\n", encoding="utf-8")
    with pytest.raises(ConfigurationError):
        load_config(path)


def test_config_rejects_conflicting_hardware_ports(tmp_path):
    path = tmp_path / "config.yaml"
    path.write_text(
        "hardware:\n  audio_port: 8080\n  vision_port: 8080\n",
        encoding="utf-8",
    )
    with pytest.raises(ConfigurationError):
        load_config(path)


def test_app_cli_supports_vision_test_mode():
    args = build_parser().parse_args(
        ["test", "--vision-port", "9000", "--scale", "1.5"]
    )
    assert args.mode == "test"
    assert args.vision_port == 9000
    assert args.scale == 1.5
