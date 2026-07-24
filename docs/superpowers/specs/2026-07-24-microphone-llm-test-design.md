# Computer Microphone LLM Test Design

## Goal

Add a `python -m app mic-test` mode that replaces the Bot TCP audio source with
the computer's microphone while reusing the production VAD, ASR, intent,
letter/question session, and LLM client pipeline. LLM results remain log-only;
this mode does not print them.

## Command-line interface

The application mode choices become `run`, `test`, and `mic-test`.

```bash
python -m app mic-test
python -m app mic-test --input-device 2
python -m app mic-test --input-device "MacBook Microphone"
python -m app mic-test --list-input-devices
```

- With no device argument, `sounddevice` uses the operating system's default
  input device.
- `--input-device` accepts either an integer device index or a device-name
  string.
- `--list-input-devices` prints input-capable devices and exits without loading
  ASR, VAD, LLM, network listeners, or vision.
- `Ctrl+C` stops the test and closes the microphone stream.

The two microphone options are valid only with `mic-test`. Supplying them with
`run` or the existing vision `test` mode produces a command-line usage error.

## Audio source

Create `LocalMicrophoneAudioSource` as an implementation of the existing
`AudioFrameSource` contract. It owns a `sounddevice.InputStream` configured as:

- sample rate from `audio.target_sample_rate` (currently 16 kHz);
- one input channel;
- `float32`;
- block size from `hardware.audio_frame_samples` (currently 512 samples).

The PortAudio callback runs outside the asyncio event-loop thread. It copies
each mono block, flattens it into a contiguous NumPy `float32` array, and uses
`loop.call_soon_threadsafe` to offer it to a bounded asyncio queue. If the queue
is full, the source drops the oldest frame before inserting the newest one and
increments a dropped-frame counter; the callback must never block the audio
thread.

The async `frames()` generator starts the stream, yields queued frames, and
closes the stream in `finally`. Startup and callback failures are translated
into a stable `MicrophoneError` with non-secret, device-oriented reasons.
Repeated start and close operations are guarded so a stream cannot be opened
twice and cleanup is idempotent.

`sounddevice` becomes an explicit runtime dependency. The existing
`scripts/record.py` also benefits from that correction. `soundfile` is not
required for live microphone mode and remains outside this feature's scope.

## Runtime wiring

`build_daemon` keeps its existing production behavior for `run`. In
`mic-test`:

1. audio is forced on even if the hardware TCP audio switch is off;
2. vision input is forced off so no camera HTTP port is opened;
3. `LocalMicrophoneAudioSource` replaces `TCPPCMAudioSource`;
4. the same `StreamingAudioPipeline`, configured VAD backend,
   `KeywordASRProcessor`, `LLMModeDetector`, controller, and optional
   `LLMSessionManager` are constructed unchanged.

Photo printing cannot be triggered from microphone mode because there is no
camera frame source. Existing controller behavior returns the normal
photo-feature failure if a photo phrase is spoken; the microphone test adds no
special photo simulation.

LLM availability continues to follow the existing configuration rules:

- valid `config/llm.yaml` plus `llm.enabled: true` enables letter and
  question-answer sessions;
- missing credentials leave VAD and ASR usable, but LLM start phrases produce
  `llm.session_rejected`;
- malformed credentials fail during normal configuration validation.

## Logs and user feedback

The console prints the selected microphone, sample rate, frame size, startup
instructions, and the paths of both log files. It does not print full LLM
content by default.

- `logs/perception.log` contains ASR transcripts and perception/controller
  events.
- `logs/llm.log` contains session transitions, buffered spoken text, LLM
  output, duration, cancellation, and errors.

No API key is included in console output, events, exceptions, or logs. Phase
one remains log-only and does not send generated letter or answer content to
the printer.

## Device listing and errors

Device listing uses `sounddevice.query_devices()` and includes only entries
whose `max_input_channels` is greater than zero. Each line includes index,
name, maximum input channels, and default sample rate.

Failures are reported clearly:

- dependency unavailable: install project requirements;
- microphone permission denied or device unavailable: `microphone_unavailable`;
- unsupported sample rate, channel count, or stream startup:
  `microphone_open_failed`;
- asynchronous callback status or overflow: warning log plus continued
  capture when possible.

Ordinary hardware `run` mode imports `sounddevice` lazily through the local
source module, so a microphone-specific runtime failure does not alter TCP
audio behavior.

## Tests

Automated tests inject a fake `sounddevice` module and never open real hardware.
They cover:

- default and named/indexed device parsing;
- input-only device listing;
- callback conversion to contiguous mono `float32` frames;
- bounded-queue oldest-frame dropping;
- generator startup, repeated-start guard, cancellation, and idempotent close;
- stable microphone error mapping;
- `mic-test` selecting local audio and disabling TCP audio/vision sources;
- normal `run` retaining TCP audio and normal vision behavior;
- ASR/LLM components and log paths remaining unchanged;
- CLI rejection of microphone-only flags in other modes.

A manual smoke test records the exact command, expected console startup
message, a short letter flow, a short question flow, and verification of
`logs/perception.log` and `logs/llm.log`.
