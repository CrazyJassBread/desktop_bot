"""Detect configured LLM session start phrases."""

from __future__ import annotations

from app.config import LLMModesConfig
from app.detection.keywords import KeywordMatch, normalize_text


def _normalized_with_indexes(text: str) -> tuple[str, list[int]]:
    characters: list[str] = []
    indexes: list[int] = []
    for index, character in enumerate(text):
        for normalized in normalize_text(character):
            characters.append(normalized)
            indexes.append(index)
    return "".join(characters), indexes


def _template_recipient(
    transcript: str,
    template: str,
) -> str | None:
    prefix, suffix = template.split("{recipient}", 1)
    normalized, original_indexes = _normalized_with_indexes(transcript)
    normalized_prefix = normalize_text(prefix)
    normalized_suffix = normalize_text(suffix)
    prefix_position = normalized.find(normalized_prefix)
    if prefix_position < 0:
        return None
    recipient_start = prefix_position + len(normalized_prefix)
    if normalized_suffix:
        suffix_position = normalized.find(
            normalized_suffix,
            recipient_start,
        )
        if suffix_position < 0:
            return None
        recipient_end = suffix_position
    else:
        recipient_end = len(normalized)
    if recipient_start >= recipient_end:
        return None
    original_start = original_indexes[recipient_start]
    original_end = original_indexes[recipient_end - 1] + 1
    recipient = transcript[original_start:original_end].strip(
        " \t\r\n，。！？、,.!?;；:：\"'“”‘’（）()[]【】"
    )
    return recipient or None


class LLMModeDetector:
    def __init__(self, modes: LLMModesConfig) -> None:
        self.modes = modes

    def detect(self, transcript: str) -> KeywordMatch | None:
        normalized = normalize_text(transcript)
        if not normalized:
            return None

        for phrase in self.modes.letter.start_phrases:
            if normalize_text(phrase) in normalized:
                return self._match(
                    "llm.letter.start",
                    phrase,
                    transcript,
                )
        for template in self.modes.letter.recipient_templates:
            recipient = _template_recipient(transcript, template)
            if recipient is not None:
                return self._match(
                    "llm.letter.start",
                    template,
                    transcript,
                    recipient,
                )
        for phrase in self.modes.qa.start_phrases:
            if normalize_text(phrase) in normalized:
                return self._match(
                    "llm.qa.start",
                    phrase,
                    transcript,
                )
        return None

    @staticmethod
    def _match(
        event_type: str,
        keyword: str,
        transcript: str,
        payload_text: str = "",
    ) -> KeywordMatch:
        return KeywordMatch(
            event_type=event_type,
            keyword=keyword,
            transcript=transcript.strip(),
            payload_text=payload_text,
        )
