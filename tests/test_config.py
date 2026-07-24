import pytest

from app.config import ConfigurationError, load_config
from app.hardware_main import build_parser


def test_config_defaults():
    config = load_config()
    assert config.audio.target_sample_rate == 16_000
    assert config.hardware.audio_port == 8080
    assert config.hardware.vision_port == 8081
    assert config.keywords.wake
    assert config.keywords.photo_print
    assert config.perception.vision_max_fps == 5
    assert config.application.photo_delay_seconds == 1
    assert config.application.default_language == "zh"
    assert config.printer.base_url == "http://10.76.7.129"
    assert config.printer.width == 384
    assert config.printer.cooldown_seconds == 2
    assert config.llm.enabled is False
    assert config.llm.session.idle_timeout_seconds == 120
    assert config.llm.modes.letter.finish_phrases == [
        "小A，完成写信",
        "小A，信写完了",
    ]
    assert config.llm.modes.qa.cancel_phrases == [
        "小A，取消问答",
        "小A，不要回答了",
    ]
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


@pytest.mark.parametrize(
    "body",
    [
        'printer:\n  base_url: ""\n',
        "printer:\n  width: 0\n",
        "printer:\n  max_chunk_height: 0\n",
        "printer:\n  pixel_size: 0\n",
        "printer:\n  grayscale_levels: 1\n",
        "printer:\n  grayscale_levels: 257\n",
        "printer:\n  contrast: 0\n",
        "printer:\n  brightness: 0\n",
        "printer:\n  timeout_seconds: 0\n",
        "printer:\n  cooldown_seconds: -1\n",
    ],
)
def test_config_rejects_invalid_printer_settings(tmp_path, body):
    path = tmp_path / "config.yaml"
    path.write_text(body, encoding="utf-8")

    with pytest.raises(ConfigurationError):
        load_config(path)


def test_config_loads_nested_llm_overrides(tmp_path):
    path = tmp_path / "config.yaml"
    path.write_text(
        """
llm:
  enabled: true
  base_url: https://example.test/v1
  api_key_env: TEST_LLM_KEY
  model: test-model
  user_nickname: 小面包
  session:
    idle_timeout_seconds: 30
    max_duration_seconds: 300
    max_characters: 4000
    body_prefixes: ["内容："]
  modes:
    letter:
      start_phrases: ["写一封信"]
      recipient_templates: ["给{recipient}写信"]
      recipient_prefixes: ["收件人："]
      finish_phrases: ["完成信件"]
      cancel_phrases: ["取消信件"]
    qa:
      start_phrases: ["开始提问"]
      finish_phrases: ["请作答"]
      cancel_phrases: ["取消提问"]
""",
        encoding="utf-8",
    )

    config = load_config(path)

    assert config.llm.enabled is True
    assert config.llm.model == "test-model"
    assert config.llm.user_nickname == "小面包"
    assert config.llm.session.max_characters == 4000
    assert config.llm.modes.letter.recipient_templates == [
        "给{recipient}写信"
    ]
    assert config.llm.modes.qa.finish_phrases == ["请作答"]


@pytest.mark.parametrize(
    "llm_body",
    [
        "enabled: true\n",
        "session:\n    idle_timeout_seconds: 0\n",
        "session:\n    max_duration_seconds: -1\n",
        "session:\n    max_characters: 0\n",
        "modes:\n    letter:\n      finish_phrases: []\n",
        (
            "modes:\n    letter:\n"
            "      recipient_templates: ['我要写信']\n"
        ),
        (
            "modes:\n    letter:\n"
            "      recipient_templates: "
            "['给{recipient}和{recipient}写信']\n"
        ),
        (
            "modes:\n    letter:\n"
            "      finish_phrases: ['结束']\n"
            "      cancel_phrases: ['结束！']\n"
        ),
        (
            "modes:\n"
            "    letter:\n      start_phrases: ['开始']\n"
            "    qa:\n      start_phrases: ['开始！']\n"
        ),
    ],
)
def test_config_rejects_invalid_llm_settings(tmp_path, llm_body):
    path = tmp_path / "config.yaml"
    path.write_text(f"llm:\n  {llm_body}", encoding="utf-8")

    with pytest.raises(ConfigurationError):
        load_config(path)


def test_app_cli_supports_vision_test_mode():
    args = build_parser().parse_args(
        ["test", "--vision-port", "9000", "--scale", "1.5"]
    )
    assert args.mode == "test"
    assert args.vision_port == 9000
    assert args.scale == 1.5
