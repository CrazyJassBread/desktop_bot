"""Validate and compact LLM output for a screen and speech synthesizer."""

from __future__ import annotations

import re

from app.config import LLMConfig
from app.llm.history import append_turn
from app.routing.mode_manager import SessionState
from app.schemas import LLMReply

FALLBACK_TEXT = "暂时无法生成回答，请稍后重试。"
VALID_EMOTIONS = {
    "neutral",
    "happy",
    "thinking",
    "explaining",
    "confused",
    "error",
}
_MARKDOWN = re.compile(r"(`{1,3}|[*_#>]+|\[(.*?)\]\([^)]*\))")


def _clean(text: str) -> str:
    def replace_link(match: re.Match[str]) -> str:
        return match.group(2) or ""

    return re.sub(r"\s+", " ", _MARKDOWN.sub(replace_link, text)).strip()


def _truncate(text: str, limit: int) -> str:
    if len(text) <= limit:
        return text
    preferred = "。！？!?"
    cut = max(text.rfind(char, 0, limit + 1) for char in preferred)
    if cut >= max(1, limit // 3):
        return text[: cut + 1].strip()
    secondary = "；;，, "
    cut = max(text.rfind(char, 0, limit) for char in secondary)
    if cut >= max(1, limit // 2):
        return text[:cut].rstrip() + "…"
    return text[: limit - 1].rstrip() + "…"


class ResponseProcessor:
    def __init__(self, config: LLMConfig, max_history_turns: int = 6) -> None:
        self.config = config
        self.max_history_turns = max_history_turns

    def process(
        self,
        reply: LLMReply,
        transcript: str,
        session: SessionState,
        *,
        update_history: bool = True,
    ) -> LLMReply:
        display = _clean(reply.display_text) or FALLBACK_TEXT
        spoken = _clean(reply.spoken_text) or FALLBACK_TEXT
        result = LLMReply(
            display_text=_truncate(display, self.config.max_display_chars),
            spoken_text=_truncate(spoken, self.config.max_spoken_chars),
            emotion=(
                reply.emotion if reply.emotion in VALID_EMOTIONS else "neutral"
            ),
        )
        session.last_assistant_response = result.display_text
        if update_history:
            append_turn(
                session,
                transcript,
                result.display_text,
                self.max_history_turns,
            )
        return result

