"""Conservative text normalization used only for intent matching."""

from __future__ import annotations

import re

ALIASES = {
    "进入智能模式": "进入聊天模式",
    "和大模型聊天": "进入聊天模式",
    "回主界面": "返回主页",
    "回到主界面": "返回主页",
}

_PUNCTUATION = re.compile(
    r"""[，。！？、；：“”‘’（）【】《》〈〉…—,.!?;:'"()[\]{}<>`~@#$%^&*_+=|\\/·-]+"""
)


def normalize_text(text: str) -> str:
    """Normalize punctuation and aliases without altering the original text."""
    normalized = text.strip().lower()
    normalized = _PUNCTUATION.sub(" ", normalized)
    normalized = re.sub(r"\s+", "", normalized)
    for source in sorted(ALIASES, key=len, reverse=True):
        normalized = normalized.replace(source, ALIASES[source])
    return normalized

