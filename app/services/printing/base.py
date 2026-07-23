"""Printer hardware boundary."""

from __future__ import annotations

from abc import ABC, abstractmethod

from app.schemas import PrintJob


class PrinterAdapter(ABC):
    @abstractmethod
    async def submit(self, job: PrintJob) -> bool:
        raise NotImplementedError


class MockPrinterAdapter(PrinterAdapter):
    def __init__(self) -> None:
        self.jobs: list[PrintJob] = []

    async def submit(self, job: PrintJob) -> bool:
        self.jobs.append(job)
        return True
