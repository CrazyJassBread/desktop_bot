"""Future WebSocket, HTTP, serial, and Bot SDK transport contract."""

from abc import ABC, abstractmethod

from app.output.base import OutputAdapter
from app.schemas import AudioRequest


class DuplexTransportAdapter(OutputAdapter, ABC):
    """Receive audio requests and return responses over a full-duplex transport."""

    @abstractmethod
    async def receive_request(self) -> AudioRequest:
        """Wait for and convert one transport message into an audio request."""
        raise NotImplementedError

