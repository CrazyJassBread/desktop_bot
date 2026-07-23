"""Offline end-to-end smoke checks for the desktop assistant."""

from __future__ import annotations

import asyncio
import json
import tempfile
import wave
from pathlib import Path

from app.asr.mock_backend import MockASRBackend
from app.config import AppConfig
from app.llm.mock_backend import MockLLMBackend
from app.output.json_file_adapter import JsonFileOutputAdapter
from app.routing.mode_manager import ModeManager
from app.runtime.pipeline import VoicePipeline
from app.schemas import AudioRequest, ControlSignal, InteractionMode


def write_wav(path: Path) -> Path:
    with wave.open(str(path), "wb") as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(16_000)
        output.writeframes(b"\x00\x00" * 8_000)
    return path


async def main() -> None:
    with tempfile.TemporaryDirectory(prefix="assistant-smoke-") as directory:
        root = Path(directory)
        names = (
            "home.wav",
            "name.wav",
            "question.wav",
            "switch.wav",
            "empty.wav",
        )
        paths = {name: write_wav(root / name) for name in names}
        broken = root / "broken.wav"
        broken.write_bytes(b"not a wav")
        transcripts = {
            "home.wav": "返回主页",
            "name.wav": "你叫什么名字",
            "question.wav": "什么是强化学习",
            "switch.wav": "切换模式",
            "empty.wav": "",
        }
        manager = ModeManager()
        llm = MockLLMBackend()
        pipeline = VoicePipeline(
            AppConfig(), MockASRBackend(transcripts), llm, manager
        )

        home = await pipeline.process(AudioRequest(paths["home.wav"]))
        assert home.action == "ui.home" and llm.call_count == 0

        fixed_qa = await pipeline.process(AudioRequest(paths["name.wav"]))
        assert fixed_qa.display_text == "我是你的桌面 AI 助手。"

        one_shot_llm = await pipeline.process(
            AudioRequest(
                paths["question.wav"], signal=ControlSignal.LLM_MODE
            )
        )
        assert one_shot_llm.mode == "llm"

        entered = await pipeline.process(
            AudioRequest(
                paths["switch.wav"],
                "smoke",
                ControlSignal.ENTER_LLM_MODE,
            )
        )
        assert entered.action == "mode.enter_llm"
        assert manager.get_session("smoke").mode == InteractionMode.LLM

        forced_command = await pipeline.process(
            AudioRequest(
                paths["home.wav"], "smoke", ControlSignal.COMMAND_MODE
            )
        )
        assert forced_command.action == "ui.home"
        assert manager.get_session("smoke").mode == InteractionMode.LLM

        in_session_llm = await pipeline.process(
            AudioRequest(paths["question.wav"], "smoke")
        )
        assert in_session_llm.mode == "llm"

        exited = await pipeline.process(
            AudioRequest(
                paths["switch.wav"],
                "smoke",
                ControlSignal.EXIT_LLM_MODE,
            )
        )
        assert exited.action == "mode.exit_llm"
        assert manager.get_session("smoke").conversation_history == []

        corrupted = await pipeline.process(AudioRequest(broken))
        assert corrupted.error == "corrupted_audio"

        empty = await pipeline.process(AudioRequest(paths["empty.wav"]))
        assert empty.error == "empty_transcript"

        output_path = Path("output/latest_response.json")
        await JsonFileOutputAdapter(output_path).send_response(home)
        payload = json.loads(output_path.read_text(encoding="utf-8"))
        assert payload["action"] == "ui.home"

    print("10/10 offline smoke checks passed")


if __name__ == "__main__":
    asyncio.run(main())

