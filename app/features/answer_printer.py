"""Print LLM Q&A answers on letter stationery via the thermal printer."""

from __future__ import annotations

import asyncio
import base64
import datetime
import logging
from typing import Any, Awaitable, Callable, Protocol

from PIL import Image, ImageDraw, ImageFont

from app.events.event_bus import EventBus
from app.features.photo_printer import pack_bitmap, split_image
from app.perception_events import PerceptionEvent

LOGGER = logging.getLogger("desktop_assistant.answer_printer")

EventEmitter = Callable[[PerceptionEvent], Awaitable[None]]
# poster(url, headers, payload) -> (status_code, response_body)
Poster = Callable[[str, dict[str, str], dict[str, Any]], Awaitable[tuple[int, Any]]]

PRINTER_WIDTH = 384


class BitmapPrinter(Protocol):
    def post_bitmap(self, packed: bytes, width: int, height: int) -> object: ...


def _load_font(font_path: str, size: int) -> ImageFont.ImageFont:
    try:
        return ImageFont.truetype(font_path, size)
    except OSError:
        LOGGER.warning("font %s unavailable, using the default font", font_path)
        try:
            return ImageFont.load_default(size=size)
        except TypeError:  # Pillow < 10.1 has no size parameter
            return ImageFont.load_default()


def _wrap_line(text: str, font: ImageFont.ImageFont, max_width: float) -> list[str]:
    lines: list[str] = []
    current = ""
    for char in text:
        candidate = current + char
        if not current or font.getlength(candidate) <= max_width:
            current = candidate
        else:
            lines.append(current)
            current = char
    if current:
        lines.append(current)
    return lines


def _wrap_text(
    text: str,
    font: ImageFont.ImageFont,
    max_width: float,
    max_lines: int,
) -> list[str]:
    lines: list[str] = []
    for raw_line in text.splitlines() or [""]:
        stripped = raw_line.strip()
        if stripped:
            lines.extend(_wrap_line(stripped, font, max_width))
        else:
            lines.append("")
    while lines and not lines[-1]:
        lines.pop()
    if len(lines) > max_lines:
        lines = lines[:max_lines]
        lines[-1] = f"{lines[-1][:-1]}…" if lines[-1] else "…"
    return lines or [""]


def render_answer_letter(
    question: str,
    answer: str,
    *,
    font_path: str,
    rotate_180: bool = False,
) -> Image.Image:
    """Draw a simplified letter card: border, question title, answer body.

    Local fallback for when the ui letter template renderer is offline.
    Returns a 1-bit image at the printer width, ready for pack_bitmap.
    """
    title_font = _load_font(font_path, 26)
    body_font = _load_font(font_path, 22)
    footer_font = _load_font(font_path, 16)
    margin = 26
    text_width = PRINTER_WIDTH - margin * 2
    title_lines = _wrap_text(question or "Q&A", title_font, text_width, 3)
    body_lines = _wrap_text(answer, body_font, text_width, 60)
    title_step = 34
    body_step = 30
    header_top = 30
    separator_gap = 14
    body_top = header_top + len(title_lines) * title_step + separator_gap * 2
    footer_gap = 22
    height = body_top + len(body_lines) * body_step + footer_gap + 40

    image = Image.new("L", (PRINTER_WIDTH, height), 255)
    draw = ImageDraw.Draw(image)
    # Double border, mirroring the stationery look of the ui template.
    draw.rectangle((4, 4, PRINTER_WIDTH - 5, height - 5), outline=0, width=2)
    draw.rectangle((10, 10, PRINTER_WIDTH - 11, height - 11), outline=0, width=1)

    y = header_top
    for line in title_lines:
        draw.text((margin, y), line, font=title_font, fill=0)
        y += title_step
    y += separator_gap
    draw.line((margin, y, PRINTER_WIDTH - margin, y), fill=0, width=1)
    y += separator_gap
    for line in body_lines:
        if line:
            draw.text((margin, y), line, font=body_font, fill=0)
        y += body_step
    y += footer_gap
    date_text = datetime.date.today().isoformat()
    draw.text((margin, y), date_text, font=footer_font, fill=0)
    signature = "AI Hub"
    draw.text(
        (PRINTER_WIDTH - margin - footer_font.getlength(signature), y),
        signature,
        font=footer_font,
        fill=0,
    )

    if rotate_180:
        image = image.rotate(180, expand=False)
    # Threshold without dithering so the text stays crisp.
    return image.point(lambda value: 255 if value >= 128 else 0, mode="1")


class AnswerPrinter:
    """Print llm.answer_completed events using the letter template.

    Prefers the ui renderer (pixel-identical to the web stationery) and
    falls back to a local Pillow rendering when the ui is unreachable.
    """

    def __init__(
        self,
        event_bus: EventBus,
        *,
        printer: BitmapPrinter,
        ui_base_url: str | None = None,
        device_token: str | None = None,
        rotate_180: bool = False,
        letter_batch_height: int = 900,
        max_chunk_height: int = 1200,
        font_path: str = "/System/Library/Fonts/Hiragino Sans GB.ttc",
        timeout_seconds: float = 15.0,
        poster: Poster | None = None,
    ) -> None:
        self.event_bus = event_bus
        self.printer = printer
        self.ui_base_url = ui_base_url.rstrip("/") if ui_base_url else None
        self.device_token = device_token
        self.rotate_180 = rotate_180
        self.letter_batch_height = letter_batch_height
        self.max_chunk_height = max_chunk_height
        self.font_path = font_path
        self.timeout_seconds = timeout_seconds
        self._poster = poster
        self._emit: EventEmitter | None = None
        self._session = None
        self._task: asyncio.Task[None] | None = None

    def set_event_emitter(self, emitter: EventEmitter) -> None:
        self._emit = emitter

    def start(self) -> None:
        if self._task is None:
            self._task = asyncio.create_task(self._consume())

    async def _consume(self) -> None:
        async with self.event_bus.subscribe() as subscription:
            while True:
                event = await subscription.get()
                if event.event_type == "llm.answer_completed":
                    await self._print_answer(event)

    async def _print_answer(self, event: PerceptionEvent) -> None:
        question = str(event.payload.get("question") or "").strip()
        answer = str(event.payload.get("answer") or "").strip()
        if not answer:
            await self._publish_failed(event, "answer text is empty")
            return
        batches = None
        if self.ui_base_url and self.device_token:
            batches = await self._fetch_ui_batches(question, answer)
        try:
            if batches is not None:
                render_source = "ui"
                sent = await self._print_batches(batches)
            else:
                render_source = "local"
                sent = await self._print_local(question, answer)
        except Exception as exc:  # printing must never break the runtime
            LOGGER.warning("answer printing failed: %s", exc)
            await self._publish_failed(event, f"printer error: {exc}")
            return
        await self._publish(
            PerceptionEvent(
                event_type="qa.printed",
                source="answer_printer",
                session_id=event.session_id,
                payload={
                    "render_source": render_source,
                    "batches": sent,
                    "trigger_event_id": event.event_id,
                },
            )
        )

    async def _fetch_ui_batches(
        self, question: str, answer: str
    ) -> list[dict[str, Any]] | None:
        """Ask the ui to render the stationery. None means fall back."""
        url = f"{self.ui_base_url}/api/v1/device/letters/render"
        headers = {"Authorization": f"Bearer {self.device_token}"}
        payload = {
            "subject": question,
            "body": answer,
            "rotate180": self.rotate_180,
            "maxBatchHeight": self.letter_batch_height,
        }
        try:
            status, body = await self._post(url, headers, payload)
        except Exception as exc:
            LOGGER.warning("ui renderer unreachable, using local render: %s", exc)
            return None
        if status >= 300 or not isinstance(body, dict) or not body.get("batches"):
            LOGGER.warning(
                "ui renderer rejected the answer (%s), using local render", status
            )
            return None
        return sorted(body["batches"], key=lambda batch: batch.get("index", 0))

    async def _print_batches(self, batches: list[dict[str, Any]]) -> int:
        for batch in batches:
            packed = base64.b64decode(batch["bitmapBase64"])
            await asyncio.to_thread(
                self.printer.post_bitmap,
                packed,
                int(batch["width"]),
                int(batch["height"]),
            )
        return len(batches)

    async def _print_local(self, question: str, answer: str) -> int:
        image = await asyncio.to_thread(
            render_answer_letter,
            question,
            answer,
            font_path=self.font_path,
            rotate_180=self.rotate_180,
        )
        chunks = split_image(image, self.max_chunk_height)
        for chunk in chunks:
            await asyncio.to_thread(
                self.printer.post_bitmap,
                pack_bitmap(chunk),
                chunk.width,
                chunk.height,
            )
        return len(chunks)

    async def _post(
        self,
        url: str,
        headers: dict[str, str],
        payload: dict[str, Any],
    ) -> tuple[int, Any]:
        if self._poster is not None:
            return await self._poster(url, headers, payload)
        import aiohttp

        if self._session is None or self._session.closed:
            self._session = aiohttp.ClientSession(
                timeout=aiohttp.ClientTimeout(total=self.timeout_seconds)
            )
        async with self._session.post(url, json=payload, headers=headers) as response:
            body = await response.json(content_type=None)
            return response.status, body

    async def _publish_failed(self, event: PerceptionEvent, reason: str) -> None:
        await self._publish(
            PerceptionEvent(
                event_type="qa.print_failed",
                source="answer_printer",
                session_id=event.session_id,
                payload={
                    "reason": reason,
                    "trigger_event_id": event.event_id,
                },
            )
        )

    async def _publish(self, event: PerceptionEvent) -> None:
        if self._emit is None:
            LOGGER.warning("qa print event dropped because no emitter is configured")
            return
        await self._emit(event)

    async def aclose(self) -> None:
        if self._task is not None:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None
        if self._session is not None and not self._session.closed:
            await self._session.close()
