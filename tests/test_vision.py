from __future__ import annotations

from io import BytesIO

import numpy as np
import pytest
from PIL import Image

from app.config import AppConfig
from app.asr.mock_backend import MockASRBackend
from app.llm.mock_backend import MockLLMBackend
from app.runtime.assistant_runtime import AssistantRuntime
from app.runtime.vision_pipeline import VisionPipeline
from app.schemas import GestureDetection, ImageRequest, InteractionMode
from app.vision.frame_cache import CachedVisionFrame, VisionFrameCache
from app.vision.mock_backend import MockGestureBackend


def jpeg_bytes(width: int = 640, height: int = 480) -> bytes:
    image = Image.new("RGB", (width, height), color=(10, 20, 30))
    output = BytesIO()
    image.save(output, format="JPEG")
    return output.getvalue()


def detection(label: str) -> GestureDetection:
    return GestureDetection(label, 0.95, "Right")


def make_pipeline(results):
    config = AppConfig()
    runtime = AssistantRuntime(config)
    backend = MockGestureBackend(results)
    pipeline = VisionPipeline(config.vision, backend, runtime.coordinator)
    return pipeline, runtime, backend


def test_frame_cache_evicts_oldest_frame():
    cache = VisionFrameCache(20)
    image = np.zeros((480, 640, 3), dtype=np.uint8)
    for sequence in range(1, 22):
        cache.append(
            CachedVisionFrame(sequence, sequence, image, (), 1.0)
        )
    snapshot = cache.snapshot()
    assert len(snapshot) == 20
    assert snapshot[0].sequence_id == 2
    assert snapshot[-1].sequence_id == 21


@pytest.mark.asyncio
async def test_victory_toggles_mode_once_while_held():
    pipeline, runtime, backend = make_pipeline(
        [[detection("Victory")]] * 7
    )
    actions = []
    for _ in range(7):
        response = await pipeline.process(ImageRequest(jpeg_bytes(), "bot"))
        actions.extend(response.actions)
    assert backend.call_count == 7
    assert [item.action for item in actions] == ["ui.show_mode"]
    assert runtime.mode_manager.get_session("bot").mode == InteractionMode.LLM
    assert len(pipeline.cache) == 7
    voice = runtime.create_voice_pipeline(
        MockASRBackend(),
        MockLLMBackend(),
    )
    assert voice.mode_manager is runtime.mode_manager


@pytest.mark.asyncio
async def test_thumb_up_jumps_only_in_game_context():
    pipeline, runtime, _ = make_pipeline(
        [[detection("Thumb_Up")]] * 3
    )
    await runtime.coordinator.handle_transcript("bot", "打开跑酷游戏")
    actions = []
    for _ in range(3):
        response = await pipeline.process(ImageRequest(jpeg_bytes(), "bot"))
        actions.extend(response.actions)
    assert [item.action for item in actions] == ["game.runner.jump"]
    assert runtime.state_manager.get("bot").game_running is True


@pytest.mark.asyncio
async def test_invalid_image_dimensions_are_structured():
    pipeline, _, backend = make_pipeline([])
    response = await pipeline.process(
        ImageRequest(jpeg_bytes(320, 240), "bot")
    )
    assert response.success is False
    assert response.error == "invalid_image_dimensions"
    assert backend.call_count == 0
