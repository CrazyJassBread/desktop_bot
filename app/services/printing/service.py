"""Bounded print queue shared by letters and other services."""

from __future__ import annotations

from collections import deque

from app.schemas import PrintJob
from app.services.printing.base import PrinterAdapter


class PrintService:
    def __init__(self, adapter: PrinterAdapter, max_pending_jobs: int = 20) -> None:
        if max_pending_jobs < 1:
            raise ValueError("max_pending_jobs must be positive")
        self.adapter = adapter
        self._pending: deque[PrintJob] = deque(maxlen=max_pending_jobs)
        self._seen_job_ids: set[str] = set()

    async def submit(self, job: PrintJob) -> bool:
        if job.job_id in self._seen_job_ids:
            return False
        if len(self._pending) == self._pending.maxlen:
            raise RuntimeError("print_queue_full")
        self._seen_job_ids.add(job.job_id)
        self._pending.append(job)
        accepted = await self.adapter.submit(job)
        if accepted:
            self._pending.remove(job)
        return accepted

    @property
    def pending_count(self) -> int:
        return len(self._pending)
