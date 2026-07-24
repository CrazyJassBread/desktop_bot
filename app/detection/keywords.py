"""Deterministic keyword detection after ASR."""

from __future__ import annotations

import re
from dataclasses import dataclass

from app.config import KeywordConfig

_SEPARATORS = re.compile(r"[\s，。！？、,.!?;；:：\"'“”‘’（）()\[\]【】]+")


def normalize_text(text: str) -> str:
    return _SEPARATORS.sub("", text).casefold()


def _remove_normalized_once(text: str, phrase: str) -> str:
    """Remove a normalized match while retaining the remaining original text."""
    normalized_chars: list[str] = []
    original_indexes: list[int] = []
    for index, character in enumerate(text):
        normalized = normalize_text(character)
        for normalized_character in normalized:
            normalized_chars.append(normalized_character)
            original_indexes.append(index)
    needle = normalize_text(phrase)
    position = "".join(normalized_chars).find(needle)
    if position < 0:
        return text
    start = original_indexes[position]
    end = original_indexes[position + len(needle) - 1] + 1
    remainder = text[:start] + text[end:]
    return _SEPARATORS.sub(" ", remainder).strip()


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
            ("feature.photo_print", config.photo_print),
            ("feature.write_letter", config.write_letter),
            *(
                (f"intent.{command_type}", phrases)
                for command_type, phrases in config.custom.items()
            ),
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
                    payload = _remove_normalized_once(transcript, phrase)
                    if event_type != "wake":
                        for wake_phrase in self._wake_phrases:
                            payload = _remove_normalized_once(
                                payload,
                                wake_phrase,
                            )
                    return KeywordMatch(
                        event_type=event_type,
                        keyword=phrase,
                        transcript=transcript.strip(),
                        payload_text=payload,
                    )
        return None
