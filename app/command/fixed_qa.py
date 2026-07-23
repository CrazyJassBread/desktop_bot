"""Small fixed-QA catalog for command mode."""

from __future__ import annotations

from dataclasses import dataclass

from app.routing.mode_manager import SessionState
from app.routing.aliases import normalize_text


@dataclass(frozen=True)
class FixedQAResult:
    display_text: str
    spoken_text: str
    emotion: str = "neutral"


def match_fixed_qa(normalized: str, session: SessionState) -> FixedQAResult | None:
    answers = {
        normalize_text("你叫什么名字"): "我是你的桌面 AI 助手。",
        normalize_text("你能做什么"): "我可以识别语音指令、回答问题，并控制桌面设备。",
    }
    for question, answer in answers.items():
        if normalized == question or question in normalized:
            return FixedQAResult(answer, answer)
    mode_question = normalize_text("现在是什么模式")
    if normalized == mode_question or mode_question in normalized:
        mode_name = "聊天模式" if session.mode.value == "llm" else "固定指令模式"
        answer = f"当前是{mode_name}。"
        return FixedQAResult(answer, answer)
    return None

