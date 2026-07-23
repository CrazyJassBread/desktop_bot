from __future__ import annotations

from datetime import datetime

import pytest

from app.core.events import BotEvent
from app.core.state import BotState
from app.schemas import LetterReceived
from app.services.letter.service import LetterService
from app.services.printing.base import MockPrinterAdapter
from app.services.printing.service import PrintService
from app.services.time_service import TimeService


@pytest.mark.asyncio
async def test_time_service_is_local_and_deterministic():
    service = TimeService(lambda: datetime(2026, 7, 23, 15, 26))
    event = BotEvent(
        "transcript.ready",
        "bot",
        {"transcript": "现在几点了"},
    )
    assert service.can_handle(event, BotState("bot"))
    result = await service.handle(event, BotState("bot"))
    assert result.display_text == "现在是15:26。"
    assert result.actions[0].action == "ui.show_time"


@pytest.mark.asyncio
async def test_letter_auto_print_is_idempotent():
    adapter = MockPrinterAdapter()
    printing = PrintService(adapter)
    service = LetterService(
        printing,
        enabled=True,
        print_policy="auto_print",
    )
    letter = LetterReceived(
        event_id="event-1",
        letter_id="letter-1",
        recipient_bot_id="bot",
        subject="问候",
        content="你好。",
        requested_action="print",
    )
    assert await service.receive(letter) == "printing"
    assert await service.receive(letter) == "duplicate"
    assert len(adapter.jobs) == 1
    assert service.latest() == letter


@pytest.mark.asyncio
async def test_letter_service_is_disabled_by_default():
    adapter = MockPrinterAdapter()
    service = LetterService(PrintService(adapter))
    status = await service.receive(
        LetterReceived("e", "l", "bot", "标题", "内容")
    )
    assert status == "disabled"
    assert adapter.jobs == []
