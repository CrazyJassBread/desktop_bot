"""Remove a leading wake word from an ASR transcript."""

from __future__ import annotations

import re

from app.config import WakeWordConfig


def strip_leading_wake_word(
    transcript: str,
    config: WakeWordConfig,
) -> str:
    aliases = {config.phrase, *config.aliases}
    aliases = {item.strip() for item in aliases if item.strip()}
    for alias in sorted(aliases, key=len, reverse=True):
        pattern = (
            r"^\s*"
            + re.escape(alias)
            + r"(?:\s*[,，。.!！?？:：、]\s*|\s+|(?=[\u4e00-\u9fff]))?"
        )
        cleaned, count = re.subn(
            pattern,
            "",
            transcript,
            count=1,
            flags=re.IGNORECASE,
        )
        if count:
            return cleaned.strip()
    return transcript.strip()
