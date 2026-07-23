"""Audio-domain exceptions and path validation."""

from pathlib import Path


class AudioProcessingError(Exception):
    """An expected audio processing failure with a stable error code."""

    def __init__(self, code: str, message: str | None = None) -> None:
        self.code = code
        super().__init__(message or code)


def validate_audio_path(path: Path) -> None:
    if not path.is_file():
        raise AudioProcessingError("audio_file_not_found")
    if path.suffix.lower() != ".wav":
        raise AudioProcessingError("unsupported_audio_format")

