# Computer Microphone LLM Test Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `python -m app mic-test` so a computer microphone can drive the production VAD, ASR, letter/question, and LLM pipeline while results remain in the existing logs.

**Architecture:** A focused `LocalMicrophoneAudioSource` adapts PortAudio callbacks into the existing async `AudioFrameSource` contract through a bounded queue. The CLI selects that source in `mic-test`, disables network audio and vision inputs, and otherwise reuses the same daemon construction, controller, LLM session manager, and logging code.

**Tech Stack:** Python 3.11+, asyncio, NumPy, sounddevice/PortAudio, argparse, pytest

---

## File map

- Create `app/transport/microphone_source.py`: device parsing/listing,
  microphone errors, PortAudio-to-asyncio bridge, queue backpressure, cleanup.
- Create `tests/test_microphone_source.py`: fake sounddevice coverage without
  opening real hardware.
- Modify `app/transport/__init__.py`: export the local source API.
- Modify `app/hardware_main.py`: add CLI flags, validate modes, list devices,
  select the local source, and log mic-test startup information.
- Modify `tests/test_config.py`: parser choices and microphone-only flag tests.
- Modify `tests/test_perception_runtime.py`: daemon source selection and
  production-mode regression tests.
- Modify `.gitignore`: whitelist the new tracked test.
- Modify `requirements.txt`: declare `sounddevice`.
- Modify `README.md` and `docs/app-pipeline.md`: usage, logs, permissions,
  supported flows, and manual smoke test.

### Task 1: Implement the local microphone audio source

**Files:**
- Create: `app/transport/microphone_source.py`
- Create: `tests/test_microphone_source.py`
- Modify: `app/transport/__init__.py`
- Modify: `.gitignore`

- [ ] **Step 1: Write failing device and streaming tests**

Create `tests/test_microphone_source.py`:

```python
from __future__ import annotations

import asyncio

import numpy as np
import pytest

from app.transport.microphone_source import (
    LocalMicrophoneAudioSource,
    MicrophoneError,
    list_input_devices,
    parse_input_device,
)


class FakeInputStream:
    def __init__(self, owner, **kwargs):
        self.owner = owner
        self.kwargs = kwargs
        self.started = False
        self.stopped = False
        self.closed = False
        owner.streams.append(self)

    def start(self):
        if self.owner.start_error is not None:
            raise self.owner.start_error
        self.started = True

    def stop(self):
        self.stopped = True

    def close(self):
        self.closed = True

    def emit(self, samples, status=None):
        data = np.asarray(samples, dtype=np.float32).reshape(-1, 1)
        self.kwargs["callback"](data, len(data), None, status)


class FakeSoundDevice:
    def __init__(self):
        self.streams = []
        self.start_error = None
        self.devices = [
            {
                "name": "Output only",
                "max_input_channels": 0,
                "default_samplerate": 48_000,
            },
            {
                "name": "Built-in Mic",
                "max_input_channels": 2,
                "default_samplerate": 48_000,
            },
        ]

    def InputStream(self, **kwargs):
        return FakeInputStream(self, **kwargs)

    def query_devices(self, device=None, kind=None):
        if device is None:
            return self.devices
        return self.devices[1]


def test_parse_input_device_accepts_index_or_name():
    assert parse_input_device("2") == 2
    assert parse_input_device("  Built-in Mic  ") == "Built-in Mic"
    with pytest.raises(ValueError):
        parse_input_device("   ")


def test_list_input_devices_filters_output_only_devices():
    devices = list_input_devices(FakeSoundDevice())

    assert [(item.index, item.name) for item in devices] == [
        (1, "Built-in Mic")
    ]
    assert devices[0].max_input_channels == 2
    assert devices[0].default_samplerate == 48_000


@pytest.mark.asyncio
async def test_microphone_source_yields_contiguous_float32_mono_frame():
    sounddevice = FakeSoundDevice()
    source = LocalMicrophoneAudioSource(
        device=1,
        sample_rate=16_000,
        frame_samples=512,
        queue_size=2,
        sounddevice_module=sounddevice,
    )
    iterator = source.frames().__aiter__()
    pending = asyncio.create_task(anext(iterator))
    await asyncio.sleep(0)
    stream = sounddevice.streams[0]
    stream.emit([0.25, -0.5, 0.75])

    frame = await asyncio.wait_for(pending, timeout=1)

    assert frame.dtype == np.float32
    assert frame.flags.c_contiguous
    np.testing.assert_array_equal(
        frame,
        np.array([0.25, -0.5, 0.75], dtype=np.float32),
    )
    await iterator.aclose()
    assert stream.stopped is True
    assert stream.closed is True


@pytest.mark.asyncio
async def test_microphone_source_drops_oldest_frame_when_queue_is_full():
    sounddevice = FakeSoundDevice()
    source = LocalMicrophoneAudioSource(
        sample_rate=16_000,
        frame_samples=512,
        queue_size=1,
        sounddevice_module=sounddevice,
    )
    iterator = source.frames().__aiter__()
    pending = asyncio.create_task(anext(iterator))
    await asyncio.sleep(0)
    stream = sounddevice.streams[0]
    stream.emit([1.0])
    await pending
    stream.emit([2.0])
    stream.emit([3.0])
    await asyncio.sleep(0)

    latest = await asyncio.wait_for(anext(iterator), timeout=1)

    np.testing.assert_array_equal(latest, np.array([3.0], dtype=np.float32))
    assert source.dropped_frames == 1
    await iterator.aclose()


@pytest.mark.asyncio
async def test_microphone_source_rejects_second_start_and_closes_idempotently():
    sounddevice = FakeSoundDevice()
    source = LocalMicrophoneAudioSource(
        sounddevice_module=sounddevice,
    )
    first = source.frames().__aiter__()
    pending = asyncio.create_task(anext(first))
    await asyncio.sleep(0)

    second = source.frames().__aiter__()
    with pytest.raises(MicrophoneError) as captured:
        await anext(second)
    assert captured.value.reason == "microphone_already_running"

    await source.aclose()
    await source.aclose()
    pending.cancel()
    with pytest.raises(asyncio.CancelledError):
        await pending


@pytest.mark.asyncio
async def test_microphone_source_maps_stream_start_failure():
    sounddevice = FakeSoundDevice()
    sounddevice.start_error = RuntimeError("device busy")
    source = LocalMicrophoneAudioSource(
        sounddevice_module=sounddevice,
    )

    with pytest.raises(MicrophoneError) as captured:
        await anext(source.frames().__aiter__())

    assert captured.value.reason == "microphone_open_failed"
    assert "device busy" not in str(captured.value)
    assert sounddevice.streams[0].closed is True


@pytest.mark.asyncio
async def test_microphone_source_maps_permission_failure():
    sounddevice = FakeSoundDevice()
    sounddevice.start_error = RuntimeError("Permission denied")
    source = LocalMicrophoneAudioSource(
        sounddevice_module=sounddevice,
    )

    with pytest.raises(MicrophoneError) as captured:
        await anext(source.frames().__aiter__())

    assert captured.value.reason == "microphone_unavailable"
```

- [ ] **Step 2: Run the new tests and verify they fail**

Run:

```bash
/Users/crazybread/Code/ai-bot/.venv/bin/python -m pytest \
  tests/test_microphone_source.py -q
```

Expected: collection fails because
`app.transport.microphone_source` does not exist.

- [ ] **Step 3: Implement device parsing and listing**

Create `app/transport/microphone_source.py` with:

```python
"""Computer microphone input adapted to the async audio source contract."""

from __future__ import annotations

import asyncio
import importlib
import logging
from dataclasses import dataclass
from typing import Any

import numpy as np

from app.transport.sources import AudioFrameSource

LOGGER = logging.getLogger("desktop_assistant.microphone")


class MicrophoneError(RuntimeError):
    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


@dataclass(frozen=True)
class InputDevice:
    index: int
    name: str
    max_input_channels: int
    default_samplerate: float


def parse_input_device(value: str) -> int | str:
    normalized = value.strip()
    if not normalized:
        raise ValueError("input device cannot be empty")
    try:
        return int(normalized)
    except ValueError:
        return normalized


def _load_sounddevice() -> Any:
    try:
        return importlib.import_module("sounddevice")
    except (ImportError, OSError) as exc:
        raise MicrophoneError("sounddevice_unavailable") from exc


def list_input_devices(sounddevice_module: Any | None = None) -> tuple[InputDevice, ...]:
    sounddevice = sounddevice_module or _load_sounddevice()
    try:
        devices = sounddevice.query_devices()
    except Exception as exc:
        raise MicrophoneError("microphone_unavailable") from exc
    return tuple(
        InputDevice(
            index=index,
            name=str(device["name"]),
            max_input_channels=int(device["max_input_channels"]),
            default_samplerate=float(device["default_samplerate"]),
        )
        for index, device in enumerate(devices)
        if int(device["max_input_channels"]) > 0
    )


def _open_failure_reason(exc: Exception) -> str:
    message = str(exc).casefold()
    unavailable_hints = (
        "permission",
        "not permitted",
        "invalid device",
        "device unavailable",
        "no default input",
    )
    if any(hint in message for hint in unavailable_hints):
        return "microphone_unavailable"
    return "microphone_open_failed"
```

- [ ] **Step 4: Implement callback-to-async streaming and cleanup**

Continue `app/transport/microphone_source.py`:

```python
class LocalMicrophoneAudioSource(AudioFrameSource):
    def __init__(
        self,
        device: int | str | None = None,
        *,
        sample_rate: int = 16_000,
        frame_samples: int = 512,
        queue_size: int = 256,
        sounddevice_module: Any | None = None,
    ) -> None:
        if sample_rate <= 0 or frame_samples <= 0 or queue_size <= 0:
            raise ValueError("microphone source sizes must be positive")
        self.device = device
        self.sample_rate = sample_rate
        self.frame_samples = frame_samples
        self.queue_size = queue_size
        self._sounddevice = sounddevice_module
        self._queue: asyncio.Queue[np.ndarray] | None = None
        self._loop: asyncio.AbstractEventLoop | None = None
        self._stream: Any | None = None
        self.dropped_frames = 0

    async def frames(self):
        if self._stream is not None:
            raise MicrophoneError("microphone_already_running")
        sounddevice = self._sounddevice or _load_sounddevice()
        self._loop = asyncio.get_running_loop()
        self._queue = asyncio.Queue(maxsize=self.queue_size)
        try:
            self._stream = sounddevice.InputStream(
                device=self.device,
                samplerate=self.sample_rate,
                channels=1,
                dtype="float32",
                blocksize=self.frame_samples,
                callback=self._audio_callback,
            )
            self._stream.start()
        except Exception as exc:
            await self.aclose()
            raise MicrophoneError(_open_failure_reason(exc)) from exc
        LOGGER.info(
            "computer microphone started device=%s sample_rate=%s "
            "frame_samples=%s",
            self.device if self.device is not None else "default",
            self.sample_rate,
            self.frame_samples,
        )
        try:
            assert self._queue is not None
            while True:
                yield await self._queue.get()
        finally:
            await self.aclose()

    def _audio_callback(
        self,
        indata: np.ndarray,
        _frames: int,
        _time_info: object,
        status: object,
    ) -> None:
        if status:
            LOGGER.warning("microphone callback status: %s", status)
        frame = np.ascontiguousarray(
            np.asarray(indata, dtype=np.float32).reshape(-1),
        ).copy()
        loop = self._loop
        if loop is None or loop.is_closed():
            return
        try:
            loop.call_soon_threadsafe(self._offer_frame, frame)
        except RuntimeError:
            LOGGER.warning("microphone frame arrived after loop shutdown")

    def _offer_frame(self, frame: np.ndarray) -> None:
        queue = self._queue
        if queue is None:
            return
        if queue.full():
            queue.get_nowait()
            self.dropped_frames += 1
        queue.put_nowait(frame)

    async def aclose(self) -> None:
        stream = self._stream
        self._stream = None
        self._queue = None
        self._loop = None
        if stream is None:
            return
        try:
            try:
                stream.stop()
            except Exception:
                LOGGER.warning(
                    "microphone stream stop failed",
                    exc_info=True,
                )
        finally:
            try:
                stream.close()
            except Exception:
                LOGGER.warning(
                    "microphone stream close failed",
                    exc_info=True,
                )
        LOGGER.info(
            "computer microphone stopped dropped_frames=%s",
            self.dropped_frames,
        )
```

- [ ] **Step 5: Export and track the source**

Change `app/transport/__init__.py` to export:

```python
from app.transport.microphone_source import (
    InputDevice,
    LocalMicrophoneAudioSource,
    MicrophoneError,
    list_input_devices,
    parse_input_device,
)
```

Add the names to `__all__`. Add to `.gitignore`:

```gitignore
!tests/test_microphone_source.py
```

- [ ] **Step 6: Run source tests and verify they pass**

Run:

```bash
/Users/crazybread/Code/ai-bot/.venv/bin/python -m pytest \
  tests/test_microphone_source.py -q
```

Expected: all microphone-source tests pass without opening real hardware.

- [ ] **Step 7: Commit the local source**

```bash
git add .gitignore app/transport/microphone_source.py \
  app/transport/__init__.py tests/test_microphone_source.py
git commit -m "feat: add local microphone audio source"
```

### Task 2: Add mic-test CLI and device listing

**Files:**
- Modify: `app/hardware_main.py`
- Modify: `tests/test_config.py`

- [ ] **Step 1: Write failing parser and validation tests**

Add to `tests/test_config.py`:

```python
from app.hardware_main import (
    build_parser,
    validate_mode_arguments,
)


def test_app_cli_supports_microphone_test_options():
    args = build_parser().parse_args(
        ["mic-test", "--input-device", "2"]
    )

    validate_mode_arguments(args)

    assert args.mode == "mic-test"
    assert args.input_device == 2
    assert args.list_input_devices is False


def test_app_cli_supports_named_input_device():
    args = build_parser().parse_args(
        ["mic-test", "--input-device", "Built-in Mic"]
    )

    validate_mode_arguments(args)

    assert args.input_device == "Built-in Mic"


@pytest.mark.parametrize(
    "argv",
    [
        ["run", "--input-device", "2"],
        ["test", "--list-input-devices"],
    ],
)
def test_microphone_options_are_rejected_outside_mic_test(argv):
    args = build_parser().parse_args(argv)

    with pytest.raises(ConfigurationError):
        validate_mode_arguments(args)
```

- [ ] **Step 2: Run parser tests and verify they fail**

Run:

```bash
/Users/crazybread/Code/ai-bot/.venv/bin/python -m pytest \
  tests/test_config.py -q
```

Expected: import or assertion failures because the new mode, flags, and
validation function do not exist.

- [ ] **Step 3: Add mode, arguments, and validation**

In `app/hardware_main.py`, import `parse_input_device` lazily-safe from the
microphone module and update the parser:

```python
choices=("run", "test", "mic-test")
```

Add:

```python
parser.add_argument(
    "--input-device",
    type=parse_input_device,
    default=None,
)
parser.add_argument(
    "--list-input-devices",
    action="store_true",
)
```

Add:

```python
def validate_mode_arguments(args: argparse.Namespace) -> None:
    if args.mode != "mic-test" and (
        args.input_device is not None or args.list_input_devices
    ):
        raise ConfigurationError(
            "microphone options require mic-test mode"
        )
    if args.mode == "mic-test" and (
        args.audio_only
        or args.vision_only
        or args.audio_host is not None
        or args.audio_port is not None
        or args.vision_host is not None
        or args.vision_port is not None
    ):
        raise ConfigurationError(
            "hardware channel options are not valid in mic-test mode"
        )
```

- [ ] **Step 4: Add input-device listing before configuration loading**

Add to `app/hardware_main.py`:

```python
def format_input_devices() -> str:
    devices = list_input_devices()
    if not devices:
        return "No input-capable audio devices found."
    return "\n".join(
        f"{item.index}: {item.name} "
        f"(inputs={item.max_input_channels}, "
        f"default_rate={item.default_samplerate:g})"
        for item in devices
    )
```

In `main`, immediately after parsing:

```python
validate_mode_arguments(args)
if args.list_input_devices:
    print(format_input_devices())
    return
```

Keep this before `load_config`, VAD/ASR model creation, daemon creation, or API
startup.

- [ ] **Step 5: Run parser tests**

Run:

```bash
/Users/crazybread/Code/ai-bot/.venv/bin/python -m pytest \
  tests/test_config.py -q
```

Expected: all configuration and parser tests pass.

- [ ] **Step 6: Commit the CLI**

```bash
git add app/hardware_main.py tests/test_config.py
git commit -m "feat: add microphone test CLI"
```

### Task 3: Select the microphone source in the production pipeline

**Files:**
- Modify: `app/hardware_main.py`
- Modify: `tests/test_perception_runtime.py`

- [ ] **Step 1: Write failing daemon-wiring tests**

Add imports and tests to `tests/test_perception_runtime.py`:

```python
from app.transport.hardware_sources import (
    HTTPJPEGImageSource,
    TCPPCMAudioSource,
)
from app.transport.microphone_source import LocalMicrophoneAudioSource


@pytest.mark.asyncio
async def test_build_daemon_uses_only_computer_microphone_in_mic_test(
    monkeypatch,
):
    config = load_config()
    config.hardware.audio_enabled = False
    monkeypatch.setattr(
        "app.hardware_main.build_vad",
        lambda _config: MockVADBackend([]),
    )
    monkeypatch.setattr(
        "app.hardware_main.build_asr",
        lambda _config: SequenceASR([]),
    )

    daemon, gesture_backend = build_daemon(
        config,
        build_parser().parse_args(
            ["mic-test", "--input-device", "2"]
        ),
    )

    assert isinstance(daemon.audio_source, LocalMicrophoneAudioSource)
    assert daemon.audio_source.device == 2
    assert daemon.audio_source.sample_rate == 16_000
    assert daemon.audio_source.frame_samples == 512
    assert daemon.image_source is None
    assert daemon.vision_processor is None
    assert gesture_backend is None
    assert daemon.audio_processor is not None
    assert daemon.audio_processor.llm_detector is not None


@pytest.mark.asyncio
async def test_build_daemon_run_mode_keeps_hardware_sources(
    monkeypatch,
):
    config = load_config()
    monkeypatch.setattr(
        "app.hardware_main.build_vad",
        lambda _config: MockVADBackend([]),
    )
    monkeypatch.setattr(
        "app.hardware_main.build_asr",
        lambda _config: SequenceASR([]),
    )
    monkeypatch.setattr(
        "app.hardware_main.build_gesture",
        lambda _config: MockGestureBackend([]),
    )

    daemon, gesture_backend = build_daemon(
        config,
        build_parser().parse_args(["run"]),
    )

    assert isinstance(daemon.audio_source, TCPPCMAudioSource)
    assert isinstance(daemon.image_source, HTTPJPEGImageSource)
    assert gesture_backend is not None
```

- [ ] **Step 2: Run runtime tests and verify they fail**

Run:

```bash
/Users/crazybread/Code/ai-bot/.venv/bin/python -m pytest \
  tests/test_perception_runtime.py -q
```

Expected: mic-test still creates TCP/HTTP sources or cannot be parsed.

- [ ] **Step 3: Force audio on, vision off, and select the local source**

In `build_daemon`:

```python
microphone_mode = args.mode == "mic-test"
audio_enabled = (
    True
    if microphone_mode
    else config.hardware.audio_enabled and not args.vision_only
)
vision_enabled = (
    False
    if microphone_mode
    else config.hardware.vision_enabled and not args.audio_only
)
```

Inside the audio branch:

```python
if microphone_mode:
    audio_source = LocalMicrophoneAudioSource(
        device=args.input_device,
        sample_rate=config.audio.target_sample_rate,
        frame_samples=config.hardware.audio_frame_samples,
        queue_size=config.hardware.audio_queue_size,
    )
else:
    audio_source = TCPPCMAudioSource(
        args.audio_host or config.hardware.audio_host,
        (
            args.audio_port
            if args.audio_port is not None
            else config.hardware.audio_port
        ),
        sample_rate=config.audio.target_sample_rate,
        frame_samples=config.hardware.audio_frame_samples,
        queue_size=config.hardware.audio_queue_size,
    )
```

Keep all VAD, ASR, keyword, LLM detector, LLM session manager, controller, and
log construction after source selection unchanged.

- [ ] **Step 4: Add mic-test startup feedback**

In `run`, before `daemon.run()`:

```python
if args.mode == "mic-test":
    LOGGER.info(
        "mic-test active device=%s; ASR/events=logs/perception.log; "
        "LLM sessions/results=%s; press Ctrl+C to stop",
        (
            args.input_device
            if args.input_device is not None
            else "default"
        ),
        config.llm.log_path,
    )
```

Do not log `config.llm.provider` or any API key.

- [ ] **Step 5: Catch microphone failures**

Import `MicrophoneError` and add it to the existing handled exception tuple in
`main`:

```python
except (
    ConfigurationError,
    MicrophoneError,
    OSError,
    RuntimeError,
    VADError,
    VisionError,
) as exc:
    parser.error(str(exc))
```

- [ ] **Step 6: Run runtime, session, and configuration tests**

Run:

```bash
/Users/crazybread/Code/ai-bot/.venv/bin/python -m pytest \
  tests/test_perception_runtime.py tests/test_llm_session.py \
  tests/test_config.py -q
```

Expected: all selected tests pass; no real microphone, network listener, ASR
model, or LLM API is opened.

- [ ] **Step 7: Commit runtime integration**

```bash
git add app/hardware_main.py tests/test_perception_runtime.py
git commit -m "feat: route mic-test through the LLM pipeline"
```

### Task 4: Add dependency, documentation, and final verification

**Files:**
- Modify: `requirements.txt`
- Modify: `README.md`
- Modify: `docs/app-pipeline.md`

- [ ] **Step 1: Declare the microphone dependency**

Add to `requirements.txt`:

```text
sounddevice>=0.5,<1
```

Keep the import lazy so normal hardware mode reports microphone dependency
errors only if microphone-specific commands are used.

- [ ] **Step 2: Document setup and test flows**

Add this section to `README.md`:

```markdown
### 使用电脑麦克风测试 LLM

先配置 `config/llm.yaml` 和 `config/app.yaml` 中的 `llm.enabled`，然后：

```bash
python -m app mic-test --list-input-devices
python -m app mic-test
python -m app mic-test --input-device 2
```

按 `Ctrl+C` 退出。ASR 和事件写入 `logs/perception.log`，写信/问答的
转录、结果和错误写入 `logs/llm.log`。该模式不连接 Bot 音频端口、不启动
Vision，也不打印 LLM 输出。
```

Document example letter flow:

```text
我要给小明写信
正文内容……
小A，完成写信
```

Document example question flow:

```text
进入问答模式
问题内容……
小A，请回答
```

Update `docs/app-pipeline.md` with the local microphone source, CLI mode, input
device flags, source-selection branch, log destinations, and
`app/transport/microphone_source.py` responsibility.

- [ ] **Step 3: Run static and security checks**

Run:

```bash
/Users/crazybread/Code/ai-bot/.venv/bin/python -m compileall -q app tests
/Users/crazybread/Code/ai-bot/.venv/bin/python -m app --help
git diff --check
git grep -n -E "api_key_env|LLM_API_KEY|sk-[A-Za-z0-9]" \
  HEAD -- app README.md docs/app-pipeline.md config
```

Expected: compilation and help exit zero; help lists `mic-test`,
`--input-device`, and `--list-input-devices`; no whitespace errors; secret scan
has no matches.

- [ ] **Step 4: Run the complete test suite**

Run:

```bash
/Users/crazybread/Code/ai-bot/.venv/bin/python -m pytest -q
```

Expected: the complete suite passes. Tests that bind local HTTP ports require
the existing loopback permission; microphone tests use only fakes.

- [ ] **Step 5: Check optional real-device discovery**

If `sounddevice` is installed and macOS microphone/device access is available,
run:

```bash
/Users/crazybread/Code/ai-bot/.venv/bin/python -m app \
  mic-test --list-input-devices
```

Expected: input-capable devices are listed and the process exits without
loading models or starting ports. If host device access is unavailable, record
that limitation and rely on the fake-device tests; do not claim a physical
microphone smoke test.

- [ ] **Step 6: Commit dependency and documentation**

```bash
git add requirements.txt README.md docs/app-pipeline.md
git commit -m "docs: explain microphone LLM testing"
```

- [ ] **Step 7: Verify the final branch state**

Run:

```bash
git status --short
git diff --stat main...HEAD
/Users/crazybread/Code/ai-bot/.venv/bin/python -m pytest -q
```

Expected: worktree is clean, changes are limited to the files in this plan, and
the complete test suite passes on the final commit.
