from __future__ import annotations

import asyncio
from datetime import datetime
from pathlib import Path

import pytest
from PIL import Image

from app.config import LetterConfig
from app.features.letter_print import LetterPrintManager
from app.features.letter_rendering import (
    LetterRenderError,
    LetterRenderer,
    clean_letter_text,
)
from app.features.thermal_printer import PrintResult
from app.perception_events import PerceptionEvent


def renderer_config(tmp_path, **overrides):
    font_candidates = (
        Path("/System/Library/Fonts/Supplemental/Songti.ttc"),
        Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"),
        Path(
            ".venv/lib/python3.13/site-packages/"
            "matplotlib/mpl-data/fonts/ttf/DejaVuSans.ttf"
        ),
    )
    font_path = next(path for path in font_candidates if path.is_file())
    values = {
        "output_dir": str(tmp_path),
        "font_path": str(font_path),
        "stamp_selection": "fixed",
        "stamp_themes": ["moon"],
        "postmark_style": "wave_date",
        "max_print_characters": 4_000,
    }
    values.update(overrides)
    return LetterConfig(**values)


def test_clean_letter_text_removes_common_markdown_noise():
    assert clean_letter_text(
        "## 标题\n\n- 第一段 **内容**\n\n\n第二段"
    ) == "标题\n\n第一段 内容\n\n第二段"


def test_renderer_builds_crisp_slowly_inspired_letter(tmp_path):
    renderer = LetterRenderer(
        renderer_config(tmp_path),
        width=384,
        max_chunk_height=1_200,
    )

    rendered = renderer.render(
        letter_id="letter-one",
        recipient="小明",
        content="最近还好吗？\n\n希望下次见面时，我们可以慢慢聊天。",
        signature="用户",
        created_at=datetime(2026, 7, 25),
    )

    assert rendered.image.mode == "1"
    assert rendered.image.width == 384
    assert rendered.image.height >= 300
    assert rendered.stamp_theme == "moon"
    assert rendered.page_count == 1
    assert rendered.image.getbbox() == (0, 0, 384, rendered.image.height)
    black_pixels = sum(
        1 for value in rendered.image.getdata() if value == 0
    )
    assert black_pixels > 1_000


@pytest.mark.parametrize("theme", ["flower", "moon", "envelope"])
def test_renderer_supports_each_configured_pixel_stamp(tmp_path, theme):
    config = renderer_config(tmp_path, stamp_themes=[theme])
    rendered = LetterRenderer(config).render(
        letter_id=theme,
        recipient="Friend",
        content="A short letter.",
        signature="User",
    )

    assert rendered.stamp_theme == theme


def test_renderer_paginates_only_between_text_lines(tmp_path):
    renderer = LetterRenderer(
        renderer_config(tmp_path),
        width=384,
        max_chunk_height=300,
    )
    rendered = renderer.render(
        letter_id="long-letter",
        recipient="朋友",
        content="\n\n".join(["This is a longer paragraph for pagination."] * 8),
        signature="User",
    )

    assert rendered.page_count > 1
    # The renderer reserves whitespace around each printer chunk boundary.
    for boundary in range(300, rendered.image.height, 300):
        band = rendered.image.crop((0, boundary - 8, 384, boundary + 8))
        assert all(value == 255 for value in band.getdata())


def test_renderer_rejects_empty_and_oversized_letters(tmp_path):
    renderer = LetterRenderer(
        renderer_config(tmp_path, max_print_characters=5),
    )

    with pytest.raises(LetterRenderError) as empty:
        renderer.render(
            letter_id="empty",
            recipient="用户",
            content="",
            signature="用户",
        )
    with pytest.raises(LetterRenderError) as too_long:
        renderer.render(
            letter_id="long",
            recipient="用户",
            content="123456",
            signature="用户",
        )

    assert empty.value.reason == "empty_content"
    assert too_long.value.reason == "letter_too_long"


class RecordingPreparedPrinter:
    def __init__(self) -> None:
        self.images: list[Image.Image] = []

    def print_prepared_image(self, image: Image.Image) -> PrintResult:
        self.images.append(image.copy())
        return PrintResult(image.width, image.height, 1)


@pytest.mark.asyncio
async def test_manager_renders_saves_and_prints_completed_letter(tmp_path):
    config = renderer_config(tmp_path)
    printer = RecordingPreparedPrinter()
    manager = LetterPrintManager(
        config,
        LetterRenderer(config),
        signature="面包",
        printer=printer,
    )
    emitted: list[PerceptionEvent] = []

    async def emit(event: PerceptionEvent) -> None:
        emitted.append(event)

    manager.set_event_emitter(emit)
    assert manager.schedule(
        PerceptionEvent(
            "llm.letter_completed",
            "llm",
            session_id="bot",
            payload={"recipient": "小明", "content": "这是一封测试信。"},
        )
    )

    for _ in range(20):
        if len(emitted) >= 2:
            break
        await asyncio.sleep(0.01)

    assert [event.event_type for event in emitted] == [
        "letter.rendered",
        "letter.printed",
    ]
    assert emitted[0].payload["signature"] == "面包"
    assert emitted[0].payload["stamp_theme"] == "moon"
    assert len(list(tmp_path.glob("*.png"))) == 1
    assert len(printer.images) == 1
    await manager.aclose()
