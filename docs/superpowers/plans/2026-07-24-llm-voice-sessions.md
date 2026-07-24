# Voice LLM Sessions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add configurable voice-driven letter and question-answer LLM sessions that buffer ASR text in memory, support unambiguous finish/cancel commands, call an OpenAI-compatible API, and write dedicated debug logs without printing.

**Architecture:** A stateless `LLMModeDetector` recognizes configured start phrases before normal keyword intents. A stateful `LLMSessionManager` owns recipient collection, transcript buffering, control-command matching, limits and prompts, while `OpenAICompatibleClient` owns only HTTP and response parsing. `ApplicationController` delegates LLM events and suppresses unrelated audio intents while a session is active.

**Tech Stack:** Python 3.13, asyncio, urllib, dataclasses, rotating logging, pytest, pytest-asyncio.

---

## File map

- Create `app/llm/__init__.py`: public LLM exports.
- Create `app/llm/client.py`: OpenAI-compatible request and stable errors.
- Create `app/llm/mode_detector.py`: configured start phrase/template detection.
- Create `app/llm/session.py`: state machine, buffering, prompts, timers and dedicated logs.
- Create `tests/test_llm_client.py`: local HTTP protocol and response/error tests.
- Create `tests/test_llm_session.py`: detector and state-machine tests.
- Modify `app/config.py`: nested LLM configuration and validation.
- Modify `app/audio/keyword_asr.py`: run LLM mode detection before regular keywords.
- Modify `app/control/application_controller.py`: delegate LLM events and suppress active-session audio intents.
- Modify `app/hardware_main.py`: construct and close the LLM components.
- Modify `app/factories.py`: create the isolated rotating LLM logger.
- Modify `config.yaml`: disabled-by-default LLM example and mode phrases.
- Modify `.gitignore`: include the two new test modules.
- Modify `tests/test_config.py`: LLM defaults, nested loading and invalid configurations.
- Modify `tests/test_perception_runtime.py`: integrated event routing and compatibility.
- Modify `README.md` and `docs/app-pipeline.md`: phase-one configuration, events and boundaries.

### Task 1: Nested LLM configuration

**Files:**
- Modify: `app/config.py`
- Modify: `config.yaml`
- Modify: `tests/test_config.py`

- [ ] **Step 1: Write failing configuration tests**

Add tests that assert:

```python
config = load_config()
assert config.llm.enabled is False
assert config.llm.session.idle_timeout_seconds == 120
assert config.llm.modes.letter.finish_phrases == ["小A，完成写信", "小A，信写完了"]
assert config.llm.modes.qa.cancel_phrases == ["小A，取消问答", "小A，不要回答了"]
```

Load a YAML file with nested overrides and assert every nested dataclass value. Add
parameterized invalid cases for missing enabled credentials, non-positive limits,
empty phrase lists, recipient templates with zero/two `{recipient}` markers,
duplicate normalized finish/cancel phrases, and duplicate start rules across modes.

- [ ] **Step 2: Run tests and verify RED**

Run: `.venv/bin/python -m pytest tests/test_config.py -q`

Expected: failures because `AppConfig` has no `llm` field or nested builder.

- [ ] **Step 3: Implement nested dataclasses and builder**

Add:

```python
@dataclass
class LLMSessionConfig:
    idle_timeout_seconds: float = 120
    max_duration_seconds: float = 900
    max_characters: int = 12_000
    body_prefixes: list[str] = field(default_factory=lambda: ["正文：", "正文:"])

@dataclass
class LLMModeConfig:
    start_phrases: list[str] = field(default_factory=list)
    recipient_templates: list[str] = field(default_factory=list)
    recipient_prefixes: list[str] = field(default_factory=list)
    finish_phrases: list[str] = field(default_factory=list)
    cancel_phrases: list[str] = field(default_factory=list)

@dataclass
class LLMModesConfig:
    letter: LLMModeConfig = field(default_factory=letter_defaults)
    qa: LLMModeConfig = field(default_factory=qa_defaults)

@dataclass
class LLMConfig:
    enabled: bool = False
    base_url: str = ""
    api_key_env: str = "LLM_API_KEY"
    model: str = ""
    timeout_seconds: float = 60
    temperature: float = 0.4
    max_output_tokens: int = 2_000
    log_path: str = "logs/llm.log"
    user_nickname: str = "用户"
    session: LLMSessionConfig = field(default_factory=LLMSessionConfig)
    modes: LLMModesConfig = field(default_factory=LLMModesConfig)
```

Implement `_build_llm(values)` using `_build` for each nested mapping, add `llm` to
`AppConfig`, and exclude it from the flat `_SECTIONS` comprehension. Validate the
exact constraints from the approved spec using `normalize_text`.

- [ ] **Step 4: Update repository YAML**

Add the complete `llm` section with `enabled: false`, blank endpoint/model, environment
variable name, limits, and all approved letter/QA phrases. Preserve the user's removal
of the optional `keywords.custom` example.

- [ ] **Step 5: Run tests and verify GREEN**

Run: `.venv/bin/python -m pytest tests/test_config.py -q`

Expected: all configuration tests pass.

- [ ] **Step 6: Commit**

```bash
git add app/config.py config.yaml tests/test_config.py
git commit -m "feat: configure voice LLM sessions"
```

### Task 2: LLM start-mode detection

**Files:**
- Create: `app/llm/__init__.py`
- Create: `app/llm/mode_detector.py`
- Create: `tests/test_llm_session.py`
- Modify: `app/audio/keyword_asr.py`
- Modify: `.gitignore`

- [ ] **Step 1: Write failing detector tests**

Test:

```python
detector = LLMModeDetector(config.llm.modes)
assert detector.detect("开始写信").event_type == "llm.letter.start"
match = detector.detect("我要给小明写信")
assert match.event_type == "llm.letter.start"
assert match.payload_text == "小明"
assert detector.detect("我有一个问题").event_type == "llm.qa.start"
assert detector.detect("今天不写信") is None
```

Test YAML ordering with overlapping templates and ensure empty recipients do not match.

- [ ] **Step 2: Run detector tests and verify RED**

Run: `.venv/bin/python -m pytest tests/test_llm_session.py -q`

Expected: collection error because `app.llm.mode_detector` does not exist.

- [ ] **Step 3: Implement the detector**

Implement `LLMModeDetector.detect(transcript) -> KeywordMatch | None`. Ordinary phrases
use the same normalized containment behavior as current feature keywords. Templates
split once around `{recipient}`, locate normalized prefix/suffix, and slice the original
text between them; the extracted recipient is trimmed and returned as `payload_text`.
Check letter ordinary phrases, letter templates, then QA phrases in YAML order.

- [ ] **Step 4: Add detector priority to ASR processing**

Extend `KeywordASRProcessor.__init__` with `llm_detector=None`. In `process`:

```python
match = (
    self.llm_detector.detect(transcript)
    if self.llm_detector is not None
    else None
)
if match is None:
    match = self.detector.detect(transcript)
```

Add an integration test asserting a phrase shared with legacy `write_letter` produces
`llm.letter.start` and then `speech.transcribed` with the matching event.

- [ ] **Step 5: Run tests and verify GREEN**

Run:
`.venv/bin/python -m pytest tests/test_llm_session.py tests/test_perception_runtime.py -q`

Expected: detector and existing perception tests pass.

- [ ] **Step 6: Commit**

```bash
git add .gitignore app/llm/__init__.py app/llm/mode_detector.py app/audio/keyword_asr.py tests/test_llm_session.py tests/test_perception_runtime.py
git commit -m "feat: detect configurable LLM voice modes"
```

### Task 3: OpenAI-compatible client and isolated logger

**Files:**
- Create: `app/llm/client.py`
- Create: `tests/test_llm_client.py`
- Modify: `app/llm/__init__.py`
- Modify: `app/factories.py`
- Modify: `.gitignore`

- [ ] **Step 1: Write failing HTTP client tests**

Use a local `ThreadingHTTPServer` to assert:

```python
client = OpenAICompatibleClient(
    base_url=server.url + "/v1",
    api_key_env="TEST_LLM_KEY",
    model="test-model",
    timeout_seconds=1,
    temperature=0.4,
    max_output_tokens=2000,
)
os.environ["TEST_LLM_KEY"] = "secret"
answer = await client.complete(
    system_prompt="system",
    user_prompt="user",
)
assert answer == "clean result"
assert request.path == "/v1/chat/completions"
assert request.headers["Authorization"] == "Bearer secret"
assert request.json["stream"] is False
```

Add missing key, HTTP 500, timeout, connection refusal, malformed JSON, missing choices,
and blank content tests asserting `LLMError.reason`.

- [ ] **Step 2: Run tests and verify RED**

Run: `.venv/bin/python -m pytest tests/test_llm_client.py -q`

Expected: import failure for `OpenAICompatibleClient`.

- [ ] **Step 3: Implement the client**

Implement `LLMError(reason)` and `OpenAICompatibleClient.complete`. The async method
calls a synchronous urllib request through `asyncio.to_thread`. Build non-streaming
JSON with `model`, `temperature`, `max_tokens`, and two messages. Read the API key at
request time using `os.environ.get`; never store it on the instance or include it in
error text.

Map:

- missing environment value → `api_key_missing`;
- socket timeout → `request_timeout`;
- HTTP status → `http_error`;
- URL/OS errors → `connection_error`;
- invalid/missing/blank response content → `invalid_response`.

- [ ] **Step 4: Implement isolated rotating logging**

Add `setup_llm_logging(path)` in `app/factories.py` using
`RotatingFileHandler(maxBytes=2_000_000, backupCount=3, encoding="utf-8")`. Configure
logger `desktop_assistant.llm_session`, set `propagate=False`, and avoid duplicate
handlers when construction runs twice.

- [ ] **Step 5: Verify client and logger**

Run: `.venv/bin/python -m pytest tests/test_llm_client.py -q`

Expected: all client protocol and error tests pass.

- [ ] **Step 6: Commit**

```bash
git add .gitignore app/llm/client.py app/llm/__init__.py app/factories.py tests/test_llm_client.py
git commit -m "feat: add OpenAI-compatible LLM client"
```

### Task 4: Session state machine, prompts and timeouts

**Files:**
- Create: `app/llm/session.py`
- Modify: `app/llm/__init__.py`
- Modify: `tests/test_llm_session.py`

- [ ] **Step 1: Write failing letter-session tests**

Use a `RecordingLLMClient` and short timers. Assert:

```python
events = await manager.handle(start_event("llm.letter.start", recipient="小明"))
assert event_types(events) == ["llm.session_started"]
assert manager.mode == "letter"

assert event_types(await manager.handle(transcript("嗯那个今天很好"))) == [
    "llm.transcript_buffered"
]
completed = await manager.handle(transcript("小A，信写完了"))
assert event_types(completed) == ["llm.letter_completed"]
assert client.calls[0].system_prompt contains the no-invention instruction
assert "嗯那个今天很好" in client.calls[0].user_prompt
```

Also test `awaiting_recipient`, recipient prefixes, start-transcript exclusion, empty
content and body-prefix precedence.

- [ ] **Step 2: Write failing cancel/conflict tests**

Assert a sentence containing “信写完了” is buffered, an exact normalized finish command
completes, an exact cancel command emits `llm.session_cancelled`, and prefixed
`正文：小A，取消写信` is buffered. Assert cancellation leaves `client.calls == []`.

- [ ] **Step 3: Write failing QA and limit tests**

Assert QA uses `user_nickname`, produces `llm.answer_completed`, and uses a distinct
answer prompt. Add max characters, duplicate start, idle timeout, max duration,
LLM error, and `aclose` timer cancellation tests.

- [ ] **Step 4: Run session tests and verify RED**

Run: `.venv/bin/python -m pytest tests/test_llm_session.py -q`

Expected: import failure for `LLMSessionManager`.

- [ ] **Step 5: Implement the state machine**

Implement immutable internal session data with `session_id`, `mode`, `recipient`,
ordered transcript list, character count, start and last-activity monotonic times.
Guard `handle` with `asyncio.Lock`. The public interface is:

```python
class LLMSessionManager:
    @property
    def active(self) -> bool: ...
    @property
    def mode(self) -> str | None: ...
    def set_event_emitter(self, emitter: EventEmitter) -> None: ...
    async def handle(self, event: PerceptionEvent) -> tuple[PerceptionEvent, ...]: ...
    async def aclose(self) -> None: ...
```

Handle `llm.letter.start`, `llm.qa.start`, and `speech.transcribed`. Apply body-prefix,
cancel, finish and buffer priority exactly as specified. Build separate letter/QA
prompts. On finish await the client, produce one completion/failure event, log one JSON
record containing raw transcripts and output/error, then clear state in `finally`.

- [ ] **Step 6: Implement the watchdog**

Create one background task per active session. It wakes at the earlier idle/max deadline,
rechecks session identity and clocks under the lock, emits
`llm.session_failed(idle_timeout|max_duration_exceeded)` through the configured emitter,
logs the failure, clears state, and exits. Accepted recipient/body input replaces the
watchdog. Cancelled/finished sessions cancel it without awaiting the current task itself.

- [ ] **Step 7: Run tests and verify GREEN**

Run: `.venv/bin/python -m pytest tests/test_llm_session.py -q`

Expected: all detector and session tests pass without leaked-task warnings.

- [ ] **Step 8: Commit**

```bash
git add app/llm/session.py app/llm/__init__.py tests/test_llm_session.py
git commit -m "feat: manage buffered voice LLM sessions"
```

### Task 5: Runtime/controller integration

**Files:**
- Modify: `app/control/application_controller.py`
- Modify: `app/hardware_main.py`
- Modify: `tests/test_perception_runtime.py`

- [ ] **Step 1: Write failing controller integration tests**

Construct a controller with a recording session manager. Assert:

- `llm.letter.start` and all active-session `speech.transcribed` events are delegated;
- unrelated audio-source `feature.photo_print`, chat and letter events are suppressed
  while active;
- `gesture.victory` and `gesture.open_palm` still follow their existing paths;
- an idle session leaves existing audio routing unchanged;
- controller `aclose` closes both photo and LLM managers.

- [ ] **Step 2: Run tests and verify RED**

Run: `.venv/bin/python -m pytest tests/test_perception_runtime.py -q`

Expected: controller does not accept or delegate to an LLM manager.

- [ ] **Step 3: Integrate the controller**

Add `llm_session_manager` to `ApplicationController.__init__`. In `handle`, process LLM
start and transcript events before legacy audio routes. If manager is active and an
event has `source == "audio"` but is not `speech.transcribed`, return no commands.
Return the manager's derived events. Forward the emitter and close calls to both
managers.

- [ ] **Step 4: Build components in hardware_main**

When audio is enabled:

```python
llm_detector = LLMModeDetector(config.llm.modes) if config.llm.enabled else None
llm_manager = LLMSessionManager(
    config.llm,
    OpenAICompatibleClient.from_config(config.llm),
    logger=setup_llm_logging(config.llm.log_path),
) if config.llm.enabled else None
```

Pass the detector to `KeywordASRProcessor` and manager to `ApplicationController`.
Disabled LLM configuration creates neither component and preserves current behavior.

- [ ] **Step 5: Run integration and regression tests**

Run:

```bash
.venv/bin/python -m pytest tests/test_perception_runtime.py tests/test_llm_session.py tests/test_llm_client.py tests/test_config.py -q
```

Expected: all targeted tests pass.

- [ ] **Step 6: Commit**

```bash
git add app/control/application_controller.py app/hardware_main.py tests/test_perception_runtime.py
git commit -m "feat: integrate voice LLM sessions into runtime"
```

### Task 6: Documentation and final verification

**Files:**
- Modify: `README.md`
- Modify: `docs/app-pipeline.md`

- [ ] **Step 1: Document phase-one behavior**

Document the `llm` YAML section, environment-variable API key, start/finish/cancel
semantics, recipient collection, in-memory limits, dedicated log, events, and the
explicit boundary that phase one does not print.

- [ ] **Step 2: Run complete verification**

Run:

```bash
.venv/bin/python -m pytest -q
.venv/bin/python -m compileall -q app tests
.venv/bin/python -m app --help
git diff --check
```

Expected: all tests pass, compilation and CLI smoke test exit zero, and diff check
prints nothing.

- [ ] **Step 3: Inspect security-sensitive output**

Run tests with a sentinel API key and search captured logs/test artifacts. Confirm the
sentinel appears only in the fake HTTP Authorization header assertion and never in
`logs/llm.log`, exception messages, or perception event payloads.

- [ ] **Step 4: Commit**

```bash
git add README.md docs/app-pipeline.md
git commit -m "docs: describe voice LLM sessions"
```
