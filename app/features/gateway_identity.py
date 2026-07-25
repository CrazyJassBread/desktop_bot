"""Resolve the logged-in Web user bound to the connected computer gateway."""

from __future__ import annotations

import asyncio
import json
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen


class GatewayIdentityError(RuntimeError):
    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


class GatewayIdentityClient:
    def __init__(
        self,
        base_url: str,
        bridge_token: str,
        *,
        timeout_seconds: float = 10,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.bridge_token = bridge_token
        self.timeout_seconds = timeout_seconds

    async def set_presence(
        self,
        gateway_id: str,
        pairing_code: str,
        *,
        connected: bool,
    ) -> None:
        await asyncio.to_thread(
            self._request,
            "POST",
            "/api/v1/app/gateways/presence",
            {
                "gatewayId": gateway_id,
                "pairingCode": pairing_code,
                "connected": connected,
            },
        )

    async def owner(self, gateway_id: str) -> dict[str, str] | None:
        try:
            result = await asyncio.to_thread(
                self._request,
                "GET",
                f"/api/v1/app/gateways/{quote(gateway_id, safe='')}/owner",
                None,
            )
        except GatewayIdentityError as exc:
            if exc.reason in {"GATEWAY_NOT_BOUND", "GATEWAY_OFFLINE"}:
                return None
            raise
        user = result.get("user")
        if not isinstance(user, dict):
            raise GatewayIdentityError("invalid_response")
        return {
            "id": str(user.get("id", "")),
            "email": str(user.get("email", "")),
            "displayName": str(user.get("displayName", "")),
        }

    def _request(
        self,
        method: str,
        path: str,
        payload: dict[str, object] | None,
    ) -> dict[str, object]:
        data = (
            json.dumps(payload, ensure_ascii=False).encode("utf-8")
            if payload is not None
            else None
        )
        request = Request(
            f"{self.base_url}{path}",
            data=data,
            method=method,
            headers={
                "Authorization": f"Bearer {self.bridge_token}",
                "Content-Type": "application/json; charset=utf-8",
            },
        )
        try:
            with urlopen(request, timeout=self.timeout_seconds) as response:
                body = response.read()
        except HTTPError as exc:
            reason = f"http_{exc.code}"
            try:
                parsed = json.loads(exc.read())
                reason = str(parsed.get("error", {}).get("code", reason))
            except (json.JSONDecodeError, AttributeError, UnicodeDecodeError):
                pass
            raise GatewayIdentityError(reason) from exc
        except URLError as exc:
            raise GatewayIdentityError("connection_failed") from exc
        parsed = json.loads(body)
        if not isinstance(parsed, dict):
            raise GatewayIdentityError("invalid_response")
        return parsed
