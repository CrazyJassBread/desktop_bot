"""Local, deterministic clock service."""

from __future__ import annotations

from datetime import datetime
from typing import Callable

from app.core.events import BotEvent
from app.core.service import BotService, ServiceResult
from app.core.state import BotState
from app.schemas import DeviceAction


class TimeService(BotService):
    service_id = "time"
    priority = 20
    _PHRASES = ("几点", "时间", "几号", "日期", "星期")

    def __init__(self, clock: Callable[[], datetime] | None = None) -> None:
        self._clock = clock or datetime.now

    def can_handle(self, event: BotEvent, state: BotState) -> bool:
        if event.event_type != "transcript.ready":
            return False
        transcript = str(event.payload.get("transcript", ""))
        return any(phrase in transcript for phrase in self._PHRASES)

    async def handle(self, event: BotEvent, state: BotState) -> ServiceResult:
        now = self._clock()
        transcript = str(event.payload.get("transcript", ""))
        if any(phrase in transcript for phrase in ("几号", "日期", "星期")):
            weekdays = "一二三四五六日"
            text = (
                f"今天是{now.year}年{now.month}月{now.day}日，"
                f"星期{weekdays[now.weekday()]}。"
            )
        else:
            text = f"现在是{now.hour:02d}:{now.minute:02d}。"
        return ServiceResult(
            handled=True,
            display_text=text,
            spoken_text=text,
            actions=[
                DeviceAction(
                    "ui.show_time",
                    {"iso": now.isoformat(timespec="seconds")},
                )
            ],
        )
