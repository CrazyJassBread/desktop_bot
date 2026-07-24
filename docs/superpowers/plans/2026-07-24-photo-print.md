# Photo Print Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Print a grayscale pixel-art version of the camera frame one second after an ASR photo intent or stable Victory gesture, while ignoring duplicate triggers until a two-second cooldown ends.

**Architecture:** Add a focused `ThermalPrinterClient` for Pillow conversion, bitmap packing, chunking, and the printer HTTP protocol. Extend the existing photo manager to coordinate capture and printing, while the controller maps both trigger events into that single workflow and moves language switching to Open Palm.

**Tech Stack:** Python 3.13, asyncio, Pillow, urllib, pytest, pytest-asyncio.

---

## File map

- Create `app/features/thermal_printer.py`: image conversion, bitmap packing, chunking, synchronous HTTP printer client.
- Create `tests/test_thermal_printer.py`: deterministic image and local HTTP protocol tests.
- Modify `app/config.py`: photo keyword and printer configuration models and validation.
- Modify `config.yaml`: one-second delay, trigger phrases, printer defaults.
- Modify `app/detection/keywords.py`: emit `feature.photo_print`.
- Modify `app/features/photo_capture.py`: invoke printer and enforce cooldown.
- Modify `app/control/application_controller.py`: shared photo trigger and gesture role swap.
- Modify `app/hardware_main.py`: construct and inject the printer client.
- Modify `app/features/__init__.py`: export printer types.
- Modify `tests/test_config.py`: defaults and invalid printer configuration.
- Modify `tests/test_perception_runtime.py`: keyword, gesture, duplicate, cooldown, and workflow events.
- Modify `README.md` and `docs/app-pipeline.md`: document triggers, configuration, and event flow.

### Task 1: Printer image conversion and bitmap format

**Files:**
- Create: `app/features/thermal_printer.py`
- Create: `tests/test_thermal_printer.py`

- [ ] **Step 1: Write failing conversion and packing tests**

```python
from io import BytesIO
from PIL import Image

from app.features.thermal_printer import (
    convert_to_printer_image,
    pack_bitmap,
    split_image,
)


def encoded_image(size=(8, 4), color=(32, 64, 96)) -> bytes:
    output = BytesIO()
    Image.new("RGB", size, color).save(output, "PNG")
    return output.getvalue()


def test_conversion_is_one_bit_pixel_art_at_printer_width():
    result = convert_to_printer_image(
        encoded_image(),
        printer_width=16,
        pixel_size=2,
        grayscale_levels=4,
    )
    assert result.mode == "1"
    assert result.size == (16, 8)


def test_pack_bitmap_uses_msb_and_black_is_one():
    image = Image.new("1", (8, 1), 255)
    image.putpixel((0, 0), 0)
    image.putpixel((7, 0), 0)
    assert pack_bitmap(image) == bytes([0b10000001])


def test_split_image_preserves_order_and_height_limit():
    image = Image.new("1", (8, 5), 255)
    chunks = split_image(image, 2)
    assert [chunk.size for chunk in chunks] == [(8, 2), (8, 2), (8, 1)]
```

- [ ] **Step 2: Run tests and verify RED**

Run: `.venv/bin/python -m pytest tests/test_thermal_printer.py -q`

Expected: collection fails because `app.features.thermal_printer` does not exist.

- [ ] **Step 3: Implement minimal image helpers**

Implement `convert_to_printer_image(image_bytes, ...)`, `quantize_grayscale`,
`pack_bitmap`, and `split_image` in `app/features/thermal_printer.py`. Decode from
`BytesIO`, apply EXIF transpose, white transparency background, aspect-ratio resize,
grayscale, brightness/contrast, downscale/upscale pixelation, grayscale quantization,
optional rotation/dither, then emit Pillow mode `1`. Reject invalid dimensions,
levels, pixel sizes, and non-`1` input to `pack_bitmap`.

- [ ] **Step 4: Run tests and verify GREEN**

Run: `.venv/bin/python -m pytest tests/test_thermal_printer.py -q`

Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add app/features/thermal_printer.py tests/test_thermal_printer.py
git commit -m "feat: add thermal printer image conversion"
```

### Task 2: Printer HTTP client

**Files:**
- Modify: `app/features/thermal_printer.py`
- Modify: `tests/test_thermal_printer.py`
- Modify: `app/features/__init__.py`

- [ ] **Step 1: Write failing HTTP client tests**

Add a local `http.server.ThreadingHTTPServer` fixture that records POST path and body.
Test:

```python
def test_client_posts_each_chunk_in_order(recording_server):
    client = ThermalPrinterClient(
        recording_server.url,
        width=8,
        max_chunk_height=2,
        pixel_size=1,
        grayscale_levels=2,
        dither=False,
    )
    result = client.print_image(encoded_image(size=(8, 5)))
    assert result.chunk_count == 3
    assert [request.query["height"] for request in recording_server.requests] == [
        "2", "2", "1"
    ]
    assert all(request.path == "/printer/image" for request in recording_server.requests)
    assert all(request.content_type == "application/octet-stream"
               for request in recording_server.requests)
```

Also return HTTP 500 and assert `PrinterError.reason == "http_error"`.

- [ ] **Step 2: Run the targeted tests and verify RED**

Run: `.venv/bin/python -m pytest tests/test_thermal_printer.py -q`

Expected: import or attribute failure for `ThermalPrinterClient`.

- [ ] **Step 3: Implement the client**

Add immutable `PrintResult(width, height, chunk_count)`, `PrinterError(reason)`, and
`ThermalPrinterClient`. Its `print_image` prepares the image, splits it, packs each
chunk and sequentially performs:

```python
query = urlencode({"width": chunk.width, "height": chunk.height})
request = Request(
    f"{self.base_url}/printer/image?{query}",
    data=pack_bitmap(chunk),
    method="POST",
    headers={"Content-Type": "application/octet-stream"},
)
with urlopen(request, timeout=self.timeout_seconds) as response:
    response.read()
```

Map invalid images to `invalid_image`, timeouts to `timeout`, HTTP status failures to
`http_error`, and other connection failures to `connection_error`.

- [ ] **Step 4: Run tests and verify GREEN**

Run: `.venv/bin/python -m pytest tests/test_thermal_printer.py -q`

Expected: all printer tests pass.

- [ ] **Step 5: Export and commit**

Export `PrinterError`, `PrintResult`, and `ThermalPrinterClient` from
`app/features/__init__.py`, then:

```bash
git add app/features/thermal_printer.py app/features/__init__.py tests/test_thermal_printer.py
git commit -m "feat: add thermal printer HTTP client"
```

### Task 3: Configuration and photo intent

**Files:**
- Modify: `app/config.py`
- Modify: `config.yaml`
- Modify: `app/detection/keywords.py`
- Modify: `tests/test_config.py`
- Modify: `tests/test_perception_runtime.py`

- [ ] **Step 1: Write failing configuration and keyword tests**

Assert defaults:

```python
assert config.keywords.photo_print
assert config.printer.base_url == "http://10.76.7.129"
assert config.printer.width == 384
assert config.printer.cooldown_seconds == 2
```

Write invalid configuration cases for an empty URL, non-positive width, chunk height,
pixel size, contrast, brightness, timeout/cooldown, and grayscale levels outside
`2..256`. Add detector cases:

```python
for transcript in ("请拍照", "给我照相", "photo please", "take a picture"):
    match = detector.detect(transcript)
    assert match is not None
    assert match.event_type == "feature.photo_print"
```

- [ ] **Step 2: Run tests and verify RED**

Run: `.venv/bin/python -m pytest tests/test_config.py tests/test_perception_runtime.py -q`

Expected: missing `photo_print`/`printer` fields and unmatched photo phrases.

- [ ] **Step 3: Implement configuration and detection**

Add `KeywordConfig.photo_print` with the approved defaults. Add:

```python
@dataclass
class PrinterConfig:
    enabled: bool = True
    base_url: str = "http://10.76.7.129"
    width: int = 384
    max_chunk_height: int = 1200
    pixel_size: int = 6
    grayscale_levels: int = 4
    contrast: float = 1.2
    brightness: float = 1.0
    dither: bool = True
    rotate_180: bool = False
    timeout_seconds: float = 30.0
    cooldown_seconds: float = 2.0
```

Add it to `AppConfig` and `_SECTIONS`, validate the exact constraints, and place
`("feature.photo_print", config.photo_print)` before other feature rules in
`KeywordDetector`. Update repository YAML while preserving existing user edits.

- [ ] **Step 4: Run tests and verify GREEN**

Run: `.venv/bin/python -m pytest tests/test_config.py tests/test_perception_runtime.py -q`

Expected: all targeted tests pass.

- [ ] **Step 5: Commit**

```bash
git add app/config.py app/detection/keywords.py config.yaml tests/test_config.py tests/test_perception_runtime.py
git commit -m "feat: configure photo print intents"
```

### Task 4: Capture, print, cooldown, and gesture routing

**Files:**
- Modify: `app/features/photo_capture.py`
- Modify: `app/control/application_controller.py`
- Modify: `app/hardware_main.py`
- Modify: `tests/test_perception_runtime.py`

- [ ] **Step 1: Write failing workflow tests**

Create a recording printer with synchronous `print_image` and test:

```python
commands = await controller.handle(
    PerceptionEvent("feature.photo_print", "audio")
)
duplicate = await controller.handle(
    PerceptionEvent("gesture.victory", "vision")
)
assert [event.event_type for event in commands] == ["command.camera.capture_after"]
assert duplicate == ()

await asyncio.sleep(0.03)
assert printer.calls == 1
assert [event.event_type for event in emitted] == [
    "photo.captured", "photo.printed", "photo.completed"
]

assert await controller.handle(
    PerceptionEvent("feature.photo_print", "audio")
) == ()
await asyncio.sleep(0.03)
assert [event.event_type for event in await controller.handle(
    PerceptionEvent("gesture.victory", "vision")
)] == ["command.camera.capture_after"]
```

Use short test delays/cooldowns. Add failure tests for absent printer and
`PrinterError("timeout")`. Change the language test so `gesture.open_palm` toggles
language and `gesture.victory` does not.

- [ ] **Step 2: Run tests and verify RED**

Run: `.venv/bin/python -m pytest tests/test_perception_runtime.py -q`

Expected: Victory still switches language, Open Palm still captures, and no printer
events exist.

- [ ] **Step 3: Extend the photo manager**

Inject `printer` and `cooldown_seconds`. Keep one task as the lock. In `_capture`,
set an internal phase, delay, snapshot/save, emit `photo.captured`, call
`await asyncio.to_thread(printer.print_image, image_bytes)`, emit `photo.printed`
with dimensions/chunk count, then `photo.completed`. Emit `photo.print_failed` with
stable reasons for disabled/failed printers. In `finally`, sleep for the cooldown
unless cancelled, then return phase to `idle`.

- [ ] **Step 4: Swap gesture roles and share trigger logic**

In `ApplicationController.handle`, route both `feature.photo_print` and
`gesture.victory` to `_start_photo_print(event)`, route `gesture.open_palm` to
`_switch_language(event)`, and include `photo.print_failed` in terminal photo events.
The helper calls `photo_manager.schedule` and emits one
`command.camera.capture_after` only when scheduling succeeds.

- [ ] **Step 5: Wire the configured printer**

In `build_daemon`, construct `ThermalPrinterClient` when `printer.enabled`, pass it
and `printer.cooldown_seconds` to `PhotoCaptureManager`, and keep a photo manager
available when vision is enabled even if printing is disabled so it can emit the
stable `printer_disabled` failure.

- [ ] **Step 6: Run tests and verify GREEN**

Run: `.venv/bin/python -m pytest tests/test_perception_runtime.py tests/test_config.py tests/test_thermal_printer.py -q`

Expected: all targeted tests pass.

- [ ] **Step 7: Commit**

```bash
git add app/features/photo_capture.py app/control/application_controller.py app/hardware_main.py tests/test_perception_runtime.py
git commit -m "feat: trigger delayed photo printing from voice and victory"
```

### Task 5: Documentation and full verification

**Files:**
- Modify: `README.md`
- Modify: `docs/app-pipeline.md`

- [ ] **Step 1: Update documentation**

Document:

- photo phrases and deterministic matching;
- Victory photo printing and Open Palm language switching;
- the `printer` configuration table;
- the one-second delay and two-second cooldown;
- `photo.printed` and `photo.print_failed`;
- `/printer/image` protocol and in-memory bitmap transformation.

- [ ] **Step 2: Run formatting and regression checks**

Run:

```bash
.venv/bin/python -m pytest -q
.venv/bin/python -m compileall -q app tests
git diff --check
```

Expected: all tests pass, compilation succeeds, and `git diff --check` prints nothing.

- [ ] **Step 3: Run a non-mutating startup smoke test**

Run:

```bash
.venv/bin/python -m app --help
```

Expected: exit code 0 and CLI help.

- [ ] **Step 4: Review the final diff**

Confirm only scoped production files, tests, documentation, and the approved
`config.yaml` additions changed. Preserve unrelated `.DS_Store` and pre-existing
configuration edits.

- [ ] **Step 5: Commit**

```bash
git add README.md docs/app-pipeline.md
git commit -m "docs: describe photo printer workflow"
```

