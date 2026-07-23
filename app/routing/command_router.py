"""Three-stage command matching with ambiguity protection."""

from __future__ import annotations

from dataclasses import dataclass
from difflib import SequenceMatcher

from app.command.definitions import COMMANDS, CommandDefinition
from app.config import CommandConfig
from app.routing.aliases import normalize_text

try:
    from rapidfuzz.fuzz import ratio as fuzzy_ratio
except ImportError:  # pragma: no cover - exercised only in minimal installations
    def fuzzy_ratio(left: str, right: str) -> float:
        return SequenceMatcher(None, left, right).ratio() * 100


@dataclass(frozen=True)
class CommandMatch:
    definition: CommandDefinition
    score: float
    matched_phrase: str
    ambiguous: bool = False


class CommandRouter:
    def __init__(
        self,
        config: CommandConfig,
        definitions: tuple[CommandDefinition, ...] = COMMANDS,
    ) -> None:
        self.config = config
        self.definitions = definitions

    def match(self, text: str, *, global_only: bool = False) -> CommandMatch | None:
        normalized = normalize_text(text)
        candidates = tuple(
            item
            for item in self.definitions
            if (item.is_global if global_only else not item.is_global)
        )
        if not normalized or not candidates:
            return None

        exact = self._exact(normalized, candidates)
        if exact:
            return exact
        contained = self._contained(normalized, candidates)
        if contained:
            return contained
        if not self.config.fuzzy_match:
            return None
        return self._fuzzy(normalized, candidates)

    @staticmethod
    def _exact(
        normalized: str, candidates: tuple[CommandDefinition, ...]
    ) -> CommandMatch | None:
        for definition in candidates:
            for phrase in definition.phrases:
                normalized_phrase = normalize_text(phrase)
                if normalized == normalized_phrase:
                    return CommandMatch(definition, 100.0, phrase)
        return None

    @staticmethod
    def _contained(
        normalized: str, candidates: tuple[CommandDefinition, ...]
    ) -> CommandMatch | None:
        matches: list[tuple[int, CommandDefinition, str]] = []
        for definition in candidates:
            for phrase in definition.phrases:
                normalized_phrase = normalize_text(phrase)
                if normalized_phrase and normalized_phrase in normalized:
                    matches.append((len(normalized_phrase), definition, phrase))
        if not matches:
            return None
        _, definition, phrase = max(matches, key=lambda item: item[0])
        return CommandMatch(definition, 95.0, phrase)

    def _fuzzy(
        self, normalized: str, candidates: tuple[CommandDefinition, ...]
    ) -> CommandMatch | None:
        ranked: list[tuple[float, CommandDefinition, str]] = []
        for definition in candidates:
            scores = [
                (float(fuzzy_ratio(normalized, normalize_text(phrase))), phrase)
                for phrase in definition.phrases
            ]
            score, phrase = max(scores, key=lambda item: item[0])
            ranked.append((score, definition, phrase))
        ranked.sort(key=lambda item: item[0], reverse=True)
        best_score, best_definition, best_phrase = ranked[0]
        threshold = self.config.fuzzy_threshold
        if best_definition.action in {
            "printer.print_last_response",
            "message.delete",
            "message.send",
        }:
            threshold = max(threshold, self.config.dangerous_action_threshold)
        if best_score < threshold:
            return None
        second_score = ranked[1][0] if len(ranked) > 1 else 0.0
        ambiguous = best_score - second_score < self.config.ambiguity_margin
        return CommandMatch(
            best_definition,
            best_score,
            best_phrase,
            ambiguous=ambiguous,
        )
