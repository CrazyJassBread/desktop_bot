"""Voice activity detection backends."""

from app.audio.vad.base import VADBackend, VADError

__all__ = ["VADBackend", "VADError"]
