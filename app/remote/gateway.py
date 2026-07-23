"""Validate and de-duplicate events from a future online platform."""

from __future__ import annotations

from app.schemas import LetterReceived
from app.services.letter.service import LetterService


class RemoteEventGateway:
    def __init__(self, letter_service: LetterService, enabled: bool = False) -> None:
        self.letter_service = letter_service
        self.enabled = enabled

    async def receive_letter(self, event: LetterReceived) -> str:
        if not self.enabled:
            return "disabled"
        return await self.letter_service.receive(event)
