"""Context-aware actions for a small runner game."""

from __future__ import annotations

from app.core.events import BotEvent
from app.core.service import BotService, ServiceResult
from app.core.state import BotState
from app.schemas import DeviceAction


class RunnerGameService(BotService):
    service_id = "runner_game"
    priority = 10

    def can_handle(self, event: BotEvent, state: BotState) -> bool:
        if event.event_type == "gesture.stable":
            return state.game_running and event.payload.get("label") == "Thumb_Up"
        if event.event_type != "transcript.ready":
            return False
        transcript = str(event.payload.get("transcript", ""))
        return any(
            phrase in transcript
            for phrase in (
                "打开跑酷游戏",
                "开始跑酷游戏",
                "打开小恐龙",
                "暂停游戏",
                "继续游戏",
                "退出游戏",
                "关闭游戏",
            )
        )

    async def handle(self, event: BotEvent, state: BotState) -> ServiceResult:
        if event.event_type == "gesture.stable":
            return ServiceResult(
                handled=True,
                actions=[DeviceAction("game.runner.jump")],
            )

        transcript = str(event.payload.get("transcript", ""))
        if any(phrase in transcript for phrase in ("退出游戏", "关闭游戏")):
            state.game_running = False
            state.active_service = "home"
            return ServiceResult(
                True,
                "已退出跑酷游戏。",
                "已退出跑酷游戏。",
                [DeviceAction("game.runner.stop")],
            )
        if "暂停游戏" in transcript:
            return ServiceResult(
                True,
                "游戏已暂停。",
                "游戏已暂停。",
                [DeviceAction("game.runner.pause")],
            )
        if "继续游戏" in transcript:
            return ServiceResult(
                True,
                "继续游戏。",
                "继续游戏。",
                [DeviceAction("game.runner.resume")],
            )
        state.game_running = True
        state.active_service = self.service_id
        return ServiceResult(
            True,
            "跑酷游戏已开始，点赞手势可以跳跃。",
            "跑酷游戏已开始，点赞手势可以跳跃。",
            [DeviceAction("game.runner.start")],
        )
