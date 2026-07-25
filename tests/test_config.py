import pytest

from app.config import ConfigurationError, load_config
from app.hardware_main import build_parser


def test_config_defaults():
    config = load_config()
    assert config.audio.target_sample_rate == 16_000
    assert config.hardware.audio_port == 8081
    assert config.hardware.vision_port == 8082
    assert config.keywords.wake
    assert config.perception.vision_max_fps == 5
    assert config.application.photo_delay_seconds == 2
    assert config.application.default_language == "zh"
    assert config.api.port == 8090


def test_repository_config_loads():
    config = load_config("config")
    assert config.asr.backend == "faster_whisper"
    assert config.vision.enabled is True
    assert config.llm.backend == "deepseek"
    assert config.keywords.end_letter
    assert config.keywords.start_qa


def test_config_directory_merges_sections(tmp_path):
    (tmp_path / "one.yaml").write_text(
        "audio:\n  target_sample_rate: 16000\n", encoding="utf-8"
    )
    (tmp_path / "two.yaml").write_text(
        "llm:\n  backend: mock\n", encoding="utf-8"
    )
    config = load_config(tmp_path)
    assert config.audio.target_sample_rate == 16_000
    assert config.llm.backend == "mock"


def test_config_directory_rejects_duplicate_sections(tmp_path):
    (tmp_path / "one.yaml").write_text(
        "audio:\n  target_sample_rate: 16000\n", encoding="utf-8"
    )
    (tmp_path / "two.yaml").write_text(
        "audio:\n  target_sample_rate: 16000\n", encoding="utf-8"
    )
    with pytest.raises(ConfigurationError):
        load_config(tmp_path)


def test_config_rejects_unknown_llm_backend(tmp_path):
    path = tmp_path / "config.yaml"
    path.write_text("llm:\n  backend: gpt9\n", encoding="utf-8")
    with pytest.raises(ConfigurationError):
        load_config(path)


def test_config_rejects_non_positive_llm_silence_timeout(tmp_path):
    path = tmp_path / "config.yaml"
    path.write_text(
        "llm:\n  backend: mock\n  silence_timeout_seconds: 0\n",
        encoding="utf-8",
    )
    with pytest.raises(ConfigurationError):
        load_config(path)


def test_config_accepts_inline_llm_api_key(tmp_path):
    path = tmp_path / "config.yaml"
    path.write_text(
        "llm:\n  backend: deepseek\n  api_key: sk-test\n  api_key_env: ''\n",
        encoding="utf-8",
    )
    config = load_config(path)
    assert config.llm.api_key == "sk-test"


def test_config_requires_some_llm_api_key_source(tmp_path):
    path = tmp_path / "config.yaml"
    path.write_text(
        "llm:\n  backend: deepseek\n  api_key: ''\n  api_key_env: ''\n",
        encoding="utf-8",
    )
    with pytest.raises(ConfigurationError):
        load_config(path)


def test_config_ui_defaults_to_disabled():
    config = load_config()
    assert config.ui.enabled is False
    assert config.ui.base_url == "http://127.0.0.1:18000"


def test_repository_ui_config_enables_delivery():
    config = load_config("config")
    assert config.ui.enabled is True
    assert config.ui.device_token


def test_config_ui_enabled_requires_device_token(tmp_path):
    path = tmp_path / "config.yaml"
    path.write_text(
        "ui:\n  enabled: true\n  device_token: ''\n",
        encoding="utf-8",
    )
    with pytest.raises(ConfigurationError):
        load_config(path)


def test_config_ui_enabled_requires_base_url(tmp_path):
    path = tmp_path / "config.yaml"
    path.write_text(
        "ui:\n  enabled: true\n  base_url: ''\n  device_token: tok\n",
        encoding="utf-8",
    )
    with pytest.raises(ConfigurationError):
        load_config(path)


def test_config_ui_rejects_non_positive_timeout(tmp_path):
    path = tmp_path / "config.yaml"
    path.write_text(
        "ui:\n  timeout_seconds: 0\n",
        encoding="utf-8",
    )
    with pytest.raises(ConfigurationError):
        load_config(path)


def test_config_rejects_wrong_type(tmp_path):
    path = tmp_path / "config.yaml"
    path.write_text("audio:\n  target_sample_rate: sixteen\n", encoding="utf-8")
    with pytest.raises(ConfigurationError):
        load_config(path)


def test_config_rejects_unknown_section(tmp_path):
    path = tmp_path / "config.yaml"
    path.write_text("toaster:\n  backend: mock\n", encoding="utf-8")
    with pytest.raises(ConfigurationError):
        load_config(path)


def test_config_printer_defaults_to_disabled():
    config = load_config()
    assert config.printer.enabled is False
    assert config.printer.pixel_size == 4
    assert config.printer.grayscale_levels == 4
    assert config.printer.max_chunk_height == 1200
    assert config.keywords.take_photo
    assert config.application.voice_photo_delay_seconds == 1.0


def test_repository_printer_config_loads():
    config = load_config("config")
    assert config.printer.base_url.startswith("http://")
    assert "拍照" in config.keywords.take_photo


def test_config_printer_enabled_requires_base_url(tmp_path):
    path = tmp_path / "config.yaml"
    path.write_text(
        "printer:\n  enabled: true\n  base_url: ''\n",
        encoding="utf-8",
    )
    with pytest.raises(ConfigurationError):
        load_config(path)


def test_config_printer_rejects_invalid_grayscale_levels(tmp_path):
    path = tmp_path / "config.yaml"
    path.write_text(
        "printer:\n  grayscale_levels: 1\n",
        encoding="utf-8",
    )
    with pytest.raises(ConfigurationError):
        load_config(path)


def test_config_rejects_empty_take_photo_keywords(tmp_path):
    path = tmp_path / "config.yaml"
    path.write_text(
        "keywords:\n  take_photo:\n    - ' '\n",
        encoding="utf-8",
    )
    with pytest.raises(ConfigurationError):
        load_config(path)


def test_config_rejects_non_positive_voice_photo_delay(tmp_path):
    path = tmp_path / "config.yaml"
    path.write_text(
        "application:\n  voice_photo_delay_seconds: 0\n",
        encoding="utf-8",
    )
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
        "hardware:\n  audio_port: 8081\n  vision_port: 8081\n",
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
