# Private LLM Configuration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move configuration into `config/`, load LLM provider credentials from an ignored YAML file, and explicitly reject LLM mode requests when credentials are unavailable without affecting other features.

**Architecture:** `config/app.yaml` remains the version-controlled source for application behavior, while `config/llm.yaml` is a strict three-field provider overlay. `load_config` attaches an optional, representation-safe `LLMProviderConfig` to `LLMConfig`; mode detection remains active regardless of provider availability, while the controller either starts a real session or emits `llm.session_rejected`.

**Tech Stack:** Python 3.11+, dataclasses, PyYAML, asyncio, pytest, existing OpenAI-compatible HTTP client

---

## File map

- Create `config/llm.example.yaml`: committed credential-file template with no secret.
- Reserve `config/llm.yaml`: ignored path for the user-created credential file;
  never commit or populate it with an existing key.
- Move `config.yaml` to `config/app.yaml`: public application and LLM behavior configuration.
- Modify `.gitignore`: ignore only the real private LLM file.
- Modify `app/config.py`: provider model, strict private-file parsing, availability state, and two-file loading.
- Modify `app/hardware_main.py`: new CLI defaults, private path, warning, detector wiring, and provider-aware session construction.
- Modify `app/llm/client.py`: accept a direct in-memory API key instead of an environment-variable name.
- Modify `app/control/application_controller.py`: emit stable rejection events when LLM is disabled or not configured.
- Modify `tests/test_config.py`: cover paths, overlay validation, missing credentials, and secret-safe representations.
- Modify `tests/test_llm_client.py`: cover direct credentials and non-disclosure.
- Modify `tests/test_perception_runtime.py`: cover unavailable mode rejection and runtime wiring.
- Modify `README.md` and `docs/app-pipeline.md`: document migration, setup, security, and rejection semantics.

### Task 1: Add the strict private provider overlay

**Files:**
- Modify: `app/config.py`
- Modify: `tests/test_config.py`

- [ ] **Step 1: Write failing provider-loading and security tests**

Add imports and tests to `tests/test_config.py`:

```python
from pathlib import Path

from app.config import ConfigurationError, load_config


def test_load_config_merges_private_llm_provider(tmp_path):
    app_path = tmp_path / "app.yaml"
    llm_path = tmp_path / "llm.yaml"
    app_path.write_text(
        """
llm:
  enabled: true
  user_nickname: 小面包
""",
        encoding="utf-8",
    )
    llm_path.write_text(
        """
base_url: https://example.test/v1
model: test-model
api_key: sentinel-secret
""",
        encoding="utf-8",
    )

    config = load_config(app_path, llm_path)

    assert config.llm.available is True
    assert config.llm.unavailable_reason is None
    assert config.llm.provider is not None
    assert config.llm.provider.base_url == "https://example.test/v1"
    assert config.llm.provider.model == "test-model"
    assert config.llm.provider.api_key == "sentinel-secret"
    assert config.llm.user_nickname == "小面包"
    assert "sentinel-secret" not in repr(config)


def test_enabled_llm_without_private_file_is_unavailable(tmp_path):
    app_path = tmp_path / "app.yaml"
    app_path.write_text("llm:\n  enabled: true\n", encoding="utf-8")

    config = load_config(app_path, tmp_path / "missing.yaml")

    assert config.llm.available is False
    assert config.llm.unavailable_reason == "not_configured"
    assert config.llm.provider is None


def test_disabled_llm_reports_disabled_without_private_file(tmp_path):
    app_path = tmp_path / "app.yaml"
    app_path.write_text("llm:\n  enabled: false\n", encoding="utf-8")

    config = load_config(app_path, tmp_path / "missing.yaml")

    assert config.llm.available is False
    assert config.llm.unavailable_reason == "disabled"


@pytest.mark.parametrize(
    "body",
    [
        "base_url: https://example.test/v1\nmodel: test\n",
        "base_url: ''\nmodel: test\napi_key: secret\n",
        "base_url: https://example.test/v1\nmodel: ''\napi_key: secret\n",
        "base_url: https://example.test/v1\nmodel: test\napi_key: ''\n",
        (
            "base_url: https://example.test/v1\n"
            "model: test\napi_key: secret\nextra: true\n"
        ),
        "- not\n- a\n- mapping\n",
    ],
)
def test_private_llm_config_rejects_invalid_content(tmp_path, body):
    app_path = tmp_path / "app.yaml"
    llm_path = tmp_path / "llm.yaml"
    app_path.write_text("llm:\n  enabled: true\n", encoding="utf-8")
    llm_path.write_text(body, encoding="utf-8")

    with pytest.raises(ConfigurationError):
        load_config(app_path, llm_path)
```

Update the existing nested LLM override test so `app.yaml` contains only
non-secret settings and `llm.yaml` contains the three provider fields.

- [ ] **Step 2: Run the focused tests and verify they fail**

Run:

```bash
.venv/bin/python -m pytest tests/test_config.py -q
```

Expected: failures because `load_config` accepts only one path and
`LLMConfig` has no `provider`, `available`, or `unavailable_reason`.

- [ ] **Step 3: Add provider types and availability properties**

In `app/config.py`, replace the public provider fields on `LLMConfig` with:

```python
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
```

Do not allow `provider` inside the public `llm:` mapping:

```python
public_fields = set(LLMConfig.__dataclass_fields__) - {"provider"}
unknown = set(values) - public_fields
```

Update `_validate_llm` so enabling LLM validates public runtime fields but no
longer requires `base_url`, `api_key_env`, or `model`.

- [ ] **Step 4: Implement strict private-file loading**

Add to `app/config.py`:

```python
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
```

Change the public API and attach the overlay only when LLM is enabled:

```python
def load_config(
    path: Path | str | None = None,
    llm_path: Path | str | None = None,
) -> AppConfig:
    data: dict[str, Any] = {}
    config_path: Path | None = None
    if path is not None:
        config_path = Path(path)
        if not config_path.is_file():
            raise ConfigurationError(
                f"config file not found: {config_path}"
            )
        loaded = yaml.safe_load(
            config_path.read_text(encoding="utf-8")
        ) or {}
        if not isinstance(loaded, dict):
            raise ConfigurationError("config root must be a mapping")
        data = loaded

    unknown = set(data) - (set(_SECTIONS) | {"llm"})
    if unknown:
        raise ConfigurationError(
            "unknown config sections: "
            f"{', '.join(sorted(unknown))}"
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
```

Ensure private-file validation occurs before returning and exception messages
never include field values.

- [ ] **Step 5: Run configuration tests and verify they pass**

Run:

```bash
.venv/bin/python -m pytest tests/test_config.py -q
```

Expected: all configuration tests pass.

- [ ] **Step 6: Commit the provider overlay**

```bash
git add app/config.py tests/test_config.py
git commit -m "feat: load private LLM provider config"
```

### Task 2: Move configuration into `config/` and update CLI paths

**Files:**
- Move: `config.yaml` to `config/app.yaml`
- Create: `config/llm.example.yaml`
- Modify: `.gitignore`
- Modify: `app/hardware_main.py`
- Modify: `tests/test_config.py`

- [ ] **Step 1: Write failing repository-layout and CLI tests**

Replace the repository-config test and extend the parser test:

```python
def test_repository_config_loads():
    config = load_config("config/app.yaml", "config/llm.yaml")
    assert config.asr.backend == "faster_whisper"
    assert config.vision.enabled is True


def test_app_cli_uses_config_directory_defaults():
    args = build_parser().parse_args([])

    assert args.config == Path("config/app.yaml")
    assert args.llm_config == Path("config/llm.yaml")


def test_private_llm_file_is_gitignored():
    ignored = Path(".gitignore").read_text(encoding="utf-8")

    assert "/config/llm.yaml" in ignored
    assert Path("config/llm.example.yaml").is_file()
```

- [ ] **Step 2: Run the focused tests and verify they fail**

Run:

```bash
.venv/bin/python -m pytest tests/test_config.py -q
```

Expected: failures because the configuration has not moved and the parser has
no `llm_config` argument.

- [ ] **Step 3: Move and sanitize the public configuration**

Move the tracked root `config.yaml` to `config/app.yaml`. Preserve the user's
non-secret values, including:

```yaml
vision:
  mode_window_size: 3
  mode_required_hits: 2
```

Keep the existing `llm:` session and mode settings, but make the public root:

```yaml
llm:
  enabled: false
  timeout_seconds: 60
  temperature: 0.4
  max_output_tokens: 2000
  log_path: logs/llm.log
  user_nickname: 用户
```

Do not copy any existing API key, provider URL, or model name into the tracked
file.

- [ ] **Step 4: Add the private template and ignore rule**

Create `config/llm.example.yaml`:

```yaml
# Copy this file to config/llm.yaml and enter newly issued credentials.
base_url: https://provider.example/v1
model: provider-model-name
api_key: ""
```

Add this exact repository-relative entry to `.gitignore`:

```gitignore
/config/llm.yaml
```

Do not add `config/llm.yaml` itself to Git. If a local file is created for a
manual smoke test, use an empty key until the user supplies a newly issued key.

- [ ] **Step 5: Update CLI parsing and runtime loading**

In `app/hardware_main.py`, change the parser arguments:

```python
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
```

Initialize logging before configuration warnings and load both files:

```python
async def run(args: argparse.Namespace) -> None:
    setup_logging()
    config = load_config(args.config, args.llm_config)
    if config.llm.unavailable_reason == "not_configured":
        LOGGER.warning(
            "LLM provider is not configured; LLM modes will be rejected"
        )
    daemon, gesture_backend = build_daemon(config, args)
```

- [ ] **Step 6: Run configuration and CLI smoke tests**

Run:

```bash
.venv/bin/python -m pytest tests/test_config.py -q
.venv/bin/python -m app --help
```

Expected: tests pass; help lists `--config` and `--llm-config`, with no
configuration-loading error.

- [ ] **Step 7: Commit the configuration layout**

```bash
git add .gitignore config/app.yaml config/llm.example.yaml \
  app/hardware_main.py tests/test_config.py
git commit -m "refactor: move configuration into config directory"
```

### Task 3: Pass the private key directly to the LLM client

**Files:**
- Modify: `app/llm/client.py`
- Modify: `tests/test_llm_client.py`
- Modify: `tests/test_perception_runtime.py`

- [ ] **Step 1: Rewrite client tests for direct credentials**

Remove `os` and environment-variable setup from `tests/test_llm_client.py`.
Change the client helper to:

```python
def make_client(
    base_url: str,
    *,
    api_key: str = "sentinel-secret",
) -> OpenAICompatibleClient:
    return OpenAICompatibleClient(
        base_url=base_url,
        api_key=api_key,
        model="test-model",
        timeout_seconds=1,
        temperature=0.4,
        max_output_tokens=2_000,
    )
```

Keep the Authorization assertion and replace the missing-key test with:

```python
@pytest.mark.asyncio
async def test_client_requires_configured_api_key():
    with pytest.raises(LLMError) as captured:
        await make_client(
            "http://127.0.0.1:1",
            api_key="",
        ).complete(system_prompt="system", user_prompt="user")

    assert captured.value.reason == "api_key_missing"
    assert "sentinel-secret" not in str(captured.value)


def test_client_representation_does_not_expose_api_key():
    client = make_client("https://example.test/v1")

    assert "sentinel-secret" not in repr(client)
```

- [ ] **Step 2: Run client tests and verify they fail**

Run:

```bash
.venv/bin/python -m pytest tests/test_llm_client.py -q
```

Expected: failures because the client constructor still requires
`api_key_env`.

- [ ] **Step 3: Implement direct, private credential handling**

In `app/llm/client.py`, remove the `os` import and change initialization:

```python
class OpenAICompatibleClient:
    def __init__(
        self,
        *,
        base_url: str,
        api_key: str,
        model: str,
        timeout_seconds: float,
        temperature: float,
        max_output_tokens: int,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self._api_key = api_key
        self.model = model
        self.timeout_seconds = timeout_seconds
        self.temperature = temperature
        self.max_output_tokens = max_output_tokens

    @classmethod
    def from_config(cls, config: LLMConfig) -> "OpenAICompatibleClient":
        provider = config.provider
        if provider is None:
            raise LLMError("api_key_missing")
        return cls(
            base_url=provider.base_url,
            api_key=provider.api_key,
            model=provider.model,
            timeout_seconds=config.timeout_seconds,
            temperature=config.temperature,
            max_output_tokens=config.max_output_tokens,
        )
```

At the start of `complete`, use:

```python
api_key = self._api_key.strip()
if not api_key:
    raise LLMError("api_key_missing")
```

Continue passing only the local `api_key` variable to `_complete_sync`. Do not
include it in exceptions or logs.

- [ ] **Step 4: Update runtime fixtures to attach a provider**

Where `tests/test_perception_runtime.py` manually enables LLM, use:

```python
from app.config import LLMProviderConfig

config.llm.enabled = True
config.llm.provider = LLMProviderConfig(
    base_url="https://example.test/v1",
    model="test-model",
    api_key="sentinel-secret",
)
```

- [ ] **Step 5: Run client and runtime tests**

Run:

```bash
.venv/bin/python -m pytest \
  tests/test_llm_client.py tests/test_perception_runtime.py -q
```

Expected: all selected tests pass and the local fake HTTP request still carries
`Bearer sentinel-secret`.

- [ ] **Step 6: Commit direct credential handling**

```bash
git add app/llm/client.py tests/test_llm_client.py \
  tests/test_perception_runtime.py
git commit -m "refactor: use private LLM credentials directly"
```

### Task 4: Reject unavailable LLM sessions without affecting other features

**Files:**
- Modify: `app/control/application_controller.py`
- Modify: `app/hardware_main.py`
- Modify: `tests/test_perception_runtime.py`

- [ ] **Step 1: Write controller rejection tests**

Add to `tests/test_perception_runtime.py`:

```python
@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("reason", "event_type", "mode"),
    [
        ("not_configured", "llm.letter.start", "letter"),
        ("disabled", "llm.qa.start", "qa"),
    ],
)
async def test_controller_rejects_unavailable_llm_mode(
    reason,
    event_type,
    mode,
):
    controller = ApplicationController(
        llm_unavailable_reason=reason,
    )

    rejected = await controller.handle(
        PerceptionEvent(event_type, "audio", session_id="bot")
    )
    ordinary = await controller.handle(
        PerceptionEvent("gesture.open_palm", "vision", session_id="bot")
    )

    assert len(rejected) == 1
    assert rejected[0].event_type == "llm.session_rejected"
    assert rejected[0].payload["mode"] == mode
    assert rejected[0].payload["reason"] == reason
    assert [event.event_type for event in ordinary] == [
        "command.language.set",
        "language.changed",
    ]
```

Add a daemon-wiring test:

```python
@pytest.mark.asyncio
async def test_build_daemon_detects_but_rejects_unconfigured_llm(
    monkeypatch,
):
    config = load_config()
    config.llm.enabled = True
    monkeypatch.setattr(
        "app.hardware_main.build_vad",
        lambda _config: MockVADBackend([]),
    )
    monkeypatch.setattr(
        "app.hardware_main.build_asr",
        lambda _config: SequenceASR([]),
    )

    daemon, _ = build_daemon(
        config,
        build_parser().parse_args(["--audio-only"]),
    )

    assert daemon.audio_processor.llm_detector is not None
    controller = daemon.application_controller
    assert controller.llm_session_manager is None
    assert controller.llm_unavailable_reason == "not_configured"
```

- [ ] **Step 2: Run runtime tests and verify they fail**

Run:

```bash
.venv/bin/python -m pytest tests/test_perception_runtime.py -q
```

Expected: failures because the controller has no unavailable-reason argument,
disabled LLM does not wire the detector, and start intents are silently ignored.

- [ ] **Step 3: Emit stable controller rejection events**

In `ApplicationController.__init__`, add:

```python
llm_unavailable_reason: str | None = None,
```

Store it as `self.llm_unavailable_reason`. At the top of `handle`, before normal
keyword routing, add:

```python
if event.event_type in {"llm.letter.start", "llm.qa.start"}:
    if self.llm_session_manager is not None:
        return await getattr(
            self.llm_session_manager,
            "handle",
        )(event)
    if self.llm_unavailable_reason is not None:
        mode = (
            "letter"
            if event.event_type == "llm.letter.start"
            else "qa"
        )
        return (
            self._result(
                "llm.session_rejected",
                event,
                {
                    "mode": mode,
                    "reason": self.llm_unavailable_reason,
                },
            ),
        )
```

Keep `speech.transcribed` delegation only in the branch where a session manager
exists. A rejected start must not mark a session active or suppress later audio.

- [ ] **Step 4: Always wire mode detection and conditionally build sessions**

In `build_daemon`, while audio is enabled:

```python
llm_detector = LLMModeDetector(config.llm.modes)
if config.llm.available:
    llm_session_manager = LLMSessionManager(
        config.llm,
        OpenAICompatibleClient.from_config(config.llm),
        logger=setup_llm_logging(config.llm.log_path),
    )
```

Construct the controller with:

```python
controller = ApplicationController(
    default_language=config.application.default_language,
    photo_manager=photo_manager,
    llm_session_manager=llm_session_manager,
    llm_unavailable_reason=config.llm.unavailable_reason,
)
```

This ensures LLM start phrases take detector priority even when unavailable and
produce a rejection instead of falling through to legacy keyword handling.

- [ ] **Step 5: Run runtime and LLM session tests**

Run:

```bash
.venv/bin/python -m pytest \
  tests/test_perception_runtime.py tests/test_llm_session.py -q
```

Expected: all selected tests pass; active LLM sessions still buffer and finish,
while unavailable modes reject immediately.

- [ ] **Step 6: Commit unavailable-session behavior**

```bash
git add app/control/application_controller.py app/hardware_main.py \
  tests/test_perception_runtime.py
git commit -m "feat: reject unavailable LLM voice modes"
```

### Task 5: Document setup and verify the migration

**Files:**
- Modify: `README.md`
- Modify: `docs/app-pipeline.md`

- [ ] **Step 1: Update user setup documentation**

Replace root `config.yaml` references with `config/app.yaml`. Document this
setup without including a real key:

```bash
cp config/llm.example.yaml config/llm.yaml
```

Explain that the user must enter a newly issued `api_key`, provider `base_url`,
and `model` in the ignored file, then set `llm.enabled: true` in
`config/app.yaml`. Remove the `export LLM_API_KEY` instructions.

Document `llm.session_rejected` and its two reasons:

- `not_configured`: LLM is enabled but `config/llm.yaml` is missing.
- `disabled`: `llm.enabled` is false.

State that rejection does not affect photo, printer, gesture, ASR, or vision
features.

- [ ] **Step 2: Run security and stale-reference scans**

Run:

```bash
rg -n "api_key_env|LLM_API_KEY|config\\.yaml" \
  app tests README.md docs/app-pipeline.md config
```

Expected: no stale environment-key field or root configuration path. References
to `config/app.yaml`, `config/llm.yaml`, and the example file are expected.

Run:

```bash
git check-ignore -v config/llm.yaml
```

Expected: `.gitignore` reports `/config/llm.yaml`.

Run a sentinel scan:

```bash
rg -n "sentinel-secret" \
  app README.md docs/app-pipeline.md config
```

Expected: no matches outside tests. Never print or search for the user's actual
key.

- [ ] **Step 3: Run the complete verification suite**

Run:

```bash
.venv/bin/python -m pytest -q
.venv/bin/python -m compileall -q app tests
.venv/bin/python -m app --help
git diff --check
git status --short
```

Expected: all tests pass, compilation and help exit zero, no whitespace errors,
and only intended project changes are present. The ignored
`config/llm.yaml` must not appear in status.

- [ ] **Step 4: Commit documentation**

```bash
git add README.md docs/app-pipeline.md
git commit -m "docs: explain private LLM configuration"
```

- [ ] **Step 5: Review final diff and verify again**

Run:

```bash
git diff --stat main...HEAD
.venv/bin/python -m pytest -q
```

Expected: changes are limited to the files listed in this plan and the complete
test suite passes on the final branch state.
