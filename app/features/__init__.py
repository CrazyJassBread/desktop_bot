"""Built-in feature adapters."""

from app.features.photo_capture import LatestFrameStore, PhotoCaptureManager
from app.features.thermal_printer import (
    PrinterError,
    PrintResult,
    ThermalPrinterClient,
)

__all__ = [
    "LatestFrameStore",
    "PhotoCaptureManager",
    "PrinterError",
    "PrintResult",
    "ThermalPrinterClient",
]
