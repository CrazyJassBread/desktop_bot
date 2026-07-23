"""Predictable ASR backend for tests and local development."""

from pathlib import Path

from app.asr.base import ASRBackend
from app.audio.loader import AudioData

DEFAULT_TRANSCRIPTS = {
    "home.wav": "返回主页",
    "enter.wav": "进入聊天模式",
    "enter_llm.wav": "进入聊天模式",
    "exit.wav": "退出聊天模式",
    "exit_llm.wav": "退出聊天模式",
    "rl.wav": "什么是强化学习",
    "question.wav": "什么是强化学习",
    "name.wav": "你叫什么名字",
    "capabilities.wav": "你能做什么",
    "empty.wav": "",
}


class MockASRBackend(ASRBackend):
    def __init__(self, transcripts: dict[str, str] | None = None) -> None:
        self.transcripts = {**DEFAULT_TRANSCRIPTS, **(transcripts or {})}

    async def transcribe(self, audio: AudioData) -> str:
        return self.transcripts.get(Path(audio.source_path).name, "")

