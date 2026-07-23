"""Composition root for the event-driven multi-service runtime."""

from __future__ import annotations

from app.config import AppConfig
from app.asr.base import ASRBackend
from app.audio.vad.base import VADBackend
from app.audio.wake_gated_pipeline import WakeGatedAudioPipeline
from app.audio.wake_word.base import WakeWordBackend
from app.core.service_registry import ServiceRegistry
from app.core.state import BotStateManager
from app.llm.base import LLMBackend
from app.routing.mode_manager import ModeManager
from app.runtime.interaction_coordinator import InteractionCoordinator
from app.runtime.pipeline import VoicePipeline
from app.runtime.wake_voice_bridge import WakeGatedVoiceBridge
from app.services.runner_game_service import RunnerGameService
from app.services.time_service import TimeService


class AssistantRuntime:
    def __init__(
        self,
        config: AppConfig,
        mode_manager: ModeManager | None = None,
        registry: ServiceRegistry | None = None,
    ) -> None:
        self.config = config
        self.mode_manager = mode_manager or ModeManager()
        self.state_manager = BotStateManager(self.mode_manager)
        self.services = registry or ServiceRegistry()
        if registry is None:
            if config.services.runner_game_enabled:
                self.services.register(RunnerGameService())
            if config.services.time_enabled:
                self.services.register(TimeService())
        self.coordinator = InteractionCoordinator(
            self.state_manager,
            self.services,
        )

    def create_voice_pipeline(
        self,
        asr_backend: ASRBackend,
        llm_backend: LLMBackend,
    ) -> VoicePipeline:
        """Build a voice pipeline sharing gesture-controlled session modes."""
        return VoicePipeline(
            self.config,
            asr_backend,
            llm_backend,
            mode_manager=self.mode_manager,
        )

    def create_wake_voice_bridge(
        self,
        wake_backend: WakeWordBackend,
        vad_backend: VADBackend,
        asr_backend: ASRBackend,
        llm_backend: LLMBackend,
    ) -> WakeGatedVoiceBridge:
        audio_pipeline = WakeGatedAudioPipeline(
            self.config.wake_word,
            self.config.vad,
            wake_backend,
            vad_backend,
            self.config.audio.target_sample_rate,
        )
        return WakeGatedVoiceBridge(
            audio_pipeline,
            self.create_voice_pipeline(asr_backend, llm_backend),
        )
