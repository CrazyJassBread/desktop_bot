from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass

import pytest

from app.config import LLMModeConfig, LLMModesConfig, load_config
from app.llm.client import LLMError
from app.llm.mode_detector import LLMModeDetector
from app.llm.session import LLMSessionManager
from app.perception_events import PerceptionEvent


@dataclass(frozen=True)
class CompletionCall:
    system_prompt: str
    user_prompt: str


class RecordingLLMClient:
    def __init__(
        self,
        result: str = "生成结果",
        failure: str | None = None,
    ) -> None:
        self.result = result
        self.failure = failure
        self.calls: list[CompletionCall] = []

    async def complete(
        self,
        *,
        system_prompt: str,
        user_prompt: str,
    ) -> str:
        self.calls.append(CompletionCall(system_prompt, user_prompt))
        if self.failure is not None:
            raise LLMError(self.failure)
        return self.result


def start_event(
    event_type: str,
    *,
    recipient: str = "",
    owner: dict[str, str] | None = None,
) -> PerceptionEvent:
    return PerceptionEvent(
        event_type,
        "audio",
        payload={
            "payload_text": recipient,
            "transcript": "开始命令",
            **(owner or {}),
        },
    )


def transcript(
    text: str,
    matched_event: str | None = None,
) -> PerceptionEvent:
    return PerceptionEvent(
        "speech.transcribed",
        "audio",
        payload={
            "transcript": text,
            "matched_event": matched_event,
        },
    )


def event_types(
    events: tuple[PerceptionEvent, ...],
) -> list[str]:
    return [event.event_type for event in events]


def manager_config():
    config = load_config().llm
    config.enabled = True
    config.base_url = "https://example.test/v1"
    config.model = "test"
    return config


def test_mode_detector_recognizes_letter_qa_and_recipient_template():
    detector = LLMModeDetector(load_config().llm.modes)

    letter = detector.detect("小 A，我要写信")
    recipient = detector.detect("小A，我要给小明写信")
    qa = detector.detect("我有一个问题")

    assert letter is not None
    assert letter.event_type == "llm.letter.start"
    assert recipient is not None
    assert recipient.event_type == "llm.letter.start"
    assert recipient.payload_text == "小明"
    assert qa is not None
    assert qa.event_type == "llm.qa.start"
    assert detector.detect("今天不写信") is None


def test_mode_detector_keeps_question_after_qa_start_phrase():
    detector = LLMModeDetector(load_config().llm.modes)

    match = detector.detect("进入问答模式，什么是强化学习")

    assert match is not None
    assert match.event_type == "llm.qa.start"
    assert match.payload_text == "什么是强化学习"


def test_mode_detector_uses_configured_order_for_templates():
    detector = LLMModeDetector(
        LLMModesConfig(
            letter=LLMModeConfig(
                start_phrases=["开始写信"],
                recipient_templates=[
                    "请给{recipient}写信",
                    "给{recipient}写信",
                ],
                finish_phrases=["完成"],
                cancel_phrases=["取消"],
            ),
            qa=LLMModeConfig(
                start_phrases=["开始问答"],
                finish_phrases=["回答"],
                cancel_phrases=["取消问答"],
            ),
        )
    )

    match = detector.detect("请给小红写信")

    assert match is not None
    assert match.keyword == "请给{recipient}写信"
    assert match.payload_text == "小红"
    assert detector.detect("请给写信") is None


@pytest.mark.asyncio
async def test_letter_session_buffers_then_generates_polished_text():
    client = RecordingLLMClient("润色后的正文")
    manager = LLMSessionManager(
        manager_config(),
        client,
        logger=logging.getLogger("test.llm.letter"),
    )

    started = await manager.handle(
        start_event("llm.letter.start", recipient="小明")
    )
    ignored_start = await manager.handle(
        transcript("我要给小明写信", "llm.letter.start")
    )
    buffered = await manager.handle(transcript("嗯那个今天很好"))
    completed = await manager.handle(transcript("小A，信写完了"))

    assert event_types(started) == ["llm.session_started"]
    assert ignored_start == ()
    assert event_types(buffered) == ["llm.transcript_buffered"]
    assert event_types(completed) == ["llm.letter_completed"]
    assert completed[0].payload["recipient"] == "小明"
    assert completed[0].payload["content"] == "润色后的正文"
    assert manager.active is False
    assert len(client.calls) == 1
    assert "不要虚构" in client.calls[0].system_prompt
    assert "嗯那个今天很好" in client.calls[0].user_prompt
    await manager.aclose()


@pytest.mark.asyncio
async def test_letter_session_locks_owner_from_start_until_completion():
    manager = LLMSessionManager(
        manager_config(),
        RecordingLLMClient("归属明确的正文"),
        logger=logging.getLogger("test.llm.owner"),
    )
    owner = {
        "owner_user_id": "user-one",
        "owner_email": "one@example.test",
        "owner_display_name": "用户一",
    }

    await manager.handle(
        start_event("llm.letter.start", recipient="小明", owner=owner)
    )
    await manager.handle(transcript("正文内容"))
    completed = await manager.handle(transcript("小A，信写完了"))

    assert completed[0].payload["owner_user_id"] == "user-one"
    assert completed[0].payload["owner_email"] == "one@example.test"
    assert completed[0].payload["owner_display_name"] == "用户一"
    await manager.aclose()


@pytest.mark.asyncio
async def test_qa_session_buffers_question_from_start_utterance():
    client = RecordingLLMClient("强化学习答案")
    manager = LLMSessionManager(
        manager_config(),
        client,
        logger=logging.getLogger("test.llm.qa.initial"),
    )

    started = await manager.handle(
        start_event("llm.qa.start", recipient="什么是强化学习")
    )
    completed = await manager.handle(transcript("小A，请回答"))

    assert event_types(started) == ["llm.session_started"]
    assert event_types(completed) == ["llm.answer_completed"]
    assert "什么是强化学习" in client.calls[0].user_prompt
    await manager.aclose()


@pytest.mark.asyncio
async def test_qa_finish_tolerates_asr_prefix_before_short_command():
    client = RecordingLLMClient("人工智能答案")
    manager = LLMSessionManager(
        manager_config(),
        client,
        logger=logging.getLogger("test.llm.qa.asr_prefix"),
    )

    await manager.handle(
        start_event("llm.qa.start", recipient="什么是人工智能")
    )
    completed = await manager.handle(transcript("小微衣，请回答。"))

    assert event_types(completed) == ["llm.answer_completed"]
    assert len(client.calls) == 1
    await manager.aclose()


@pytest.mark.asyncio
async def test_letter_session_collects_recipient_before_body():
    manager = LLMSessionManager(
        manager_config(),
        RecordingLLMClient(),
        logger=logging.getLogger("test.llm.recipient"),
    )

    await manager.handle(start_event("llm.letter.start"))
    recipient = await manager.handle(transcript("收件人 是：小红"))
    body = await manager.handle(transcript("最近很想你"))

    assert manager.mode == "letter"
    assert event_types(recipient) == ["llm.recipient_set"]
    assert recipient[0].payload["recipient"] == "小红"
    assert event_types(body) == ["llm.transcript_buffered"]
    await manager.aclose()


@pytest.mark.asyncio
async def test_control_commands_require_full_match_and_body_prefix_wins():
    client = RecordingLLMClient()
    manager = LLMSessionManager(
        manager_config(),
        client,
        logger=logging.getLogger("test.llm.controls"),
    )
    await manager.handle(
        start_event("llm.letter.start", recipient="小明")
    )

    embedded = await manager.handle(
        transcript("他说小A信写完了，但我还没有写完")
    )
    prefixed = await manager.handle(
        transcript("正文：小A，取消写信")
    )
    cancelled = await manager.handle(transcript("小A，取消写信"))

    assert event_types(embedded) == ["llm.transcript_buffered"]
    assert event_types(prefixed) == ["llm.transcript_buffered"]
    assert event_types(cancelled) == ["llm.session_cancelled"]
    assert client.calls == []
    assert manager.active is False
    await manager.aclose()


@pytest.mark.asyncio
async def test_qa_session_uses_nickname_and_answer_prompt():
    config = manager_config()
    config.user_nickname = "面包"
    client = RecordingLLMClient("这是回答")
    manager = LLMSessionManager(
        config,
        client,
        logger=logging.getLogger("test.llm.qa"),
    )

    await manager.handle(start_event("llm.qa.start"))
    await manager.handle(transcript("强化学习是什么"))
    completed = await manager.handle(transcript("小A，请回答"))

    assert event_types(completed) == ["llm.answer_completed"]
    assert completed[0].payload["nickname"] == "面包"
    assert completed[0].payload["content"] == "这是回答"
    assert "准确" in client.calls[0].system_prompt
    assert "强化学习是什么" in client.calls[0].user_prompt
    await manager.aclose()


@pytest.mark.asyncio
async def test_generation_start_is_emitted_before_completion():
    manager = LLMSessionManager(
        manager_config(),
        RecordingLLMClient("回答"),
        logger=logging.getLogger("test.llm.generation_state"),
    )
    emitted: list[PerceptionEvent] = []

    async def emit(event: PerceptionEvent) -> None:
        emitted.append(event)

    manager.set_event_emitter(emit)
    await manager.handle(start_event("llm.qa.start"))
    await manager.handle(transcript("问题"))
    completed = await manager.handle(transcript("小A，请回答"))

    assert event_types(tuple(emitted)) == ["llm.generation_started"]
    assert event_types(completed) == ["llm.answer_completed"]
    await manager.aclose()


@pytest.mark.asyncio
async def test_session_rejects_content_over_character_limit():
    config = manager_config()
    config.session.max_characters = 4
    client = RecordingLLMClient()
    manager = LLMSessionManager(
        config,
        client,
        logger=logging.getLogger("test.llm.limit"),
    )
    await manager.handle(start_event("llm.qa.start"))

    failed = await manager.handle(transcript("一二三四五"))

    assert event_types(failed) == ["llm.session_failed"]
    assert failed[0].payload["reason"] == "max_characters_exceeded"
    assert client.calls == []
    assert manager.active is False
    await manager.aclose()


@pytest.mark.asyncio
async def test_session_maps_llm_error_and_recovers():
    client = RecordingLLMClient(failure="request_timeout")
    manager = LLMSessionManager(
        manager_config(),
        client,
        logger=logging.getLogger("test.llm.failure"),
    )
    await manager.handle(start_event("llm.qa.start"))
    await manager.handle(transcript("问题内容"))

    failed = await manager.handle(transcript("小A，请回答"))

    assert event_types(failed) == ["llm.session_failed"]
    assert failed[0].payload["reason"] == "request_timeout"
    assert manager.active is False
    await manager.aclose()


@pytest.mark.asyncio
async def test_idle_timeout_emits_failure_and_clears_session():
    config = manager_config()
    config.session.idle_timeout_seconds = 0.01
    config.session.max_duration_seconds = 1
    manager = LLMSessionManager(
        config,
        RecordingLLMClient(),
        logger=logging.getLogger("test.llm.timeout"),
    )
    emitted: list[PerceptionEvent] = []

    async def emit(event: PerceptionEvent) -> None:
        emitted.append(event)

    manager.set_event_emitter(emit)
    await manager.handle(start_event("llm.qa.start"))

    await asyncio.sleep(0.04)

    assert event_types(tuple(emitted)) == ["llm.session_failed"]
    assert emitted[0].payload["reason"] == "idle_timeout"
    assert manager.active is False
    await manager.aclose()


@pytest.mark.asyncio
async def test_duplicate_start_is_ignored_and_empty_session_fails():
    manager = LLMSessionManager(
        manager_config(),
        RecordingLLMClient(),
        logger=logging.getLogger("test.llm.duplicate"),
    )
    await manager.handle(start_event("llm.qa.start"))

    duplicate = await manager.handle(start_event("llm.letter.start"))
    failed = await manager.handle(transcript("小A，请回答"))

    assert duplicate == ()
    assert event_types(failed) == ["llm.session_failed"]
    assert failed[0].payload["reason"] == "empty_content"
    await manager.aclose()


@pytest.mark.asyncio
async def test_maximum_duration_is_enforced_on_next_transcript():
    now = [10.0]
    config = manager_config()
    config.session.max_duration_seconds = 1
    manager = LLMSessionManager(
        config,
        RecordingLLMClient(),
        logger=logging.getLogger("test.llm.maximum"),
        clock=lambda: now[0],
    )
    await manager.handle(start_event("llm.qa.start"))
    now[0] = 11.1

    failed = await manager.handle(transcript("还在说话"))

    assert event_types(failed) == ["llm.session_failed"]
    assert failed[0].payload["reason"] == "max_duration_exceeded"
    await manager.aclose()
