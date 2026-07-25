"""Collect dictated speech and turn it into a letter or an answer via LLM."""

from __future__ import annotations

import asyncio
import json
import logging
from typing import Awaitable, Callable

from app.llm.base import LLMBackend, LLMError
from app.perception_events import PerceptionEvent

LOGGER = logging.getLogger("desktop_assistant.llm")
EventEmitter = Callable[[PerceptionEvent], Awaitable[None]]
ActivityProbe = Callable[[], bool]

MODE_LETTER = "letter"
MODE_QA = "qa"


def parse_letter_result(result: str) -> dict[str, object]:
    """Parse the structured letter JSON produced by the LLM.

    Returns recipient (str or None), subject, and body. A malformed
    response falls back to the whole text as the body so the letter is
    never lost.
    """
    text = result.strip()
    if text.startswith("```"):
        # Strip a Markdown code fence such as ```json ... ```.
        lines = text.splitlines()
        if len(lines) >= 2 and lines[-1].strip().startswith("```"):
            text = "\n".join(lines[1:-1]).strip()
    try:
        data = json.loads(text)
    except ValueError:
        data = None
    if not isinstance(data, dict):
        return {"recipient": None, "subject": "", "body": result.strip()}
    recipient = data.get("recipient")
    if not isinstance(recipient, str) or not recipient.strip():
        recipient = None
    else:
        recipient = recipient.strip()
    subject = data.get("subject")
    subject = subject.strip() if isinstance(subject, str) else ""
    body = data.get("body")
    body = body.strip() if isinstance(body, str) else ""
    if not body:
        return {"recipient": recipient, "subject": subject, "body": result.strip()}
    return {"recipient": recipient, "subject": subject, "body": body}


class LLMSessionManager:
    """One dictation session at a time: collect, then finalize with the LLM."""

    def __init__(
        self,
        backend: LLMBackend,
        *,
        silence_timeout_seconds: float = 10.0,
        silence_poll_interval_seconds: float = 0.25,
        letter_system_prompt: str = "",
        qa_system_prompt: str = "",
        letter_system_prompt_en: str = "",
        qa_system_prompt_en: str = "",
    ) -> None:
        self.backend = backend
        self.silence_timeout_seconds = silence_timeout_seconds
        self.silence_poll_interval_seconds = silence_poll_interval_seconds
        self.letter_system_prompt = letter_system_prompt
        self.qa_system_prompt = qa_system_prompt
        self.letter_system_prompt_en = letter_system_prompt_en
        self.qa_system_prompt_en = qa_system_prompt_en
        self._emit: EventEmitter | None = None
        self._activity_probe: ActivityProbe | None = None
        self._mode: str | None = None
        self._language = "zh"
        self._segments: list[str] = []
        self._session_id = "bot"
        self._trigger_event_id: str | None = None
        self._silence_task: asyncio.Task[None] | None = None
        self._finalize_tasks: set[asyncio.Task[None]] = set()

    def set_event_emitter(self, emitter: EventEmitter) -> None:
        self._emit = emitter

    def set_activity_probe(self, probe: ActivityProbe) -> None:
        """Install a check for in-flight speech (capture, queue or ASR).

        While the probe reports activity the silence countdown is deferred,
        so a dictation longer than the timeout is not cut off mid-speech.
        """
        self._activity_probe = probe

    @property
    def mode(self) -> str | None:
        return self._mode

    @property
    def active(self) -> bool:
        return self._mode is not None

    async def start(
        self,
        mode: str,
        trigger: PerceptionEvent,
        initial_text: str = "",
        *,
        language: str = "zh",
    ) -> None:
        if self._mode is not None:
            return
        if mode not in {MODE_LETTER, MODE_QA}:
            raise ValueError(f"unknown LLM session mode: {mode}")
        self._mode = mode
        self._language = language
        self._segments = []
        self._session_id = trigger.session_id
        self._trigger_event_id = trigger.event_id
        await self._publish(
            PerceptionEvent(
                event_type="llm.session_started",
                source="llm",
                session_id=self._session_id,
                payload={
                    "mode": mode,
                    "language": language,
                    "trigger_event_id": trigger.event_id,
                    "silence_timeout_seconds": self.silence_timeout_seconds,
                },
            )
        )
        text = initial_text.strip()
        if text:
            await self._append_segment(text)
        self._restart_silence_timer()

    async def add_transcript(self, text: str) -> None:
        if self._mode is None:
            return
        stripped = text.strip()
        if stripped:
            await self._append_segment(stripped)
        self._restart_silence_timer()

    async def finish(self, *, final_text: str = "", reason: str = "end_keyword") -> None:
        if self._mode is None:
            return
        final = final_text.strip()
        if final:
            await self._append_segment(final)
        self._cancel_silence_timer()
        mode = self._mode
        language = self._language
        raw_transcript = "\n".join(self._segments)
        session_id = self._session_id
        trigger_event_id = self._trigger_event_id
        self._mode = None
        self._segments = []
        self._trigger_event_id = None
        await self._publish(
            PerceptionEvent(
                event_type="llm.processing",
                source="llm",
                session_id=session_id,
                payload={
                    "mode": mode,
                    "language": language,
                    "reason": reason,
                    "trigger_event_id": trigger_event_id,
                    "raw_transcript": raw_transcript,
                },
            )
        )
        task = asyncio.create_task(
            self._finalize(
                mode, language, raw_transcript, session_id, trigger_event_id
            )
        )
        self._finalize_tasks.add(task)
        task.add_done_callback(self._finalize_tasks.discard)

    def _system_prompt(self, mode: str, language: str) -> str:
        if mode == MODE_LETTER:
            zh_prompt, en_prompt = (
                self.letter_system_prompt,
                self.letter_system_prompt_en,
            )
        else:
            zh_prompt, en_prompt = (
                self.qa_system_prompt,
                self.qa_system_prompt_en,
            )
        if language == "en" and en_prompt.strip():
            return en_prompt
        return zh_prompt

    async def _finalize(
        self,
        mode: str,
        language: str,
        raw_transcript: str,
        session_id: str,
        trigger_event_id: str | None,
    ) -> None:
        if not raw_transcript.strip():
            await self._failed(mode, session_id, trigger_event_id, "empty_transcript")
            return
        prompt = self._system_prompt(mode, language)
        try:
            result = await self.backend.complete(prompt, raw_transcript)
        except LLMError as exc:
            LOGGER.exception("LLM completion failed")
            await self._failed(mode, session_id, trigger_event_id, str(exc))
            return
        if mode == MODE_LETTER:
            parsed = parse_letter_result(result)
            payload: dict[str, object] = {
                "mode": mode,
                "language": language,
                "letter": parsed["body"],
                "recipient": parsed["recipient"],
                "subject": parsed["subject"],
                "raw_transcript": raw_transcript,
                "trigger_event_id": trigger_event_id,
            }
            event_type = "llm.letter_completed"
        else:
            payload = {
                "mode": mode,
                "language": language,
                "question": raw_transcript,
                "answer": result,
                "trigger_event_id": trigger_event_id,
            }
            event_type = "llm.answer_completed"
        await self._publish(
            PerceptionEvent(
                event_type=event_type,
                source="llm",
                session_id=session_id,
                payload=payload,
            )
        )

    async def _append_segment(self, text: str) -> None:
        self._segments.append(text)
        await self._publish(
            PerceptionEvent(
                event_type="llm.transcript_added",
                source="llm",
                session_id=self._session_id,
                payload={
                    "mode": self._mode,
                    "text": text,
                    "total_segments": len(self._segments),
                },
            )
        )

    def _restart_silence_timer(self) -> None:
        self._cancel_silence_timer()
        self._silence_task = asyncio.create_task(self._watch_silence())

    def _cancel_silence_timer(self) -> None:
        task = self._silence_task
        self._silence_task = None
        if task is None or task.done():
            return
        if task is asyncio.current_task():
            return
        task.cancel()

    async def _watch_silence(self) -> None:
        loop = asyncio.get_running_loop()
        deadline = loop.time() + self.silence_timeout_seconds
        while True:
            if self._activity_probe is not None and self._activity_probe():
                # Speech is still being captured or transcribed; the
                # countdown restarts once the audio pipeline is idle.
                deadline = loop.time() + self.silence_timeout_seconds
            remaining = deadline - loop.time()
            if remaining <= 0:
                await self.finish(reason="silence_timeout")
                return
            await asyncio.sleep(
                min(self.silence_poll_interval_seconds, remaining)
            )

    async def _failed(
        self,
        mode: str,
        session_id: str,
        trigger_event_id: str | None,
        reason: str,
    ) -> None:
        await self._publish(
            PerceptionEvent(
                event_type="llm.failed",
                source="llm",
                session_id=session_id,
                payload={
                    "mode": mode,
                    "reason": reason,
                    "trigger_event_id": trigger_event_id,
                },
            )
        )

    async def _publish(self, event: PerceptionEvent) -> None:
        if self._emit is None:
            LOGGER.warning("llm event dropped because no emitter is configured")
            return
        await self._emit(event)

    async def aclose(self) -> None:
        self._cancel_silence_timer()
        pending = [task for task in self._finalize_tasks if not task.done()]
        for task in pending:
            task.cancel()
        if pending:
            await asyncio.gather(*pending, return_exceptions=True)
        await self.backend.aclose()
