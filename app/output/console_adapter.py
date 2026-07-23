"""Pretty JSON terminal output."""

import json

from app.output.base import OutputAdapter
from app.schemas import AssistantResponse


class ConsoleOutputAdapter(OutputAdapter):
    async def send_response(self, response: AssistantResponse) -> None:
        print(json.dumps(response.to_dict(), ensure_ascii=False, indent=2))

