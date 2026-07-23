"""UTF-8 JSON file response adapter."""

from __future__ import annotations

import asyncio
import json
from pathlib import Path

from app.output.base import OutputAdapter
from app.schemas import AssistantResponse


class JsonFileOutputAdapter(OutputAdapter):
    def __init__(self, output_path: Path | str) -> None:
        self.output_path = Path(output_path)

    def _write(self, response: AssistantResponse) -> None:
        self.output_path.parent.mkdir(parents=True, exist_ok=True)
        self.output_path.write_text(
            json.dumps(response.to_dict(), ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )

    async def send_response(self, response: AssistantResponse) -> None:
        await asyncio.to_thread(self._write, response)

