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
    """Detect the optional voice shortcut for photo printing."""

    def __init__(self, config: KeywordConfig) -> None:
        self._phrases = tuple(config.photo_print)

    def detect(self, transcript: str) -> KeywordMatch | None:
        normalized = normalize_text(transcript)
        if not normalized:
            return None
        for phrase in self._phrases:
            keyword = normalize_text(phrase)
            if keyword and keyword in normalized:
                return KeywordMatch(
                    event_type="feature.photo_print",
                    keyword=phrase,
                    transcript=transcript.strip(),
                    payload_text=_remove_normalized_once(transcript, phrase),
                )
        return None
