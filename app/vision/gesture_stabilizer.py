"""Per-gesture voting and release-based re-arming."""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass


@dataclass(frozen=True)
class GesturePolicy:
    window_size: int
    required_hits: int
    release_frames: int


class GestureStabilizer:
    def __init__(self, policies: dict[str, GesturePolicy]) -> None:
        self._policies = policies
        self._history = {
            label: deque(maxlen=policy.window_size)
            for label, policy in policies.items()
        }
        self._armed = {label: True for label in policies}
        self._absent_frames = {label: 0 for label in policies}

    def update(self, labels: set[str]) -> tuple[str, ...]:
        triggered: list[str] = []
        for label, policy in self._policies.items():
            present = label in labels
            history = self._history[label]
            history.append(present)
            if present:
                self._absent_frames[label] = 0
            else:
                self._absent_frames[label] += 1
                if self._absent_frames[label] >= policy.release_frames:
                    self._armed[label] = True
                    history.clear()
            if (
                self._armed[label]
                and len(history) == policy.window_size
                and sum(history) >= policy.required_hits
            ):
                self._armed[label] = False
                triggered.append(label)
        return tuple(triggered)
