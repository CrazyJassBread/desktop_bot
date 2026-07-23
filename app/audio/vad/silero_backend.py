"""Stateful Silero v6 VAD using the ONNX runtime already used by Whisper."""

from __future__ import annotations

import asyncio
from pathlib import Path

import numpy as np

from app.audio.vad.base import VADBackend, VADError


class SileroVADBackend(VADBackend):
    """Process sequential 512-sample frames at 16 kHz."""

    FRAME_SAMPLES = 512
    CONTEXT_SAMPLES = 64

    def __init__(self, model_path: Path | str = "bundled") -> None:
        try:
            import onnxruntime
        except ImportError as exc:
            raise VADError("onnxruntime is required for Silero VAD") from exc
        path = self._resolve_model_path(model_path)
        try:
            options = onnxruntime.SessionOptions()
            options.inter_op_num_threads = 1
            options.intra_op_num_threads = 1
            options.enable_cpu_mem_arena = False
            options.log_severity_level = 4
            self._session = onnxruntime.InferenceSession(
                str(path),
                providers=["CPUExecutionProvider"],
                sess_options=options,
            )
        except Exception as exc:
            raise VADError("failed to load Silero VAD ONNX model") from exc
        self._h = np.zeros((1, 1, 128), dtype=np.float32)
        self._c = np.zeros((1, 1, 128), dtype=np.float32)
        self._context = np.zeros(
            (1, self.CONTEXT_SAMPLES),
            dtype=np.float32,
        )

    @staticmethod
    def _resolve_model_path(model_path: Path | str) -> Path:
        if str(model_path) == "bundled":
            try:
                from faster_whisper.utils import get_assets_path
            except ImportError as exc:
                raise VADError("faster-whisper is required for bundled VAD") from exc
            path = Path(get_assets_path()) / "silero_vad_v6.onnx"
        else:
            path = Path(model_path)
        if not path.is_file():
            raise VADError(f"Silero VAD model not found: {path}")
        return path

    def _probability_sync(
        self,
        samples: np.ndarray,
        sample_rate: int,
    ) -> float:
        if sample_rate != 16_000:
            raise VADError("Silero streaming VAD requires 16000 Hz audio")
        frame = np.ascontiguousarray(samples, dtype=np.float32).reshape(-1)
        if frame.size != self.FRAME_SAMPLES:
            raise VADError("Silero streaming VAD requires 512-sample frames")
        model_input = np.concatenate(
            [self._context, frame.reshape(1, -1)],
            axis=1,
        )
        try:
            output, self._h, self._c = self._session.run(
                None,
                {
                    "input": model_input,
                    "h": self._h,
                    "c": self._c,
                },
            )
        except Exception as exc:
            raise VADError("Silero VAD inference failed") from exc
        self._context = frame[-self.CONTEXT_SAMPLES :].reshape(1, -1)
        return float(np.asarray(output).reshape(-1)[0])

    async def speech_probability(
        self,
        samples: np.ndarray,
        sample_rate: int,
    ) -> float:
        return await asyncio.to_thread(
            self._probability_sync,
            samples,
            sample_rate,
        )

    async def reset(self) -> None:
        self._h.fill(0)
        self._c.fill(0)
        self._context.fill(0)
