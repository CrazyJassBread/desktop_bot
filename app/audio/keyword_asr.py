"""ASR transcription plus optional keyword intent detection."""

from __future__ import annotations

import json
import logging

from app.asr.base import ASRBackend
from app.detection.keywords import KeywordDetector
from app.models import AudioData
from app.perception_events import PerceptionEvent

LOGGER = logging.getLogger("desktop_assistant.asr")


class KeywordASRProcessor:
    def __init__(
        self,
        asr: ASRBackend,
        detector: KeywordDetector,
        *,
        session_id: str = "bot",
    ) -> None:
        self.asr = asr
        self.detector = detector
        self.session_id = session_id

    async def process(self, utterance: AudioData) -> tuple[PerceptionEvent, ...]:
        transcript = (await self.asr.transcribe(utterance)).strip()
        match = self.detector.detect(transcript)
        LOGGER.info(
            "asr result %s",
            json.dumps(
                {
                    "session_id": self.session_id,
                    "duration_seconds": round(
                        utterance.duration_seconds,
                        3,
                    ),
                    "transcript": transcript,
                    "matched_event": (
                        match.event_type if match is not None else None
                    ),
                    "matched_keyword": (
                        match.keyword if match is not None else None
                    ),
                },
                ensure_ascii=False,
            ),
        )
        if not transcript:
            return ()
        duration = round(utterance.duration_seconds, 3)
        transcript_event = PerceptionEvent(
            event_type="speech.transcribed",
            source="audio",
            session_id=self.session_id,
            payload={
                "transcript": transcript,
                "audio_duration_seconds": duration,
                "matched_event": match.event_type if match else None,
            },
        )
        if match is None:
            return (transcript_event,)
        intent_event = PerceptionEvent(
            event_type=match.event_type,
            source="audio",
            session_id=self.session_id,
            payload={
                "keyword": match.keyword,
                "transcript": match.transcript,
                "payload_text": match.payload_text,
                "audio_duration_seconds": duration,
            },
        )
        # Route the explicit intent first. The transcript remains observable, but
        # the application controller can avoid treating it as a second chat turn.
        return (intent_event, transcript_event)
