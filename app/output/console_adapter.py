"""Pretty JSON terminal output."""

import json

from app.output.base import OutputAdapter
from app.output.base import BotResponse


class ConsoleOutputAdapter(OutputAdapter):
    async def send_response(self, response: BotResponse) -> None:
        print(json.dumps(response.to_dict(), ensure_ascii=False, indent=2))
