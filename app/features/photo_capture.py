"""Delayed capture of the latest camera JPEG and optional downstream upload."""

from __future__ import annotations

import asyncio
import json
import logging
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Awaitable, Callable
from urllib.request import Request, urlopen
from uuid import uuid4

from app.models import ImageRequest
from app.perception_events import PerceptionEvent
from app.features.thermal_printer import PrinterError

LOGGER = logging.getLogger("desktop_assistant.photo")
EventEmitter = Callable[[PerceptionEvent], Awaitable[None]]


@dataclass(frozen=True)
class StoredFrame:
    request: ImageRequest
    received_at_ms: int


class LatestFrameStore:
    def __init__(self) -> None:
        self._frame: StoredFrame | None = None

    def update(self, request: ImageRequest) -> None:
        self._frame = StoredFrame(request, int(time.time() * 1_000))

    def snapshot(self) -> StoredFrame | None:
        return self._frame


class PhotoCaptureManager:
    def __init__(
        self,
        frame_store: LatestFrameStore,
        *,
        delay_seconds: float = 2.0,
        max_frame_age_seconds: float = 1.0,
        output_dir: Path | str = "captured_photos",
        processor_url: str = "",
        timeout_seconds: float = 10.0,
        printer: object | None = None,
        cooldown_seconds: float = 2.0,
    ) -> None:
        self.frame_store = frame_store
        self.delay_seconds = delay_seconds
        self.max_frame_age_seconds = max_frame_age_seconds
        self.output_dir = Path(output_dir)
        self.processor_url = processor_url
        self.timeout_seconds = timeout_seconds
        self.printer = printer
        self.cooldown_seconds = cooldown_seconds
        self._emit: EventEmitter | None = None
        self._task: asyncio.Task[None] | None = None
        self.phase = "idle"

    def set_event_emitter(self, emitter: EventEmitter) -> None:
        self._emit = emitter

    def schedule(self, trigger: PerceptionEvent) -> bool:
        if self._task is not None and not self._task.done():
            LOGGER.debug(
                "photo print trigger ignored while phase=%s",
                self.phase,
            )
            return False
        self._task = asyncio.create_task(self._capture(trigger))
        return True

    async def _capture(self, trigger: PerceptionEvent) -> None:
        try:
            self.phase = "countdown"
            await asyncio.sleep(self.delay_seconds)
            frame = self.frame_store.snapshot()
            if frame is None:
                await self._failed(trigger, "camera_frame_unavailable")
                return
            age_ms = int(time.time() * 1_000) - frame.received_at_ms
            if age_ms > int(self.max_frame_age_seconds * 1_000):
                await self._failed(trigger, "camera_frame_stale")
                return

            self.phase = "processing"
            capture_id = uuid4().hex
            path = await asyncio.to_thread(
                self._save,
                capture_id,
                frame.request.image_bytes,
            )
            await self._publish(
                PerceptionEvent(
                    event_type="photo.captured",
                    source="camera",
                    session_id=trigger.session_id,
                    payload={
                        "capture_id": capture_id,
                        "trigger_event_id": trigger.event_id,
                        "source_request_id": frame.request.request_id,
                        "captured_at_ms": frame.request.captured_at_ms,
                        "photo_path": str(path),
                        "photo_url": f"/api/photos/{capture_id}.jpg",
                        "content_type": frame.request.content_type,
                    },
                )
            )

            if self.printer is None:
                await self._print_failed(
                    trigger,
                    capture_id,
                    "printer_disabled",
                )
                return
            self.phase = "printing"
            try:
                print_result = await asyncio.to_thread(
                    getattr(self.printer, "print_image"),
                    frame.request.image_bytes,
                )
            except PrinterError as exc:
                await self._print_failed(
                    trigger,
                    capture_id,
                    exc.reason,
                )
                return
            await self._publish(
                PerceptionEvent(
                    event_type="photo.printed",
                    source="printer",
                    session_id=trigger.session_id,
                    payload={
                        "capture_id": capture_id,
                        "trigger_event_id": trigger.event_id,
                        "width": getattr(print_result, "width"),
                        "height": getattr(print_result, "height"),
                        "chunk_count": getattr(print_result, "chunk_count"),
                    },
                )
            )

            downstream: dict[str, object] = {}
            if self.processor_url:
                downstream = await asyncio.to_thread(
                    self._upload,
                    capture_id,
                    trigger,
                    path,
                )
            await self._publish(
                PerceptionEvent(
                    event_type="photo.completed",
                    source="photo",
                    session_id=trigger.session_id,
                    payload={
                        "capture_id": capture_id,
                        "trigger_event_id": trigger.event_id,
                        "photo_path": str(path),
                        "photo_url": f"/api/photos/{capture_id}.jpg",
                        "downstream": downstream,
                    },
                )
            )
        except asyncio.CancelledError:
            self.phase = "idle"
            raise
        except Exception as exc:
            LOGGER.exception("photo capture or downstream upload failed")
            await self._failed(trigger, type(exc).__name__)
        finally:
            if self.phase != "idle":
                self.phase = "cooldown"
                try:
                    await asyncio.sleep(self.cooldown_seconds)
                except asyncio.CancelledError:
                    self.phase = "idle"
                    raise
                self.phase = "idle"

    def _save(self, capture_id: str, image_bytes: bytes) -> Path:
        self.output_dir.mkdir(parents=True, exist_ok=True)
        final_path = self.output_dir / f"{capture_id}.jpg"
        temporary_path = self.output_dir / f".{capture_id}.tmp"
        temporary_path.write_bytes(image_bytes)
        temporary_path.replace(final_path)
        return final_path.resolve()

    def _upload(
        self,
        capture_id: str,
        trigger: PerceptionEvent,
        path: Path,
    ) -> dict[str, object]:
        boundary = f"----bot-{uuid4().hex}"
        metadata = {
            "capture_id": capture_id,
            "session_id": trigger.session_id,
            "trigger_event_id": trigger.event_id,
        }
        prefix = (
            f"--{boundary}\r\n"
            'Content-Disposition: form-data; name="metadata"\r\n'
            "Content-Type: application/json\r\n\r\n"
            f"{json.dumps(metadata, ensure_ascii=False)}\r\n"
            f"--{boundary}\r\n"
            'Content-Disposition: form-data; name="image"; '
            f'filename="{path.name}"\r\n'
            "Content-Type: image/jpeg\r\n\r\n"
        ).encode()
        suffix = f"\r\n--{boundary}--\r\n".encode()
        body = prefix + path.read_bytes() + suffix
        request = Request(
            self.processor_url,
            data=body,
            method="POST",
            headers={
                "Content-Type": f"multipart/form-data; boundary={boundary}",
                "Idempotency-Key": capture_id,
            },
        )
        with urlopen(request, timeout=self.timeout_seconds) as response:
            response_body = response.read()
        if not response_body:
            return {"status": "accepted"}
        try:
            parsed = json.loads(response_body)
        except (json.JSONDecodeError, UnicodeDecodeError):
            return {"status": "accepted", "response": response_body.decode(
                "utf-8", errors="replace"
            )}
        return parsed if isinstance(parsed, dict) else {"response": parsed}

    async def _failed(
        self,
        trigger: PerceptionEvent,
        reason: str,
    ) -> None:
        await self._publish(
            PerceptionEvent(
                event_type="photo.capture_failed",
                source="photo",
                session_id=trigger.session_id,
                payload={
                    "trigger_event_id": trigger.event_id,
                    "reason": reason,
                },
            )
        )

    async def _print_failed(
        self,
        trigger: PerceptionEvent,
        capture_id: str,
        reason: str,
    ) -> None:
        await self._publish(
            PerceptionEvent(
                event_type="photo.print_failed",
                source="printer",
                session_id=trigger.session_id,
                payload={
                    "capture_id": capture_id,
                    "trigger_event_id": trigger.event_id,
                    "reason": reason,
                },
            )
        )

    async def _publish(self, event: PerceptionEvent) -> None:
        if self._emit is None:
            LOGGER.warning("photo event dropped because no emitter is configured")
            return
        await self._emit(event)

    async def aclose(self) -> None:
        if self._task is None or self._task.done():
            return
        self._task.cancel()
        await asyncio.gather(self._task, return_exceptions=True)
