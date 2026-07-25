"""HTTP health/history/photo endpoints and a live WebSocket event stream."""

from __future__ import annotations

import re
from pathlib import Path
from typing import Awaitable, Callable

from app.control.application_controller import ApplicationController
from app.event_cache import EventCache
from app.events.event_bus import EventBus
from app.perception_events import PerceptionEvent

_CAPTURE_ID = re.compile(r"^[0-9a-f]{32}$")


class EventAPIServer:
    def __init__(
        self,
        *,
        host: str,
        port: int,
        websocket_path: str,
        cache: EventCache,
        event_bus: EventBus,
        controller: ApplicationController,
        health: Callable[[], dict[str, object]],
        emit: Callable[[PerceptionEvent], Awaitable[None]],
        photo_output_dir: Path,
    ) -> None:
        self.host = host
        self.port = port
        self.websocket_path = websocket_path
        self.cache = cache
        self.event_bus = event_bus
        self.controller = controller
        self.health = health
        self.emit = emit
        self.photo_output_dir = photo_output_dir
        self._runner = None

    async def start(self) -> None:
        try:
            from aiohttp import web
        except ImportError as exc:
            raise RuntimeError(
                "API is enabled but aiohttp is not installed"
            ) from exc

        # The local web demo (another origin, e.g. :18000) fetches photos and
        # polls events from the browser; allow simple cross-origin reads.
        @web.middleware
        async def _cors(request, handler):
            try:
                response = await handler(request)
            except web.HTTPException as exc:
                exc.headers["Access-Control-Allow-Origin"] = "*"
                raise
            response.headers["Access-Control-Allow-Origin"] = "*"
            return response

        app = web.Application(middlewares=[_cors])
        app.router.add_get("/api/health", self._health)
        app.router.add_get("/api/state", self._state)
        app.router.add_post("/api/results", self._result)
        app.router.add_get(self.websocket_path, self._events)
        app.router.add_get("/api/photos/{capture_id}.jpg", self._photo)
        self._runner = web.AppRunner(app)
        await self._runner.setup()
        site = web.TCPSite(self._runner, self.host, self.port)
        await site.start()

    async def stop(self) -> None:
        if self._runner is not None:
            await self._runner.cleanup()
            self._runner = None

    async def _health(self, _: object):
        from aiohttp import web

        return web.json_response(self.health())

    async def _state(self, _: object):
        from aiohttp import web

        return web.json_response(self.controller.state.to_dict())

    async def _result(self, request):
        from aiohttp import web

        try:
            body = await request.json()
        except (ValueError, TypeError):
            return web.json_response({"error": "expected JSON object"}, status=400)
        if not isinstance(body, dict):
            return web.json_response({"error": "expected JSON object"}, status=400)
        event_type = body.get("event_type")
        payload = body.get("payload", {})
        if not isinstance(event_type, str) or not event_type.strip():
            return web.json_response(
                {"error": "event_type is required"},
                status=400,
            )
        if not isinstance(payload, dict):
            return web.json_response(
                {"error": "payload must be an object"},
                status=400,
            )
        event = PerceptionEvent(
            event_type=event_type,
            source="external",
            session_id=str(body.get("session_id", "bot")),
            payload=payload,
        )
        await self.emit(event)
        return web.json_response(
            {"status": "accepted", "event_id": event.event_id},
            status=202,
        )

    async def _events(self, request):
        import asyncio

        from aiohttp import WSMsgType, web

        probe = web.WebSocketResponse().can_prepare(request)
        if not probe.ok:
            try:
                after = int(request.query.get("after_sequence", "0"))
            except ValueError:
                return web.json_response(
                    {"error": "after_sequence must be an integer"},
                    status=400,
                )
            events = [
                event.to_dict()
                for event in self.cache.snapshot()
                if event.sequence > after
            ]
            return web.json_response({"events": events})

        socket = web.WebSocketResponse(heartbeat=20)
        await socket.prepare(request)
        subscription = self.event_bus.subscribe()
        try:
            while not socket.closed:
                event_task = asyncio.create_task(subscription.get())
                receive_task = asyncio.create_task(socket.receive())
                done, pending = await asyncio.wait(
                    {event_task, receive_task},
                    return_when=asyncio.FIRST_COMPLETED,
                )
                for task in pending:
                    task.cancel()
                await asyncio.gather(*pending, return_exceptions=True)
                if receive_task in done:
                    message = receive_task.result()
                    if message.type in {
                        WSMsgType.CLOSE,
                        WSMsgType.CLOSED,
                        WSMsgType.ERROR,
                    }:
                        break
                if event_task in done:
                    await socket.send_json(event_task.result().to_dict())
        finally:
            subscription.close()
            if not socket.closed:
                await socket.close()
        return socket

    async def _photo(self, request):
        from aiohttp import web

        capture_id = request.match_info["capture_id"]
        if not _CAPTURE_ID.fullmatch(capture_id):
            raise web.HTTPNotFound()
        path = self.photo_output_dir / f"{capture_id}.jpg"
        if not path.is_file():
            raise web.HTTPNotFound()
        return web.FileResponse(path)
