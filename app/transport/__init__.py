"""Current Bot hardware input sources."""

from app.transport.hardware_sources import (
    HTTPJPEGImageSource,
    TCPPCMAudioSource,
)
from app.transport.microphone_source import (
    InputDevice,
    LocalMicrophoneAudioSource,
    MicrophoneError,
    list_input_devices,
    parse_input_device,
)

__all__ = [
    "HTTPJPEGImageSource",
    "InputDevice",
    "LocalMicrophoneAudioSource",
    "MicrophoneError",
    "TCPPCMAudioSource",
    "list_input_devices",
    "parse_input_device",
]
