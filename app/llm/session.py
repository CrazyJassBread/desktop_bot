"""In-memory voice session state for letter polishing and question answering."""

from __future__ import annotations

import asyncio
import json
import logging
import time
from dataclasses import dataclass, field
from typing import Awaitable, Callable
from uuid import uuid4

from app.config import LLMConfig, LLMModeConfig
from app.detection.keywords import normalize_text
from app.llm.client import LLMError
from app.llm.mode_detector import _normalized_with_indexes
from app.perception_events import PerceptionEvent

EventEmitter = Callable[[PerceptionEvent], Awaitable[None]]


@dataclass
class _ActiveSession:
    session_id: str
    runtime_session_id: str
    mode: str
    recipient: str | None
    phase: str
    started_at: float
    last_activity: float
    transcripts: list[str] = field(default_factory=list)
    character_count: int = 0
    owner_user_id: str | None = None
    owner_email: str | None = None
    owner_display_name: str | None = None


@dataclass(frozen=True)
class _GenerationRequest:
    session_id: str
    runtime_session_id: str
    mode: str
    recipient: str | None
    transcripts: tuple[str, ...]
    started_at: float
    owner_user_id: str | None
    owner_email: str | None
    owner_display_name: str | None


class LLMSessionManager:
    def __init__(
        self,
        config: LLMConfig,
        client: object,
        *,
        logger: logging.Logger,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self.config = config
        self.client = client
        self.logger = logger
        self.clock = clock
        self._session: _ActiveSession | None = None
        self._watchdog_task: asyncio.Task[None] | None = None
        self._emit: EventEmitter | None = None
        self._lock = asyncio.Lock()

    @property
    def active(self) -> bool:
        return self._session is not None

    @property
    def mode(self) -> str | None:
        return self._session.mode if self._session is not None else None

    def set_event_emitter(self, emitter: EventEmitter) -> None:
        self._emit = emitter

    async def handle(
        self,
        event: PerceptionEvent,
    ) -> tuple[PerceptionEvent, ...]:
        generation: _GenerationRequest | None = None
        async with self._lock:
            if event.event_type in {"llm.letter.start", "llm.qa.start"}:
                return self._start_locked(event)
            if event.event_type != "speech.transcribed":
                return ()
            events, generation = self._transcript_locked(event)
        if generation is not None:
            await self._publish(
                PerceptionEvent(
                    event_type="llm.generation_started",
                    source="llm",
                    session_id=generation.runtime_session_id,
                    payload={
                        "llm_session_id": generation.session_id,
                        "mode": generation.mode,
                    },
                )
            )
            return await self._generate(generation)
        return events

    def _start_locked(
        self,
        event: PerceptionEvent,
    ) -> tuple[PerceptionEvent, ...]:
        if self._session is not None:
            return ()
        mode = (
            "letter"
            if event.event_type == "llm.letter.start"
            else "qa"
        )
        recipient = str(event.payload.get("payload_text", "")).strip()
        initial_text = ""
        if mode != "letter":
            initial_text = recipient
            recipient = self.config.user_nickname
        now = self.clock()
        self._session = _ActiveSession(
            session_id=uuid4().hex,
            runtime_session_id=event.session_id,
            mode=mode,
            recipient=recipient or None,
            phase=(
                "awaiting_recipient"
                if mode == "letter" and not recipient
                else "collecting"
            ),
            started_at=now,
            last_activity=now,
            transcripts=[initial_text] if initial_text else [],
            character_count=len(initial_text),
            owner_user_id=(
                str(event.payload.get("owner_user_id", "")).strip() or None
            ),
            owner_email=(
                str(event.payload.get("owner_email", "")).strip() or None
            ),
            owner_display_name=(
                str(event.payload.get("owner_display_name", "")).strip()
                or None
            ),
        )
        self._restart_watchdog_locked()
        self._log(
            "session_started",
            self._session,
            recipient=self._session.recipient,
        )
        return (
            self._event(
                "llm.session_started",
                self._session,
                {
                    "recipient": self._session.recipient,
                    "nickname": (
                        self.config.user_nickname
                        if mode == "qa"
                        else None
                    ),
                    "state": self._session.phase,
                },
            ),
        )

    def _transcript_locked(
        self,
        event: PerceptionEvent,
    ) -> tuple[
        tuple[PerceptionEvent, ...],
        _GenerationRequest | None,
    ]:
        session = self._session
        if session is None or session.phase == "generating":
            return (), None
        if event.payload.get("matched_event") == (
            f"llm.{session.mode}.start"
        ):
            return (), None

        now = self.clock()
        if now - session.started_at >= (
            self.config.session.max_duration_seconds
        ):
            return self._fail_locked("max_duration_exceeded"), None

        text = str(event.payload.get("transcript", "")).strip()
        if not text:
            return (), None
        forced_body = self._remove_body_prefix(text)
        mode_config = self._mode_config(session.mode)

        if forced_body is None:
            normalized = normalize_text(text)
            if normalized in {
                normalize_text(item)
                for item in mode_config.cancel_phrases
            }:
                cancelled = self._event(
                    "llm.session_cancelled",
                    session,
                    {"command": text},
                )
                self._log(
                    "session_cancelled",
                    session,
                    command=text,
                    transcripts=session.transcripts,
                )
                self._clear_locked()
                return (cancelled,), None
            normalized_finish_phrases = {
                normalize_text(item)
                for item in mode_config.finish_phrases
            }
            if (
                normalized in normalized_finish_phrases
                or any(
                    normalized.endswith(phrase)
                    for phrase in normalized_finish_phrases
                )
            ):
                if session.phase == "awaiting_recipient":
                    return self._fail_locked("recipient_required"), None
                if not session.transcripts:
                    return self._fail_locked("empty_content"), None
                session.phase = "generating"
                self._cancel_watchdog_locked()
                return (), _GenerationRequest(
                    session_id=session.session_id,
                    runtime_session_id=session.runtime_session_id,
                    mode=session.mode,
                    recipient=session.recipient,
                    transcripts=tuple(session.transcripts),
                    started_at=session.started_at,
                    owner_user_id=session.owner_user_id,
                    owner_email=session.owner_email,
                    owner_display_name=session.owner_display_name,
                )
        else:
            text = forced_body
            if not text:
                return (), None

        if session.phase == "awaiting_recipient":
            recipient = self._extract_recipient(text, mode_config)
            if recipient is None:
                return (), None
            session.recipient = recipient
            session.phase = "collecting"
            session.last_activity = now
            self._restart_watchdog_locked()
            self._log(
                "recipient_set",
                session,
                recipient=recipient,
            )
            return (
                self._event(
                    "llm.recipient_set",
                    session,
                    {"recipient": recipient},
                ),
            ), None

        next_count = session.character_count + len(text)
        if next_count > self.config.session.max_characters:
            return self._fail_locked("max_characters_exceeded"), None
        session.transcripts.append(text)
        session.character_count = next_count
        session.last_activity = now
        self._restart_watchdog_locked()
        self._log(
            "transcript_buffered",
            session,
            transcript=text,
            fragment_count=len(session.transcripts),
            character_count=next_count,
        )
        return (
            self._event(
                "llm.transcript_buffered",
                session,
                {
                    "fragment_count": len(session.transcripts),
                    "character_count": next_count,
                },
            ),
        ), None

    async def _generate(
        self,
        request: _GenerationRequest,
    ) -> tuple[PerceptionEvent, ...]:
        system_prompt, user_prompt = self._prompts(request)
        started = self.clock()
        try:
            content = await getattr(self.client, "complete")(
                system_prompt=system_prompt,
                user_prompt=user_prompt,
            )
        except LLMError as exc:
            async with self._lock:
                if not self._is_current(request.session_id):
                    return ()
                return self._fail_locked(exc.reason)
        except Exception:
            self.logger.exception("unexpected LLM session failure")
            async with self._lock:
                if not self._is_current(request.session_id):
                    return ()
                return self._fail_locked("internal_error")

        elapsed_ms = int((self.clock() - started) * 1_000)
        async with self._lock:
            if not self._is_current(request.session_id):
                return ()
            session = self._session
            assert session is not None
            event_type = (
                "llm.letter_completed"
                if request.mode == "letter"
                else "llm.answer_completed"
            )
            payload = {
                (
                    "recipient"
                    if request.mode == "letter"
                    else "nickname"
                ): (
                    request.recipient
                    if request.mode == "letter"
                    else self.config.user_nickname
                ),
                "content": content,
                "fragment_count": len(request.transcripts),
                "elapsed_ms": elapsed_ms,
            }
            if request.mode == "letter" and request.owner_user_id is not None:
                payload.update(
                    {
                        "owner_user_id": request.owner_user_id,
                        "owner_email": request.owner_email,
                        "owner_display_name": request.owner_display_name,
                    }
                )
            completed = self._event(event_type, session, payload)
            self._log(
                "session_completed",
                session,
                transcripts=request.transcripts,
                output=content,
                prompt_characters=len(system_prompt) + len(user_prompt),
                elapsed_ms=elapsed_ms,
            )
            self._clear_locked()
            return (completed,)

    def _prompts(
        self,
        request: _GenerationRequest,
    ) -> tuple[str, str]:
        numbered = "\n".join(
            f"{index}. {text}"
            for index, text in enumerate(request.transcripts, start=1)
        )
        if request.mode == "letter":
            system = (
                "你是一名书信编辑。请保留事实、姓名、关系、情绪和原意，"
                "删除ASR重复、口头禅、停顿词和无意义碎片，改善断句、逻辑、"
                "表达清晰度和文学性。不要虚构经历、承诺或事实。"
                "只输出正文，不生成称呼、日期、签名或打印布局。"
            )
            user = (
                f"收件人：{request.recipient}\n"
                f"按顺序整理以下口语转录：\n{numbered}"
            )
            return system, user
        system = (
            "你是一名准确、清晰的问答助手。请将多段口语转录理解为一个"
            "完整问题，给出直接、准确、结构清晰的回答；无可靠结论时明确"
            "说明不确定性。只输出回答正文，不生成打印布局。"
        )
        user = (
            f"用户昵称：{self.config.user_nickname}\n"
            f"按顺序理解以下问题转录：\n{numbered}"
        )
        return system, user

    def _remove_body_prefix(self, text: str) -> str | None:
        for prefix in self.config.session.body_prefixes:
            if text.startswith(prefix):
                return text[len(prefix):].strip()
        return None

    @staticmethod
    def _extract_recipient(
        text: str,
        mode_config: LLMModeConfig,
    ) -> str | None:
        normalized, original_indexes = _normalized_with_indexes(text)
        for prefix in mode_config.recipient_prefixes:
            normalized_prefix = normalize_text(prefix)
            if normalized.startswith(normalized_prefix):
                recipient_start = len(normalized_prefix)
                if recipient_start >= len(original_indexes):
                    return None
                original_start = original_indexes[recipient_start]
                recipient = text[original_start:].strip(
                    " \t\r\n，。！？、,.!?;；:：\"'“”‘’（）()[]【】"
                )
                return recipient or None
        return None

    def _mode_config(self, mode: str) -> LLMModeConfig:
        return (
            self.config.modes.letter
            if mode == "letter"
            else self.config.modes.qa
        )

    def _fail_locked(
        self,
        reason: str,
    ) -> tuple[PerceptionEvent, ...]:
        session = self._session
        assert session is not None
        failed = self._event(
            "llm.session_failed",
            session,
            {"reason": reason},
        )
        self._log(
            "session_failed",
            session,
            reason=reason,
            transcripts=session.transcripts,
        )
        self._clear_locked()
        return (failed,)

    def _event(
        self,
        event_type: str,
        session: _ActiveSession,
        payload: dict[str, object],
    ) -> PerceptionEvent:
        return PerceptionEvent(
            event_type=event_type,
            source="llm",
            session_id=session.runtime_session_id,
            payload={
                "llm_session_id": session.session_id,
                "mode": session.mode,
                **payload,
            },
        )

    def _log(
        self,
        action: str,
        session: _ActiveSession,
        **details: object,
    ) -> None:
        self.logger.info(
            "%s",
            json.dumps(
                {
                    "action": action,
                    "llm_session_id": session.session_id,
                    "mode": session.mode,
                    "recipient": session.recipient,
                    **details,
                },
                ensure_ascii=False,
            ),
        )

    def _restart_watchdog_locked(self) -> None:
        self._cancel_watchdog_locked()
        assert self._session is not None
        self._watchdog_task = asyncio.create_task(
            self._watchdog(self._session.session_id)
        )

    def _cancel_watchdog_locked(self) -> None:
        task = self._watchdog_task
        self._watchdog_task = None
        if (
            task is not None
            and task is not asyncio.current_task()
            and not task.done()
        ):
            task.cancel()

    async def _watchdog(self, session_id: str) -> None:
        try:
            while True:
                event: PerceptionEvent | None = None
                delay = 0.0
                async with self._lock:
                    if not self._is_current(session_id):
                        return
                    session = self._session
                    assert session is not None
                    now = self.clock()
                    idle_remaining = (
                        self.config.session.idle_timeout_seconds
                        - (now - session.last_activity)
                    )
                    maximum_remaining = (
                        self.config.session.max_duration_seconds
                        - (now - session.started_at)
                    )
                    delay = min(idle_remaining, maximum_remaining)
                    if delay <= 0:
                        reason = (
                            "max_duration_exceeded"
                            if maximum_remaining <= 0
                            else "idle_timeout"
                        )
                        event = self._fail_locked(reason)[0]
                if event is not None:
                    await self._publish(event)
                    return
                await asyncio.sleep(delay)
        except asyncio.CancelledError:
            raise

    async def _publish(self, event: PerceptionEvent) -> None:
        if self._emit is None:
            self.logger.warning(
                "LLM session event dropped because no emitter is configured"
            )
            return
        await self._emit(event)

    def _is_current(self, session_id: str) -> bool:
        return (
            self._session is not None
            and self._session.session_id == session_id
        )

    def _clear_locked(self) -> None:
        self._cancel_watchdog_locked()
        self._session = None

    async def aclose(self) -> None:
        async with self._lock:
            task = self._watchdog_task
            self._watchdog_task = None
            self._session = None
            if task is not None and not task.done():
                task.cancel()
        if task is not None:
            await asyncio.gather(task, return_exceptions=True)
