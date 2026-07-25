from __future__ import annotations

import json
from io import BytesIO
from urllib.error import HTTPError

import pytest

from app.features.gateway_identity import GatewayIdentityClient


class FakeResponse:
    def __init__(self, payload: dict[str, object]) -> None:
        self.payload = payload

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def read(self) -> bytes:
        return json.dumps(self.payload).encode()


@pytest.mark.asyncio
async def test_identity_client_registers_presence_and_resolves_owner(
    monkeypatch,
):
    requests = []

    def fake_urlopen(request, timeout):
        requests.append((request, timeout))
        if request.full_url.endswith("/owner"):
            return FakeResponse(
                {
                    "user": {
                        "id": "user-one",
                        "email": "one@example.test",
                        "displayName": "用户一",
                    }
                }
            )
        return FakeResponse({"gateway": {"gatewayId": "computer-one"}})

    monkeypatch.setattr(
        "app.features.gateway_identity.urlopen",
        fake_urlopen,
    )
    client = GatewayIdentityClient(
        "https://web.example.test",
        "bridge-secret",
    )

    await client.set_presence(
        "computer-one",
        "482913",
        connected=True,
    )
    owner = await client.owner("computer-one")

    assert owner == {
        "id": "user-one",
        "email": "one@example.test",
        "displayName": "用户一",
    }
    presence = json.loads(requests[0][0].data)
    assert presence == {
        "gatewayId": "computer-one",
        "pairingCode": "482913",
        "connected": True,
    }
    assert requests[0][0].headers["Authorization"] == "Bearer bridge-secret"


@pytest.mark.asyncio
async def test_identity_client_returns_none_for_unbound_gateway(monkeypatch):
    def fake_urlopen(request, timeout):
        del request, timeout
        body = BytesIO(
            json.dumps(
                {"error": {"code": "GATEWAY_NOT_BOUND"}}
            ).encode()
        )
        raise HTTPError(
            "https://web.example.test",
            404,
            "not found",
            {},
            body,
        )

    monkeypatch.setattr(
        "app.features.gateway_identity.urlopen",
        fake_urlopen,
    )
    client = GatewayIdentityClient(
        "https://web.example.test",
        "bridge-secret",
    )

    assert await client.owner("computer-one") is None
