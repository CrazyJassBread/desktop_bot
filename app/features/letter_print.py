"""Render and print completed LLM-assisted letters."""

from __future__ import annotations

import asyncio
import logging
from pathlib import Path
from typing import Awaitable, Callable
from uuid import uuid4

from app.config import LetterConfig
from app.features.letter_rendering import LetterRenderError, LetterRenderer
from app.features.thermal_printer import PrinterError
from app.perception_events import PerceptionEvent

LOGGER = logging.getLogger("desktop_assistant.letter")
EventEmitter = Callable[[PerceptionEvent], Awaitable[None]]


class LetterPrintManager:
    def __init__(
        self,
        config: LetterConfig,
        renderer: LetterRenderer,
        *,
        signature: str,
        printer: object | None,
    ) -> None:
        self.config = config
        self.renderer = renderer
        self.signature = signature
        self.printer = printer
        self.output_dir = Path(config.output_dir)
        self._emit: EventEmitter | None = None
        self._task: asyncio.Task[None] | None = None

    def set_event_emitter(self, emitter: EventEmitter) -> None:
        self._emit = emitter

    def schedule(self, completed: PerceptionEvent) -> bool:
        if completed.event_type != "llm.letter_completed":
            return False
        if self._task is not None and not self._task.done():
            LOGGER.warning("letter print ignored while another letter is active")
            return False
        self._task = asyncio.create_task(self._render_and_print(completed))
        return True

    async def _render_and_print(self, completed: PerceptionEvent) -> None:
        letter_id = uuid4().hex
        recipient = str(completed.payload.get("recipient", "")).strip() or "用户"
        content = str(completed.payload.get("content", "")).strip()
        try:
            rendered = await asyncio.to_thread(
                self.renderer.render,
                letter_id=letter_id,
                recipient=recipient,
                content=content,
                signature=self.signature,
            )
            path = await asyncio.to_thread(
                self._save,
                letter_id,
                rendered.image,
            )
        except LetterRenderError as exc:
            await self._publish(
                self._event(
                    "letter.render_failed",
                    completed,
                    letter_id,
                    {"reason": exc.reason},
                )
            )
            return
        except Exception:
            LOGGER.exception("unexpected letter rendering failure")
            await self._publish(
                self._event(
                    "letter.render_failed",
                    completed,
                    letter_id,
                    {"reason": "internal_error"},
                )
            )
            return

        common = {
            "recipient": recipient,
            "signature": self.signature if self.config.show_signature else "",
            "stamp_theme": rendered.stamp_theme,
            "letter_path": str(path),
            "letter_url": f"/api/letters/{letter_id}.png",
            "width": rendered.image.width,
            "height": rendered.image.height,
            "page_count": rendered.page_count,
        }
        await self._publish(
            self._event("letter.rendered", completed, letter_id, common)
        )
        if not self.config.auto_print:
            return
        if self.printer is None:
            await self._publish(
                self._event(
                    "letter.print_failed",
                    completed,
                    letter_id,
                    {**common, "reason": "printer_disabled"},
                )
            )
            return
        try:
            result = await asyncio.to_thread(
                getattr(self.printer, "print_prepared_image"),
                rendered.image,
            )
        except PrinterError as exc:
            await self._publish(
                self._event(
                    "letter.print_failed",
                    completed,
                    letter_id,
                    {**common, "reason": exc.reason},
                )
            )
            return
        except Exception:
            LOGGER.exception("unexpected letter printing failure")
            await self._publish(
                self._event(
                    "letter.print_failed",
                    completed,
                    letter_id,
                    {**common, "reason": "internal_error"},
                )
            )
            return
        await self._publish(
            self._event(
                "letter.printed",
                completed,
                letter_id,
                {
                    **common,
                    "width": getattr(result, "width"),
                    "height": getattr(result, "height"),
                    "chunk_count": getattr(result, "chunk_count"),
                },
            )
        )

    def _save(
        self,
        letter_id: str,
        image: object,
    ) -> Path:
        self.output_dir.mkdir(parents=True, exist_ok=True)
        final_path = self.output_dir / f"{letter_id}.png"
        temporary_path = self.output_dir / f".{letter_id}.tmp"
        getattr(image, "save")(temporary_path, "PNG")
        temporary_path.replace(final_path)
        return final_path.resolve()

    @staticmethod
    def _event(
        event_type: str,
        trigger: PerceptionEvent,
        letter_id: str,
        payload: dict[str, object],
    ) -> PerceptionEvent:
        return PerceptionEvent(
            event_type=event_type,
            source=(
                "printer" if event_type.startswith("letter.print") else "letter"
            ),
            session_id=trigger.session_id,
            payload={
                "letter_id": letter_id,
                "trigger_event_id": trigger.event_id,
                **payload,
            },
        )

    async def _publish(self, event: PerceptionEvent) -> None:
        if self._emit is None:
            LOGGER.warning("letter event dropped because no emitter is configured")
            return
        await self._emit(event)

    async def aclose(self) -> None:
        if self._task is None or self._task.done():
            return
        self._task.cancel()
        await asyncio.gather(self._task, return_exceptions=True)
