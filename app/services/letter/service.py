"""Disabled-by-default online letter intake and print policy."""

from __future__ import annotations

from dataclasses import replace

from app.schemas import LetterReceived, PrintJob
from app.services.printing.service import PrintService


class LetterService:
    def __init__(
        self,
        print_service: PrintService,
        *,
        enabled: bool = False,
        print_policy: str = "require_confirmation",
        max_letter_chars: int = 10_000,
    ) -> None:
        self.print_service = print_service
        self.enabled = enabled
        self.print_policy = print_policy
        self.max_letter_chars = max_letter_chars
        self._letters: dict[str, LetterReceived] = {}
        self._event_ids: set[str] = set()

    async def receive(self, letter: LetterReceived) -> str:
        if not self.enabled:
            return "disabled"
        if letter.event_id in self._event_ids:
            return "duplicate"
        if not letter.content.strip() or len(letter.content) > self.max_letter_chars:
            raise ValueError("invalid_letter_content")
        self._event_ids.add(letter.event_id)
        self._letters[letter.letter_id] = replace(letter)
        if self.print_policy == "auto_print" and letter.requested_action == "print":
            await self.print_service.submit(
                PrintJob(
                    job_id=f"letter:{letter.event_id}",
                    source_type="letter",
                    source_id=letter.letter_id,
                    title=letter.subject,
                    content=letter.content,
                )
            )
            return "printing"
        if letter.requested_action == "print":
            return "waiting_confirmation"
        return "received"

    def latest(self) -> LetterReceived | None:
        if not self._letters:
            return None
        return self._letters[next(reversed(self._letters))]
