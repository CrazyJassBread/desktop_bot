"""Network sources for the Bot's current audio and camera protocols."""

from __future__ import annotations

import asyncio
import json
import logging
import time
from contextlib import suppress
from urllib.parse import urlsplit

import numpy as np

from app.models import ImageRequest
from app.transport.sources import AudioFrameSource, ImageFrameSource

LOGGER = logging.getLogger("desktop_assistant.hardware")


class TCPPCMAudioSource(AudioFrameSource):
    """Receive 16-bit little-endian mono PCM from one reconnecting Bot."""

    def __init__(
        self,
        host: str = "0.0.0.0",
        port: int = 8080,
        *,
        sample_rate: int = 16_000,
        frame_samples: int = 512,
        queue_size: int = 256,
    ) -> None:
        if not 0 <= port <= 65_535:
            raise ValueError("audio port must be between 0 and 65535")
        if sample_rate <= 0 or frame_samples <= 0 or queue_size <= 0:
            raise ValueError("audio source sizes must be positive")
        self.host = host
        self.port = port
        self.sample_rate = sample_rate
        self.frame_samples = frame_samples
        self.queue_size = queue_size
        self.bound_port: int | None = None
        self._queue: asyncio.Queue[np.ndarray] | None = None
        self._server: asyncio.Server | None = None
        self._started = asyncio.Event()
        self._active_writer: asyncio.StreamWriter | None = None

    async def wait_started(self) -> None:
        await self._started.wait()

    async def frames(self):
        if self._server is not None:
            raise RuntimeError("audio source is already running")
        self._queue = asyncio.Queue(maxsize=self.queue_size)
        self._server = await asyncio.start_server(
            self._handle_connection,
            self.host,
            self.port,
        )
        sockets = self._server.sockets or []
        self.bound_port = int(sockets[0].getsockname()[1]) if sockets else self.port
        self._started.set()
        LOGGER.info(
            "audio TCP source listening on %s:%s (PCM s16le, %s Hz, mono)",
            self.host,
            self.bound_port,
            self.sample_rate,
        )
        try:
            while True:
                yield await self._queue.get()
        finally:
            await self.aclose()

    async def _handle_connection(
        self,
        reader: asyncio.StreamReader,
        writer: asyncio.StreamWriter,
    ) -> None:
        peer = writer.get_extra_info("peername")
        if self._active_writer is not None:
            LOGGER.warning("rejecting second audio client from %s", peer)
            writer.close()
            await writer.wait_closed()
            return
        self._active_writer = writer
        LOGGER.info("audio Bot connected from %s", peer)
        frame_bytes = self.frame_samples * 2
        buffered = bytearray()
        try:
            while True:
                data = await reader.read(4096)
                if not data:
                    break
                buffered.extend(data)
                while len(buffered) >= frame_bytes:
                    raw = bytes(buffered[:frame_bytes])
                    del buffered[:frame_bytes]
                    pcm = np.frombuffer(raw, dtype="<i2")
                    frame = np.ascontiguousarray(
                        pcm.astype(np.float32) / 32768.0
                    )
                    assert self._queue is not None
                    await self._queue.put(frame)
        except (ConnectionError, asyncio.CancelledError):
            raise
        except Exception:
            LOGGER.exception("audio connection failed for %s", peer)
        finally:
            if self._active_writer is writer:
                self._active_writer = None
            writer.close()
            with suppress(Exception):
                await writer.wait_closed()
            LOGGER.info("audio Bot disconnected from %s", peer)

    async def aclose(self) -> None:
        writer = self._active_writer
        self._active_writer = None
        if writer is not None:
            writer.close()
            with suppress(Exception):
                await writer.wait_closed()
        server = self._server
        self._server = None
        if server is not None:
            server.close()
            await server.wait_closed()


class HTTPJPEGImageSource(ImageFrameSource):
    """Accept JPEG bytes with ``POST /upload`` and emit ImageRequest objects."""

    def __init__(
        self,
        host: str = "0.0.0.0",
        port: int = 8081,
        *,
        upload_path: str = "/upload",
        max_image_bytes: int = 2_097_152,
        queue_size: int = 2,
        default_session_id: str = "default",
    ) -> None:
        if not 0 <= port <= 65_535:
            raise ValueError("image port must be between 0 and 65535")
        if not upload_path.startswith("/"):
            raise ValueError("image upload path must start with '/'")
        if max_image_bytes <= 0 or queue_size <= 0:
            raise ValueError("image source sizes must be positive")
        self.host = host
        self.port = port
        self.upload_path = upload_path
        self.max_image_bytes = max_image_bytes
        self.queue_size = queue_size
        self.default_session_id = default_session_id
        self.bound_port: int | None = None
        self._queue: asyncio.Queue[ImageRequest] | None = None
        self._server: asyncio.Server | None = None
        self._started = asyncio.Event()

    async def wait_started(self) -> None:
        await self._started.wait()

    async def images(self):
        if self._server is not None:
            raise RuntimeError("image source is already running")
        self._queue = asyncio.Queue(maxsize=self.queue_size)
        self._server = await asyncio.start_server(
            self._handle_connection,
            self.host,
            self.port,
        )
        sockets = self._server.sockets or []
        self.bound_port = int(sockets[0].getsockname()[1]) if sockets else self.port
        self._started.set()
        LOGGER.info(
            "image HTTP source listening on http://%s:%s%s",
            self.host,
            self.bound_port,
            self.upload_path,
        )
        try:
            while True:
                yield await self._queue.get()
        finally:
            await self.aclose()

    async def _handle_connection(
        self,
        reader: asyncio.StreamReader,
        writer: asyncio.StreamWriter,
    ) -> None:
        try:
            request_line = (await reader.readline()).decode(
                "ascii", errors="replace"
            ).strip()
            parts = request_line.split()
            if len(parts) != 3:
                await self._respond(writer, 400, {"error": "invalid request"})
                return
            method, target, _ = parts
            headers: dict[str, str] = {}
            total_header_bytes = len(request_line)
            while True:
                line = await reader.readline()
                total_header_bytes += len(line)
                if total_header_bytes > 32_768:
                    await self._respond(
                        writer, 431, {"error": "headers too large"}
                    )
                    return
                if line in {b"\r\n", b"\n", b""}:
                    break
                name, separator, value = line.decode(
                    "latin-1", errors="replace"
                ).partition(":")
                if not separator:
                    await self._respond(
                        writer, 400, {"error": "invalid header"}
                    )
                    return
                headers[name.strip().lower()] = value.strip()

            if method != "POST" or urlsplit(target).path != self.upload_path:
                await self._respond(writer, 404, {"error": "not found"})
                return
            content_type = headers.get("content-type", "image/jpeg").split(
                ";", 1
            )[0].strip().lower()
            if content_type not in {"image/jpeg", "image/jpg"}:
                await self._respond(
                    writer, 415, {"error": "expected image/jpeg"}
                )
                return
            try:
                content_length = int(headers["content-length"])
            except (KeyError, ValueError):
                await self._respond(
                    writer, 411, {"error": "content-length required"}
                )
                return
            if content_length <= 0:
                await self._respond(writer, 400, {"error": "empty image"})
                return
            if content_length > self.max_image_bytes:
                await self._respond(writer, 413, {"error": "image too large"})
                return
            try:
                image_bytes = await reader.readexactly(content_length)
            except asyncio.IncompleteReadError:
                await self._respond(
                    writer, 400, {"error": "incomplete image"}
                )
                return

            request = ImageRequest(
                image_bytes=image_bytes,
                session_id=headers.get(
                    "x-session-id", self.default_session_id
                ),
                request_id=headers.get("x-request-id"),
                captured_at_ms=int(time.time() * 1000),
                content_type="image/jpeg",
            )
            assert self._queue is not None
            dropped = False
            if self._queue.full():
                self._queue.get_nowait()
                dropped = True
            self._queue.put_nowait(request)
            await self._respond(
                writer,
                202,
                {
                    "status": "accepted",
                    "bytes": content_length,
                    "dropped_stale_frame": dropped,
                },
            )
        except (ConnectionError, asyncio.CancelledError):
            raise
        except Exception:
            LOGGER.exception("invalid image upload")
            with suppress(Exception):
                await self._respond(
                    writer, 500, {"error": "internal server error"}
                )
        finally:
            writer.close()
            with suppress(Exception):
                await writer.wait_closed()

    @staticmethod
    async def _respond(
        writer: asyncio.StreamWriter,
        status: int,
        payload: dict[str, object],
    ) -> None:
        reasons = {
            202: "Accepted",
            400: "Bad Request",
            404: "Not Found",
            411: "Length Required",
            413: "Content Too Large",
            415: "Unsupported Media Type",
            431: "Request Header Fields Too Large",
            500: "Internal Server Error",
        }
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        head = (
            f"HTTP/1.1 {status} {reasons.get(status, '')}\r\n"
            "Content-Type: application/json; charset=utf-8\r\n"
            f"Content-Length: {len(body)}\r\n"
            "Connection: close\r\n"
            "\r\n"
        ).encode("ascii")
        writer.write(head + body)
        await writer.drain()

    async def aclose(self) -> None:
        server = self._server
        self._server = None
        if server is not None:
            server.close()
            await server.wait_closed()
