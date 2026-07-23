# Worklog

## 2026-07-23：MVP

- 检查仓库：项目没有既有应用主流程，保留原有 `docs` / `tests` 目录并按目标结构搭建。
- 移除测试源码中的硬编码 API Key，外部服务测试改用环境变量且默认跳过。
- 完成 PCM WAV 校验、单声道转换、16 kHz 重采样、float32 转换和轻量归一化。
- 完成 Mock / faster-whisper ASR 接口及 Mock / OpenAI 兼容 LLM 接口。
- 完成命令、固定问答、三级匹配、歧义保护、session 模式和历史隔离。
- 完成 Pipeline、回答压缩、结构化错误、耗时 metadata、日志、CLI 和输出适配器。
- 增加双向传输抽象，为 WebSocket、HTTP、串口与 Bot SDK 接入预留接口。
- 自动化测试：37 passed，1 skipped（需要外部服务凭据的 live test）。
- 离线 smoke test：10/10 passed，包括损坏 WAV、空识别与 JSON 文件输出。
- faster-whisper 未安装、未下载模型，因此真实中文 ASR 未在本机验证；Mock 完整链路已验证。

## 2026-07-23：DeepSeek 兼容修复

- 将 DeepSeek 配置改为 `backend: openai_compatible` 与独立 `base_url`。
- 兼容旧配置：`llm.backend` 中的 HTTP(S) URL 自动作为 OpenAI 兼容地址。
- LLM 客户端改为按需初始化，固定命令不再因未设置 LLM API Key 而启动失败。
- 增加 URL backend 回归测试；当前测试结果为 38 passed、1 skipped。

## 2026-07-23：中文 Whisper ASR

- 安装 `faster-whisper 1.2.1` 及 CTranslate2 本地推理依赖。
- ASR 默认切换为 `faster_whisper`，固定中文 `zh` 与转写任务 `transcribe`。
- 增加可配置的 `asr.model_dir`，支持后续模型并存与其他 ASR backend。
- 通过 `hf-mirror.com` 下载 small 模型到 `models/faster-whisper-small/`；
  模型文件被 `.gitignore` 排除，不进入 Git。
- 默认配置指向明确的本地模型目录，运行时不需要再次联网下载。

## 2026-07-23：AUTO 指南智能体

- 新增 `guide` 未匹配策略并设为默认值。
- 新增独立 `GUIDE_SYSTEM_PROMPT` 与 `GuideAgent`。
- AUTO/COMMAND 下未匹配内容会获得一次性简短 LLM 回答，但 session 保持 COMMAND。
- 指南请求不读取、不写入持续聊天历史；成功回答仍可供“打印回答”使用。
- 响应 metadata 增加 `llm_role` 与 `session_mode`，便于观测路由效果。
- 新增 session/history 隔离回归测试；当前测试结果为 39 passed、1 skipped。

## 2026-07-23：LLM 错误诊断

- 确认指南调用失败原因为当前进程未设置 `DEEPSEEK_API_KEY`。
- LLM 错误细分为缺少密钥、鉴权、模型不存在、限流、超时、连接与请求错误。
- 结构化响应提供安全、可执行的提示，不记录 API Key 或远端响应正文。
- 当前测试结果为 40 passed、1 skipped。

## 2026-07-23：开发与调试文档

- 新增 `docs/development-guide.md`。
- 记录完整请求调用链、路由决策树、`app/` 目录职责和核心修改入口。
- 补充固定命令、ASR、LLM、传输层扩展步骤及常见故障排查顺序。

## 2026-07-23：多模态 Runtime

- 新增事件、状态、ServiceRegistry 和 DeviceAction 边界。
- 新增 MediaPipe 手势识别、640×480 JPEG 校验和最近 20 帧缓存。
- Victory 使用 3/5 帧投票切换 command / llm；游戏中的 Thumb_Up 使用 2/3
  帧投票触发 jump。
- 新增时间、跑酷游戏、信件和打印服务边界。
- 新增 AssistantRuntime 和 AssistantDaemon，Audio/Vision 使用独立有界队列。
- MediaPipe 0.10.35 与官方 gesture_recognizer.task 已完成本地 smoke test。

## 2026-07-23：VAD 和唤醒门控

- 新增 Silero v6 ONNX 流式后端，直接复用 faster-whisper 资产。
- 新增 2 秒休眠 PCM 缓存、5 秒唤醒等待和 45 秒有效语句上限。
- 新增 WakeWordBackend 和 Mock，“小A”真实声学模型尚未接入。
- 新增小A文本别名清理、只说唤醒词后的 follow-up 窗口。
- 项目配置默认关闭 LLM 多轮历史，同时保留 last_assistant_response。
- 自动化验证更新为 61 passed、1 skipped；离线 smoke test 10/10。

## 2026-07-23：文档重构

- 新增 `docs/project-overview.md`，统一记录功能、架构、配置和生产缺口。
- 重写设计说明和开发指南，使其覆盖 Audio、Vision、Runtime、Services、
  线上信件与打印。
- 明确区分已实现的 WakeWord 接口、尚未提供的真实“小A”模型，以及尚未实现的
  ASR 关键词门控。
