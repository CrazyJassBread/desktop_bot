"""Cloud-side sources and hardware proxy for an outbound local gateway."""

from __future__ import annotations

import asyncio
import io
import logging
import re
import secrets
import time
from concurrent.futures import TimeoutError as FutureTimeout
from contextlib import suppress
from dataclasses import dataclass
from uuid import uuid4

import numpy as np
from PIL import Image

from app.config import PrinterConfig
from app.features.thermal_printer import PrintResult, PrinterError
from app.models import ImageRequest
from app.transport.gateway_protocol import (
    ACK,
    AUDIO,
    COMMAND,
    IMAGE,
    decode_message,
    encode_message,
)
from app.transport.sources import AudioFrameSource, ImageFrameSource

LOGGER = logging.getLogger("desktop_assistant.remote_gateway")
_GATEWAY_ID = re.compile(r"^[A-Za-z0-9._:-]{1,128}$")
_PAIRING_CODE = re.compile(r"^\d{6}$")


class RemoteAudioSource(AudioFrameSource):
    def __init__(self, frame_samples: int = 512, queue_size: int = 256) -> None:
        self.frame_samples = frame_samples
        self._queue: asyncio.Queue[np.ndarray] = asyncio.Queue(queue_size)
        self.frames_received = 0
        self.connected = False

    async def put(self, payload: bytes) -> None:
        frame_bytes = self.frame_samples * 2
        if len(payload) % frame_bytes:
            raise ValueError("audio payload is not aligned to a PCM frame")
        for offset in range(0, len(payload), frame_bytes):
            pcm = np.frombuffer(payload[offset:offset + frame_bytes], dtype="<i2")
            frame = np.ascontiguousarray(pcm.astype(np.float32) / 32768.0)
            if self._queue.full():
                with suppress(asyncio.QueueEmpty):
                    self._queue.get_nowait()
            self._queue.put_nowait(frame)
            self.frames_received += 1

    async def frames(self):
        while True:
            yield await self._queue.get()

    def diagnostics(self) -> dict[str, object]:
        return {
            "transport": "remote_gateway",
            "connected": self.connected,
            "frames_received": self.frames_received,
            "queued_frames": self._queue.qsize(),
            "format": "PCM s16le / mono",
        }


class RemoteImageSource(ImageFrameSource):
    def __init__(self, queue_size: int = 1) -> None:
        self._queue: asyncio.Queue[ImageRequest] = asyncio.Queue(queue_size)

    async def put(self, metadata: dict[str, object], payload: bytes) -> None:
        request = ImageRequest(
            image_bytes=payload,
            session_id=str(metadata.get("session_id", "bot")),
            request_id=(
                str(metadata["request_id"])
                if metadata.get("request_id")
                else None
            ),
            captured_at_ms=int(metadata.get("captured_at_ms", time.time() * 1000)),
            content_type="image/jpeg",
        )
        if self._queue.full():
            with suppress(asyncio.QueueEmpty):
                self._queue.get_nowait()
        self._queue.put_nowait(request)

    async def images(self):
        while True:
            yield await self._queue.get()


@dataclass
class _PendingCommand:
    future: asyncio.Future[dict[str, object]]


class RemoteGatewayHub:
    """Own the single authenticated local gateway connection."""

    def __init__(
        self,
        token: str,
        *,
        command_timeout: float = 45.0,
        identity_client: object | None = None,
    ) -> None:
        if not token:
            raise ValueError("BOT_GATEWAY_TOKEN cannot be empty")
        self.token = token
        self.command_timeout = command_timeout
        self.identity_client = identity_client
        self.audio = RemoteAudioSource()
        self.images = RemoteImageSource()
        self._socket = None
        self._loop: asyncio.AbstractEventLoop | None = None
        self._pending: dict[str, _PendingCommand] = {}
        self.gateway_id: str | None = None
        self.pairing_code: str | None = None

    @property
    def connected(self) -> bool:
        return self._socket is not None and not self._socket.closed

    async def websocket_handler(self, request):
        from aiohttp import WSMsgType, web

        supplied = request.headers.get("Authorization", "")
        expected = f"Bearer {self.token}"
        if not secrets.compare_digest(supplied, expected):
            raise web.HTTPUnauthorized(text="invalid gateway token")
        gateway_id = request.headers.get("X-Bot-Gateway-Id", "")
        pairing_code = request.headers.get("X-Bot-Pairing-Code", "")
        if not _GATEWAY_ID.fullmatch(gateway_id):
            raise web.HTTPBadRequest(text="invalid gateway id")
        if not _PAIRING_CODE.fullmatch(pairing_code):
            raise web.HTTPBadRequest(text="invalid pairing code")
        socket = web.WebSocketResponse(heartbeat=20, max_msg_size=4 * 1024 * 1024)
        await socket.prepare(request)
        previous = self._socket
        self._socket = socket
        self._loop = asyncio.get_running_loop()
        self.gateway_id = gateway_id
        self.pairing_code = pairing_code
        self.audio.connected = True
        if previous is not None and not previous.closed:
            await previous.close(code=4001, message=b"replaced")
        LOGGER.info("local Bot gateway connected")
        if self.identity_client is not None:
            try:
                await getattr(self.identity_client, "set_presence")(
                    gateway_id,
                    pairing_code,
                    connected=True,
                )
            except Exception:
                LOGGER.exception("failed to register gateway pairing presence")
        try:
            async for item in socket:
                if item.type == WSMsgType.BINARY:
                    message = decode_message(item.data)
                    if message.kind == AUDIO:
                        await self.audio.put(message.payload)
                    elif message.kind == IMAGE:
                        await self.images.put(message.metadata, message.payload)
                    elif message.kind == ACK:
                        request_id = str(message.metadata.get("request_id", ""))
                        pending = self._pending.pop(request_id, None)
                        if pending is not None and not pending.future.done():
                            pending.future.set_result(message.metadata)
                elif item.type in {WSMsgType.ERROR, WSMsgType.CLOSE}:
                    break
        finally:
            if self._socket is socket:
                self._socket = None
                self.audio.connected = False
                if self.identity_client is not None:
                    try:
                        await getattr(self.identity_client, "set_presence")(
                            gateway_id,
                            pairing_code,
                            connected=False,
                        )
                    except Exception:
                        LOGGER.warning(
                            "failed to mark gateway offline",
                            exc_info=True,
                        )
                self.gateway_id = None
                self.pairing_code = None
            for pending in self._pending.values():
                if not pending.future.done():
                    pending.future.set_exception(
                        ConnectionError("local Bot gateway disconnected")
                    )
            self._pending.clear()
            LOGGER.warning("local Bot gateway disconnected")
        return socket

    async def resolve_owner(self) -> dict[str, str] | None:
        if (
            self.identity_client is None
            or not self.connected
            or self.gateway_id is None
        ):
            return None
        return await getattr(self.identity_client, "owner")(self.gateway_id)

    async def request(
        self,
        command: str,
        metadata: dict[str, object] | None = None,
        payload: bytes = b"",
    ) -> dict[str, object]:
        socket = self._socket
        if socket is None or socket.closed:
            raise ConnectionError("local Bot gateway is offline")
        request_id = uuid4().hex
        body = {"request_id": request_id, "command": command, **(metadata or {})}
        loop = asyncio.get_running_loop()
        future: asyncio.Future[dict[str, object]] = loop.create_future()
        self._pending[request_id] = _PendingCommand(future)
        try:
            await socket.send_bytes(encode_message(COMMAND, body, payload))
            result = await asyncio.wait_for(future, self.command_timeout)
        finally:
            self._pending.pop(request_id, None)
        if not result.get("ok"):
            raise RuntimeError(str(result.get("error", "gateway command failed")))
        return result

    async def send_expression(self, expression: str) -> None:
        await self.request("expression", {"expression": expression})

    def request_from_worker(
        self,
        command: str,
        metadata: dict[str, object],
        payload: bytes,
    ) -> dict[str, object]:
        if self._loop is None:
            raise ConnectionError("local Bot gateway is offline")
        future = asyncio.run_coroutine_threadsafe(
            self.request(command, metadata, payload),
            self._loop,
        )
        try:
            return future.result(timeout=self.command_timeout + 2)
        except FutureTimeout as exc:
            future.cancel()
            raise TimeoutError("local Bot gateway command timed out") from exc


class RemoteThermalPrinterClient:
    """Printer-compatible proxy that executes the physical print locally."""

    def __init__(self, hub: RemoteGatewayHub, config: PrinterConfig) -> None:
        self.hub = hub
        self.width = config.width
        self.max_chunk_height = config.max_chunk_height

    @staticmethod
    def _result(reply: dict[str, object]) -> PrintResult:
        return PrintResult(
            int(reply.get("width", 0)),
            int(reply.get("height", 0)),
            int(reply.get("chunk_count", 0)),
        )

    def print_image(self, image_bytes: bytes) -> PrintResult:
        try:
            reply = self.hub.request_from_worker(
                "print",
                {"print_mode": "photo"},
                image_bytes,
            )
            return self._result(reply)
        except Exception as exc:
            raise PrinterError("remote_gateway_error") from exc

    def print_prepared_image(self, image: Image.Image) -> PrintResult:
        output = io.BytesIO()
        image.save(output, format="PNG")
        try:
            reply = self.hub.request_from_worker(
                "print",
                {"print_mode": "prepared"},
                output.getvalue(),
            )
            return self._result(reply)
        except Exception as exc:
            raise PrinterError("remote_gateway_error") from exc
