"""Persist ASR and LLM results from the event bus for local testing."""

from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime
from pathlib import Path

from app.events.event_bus import EventBus
from app.perception_events import PerceptionEvent

LOGGER = logging.getLogger("desktop_assistant.recorder")

_ASR_EVENTS = {"speech.transcribed"}
_LLM_EVENTS = {
    "llm.session_started",
    "llm.processing",
    "llm.letter_completed",
    "llm.answer_completed",
    "llm.failed",
}


class ResultRecorder:
    """Split ASR and LLM results into separate JSONL files and echo them."""

    def __init__(
        self,
        event_bus: EventBus,
        output_dir: str | Path = "logs/mictest",
        *,
        echo: bool = True,
    ) -> None:
        self.event_bus = event_bus
        self.output_dir = Path(output_dir)
        self.asr_path = self.output_dir / "asr_results.jsonl"
        self.llm_path = self.output_dir / "llm_results.jsonl"
        self.echo = echo
        self._task: asyncio.Task[None] | None = None

    def start(self) -> None:
        if self._task is None:
            self.output_dir.mkdir(parents=True, exist_ok=True)
            self._task = asyncio.create_task(self._consume())

    async def aclose(self) -> None:
        if self._task is not None:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None

    async def _consume(self) -> None:
        async with self.event_bus.subscribe() as subscription:
            while True:
                event = await subscription.get()
                if event.event_type in _ASR_EVENTS:
                    self._record(self.asr_path, event)
                elif event.event_type in _LLM_EVENTS:
                    self._record(self.llm_path, event)

    def _record(self, path: Path, event: PerceptionEvent) -> None:
        entry = {
            "time": datetime.fromtimestamp(
                event.timestamp_ms / 1000
            ).isoformat(timespec="milliseconds"),
            "event_type": event.event_type,
            **event.payload,
        }
        with path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(entry, ensure_ascii=False) + "\n")
        if self.echo:
            print(self._format_echo(event), flush=True)

    @staticmethod
    def _format_echo(event: PerceptionEvent) -> str:
        payload = event.payload
        if event.event_type == "speech.transcribed":
            matched = payload.get("matched_event")
            suffix = f"  →  {matched}" if matched else ""
            return f"[ASR] {payload.get('transcript', '')}{suffix}"
        if event.event_type == "llm.session_started":
            return f"[LLM▶{payload.get('mode')}] 会话开始，请继续口述…"
        if event.event_type == "llm.processing":
            return (
                f"[LLM…{payload.get('mode')}] "
                f"触发={payload.get('reason')}，正在生成…"
            )
        if event.event_type == "llm.letter_completed":
            return f"[LLM✓letter]\n{payload.get('letter', '')}"
        if event.event_type == "llm.answer_completed":
            return f"[LLM✓qa] {payload.get('answer', '')}"
        return f"[LLM✗] {payload.get('mode')}: {payload.get('reason')}"
