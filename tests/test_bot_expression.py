from __future__ import annotations

import asyncio

import pytest

from app.config import BotExpressionConfig
from app.features.bot_expression import BotExpressionController
from app.perception_events import PerceptionEvent


class RecordingSender:
    def __init__(self) -> None:
        self.expressions: list[str] = []

    async def __call__(self, expression: str) -> None:
        self.expressions.append(expression)


def event(event_type: str) -> PerceptionEvent:
    return PerceptionEvent(event_type, "test")


@pytest.mark.asyncio
async def test_persistent_processing_states_are_deduplicated():
    sender = RecordingSender()
    controller = BotExpressionController(
        BotExpressionConfig(action_duration_seconds=0.01),
        sender=sender,
    )

    await controller.start()
    await controller.handle(event("llm.session_started"))
    await controller.handle(event("llm.transcript_buffered"))
    await controller.handle(event("llm.generation_started"))
    await controller.wait_idle()

    assert sender.expressions == ["default", "happy", "tired"]
    assert controller.persistent_expression == "tired"
    await controller.aclose()


@pytest.mark.asyncio
async def test_short_action_restores_current_persistent_expression():
    sender = RecordingSender()
    controller = BotExpressionController(
        BotExpressionConfig(action_duration_seconds=0.01),
        sender=sender,
    )

    await controller.handle(event("gesture.victory"))
    await asyncio.sleep(0.02)
    await controller.wait_idle()

    assert sender.expressions == ["blink", "happy"]
    await controller.aclose()


@pytest.mark.asyncio
async def test_failure_becomes_angry_then_plays_confused():
    sender = RecordingSender()
    controller = BotExpressionController(
        BotExpressionConfig(action_duration_seconds=0.01),
        sender=sender,
    )

    await controller.handle(event("photo.print_failed"))
    await asyncio.sleep(0.02)
    await controller.wait_idle()

    assert sender.expressions == ["confused", "angry"]
    assert controller.persistent_expression == "angry"
    await controller.aclose()


@pytest.mark.asyncio
async def test_new_persistent_state_cancels_pending_action_restore():
    sender = RecordingSender()
    controller = BotExpressionController(
        BotExpressionConfig(action_duration_seconds=0.03),
        sender=sender,
    )

    await controller.handle(event("gesture.victory"))
    await controller.handle(event("llm.generation_started"))
    await asyncio.sleep(0.04)
    await controller.wait_idle()

    assert sender.expressions == ["blink", "tired"]
    await controller.aclose()
