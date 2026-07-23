"""End-to-end voice request pipeline."""

from __future__ import annotations

import logging
import time
from typing import Any

from app.asr.base import ASRBackend, ASRError
from app.audio.loader import AudioData, load_wav
from app.audio.validator import AudioProcessingError
from app.command.fixed_qa import match_fixed_qa
from app.command.handlers import handle_command
from app.config import AppConfig
from app.llm.base import LLMBackend, LLMError
from app.llm.guide_agent import GuideAgent
from app.llm.response_processor import ResponseProcessor
from app.routing.aliases import normalize_text
from app.routing.command_router import CommandMatch, CommandRouter
from app.routing.mode_manager import ModeManager, SessionState
from app.schemas import (
    AssistantResponse,
    AudioRequest,
    ControlSignal,
    InteractionMode,
)

LOGGER = logging.getLogger("desktop_assistant")
UNMATCHED_PROMPT = "我没有找到对应的固定指令。你可以进入智能问答模式。"


class VoicePipeline:
    """Coordinate audio, recognition, intent routing, and response generation."""

    def __init__(
        self,
        config: AppConfig,
        asr_backend: ASRBackend,
        llm_backend: LLMBackend,
        mode_manager: ModeManager | None = None,
        command_router: CommandRouter | None = None,
        response_processor: ResponseProcessor | None = None,
        guide_agent: GuideAgent | None = None,
    ) -> None:
        self.config = config
        self.asr_backend = asr_backend
        self.llm_backend = llm_backend
        self.mode_manager = mode_manager or ModeManager(
            InteractionMode(config.interaction.default_mode)
        )
        self.command_router = command_router or CommandRouter(config.command)
        self.response_processor = response_processor or ResponseProcessor(
            config.llm,
            config.interaction.max_history_turns,
        )
        self.guide_agent = guide_agent or GuideAgent(llm_backend)

    async def process(self, request: AudioRequest) -> AssistantResponse:
        started = time.perf_counter()
        metadata: dict[str, Any] = {}
        transcript = ""
        session: SessionState | None = None
        audio: AudioData | None = None
        LOGGER.info(
            "request started session=%s path=%s signal=%s",
            request.session_id,
            request.audio_path,
            request.signal.value,
        )
        try:
            if request.signal == ControlSignal.CANCEL:
                return self._finish(
                    AssistantResponse(
                        success=True,
                        mode=InteractionMode.COMMAND.value,
                        transcript="",
                        display_text="好的，已取消。",
                        spoken_text="好的，已取消。",
                        action="request.cancel",
                    ),
                    started,
                )

            audio = load_wav(request.audio_path, self.config.audio)
            metadata["audio_duration_seconds"] = round(
                audio.duration_seconds, 3
            )
            asr_started = time.perf_counter()
            try:
                transcript = (await self.asr_backend.transcribe(audio)).strip()
            except ASRError:
                raise
            except Exception as exc:
                raise ASRError("ASR backend failed") from exc
            finally:
                metadata["asr_latency_ms"] = round(
                    (time.perf_counter() - asr_started) * 1000, 2
                )
            LOGGER.info(
                "recognized session=%s duration=%.3f transcript=%r asr_ms=%.2f",
                request.session_id,
                audio.duration_seconds,
                transcript,
                metadata["asr_latency_ms"],
            )
            if not transcript:
                return self._finish(
                    AssistantResponse(
                        success=False,
                        mode=InteractionMode.COMMAND.value,
                        transcript="",
                        display_text="没有听清，请再说一次。",
                        spoken_text="没有听清，请再说一次。",
                        emotion="confused",
                        metadata=metadata,
                        error="empty_transcript",
                    ),
                    started,
                )

            session = self.mode_manager.get_session(request.session_id)

            switch_response = self._handle_external_switch(
                request.signal, transcript, session, metadata
            )
            if switch_response:
                return self._finish(switch_response, started)

            normalized = normalize_text(transcript)
            global_match = self.command_router.match(normalized, global_only=True)
            if global_match and not global_match.ambiguous:
                return self._finish(
                    self._handle_match(
                        global_match, transcript, session, metadata
                    ),
                    started,
                )

            forced_mode = {
                ControlSignal.COMMAND_MODE: InteractionMode.COMMAND,
                ControlSignal.LLM_MODE: InteractionMode.LLM,
            }.get(request.signal)

            normal_match = self.command_router.match(normalized)
            # Enter/exit utterances are control intents and must never reach an LLM.
            if (
                normal_match
                and not normal_match.ambiguous
                and normal_match.definition.command_id == "enter_llm"
            ):
                return self._finish(
                    self._handle_match(
                        normal_match, transcript, session, metadata
                    ),
                    started,
                )

            selected_mode = forced_mode or session.mode
            LOGGER.info(
                "routing session=%s session_mode=%s selected_mode=%s",
                request.session_id,
                session.mode.value,
                selected_mode.value,
            )
            if selected_mode == InteractionMode.LLM:
                return self._finish(
                    await self._run_llm(
                        transcript, session, metadata
                    ),
                    started,
                )

            if normal_match:
                if normal_match.ambiguous:
                    metadata["command_score"] = round(normal_match.score, 2)
                    metadata["command_ambiguous"] = True
                    return self._finish(
                        AssistantResponse(
                            success=True,
                            mode=InteractionMode.COMMAND.value,
                            transcript=transcript,
                            display_text="指令不够明确，请换一种说法。",
                            spoken_text="指令不够明确，请换一种说法。",
                            emotion="confused",
                            metadata=metadata,
                        ),
                        started,
                    )
                return self._finish(
                    self._handle_match(
                        normal_match, transcript, session, metadata
                    ),
                    started,
                )

            fixed_qa = match_fixed_qa(normalized, session)
            if fixed_qa:
                session.last_assistant_response = fixed_qa.display_text
                return self._finish(
                    AssistantResponse(
                        success=True,
                        mode=InteractionMode.COMMAND.value,
                        transcript=transcript,
                        display_text=fixed_qa.display_text,
                        spoken_text=fixed_qa.spoken_text,
                        emotion=fixed_qa.emotion,
                        metadata=metadata,
                    ),
                    started,
                )

            unmatched_behavior = (
                self.config.interaction.unmatched_command_behavior
            )
            if unmatched_behavior == "guide":
                return self._finish(
                    await self._run_guide(transcript, session, metadata),
                    started,
                )
            if unmatched_behavior == "llm":
                return self._finish(
                    await self._run_llm(transcript, session, metadata),
                    started,
                )
            return self._finish(
                AssistantResponse(
                    success=True,
                    mode=InteractionMode.COMMAND.value,
                    transcript=transcript,
                    display_text=UNMATCHED_PROMPT,
                    spoken_text=UNMATCHED_PROMPT,
                    metadata=metadata,
                ),
                started,
            )
        except AudioProcessingError as exc:
            return self._error(
                exc.code, request, transcript, metadata, started, session
            )
        except ASRError:
            return self._error(
                "asr_error", request, transcript, metadata, started, session
            )
        except LLMError as exc:
            LOGGER.error(
                "llm failed session=%s code=%s detail=%s",
                request.session_id,
                exc.code,
                exc,
            )
            return self._error(
                exc.code, request, transcript, metadata, started, session
            )
        except Exception:
            LOGGER.exception("unexpected pipeline error session=%s", request.session_id)
            return self._error(
                "internal_error", request, transcript, metadata, started, session
            )

    def _handle_external_switch(
        self,
        signal: ControlSignal,
        transcript: str,
        session: SessionState,
        metadata: dict[str, Any],
    ) -> AssistantResponse | None:
        if signal == ControlSignal.ENTER_LLM_MODE:
            self.mode_manager.enter_llm(session.session_id)
            return AssistantResponse(
                True,
                InteractionMode.COMMAND.value,
                transcript,
                "已进入聊天模式。",
                "已进入聊天模式。",
                action="mode.enter_llm",
                metadata=metadata,
            )
        if signal == ControlSignal.EXIT_LLM_MODE:
            self.mode_manager.exit_llm(session.session_id)
            return AssistantResponse(
                True,
                InteractionMode.COMMAND.value,
                transcript,
                "已退出聊天模式。",
                "已退出聊天模式。",
                action="mode.exit_llm",
                metadata=metadata,
            )
        return None

    def _handle_match(
        self,
        match: CommandMatch,
        transcript: str,
        session: SessionState,
        metadata: dict[str, Any],
    ) -> AssistantResponse:
        metadata["command_score"] = round(match.score, 2)
        metadata["command_id"] = match.definition.command_id
        LOGGER.info(
            "command matched session=%s command=%s score=%.2f",
            session.session_id,
            match.definition.command_id,
            match.score,
        )
        return handle_command(
            match.definition,
            transcript,
            session,
            self.mode_manager,
            metadata,
        )

    async def _run_llm(
        self,
        transcript: str,
        session: SessionState,
        metadata: dict[str, Any],
    ) -> AssistantResponse:
        llm_started = time.perf_counter()
        metadata["llm_role"] = "conversation"
        LOGGER.info("calling llm session=%s", session.session_id)
        try:
            reply = await self.llm_backend.generate(transcript, session)
        except LLMError:
            raise
        except Exception as exc:
            raise LLMError("LLM backend failed") from exc
        finally:
            metadata["llm_latency_ms"] = round(
                (time.perf_counter() - llm_started) * 1000, 2
            )
        processed = self.response_processor.process(reply, transcript, session)
        return AssistantResponse(
            success=True,
            mode=InteractionMode.LLM.value,
            transcript=transcript,
            display_text=processed.display_text,
            spoken_text=processed.spoken_text,
            emotion=processed.emotion,
            metadata=metadata,
        )

    async def _run_guide(
        self,
        transcript: str,
        session: SessionState,
        metadata: dict[str, Any],
    ) -> AssistantResponse:
        llm_started = time.perf_counter()
        metadata["llm_role"] = "guide"
        metadata["session_mode"] = session.mode.value
        LOGGER.info("calling guide llm session=%s", session.session_id)
        try:
            reply = await self.guide_agent.answer(transcript, session)
        except LLMError:
            raise
        except Exception as exc:
            raise LLMError("Guide LLM backend failed") from exc
        finally:
            metadata["llm_latency_ms"] = round(
                (time.perf_counter() - llm_started) * 1000, 2
            )
        processed = self.response_processor.process(
            reply,
            transcript,
            session,
            update_history=False,
        )
        return AssistantResponse(
            success=True,
            mode=InteractionMode.LLM.value,
            transcript=transcript,
            display_text=processed.display_text,
            spoken_text=processed.spoken_text,
            emotion=processed.emotion,
            metadata=metadata,
        )

    @staticmethod
    def _finish(
        response: AssistantResponse, started: float
    ) -> AssistantResponse:
        response.metadata["total_latency_ms"] = round(
            (time.perf_counter() - started) * 1000, 2
        )
        LOGGER.info(
            "request complete mode=%s success=%s total_ms=%.2f",
            response.mode,
            response.success,
            response.metadata["total_latency_ms"],
        )
        return response

    def _error(
        self,
        code: str,
        request: AudioRequest,
        transcript: str,
        metadata: dict[str, Any],
        started: float,
        session: SessionState | None,
    ) -> AssistantResponse:
        LOGGER.error(
            "request failed session=%s error_type=%s", request.session_id, code
        )
        mode = session.mode.value if session else InteractionMode.COMMAND.value
        user_messages = {
            "llm_api_key_missing": "LLM 服务尚未配置，请检查 API Key。",
            "llm_authentication_error": "LLM 鉴权失败，请检查 API Key。",
            "llm_model_not_found": "未找到配置的 LLM 模型，请检查模型名称。",
            "llm_rate_limited": "LLM 请求过于频繁，请稍后重试。",
            "llm_timeout": "LLM 响应超时，请稍后重试。",
            "llm_connection_error": "暂时无法连接 LLM 服务，请稍后重试。",
        }
        response_text = user_messages.get(code, "处理失败，请稍后重试。")
        return self._finish(
            AssistantResponse(
                success=False,
                mode=mode,
                transcript=transcript,
                display_text=response_text,
                spoken_text=response_text,
                emotion="error",
                metadata=metadata,
                error=code,
            ),
            started,
        )
