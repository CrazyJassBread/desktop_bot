"""Zeabur/cloud entry point for perception, LLM, API, and gateway relay."""

from __future__ import annotations

import argparse
import asyncio
import logging
import os
from pathlib import Path

from app.api.server import EventAPIServer
from app.config import ConfigurationError, load_config
from app.control.application_controller import ApplicationController
from app.factories import setup_logging
from app.features.gateway_identity import GatewayIdentityClient
from app.hardware_main import build_daemon
from app.transport.remote_gateway import (
    RemoteGatewayHub,
    RemoteThermalPrinterClient,
)

LOGGER = logging.getLogger("desktop_assistant.cloud")


def _required_env(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise ConfigurationError(f"{name} is required")
    return value


async def run(config_path: Path) -> None:
    setup_logging(
        Path(
            os.environ.get(
                "PERCEPTION_LOG_PATH",
                "/data/logs/perception.log",
            )
        )
    )
    config = load_config(config_path)
    config.api.host = "0.0.0.0"
    config.api.port = int(os.environ.get("PORT", config.api.port))
    web_url = os.environ.get("AI_HUB_WEB_URL", "").strip()
    if web_url:
        config.web_letter_sync.base_url = web_url

    if not web_url:
        raise ConfigurationError("AI_HUB_WEB_URL is required")
    identity_client = GatewayIdentityClient(
        web_url,
        _required_env("AI_HUB_BRIDGE_TOKEN"),
        timeout_seconds=config.web_letter_sync.timeout_seconds,
    )
    hub = RemoteGatewayHub(
        _required_env("BOT_GATEWAY_TOKEN"),
        identity_client=identity_client,
    )
    printer = (
        RemoteThermalPrinterClient(hub, config.printer)
        if config.printer.enabled
        else None
    )
    args = argparse.Namespace(
        mode="run",
        audio_only=False,
        vision_only=False,
        audio_host=None,
        audio_port=None,
        vision_host=None,
        vision_port=None,
        session=None,
    )
    daemon, gesture_backend = build_daemon(
        config,
        args,
        audio_source_override=hub.audio,
        image_source_override=hub.images,
        expression_sender=hub.send_expression,
        printer_override=printer,
        letter_owner_resolver=hub.resolve_owner,
    )
    controller = daemon.application_controller
    assert isinstance(controller, ApplicationController)
    api = EventAPIServer(
        host=config.api.host,
        port=config.api.port,
        websocket_path=config.api.websocket_path,
        cache=daemon.cache,
        event_bus=daemon.event_bus,
        controller=controller,
        health=daemon.health,
        emit=daemon.emit,
        photo_output_dir=Path(config.application.photo_output_dir),
        letter_output_dir=Path(config.letter.output_dir),
        gateway_hub=hub,
    )
    try:
        await api.start()
        LOGGER.info(
            "cloud runtime listening on %s:%s",
            config.api.host,
            config.api.port,
        )
        await daemon.run()
    finally:
        await api.stop()
        await controller.aclose()
        if gesture_backend is not None:
            await gesture_backend.close()


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the Bot cloud runtime")
    parser.add_argument(
        "--config",
        type=Path,
        default=Path("config/cloud.yaml"),
    )
    args = parser.parse_args()
    try:
        asyncio.run(run(args.config))
    except KeyboardInterrupt:
        LOGGER.info("cloud runtime stopped")
    except (ConfigurationError, OSError, RuntimeError) as exc:
        parser.error(str(exc))


if __name__ == "__main__":
    main()
