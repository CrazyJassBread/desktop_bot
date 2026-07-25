from __future__ import annotations

import pytest

from app.config import WebLetterSyncConfig
from app.features.web_letter_sync import WebLetterSyncManager
from app.perception_events import PerceptionEvent


def completed_letter() -> PerceptionEvent:
    return PerceptionEvent(
        "llm.letter_completed",
        "llm",
        session_id="bot-session",
        payload={
            "recipient": "小明",
            "content": "这是通过语音写好的一封信。",
            "owner_user_id": "sender-user",
        },
    )


@pytest.mark.asyncio
async def test_manager_sends_completed_voice_letter_to_web():
    requests: list[dict[str, object]] = []

    def transport(payload: dict[str, object]) -> dict[str, object]:
        requests.append(payload)
        return {"letter": {"id": "letter-1"}, "replayed": False}

    manager = WebLetterSyncManager(
        WebLetterSyncConfig(enabled=True),
        bridge_token="secret-token",
        transport=transport,
    )
    emitted: list[PerceptionEvent] = []

    async def emit(event: PerceptionEvent) -> None:
        emitted.append(event)

    manager.set_event_emitter(emit)
    event = completed_letter()

    assert manager.schedule(event) is True
    await manager.wait_idle()

    assert requests == [
        {
            "senderUserId": "sender-user",
            "recipient": "小明",
            "subject": "写给小明的语音信件",
            "content": "这是通过语音写好的一封信。",
            "eventId": event.event_id,
        }
    ]
    assert [item.event_type for item in emitted] == ["web.letter_saved"]
    assert emitted[0].payload == {
        "trigger_event_id": event.event_id,
        "web_letter_id": "letter-1",
        "recipient": "小明",
        "replayed": False,
    }
    await manager.aclose()


@pytest.mark.asyncio
async def test_manager_reports_web_sync_failure_without_crashing_app():
    def transport(payload: dict[str, object]) -> dict[str, object]:
        del payload
        raise RuntimeError("recipient_not_found")

    manager = WebLetterSyncManager(
        WebLetterSyncConfig(enabled=True),
        bridge_token="secret-token",
        transport=transport,
    )
    emitted: list[PerceptionEvent] = []

    async def emit(event: PerceptionEvent) -> None:
        emitted.append(event)

    manager.set_event_emitter(emit)
    manager.schedule(completed_letter())
    await manager.wait_idle()

    assert [item.event_type for item in emitted] == [
        "web.letter_sync_failed"
    ]
    assert emitted[0].payload["reason"] == "RuntimeError"
    await manager.aclose()


@pytest.mark.asyncio
async def test_manager_sends_locked_owner_id():
    requests: list[dict[str, object]] = []
    manager = WebLetterSyncManager(
        WebLetterSyncConfig(enabled=True),
        bridge_token="secret-token",
        transport=lambda payload: (
            requests.append(payload)
            or {"letter": {"id": "letter-owner"}}
        ),
    )
    event = completed_letter()
    event.payload["owner_user_id"] = "user-one"

    manager.schedule(event)
    await manager.wait_idle()

    assert requests[0]["senderUserId"] == "user-one"
    await manager.aclose()


@pytest.mark.asyncio
async def test_manager_refuses_to_sync_without_locked_owner():
    requests: list[dict[str, object]] = []
    emitted: list[PerceptionEvent] = []
    manager = WebLetterSyncManager(
        WebLetterSyncConfig(enabled=True),
        bridge_token="secret-token",
        transport=lambda payload: (
            requests.append(payload)
            or {"letter": {"id": "must-not-save"}}
        ),
    )

    async def emit(event: PerceptionEvent) -> None:
        emitted.append(event)

    manager.set_event_emitter(emit)
    event = completed_letter()
    event.payload.pop("owner_user_id")

    manager.schedule(event)
    await manager.wait_idle()

    assert requests == []
    assert emitted[0].event_type == "web.letter_sync_failed"
    assert emitted[0].payload["reason"] == "user_not_bound"
    await manager.aclose()


@pytest.mark.asyncio
async def test_manager_ignores_non_letter_events():
    manager = WebLetterSyncManager(
        WebLetterSyncConfig(enabled=True),
        bridge_token="secret-token",
        transport=lambda payload: {"letter": {"id": "unused"}},
    )

    assert (
        manager.schedule(PerceptionEvent("asr.final", "asr", payload={}))
        is False
    )
    await manager.aclose()
