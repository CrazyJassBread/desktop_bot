"""Render Slowly-inspired monochrome letters for a 384-dot printer."""

from __future__ import annotations

import hashlib
import math
import re
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

from app.config import LetterConfig

_MARKDOWN_PREFIX = re.compile(r"^\s{0,3}(?:#{1,6}|[-*+])\s+")
_TOKEN_PATTERN = re.compile(r"[A-Za-z0-9]+(?:['’_-][A-Za-z0-9]+)*\s*|.", re.S)
_CJK_FONT_CANDIDATES = (
    "/System/Library/Fonts/Supplemental/Songti.ttc",
    "/System/Library/Fonts/STHeiti Medium.ttc",
    "/usr/share/fonts/opentype/noto/NotoSerifCJK-Regular.ttc",
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
    "/usr/share/fonts/opentype/noto/NotoSansCJKsc-Regular.otf",
    "C:/Windows/Fonts/simsun.ttc",
    "C:/Windows/Fonts/msyh.ttc",
)


class LetterRenderError(RuntimeError):
    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


@dataclass(frozen=True)
class RenderedLetter:
    image: Image.Image
    stamp_theme: str
    page_count: int


def clean_letter_text(text: str) -> str:
    lines: list[str] = []
    for raw_line in text.replace("\r\n", "\n").replace("\r", "\n").split("\n"):
        line = _MARKDOWN_PREFIX.sub("", raw_line).strip()
        line = line.replace("**", "").replace("__", "")
        if line or (lines and lines[-1]):
            lines.append(line)
    while lines and not lines[-1]:
        lines.pop()
    return "\n".join(lines)


def resolve_cjk_font(configured_path: str = "") -> str:
    if configured_path.strip():
        return configured_path.strip()
    for candidate in _CJK_FONT_CANDIDATES:
        if Path(candidate).is_file():
            return candidate
    raise LetterRenderError("font_unavailable")


def _load_font(
    path: str,
    size: int,
    *,
    index: int = 0,
) -> ImageFont.FreeTypeFont:
    try:
        return ImageFont.truetype(path, size=size, index=index)
    except OSError as exc:
        raise LetterRenderError("font_unavailable") from exc


def _truncate(
    draw: ImageDraw.ImageDraw,
    text: str,
    font: ImageFont.FreeTypeFont,
    max_width: int,
) -> str:
    if draw.textlength(text, font=font) <= max_width:
        return text
    result = text
    while result and draw.textlength(f"{result}…", font=font) > max_width:
        result = result[:-1]
    return f"{result}…" if result else "…"


def _wrap_paragraph(
    draw: ImageDraw.ImageDraw,
    paragraph: str,
    font: ImageFont.FreeTypeFont,
    max_width: int,
) -> list[str]:
    if not paragraph:
        return [""]
    lines: list[str] = []
    current = ""
    for token in _TOKEN_PATTERN.findall(paragraph):
        candidate = f"{current}{token}"
        if current and draw.textlength(candidate, font=font) > max_width:
            lines.append(current.rstrip())
            current = token.lstrip()
        else:
            current = candidate
        while current and draw.textlength(current, font=font) > max_width:
            split_at = len(current) - 1
            while (
                split_at > 1
                and draw.textlength(current[:split_at], font=font) > max_width
            ):
                split_at -= 1
            lines.append(current[:split_at].rstrip())
            current = current[split_at:].lstrip()
    if current:
        lines.append(current.rstrip())
    return lines or [""]


_STAMP_SPRITES: dict[str, tuple[str, ...]] = {
    "flower": (
        "................",
        ".....##..##.....",
        "....########....",
        "....########....",
        ".....######.....",
        ".......##.......",
        ".....######.....",
        "....##.##.##....",
        "...##..##..##...",
        ".......##.......",
        "......####......",
        ".....##..##.....",
        "....##....##....",
        "................",
        "................",
        "................",
    ),
    "moon": (
        "................",
        ".........##.....",
        "....##..####....",
        "...####..##.....",
        "..#####.........",
        "..#####.....##..",
        "..#####....####.",
        "...#####....##..",
        "....#####.......",
        ".....#####......",
        ".......###......",
        ".........#......",
        "...##...........",
        "..####..........",
        "...##...........",
        "................",
    ),
    "envelope": (
        "................",
        "................",
        "..############..",
        "..##........##..",
        "..###......###..",
        "..##.##..##.##..",
        "..##..####..##..",
        "..##...##...##..",
        "..##..####..##..",
        "..##.##..##.##..",
        "..###......###..",
        "..##........##..",
        "..############..",
        "................",
        "................",
        "................",
    ),
}


class LetterRenderer:
    def __init__(
        self,
        config: LetterConfig,
        *,
        width: int = 384,
        max_chunk_height: int = 1_200,
    ) -> None:
        self.config = config
        self.width = width
        self.max_chunk_height = max_chunk_height
        self.margin = 24
        self.font_path = config.font_path
        self.title_font: ImageFont.FreeTypeFont | None = None
        self.body_font: ImageFont.FreeTypeFont | None = None
        self.signature_font: ImageFont.FreeTypeFont | None = None
        self.small_font: ImageFont.FreeTypeFont | None = None

    def _ensure_fonts(self) -> None:
        if self.body_font is not None:
            return
        self.font_path = resolve_cjk_font(self.font_path)
        is_macos_songti = Path(self.font_path).name == "Songti.ttc"
        regular_index = 6 if is_macos_songti else 0
        title_index = 1 if is_macos_songti else regular_index
        self.title_font = _load_font(
            self.font_path,
            27,
            index=title_index,
        )
        self.body_font = _load_font(
            self.font_path,
            22,
            index=regular_index,
        )
        self.signature_font = _load_font(
            self.font_path,
            21,
            index=regular_index,
        )
        self.small_font = _load_font(
            self.font_path,
            10,
            index=regular_index,
        )

    def render(
        self,
        *,
        letter_id: str,
        recipient: str,
        content: str,
        signature: str,
        created_at: datetime | None = None,
    ) -> RenderedLetter:
        self._ensure_fonts()
        assert self.title_font is not None
        assert self.body_font is not None
        assert self.signature_font is not None
        assert self.small_font is not None
        cleaned = clean_letter_text(content)
        if not cleaned:
            raise LetterRenderError("empty_content")
        if len(cleaned) > self.config.max_print_characters:
            raise LetterRenderError("letter_too_long")
        stamp_theme = self._select_stamp(letter_id)
        created_at = created_at or datetime.now()

        measuring = Image.new("1", (self.width, 1), 255)
        measure_draw = ImageDraw.Draw(measuring)
        body_width = self.width - self.margin * 2
        paragraphs = cleaned.split("\n")
        wrapped = [
            _wrap_paragraph(
                measure_draw,
                paragraph,
                self.body_font,
                body_width,
            )
            for paragraph in paragraphs
        ]
        height = self._measure_height(wrapped, bool(signature.strip()))
        image = Image.new("1", (self.width, height), 255)
        draw = ImageDraw.Draw(image)
        self._draw_header(
            draw,
            recipient=recipient or "用户",
            stamp_theme=stamp_theme,
            created_at=created_at,
        )
        self._draw_body(draw, wrapped, signature)
        return RenderedLetter(
            image=image,
            stamp_theme=stamp_theme,
            page_count=math.ceil(height / self.max_chunk_height),
        )

    def _measure_height(
        self,
        paragraphs: list[list[str]],
        has_signature: bool,
    ) -> int:
        y = 152
        for paragraph_index, lines in enumerate(paragraphs):
            for _ in lines:
                y = self._next_line_y(y, 35)
                y += 35
            if paragraph_index < len(paragraphs) - 1:
                y += 18
        if has_signature and self.config.show_signature:
            y += 30
            y = self._next_line_y(y, 34)
            y += 34
        return max(260, y + 42)

    def _draw_body(
        self,
        draw: ImageDraw.ImageDraw,
        paragraphs: list[list[str]],
        signature: str,
    ) -> None:
        assert self.body_font is not None
        assert self.signature_font is not None
        y = 152
        for paragraph_index, lines in enumerate(paragraphs):
            for line in lines:
                y = self._next_line_y(y, 35)
                draw.text(
                    (self.margin, y),
                    line,
                    font=self.body_font,
                    fill=0,
                    stroke_width=0,
                )
                y += 35
            if paragraph_index < len(paragraphs) - 1:
                y += 18
        if signature.strip() and self.config.show_signature:
            y += 30
            y = self._next_line_y(y, 34)
            shown = _truncate(
                draw,
                signature.strip(),
                self.signature_font,
                self.width - self.margin * 2,
            )
            draw.text(
                (self.margin, y),
                shown,
                font=self.signature_font,
                fill=0,
            )

    def _next_line_y(self, y: int, line_height: int) -> int:
        page_offset = y % self.max_chunk_height
        if page_offset + line_height + 16 > self.max_chunk_height:
            return y + (self.max_chunk_height - page_offset) + 24
        return y

    def _select_stamp(self, letter_id: str) -> str:
        themes = self.config.stamp_themes
        if self.config.stamp_selection == "fixed":
            return themes[0]
        digest = hashlib.sha256(letter_id.encode("utf-8")).digest()
        return themes[int.from_bytes(digest[:4], "big") % len(themes)]

    def _draw_header(
        self,
        draw: ImageDraw.ImageDraw,
        *,
        recipient: str,
        stamp_theme: str,
        created_at: datetime,
    ) -> None:
        assert self.title_font is not None
        stamp_x, stamp_y = self.width - self.margin - 64, 18
        title = _truncate(
            draw,
            f"To {recipient.strip() or '用户'}",
            self.title_font,
            stamp_x - self.margin - 34,
        )
        draw.text(
            (self.margin, 34),
            title,
            font=self.title_font,
            fill=0,
        )
        self._draw_stamp(draw, stamp_x, stamp_y, stamp_theme)
        if self.config.postmark_style == "wave_date":
            self._draw_postmark(draw, stamp_x, stamp_y, created_at)

    def _draw_stamp(
        self,
        draw: ImageDraw.ImageDraw,
        x: int,
        y: int,
        theme: str,
    ) -> None:
        assert self.small_font is not None
        width, height = 64, 78
        draw.rectangle((x, y, x + width - 1, y + height - 1), fill=0)
        draw.rectangle((x + 4, y + 4, x + width - 5, y + height - 5), fill=255)
        for notch_y in range(y + 7, y + height - 5, 8):
            draw.rectangle((x, notch_y, x + 3, notch_y + 3), fill=255)
            draw.rectangle(
                (x + width - 4, notch_y, x + width - 1, notch_y + 3),
                fill=255,
            )
        for notch_x in range(x + 7, x + width - 5, 8):
            draw.rectangle((notch_x, y, notch_x + 3, y + 3), fill=255)
            draw.rectangle(
                (notch_x, y + height - 4, notch_x + 3, y + height - 1),
                fill=255,
            )
        draw.text((x + 7, y + 7), "BOT", font=self.small_font, fill=0)
        sprite = _STAMP_SPRITES[theme]
        scale = 3
        origin_x, origin_y = x + 8, y + 24
        for row, pattern in enumerate(sprite):
            for column, value in enumerate(pattern):
                if value == "#":
                    px = origin_x + column * scale
                    py = origin_y + row * scale
                    draw.rectangle(
                        (px, py, px + scale - 1, py + scale - 1),
                        fill=0,
                    )

    def _draw_postmark(
        self,
        draw: ImageDraw.ImageDraw,
        stamp_x: int,
        stamp_y: int,
        created_at: datetime,
    ) -> None:
        assert self.small_font is not None
        center_x, center_y, radius = stamp_x - 6, stamp_y + 61, 23
        for offset in (0, 3):
            draw.ellipse(
                (
                    center_x - radius + offset,
                    center_y - radius + offset,
                    center_x + radius - offset,
                    center_y + radius - offset,
                ),
                outline=0,
                width=1,
            )
        for row in range(3):
            points: list[tuple[int, int]] = []
            baseline = center_y - 13 + row * 9
            for px in range(self.margin + 174, center_x - radius + 3):
                py = baseline + round(3 * math.sin((px - self.margin) / 6))
                points.append((px, py))
            if len(points) > 1:
                draw.line(points, fill=0, width=2)
        date_text = created_at.strftime("%m.%d")
        date_width = draw.textlength(date_text, font=self.small_font)
        draw.text(
            (center_x - date_width / 2, center_y - 6),
            date_text,
            font=self.small_font,
            fill=0,
        )
