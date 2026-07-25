"""Local hardware gateway: Bot LAN protocols in, cloud WebSocket out."""

from __future__ import annotations

import argparse
import asyncio
import io
import logging
import os
import re
import secrets
import socket
from contextlib import suppress
from pathlib import Path

import aiohttp
import numpy as np
from PIL import Image

from app.config import ConfigurationError, load_config
from app.factories import setup_logging
from app.features.bot_expression import BotExpressionClient
from app.features.thermal_printer import ThermalPrinterClient
from app.transport.gateway_protocol import (
    ACK,
    AUDIO,
    COMMAND,
    IMAGE,
    decode_message,
    encode_message,
)
from app.transport.camera_source import ComputerCameraImageSource
from app.transport.hardware_sources import HTTPJPEGImageSource, TCPPCMAudioSource
from app.transport.microphone_source import (
    LocalMicrophoneAudioSource,
    list_input_devices,
    parse_input_device,
)

LOGGER = logging.getLogger("desktop_assistant.gateway")


def _required_env(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise ConfigurationError(f"{name} is required")
    return value


class LocalBotGateway:
    def __init__(
        self,
        config,
        cloud_url: str,
        token: str,
        *,
        dry_run: bool = False,
        microphone_device: int | str | None = None,
        use_microphone: bool = False,
        camera_device: int | None = None,
        gateway_id: str,
        pairing_code: str,
    ) -> None:
        self.config = config
        self.cloud_url = cloud_url
        self.token = token
        self.dry_run = dry_run
        self.gateway_id = gateway_id
        self.pairing_code = pairing_code
        self.audio = (
            LocalMicrophoneAudioSource(
                device=microphone_device,
                sample_rate=config.audio.target_sample_rate,
                frame_samples=config.hardware.audio_frame_samples,
                queue_size=config.hardware.audio_queue_size,
            )
            if use_microphone
            else TCPPCMAudioSource(
                config.hardware.audio_host,
                config.hardware.audio_port,
                sample_rate=config.audio.target_sample_rate,
                frame_samples=config.hardware.audio_frame_samples,
                queue_size=config.hardware.audio_queue_size,
            )
        )
        self.images = (
            ComputerCameraImageSource(
                camera_device,
                frames_per_second=config.perception.vision_max_fps,
                session_id=config.hardware.session_id,
            )
            if camera_device is not None
            else HTTPJPEGImageSource(
                config.hardware.vision_host,
                config.hardware.vision_port,
                upload_path=config.hardware.vision_upload_path,
                max_image_bytes=config.vision.max_image_bytes,
                queue_size=1,
                default_session_id=config.hardware.session_id,
            )
        )
        self.outbound: asyncio.Queue[bytes] = asyncio.Queue(
            config.hardware.audio_queue_size
        )
        self.expression = (
            BotExpressionClient(config.bot_expression)
            if config.bot_expression.enabled
            else None
        )
        self.printer = (
            ThermalPrinterClient(
                config.printer.base_url,
                width=config.printer.width,
                max_chunk_height=config.printer.max_chunk_height,
                pixel_size=config.printer.pixel_size,
                contrast=config.printer.contrast,
                brightness=config.printer.brightness,
                grayscale_levels=config.printer.grayscale_levels,
                dither=config.printer.dither,
                rotate_180=config.printer.rotate_180,
                timeout_seconds=config.printer.timeout_seconds,
            )
            if config.printer.enabled
            else None
        )

    async def run(self) -> None:
        capture_tasks = [
            asyncio.create_task(self._capture_audio()),
            asyncio.create_task(self._capture_images()),
        ]
        try:
            delay = 1.0
            while True:
                try:
                    await self._connected_session()
                    delay = 1.0
                except asyncio.CancelledError:
                    raise
                except Exception:
                    LOGGER.warning(
                        "cloud connection failed; retrying in %.0fs",
                        delay,
                        exc_info=True,
                    )
                    await asyncio.sleep(delay)
                    delay = min(delay * 2, 30.0)
        finally:
            for task in capture_tasks:
                task.cancel()
            await asyncio.gather(*capture_tasks, return_exceptions=True)
            if self.expression is not None:
                await self.expression.aclose()

    async def _put_outbound(self, message: bytes) -> None:
        if self.outbound.full():
            with suppress(asyncio.QueueEmpty):
                self.outbound.get_nowait()
        self.outbound.put_nowait(message)

    async def _capture_audio(self) -> None:
        try:
            async for frame in self.audio.frames():
                pcm = np.clip(frame * 32768.0, -32768, 32767).astype("<i2")
                await self._put_outbound(
                    encode_message(AUDIO, payload=pcm.tobytes())
                )
        except asyncio.CancelledError:
            raise
        except Exception:
            LOGGER.exception("local audio capture stopped")

    async def _capture_images(self) -> None:
        try:
            async for request in self.images.images():
                await self._put_outbound(
                    encode_message(
                        IMAGE,
                        {
                            "session_id": request.session_id,
                            "request_id": request.request_id,
                            "captured_at_ms": request.captured_at_ms,
                        },
                        request.image_bytes,
                    ),
                )
        except asyncio.CancelledError:
            raise
        except Exception:
            LOGGER.exception("local image capture stopped")
            if isinstance(self.images, ComputerCameraImageSource):
                LOGGER.warning(
                    "computer camera unavailable; falling back to JPEG uploads "
                    "at http://127.0.0.1:%s%s",
                    self.config.hardware.vision_port,
                    self.config.hardware.vision_upload_path,
                )
                self.images = HTTPJPEGImageSource(
                    self.config.hardware.vision_host,
                    self.config.hardware.vision_port,
                    upload_path=self.config.hardware.vision_upload_path,
                    max_image_bytes=self.config.vision.max_image_bytes,
                    queue_size=1,
                    default_session_id=self.config.hardware.session_id,
                )
                await self._capture_images()

    async def _connected_session(self) -> None:
        headers = {
            "Authorization": f"Bearer {self.token}",
            "X-Bot-Gateway-Id": self.gateway_id,
            "X-Bot-Pairing-Code": self.pairing_code,
        }
        timeout = aiohttp.ClientTimeout(total=None, sock_connect=15)
        async with aiohttp.ClientSession(timeout=timeout) as session:
            async with session.ws_connect(
                self.cloud_url,
                headers=headers,
                heartbeat=20,
                max_msg_size=4 * 1024 * 1024,
            ) as socket:
                LOGGER.info("connected to cloud runtime at %s", self.cloud_url)
                sender = asyncio.create_task(self._send(socket))
                receiver = asyncio.create_task(self._receive(socket))
                tasks = {sender, receiver}
                try:
                    done, pending = await asyncio.wait(
                        tasks,
                        return_when=asyncio.FIRST_COMPLETED,
                    )
                    for task in pending:
                        task.cancel()
                    await asyncio.gather(*pending, return_exceptions=True)
                    for task in done:
                        task.result()
                finally:
                    for task in tasks:
                        if not task.done():
                            task.cancel()
                    await asyncio.gather(*tasks, return_exceptions=True)

    async def _send(self, socket) -> None:
        while True:
            await socket.send_bytes(await self.outbound.get())

    async def _receive(self, socket) -> None:
        async for item in socket:
            if item.type == aiohttp.WSMsgType.BINARY:
                message = decode_message(item.data)
                if message.kind != COMMAND:
                    continue
                reply = await self._execute(message.metadata, message.payload)
                await socket.send_bytes(encode_message(ACK, reply))
            elif item.type in {
                aiohttp.WSMsgType.CLOSE,
                aiohttp.WSMsgType.CLOSED,
                aiohttp.WSMsgType.ERROR,
            }:
                break

    async def _execute(
        self,
        metadata: dict[str, object],
        payload: bytes,
    ) -> dict[str, object]:
        request_id = str(metadata.get("request_id", ""))
        try:
            command = metadata.get("command")
            if command == "expression":
                if self.dry_run:
                    LOGGER.info(
                        "dry-run expression=%s",
                        metadata.get("expression"),
                    )
                    return {"request_id": request_id, "ok": True}
                if self.expression is None:
                    raise RuntimeError("Bot expression output is disabled")
                await self.expression.set_expression(
                    str(metadata.get("expression", ""))
                )
                return {"request_id": request_id, "ok": True}
            if command == "print":
                if self.dry_run:
                    with Image.open(io.BytesIO(payload)) as source:
                        width, height = source.size
                    LOGGER.info(
                        "dry-run print mode=%s size=%sx%s",
                        metadata.get("print_mode"),
                        width,
                        height,
                    )
                    return {
                        "request_id": request_id,
                        "ok": True,
                        "width": width,
                        "height": height,
                        "chunk_count": 1,
                    }
                if self.printer is None:
                    raise RuntimeError("printer output is disabled")
                if metadata.get("print_mode") == "prepared":
                    with Image.open(io.BytesIO(payload)) as source:
                        image = source.convert("1")
                    result = await asyncio.to_thread(
                        self.printer.print_prepared_image,
                        image,
                    )
                else:
                    result = await asyncio.to_thread(
                        self.printer.print_image,
                        payload,
                    )
                return {
                    "request_id": request_id,
                    "ok": True,
                    "width": result.width,
                    "height": result.height,
                    "chunk_count": result.chunk_count,
                }
            raise RuntimeError(f"unsupported command: {command}")
        except Exception as exc:
            LOGGER.warning("gateway command failed", exc_info=True)
            return {
                "request_id": request_id,
                "ok": False,
                "error": type(exc).__name__,
            }


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Run the local Bot cloud gateway")
    parser.add_argument("--config", type=Path, default=Path("config/app.yaml"))
    parser.add_argument(
        "--cloud-url",
        default=None,
        help="wss://.../api/gateway (or BOT_CLOUD_URL)",
    )
    parser.add_argument(
        "--gateway-id",
        default=None,
        help="stable computer id (or BOT_GATEWAY_ID; defaults to hostname)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="acknowledge OLED/print commands without touching hardware",
    )
    parser.add_argument(
        "--microphone",
        action="store_true",
        help="use this computer's microphone instead of Bot TCP PCM",
    )
    parser.add_argument(
        "--input-device",
        type=parse_input_device,
        default=None,
        help="microphone device index or name",
    )
    parser.add_argument(
        "--list-input-devices",
        action="store_true",
        help="list microphones and exit",
    )
    parser.add_argument(
        "--camera",
        action="store_true",
        help="use this computer's webcam instead of Bot JPEG uploads",
    )
    parser.add_argument(
        "--camera-device",
        type=int,
        default=0,
        help="computer webcam index used with --camera",
    )
    return parser


async def run(args: argparse.Namespace) -> None:
    setup_logging()
    if args.list_input_devices:
        for device in list_input_devices():
            print(
                f"{device.index}: {device.name} "
                f"(inputs={device.max_input_channels}, "
                f"default_rate={device.default_samplerate:g})"
            )
        return
    if args.input_device is not None and not args.microphone:
        raise ConfigurationError("--input-device requires --microphone")
    config = load_config(args.config)
    cloud_url = (args.cloud_url or _required_env("BOT_CLOUD_URL")).strip()
    token = _required_env("BOT_GATEWAY_TOKEN")
    gateway_id = (
        args.gateway_id
        or os.environ.get("BOT_GATEWAY_ID")
        or socket.gethostname()
    ).strip()
    if not re.fullmatch(r"[A-Za-z0-9._:-]{1,128}", gateway_id):
        raise ConfigurationError(
            "gateway id must contain only letters, numbers, dot, colon, "
            "underscore, or dash"
        )
    pairing_code = f"{secrets.randbelow(1_000_000):06d}"
    LOGGER.info("computer pairing code: %s", pairing_code)
    print(f"\n电脑 Bot 配对码：{pairing_code}\n", flush=True)
    await LocalBotGateway(
        config,
        cloud_url,
        token,
        dry_run=args.dry_run,
        microphone_device=args.input_device,
        use_microphone=args.microphone,
        camera_device=args.camera_device if args.camera else None,
        gateway_id=gateway_id,
        pairing_code=pairing_code,
    ).run()


def main() -> None:
    args = build_parser().parse_args()
    try:
        asyncio.run(run(args))
    except KeyboardInterrupt:
        LOGGER.info("local gateway stopped")
    except (ConfigurationError, OSError, RuntimeError) as exc:
        raise SystemExit(str(exc)) from exc


if __name__ == "__main__":
    main()
