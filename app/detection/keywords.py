"""Deterministic keyword detection after ASR."""

from __future__ import annotations

import re
from dataclasses import dataclass

from app.config import KeywordConfig

_SEPARATORS = re.compile(r"[\s，。！？、,.!?;；:：\"'“”‘’（）()\[\]【】]+")


def normalize_text(text: str) -> str:
    return _SEPARATORS.sub("", text).casefold()


@dataclass(frozen=True)
class KeywordMatch:
    event_type: str
    keyword: str
    transcript: str
    payload_text: str


class KeywordDetector:
    """Match feature phrases first and use wake words as the fallback."""

    def __init__(self, config: KeywordConfig) -> None:
        self._wake_phrases = tuple(
            normalize_text(item) for item in config.wake
        )
        self._rules = (
            ("mode.enter_chat", config.enter_chat),
            ("mode.exit_chat", config.exit_chat),
            ("feature.write_letter", config.write_letter),
            ("wake", config.wake),
        )

    def detect(self, transcript: str) -> KeywordMatch | None:
        normalized = normalize_text(transcript)
        if not normalized:
            return None
        for event_type, phrases in self._rules:
            for phrase in phrases:
                keyword = normalize_text(phrase)
                if keyword and keyword in normalized:
                    payload = normalized.replace(keyword, "", 1)
                    if event_type != "wake":
                        for wake_phrase in self._wake_phrases:
                            payload = payload.replace(wake_phrase, "", 1)
                    return KeywordMatch(
                        event_type=event_type,
                        keyword=phrase,
                        transcript=transcript.strip(),
                        payload_text=payload,
                    )
        return None
