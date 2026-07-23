# 桌面 AI Bot 设计说明

本文描述代码内部的稳定边界、状态归属、并发策略和扩展原则。功能与部署状态请先
阅读[项目总览](project-overview.md)。

## 1. 设计目标

- Audio、Vision、业务服务和硬件协议彼此解耦；
- 同一套核心既能处理单次文件，也能运行在长驻 Bot 进程中；
- 同步模型推理不阻塞 asyncio 事件循环；
- session 状态只能由明确的 Manager 持有；
- Pipeline 不直接控制硬件，只返回结构化 Action；
- 外部依赖、模型和硬件都能替换为 Mock；
- 无效输入和已知异常转换为稳定错误码。

## 2. 分层

```text
Source / Transport
    ↓
Audio / Vision input pipeline
    ↓
Runtime / Coordinator / State
    ↓
Voice routing or ServiceRegistry
    ↓
Response / DeviceAction
    ↓
Output / Bot adapter
```

### 输入层

- `AudioFrameSource`：持续产生 PCM frame；
- `ImageFrameSource`：持续产生 `ImageRequest`；
- `DuplexTransportAdapter`：未来 WebSocket、HTTP、串口或 Bot SDK；
- `RemoteEventGateway`：未来线上平台事件。

输入层只负责协议和硬件转换，不包含业务规则。

### 领域处理层

- `app/audio`：WAV、VAD、唤醒门控和语句缓冲；
- `app/asr`：语音转写后端；
- `app/vision`：JPEG、MediaPipe、缓存和手势稳定；
- `app/llm`：模型后端、Prompt、历史和回答后处理；
- `app/command` / `app/routing`：固定命令和语音模式路由。

### Runtime 层

- `AssistantRuntime`：依赖组合；
- `AssistantDaemon`：长驻 producer-consumer；
- `VoicePipeline`：单次语音业务路由；
- `VisionPipeline`：单次图片业务路由；
- `InteractionCoordinator`：全局手势与服务分发；
- `BotStateManager` / `ModeManager`：session 状态。

### 服务层

`BotService` 使用 `can_handle()` 和 `handle()`，由 `ServiceRegistry` 按优先级
调用。服务返回 `ServiceResult`，不直接控制设备。

### 输出层

`OutputAdapter` 接受 `AssistantResponse` 或 `VisionResponse`。设备执行由
`DeviceAction` 描述。

## 3. 状态归属

### Voice session

```text
SessionState
├── session_id
├── mode: command | llm
├── conversation_history
└── last_assistant_response
```

由 `ModeManager` 持有。项目配置默认关闭 LLM history，但字段保留以兼容需要多轮
对话的部署。

### Bot service state

```text
BotState
├── active_service
├── game_running
└── audio_busy
```

由 `BotStateManager` 持有。它与 `ModeManager` 共享 session_id，但不重复保存
语音模式。

### Wake audio state

```text
SLEEPING → ACTIVATED → CAPTURING → PROCESSING
```

由每个 `WakeGatedAudioPipeline` 实例持有，不能作为模块级全局变量。处理结束、
超时或溢出后回到 `SLEEPING`。

## 4. VoicePipeline

稳定输入是 `AudioRequest`，输出是 `AssistantResponse`：

```text
WAV
→ load / validate / preprocess
→ ASRBackend
→ strip leading wake word
→ global commands
→ signal and session mode
→ fixed command / fixed QA / GuideAgent / LLM
→ ResponseProcessor
→ AssistantResponse
```

路由优先级：

1. 外部 `cancel`；
2. 外部持续模式切换；
3. 全局停止、取消和退出聊天；
4. 单次强制模式；
5. 语音进入聊天模式；
6. session 当前模式；
7. 普通命令；
8. 固定问答；
9. 未匹配策略。

`llm.history_enabled=false` 时：

- LLMBackend 收到 `include_history=False`；
- ResponseProcessor 不写入 conversation_history；
- last_assistant_response 仍更新。

## 5. 长驻 Audio

### WakeWordBackend

这是帧级接口：

```python
async def process_frame(
    samples: np.ndarray,
    sample_rate: int,
) -> WakeWordResult
```

当前只有 Mock。真实模型和未来 `asr_gate` 都应作为新后端实现，不应把供应商逻辑
写入 `WakeGatedAudioPipeline`。

### WakeGatedAudioPipeline

休眠时：

- 更新有界 PCM ring buffer；
- 调用 WakeWordBackend；
- 不调用 VADBackend；
- 不调用 ASR。

唤醒后：

- 把唤醒前 frame 作为 VAD pre-roll；
- 使用 StreamingAudioPipeline 检测语音端点；
- 只有完整 AudioData 才交给 VoicePipeline；
- 唤醒等待超时只适用于 VAD 尚未进入 speech 的阶段；
- 已开始的语音由 max_utterance_seconds 限制。

### AssistantDaemon Audio queue

Audio frame 不能像图像一样随意丢弃。队列溢出时：

1. 记录 `audio_queue_overflow`；
2. 重置唤醒/VAD 当前状态；
3. 清空断裂 frame；
4. 从新 frame 重新监听。

这避免将断裂音频拼接成错误语句。

## 6. VisionPipeline

输入约束：

- Content-Type 为 JPEG；
- 字节数不超过配置；
- 实际解码格式必须为 JPEG；
- EXIF 方向归一；
- 尺寸严格为 640×480；
- 数据形状为 `(480, 640, 3)` uint8 RGB。

MediaPipe 后端：

- 模型只初始化一次；
- 使用 CPU delegate；
- 同步 recognize 放入工作线程；
- `None` 和低置信度结果被过滤；
- 异常转换为 VisionError。

手势策略：

- Victory：5 帧窗口中至少 3 次；
- Thumb_Up：3 帧窗口中至少 2 次；
- 触发后必须达到 release_frames 才重新 armed。

Vision queue 使用“最新帧优先”：队列满时淘汰旧的待处理图像。缓存只包含真正完成
推理的 20 帧。

## 7. InteractionCoordinator

优先处理全局手势：

```text
Victory
→ BotStateManager.toggle_voice_mode()
→ ui.show_mode
```

其他手势转换为 `gesture.stable` 事件，再交给 ServiceRegistry。游戏运行时
Thumb_Up 由 RunnerGameService 消费。

语音服务事件目前可通过 `handle_transcript()` 分发，但长驻音频桥仍以
VoicePipeline 为主，尚未把两套路由收敛为唯一入口。这是明确的后续重构点。

## 8. ServiceRegistry

服务注册时 service_id 必须唯一。dispatch 顺序由 priority 决定，第一个
`can_handle=True` 的服务获得事件。

服务不得：

- 直接访问硬件；
- 创建模块级 session 状态；
- 绕过 DeviceAction；
- 在 can_handle 中执行副作用；
- 将外部原始异常直接返回给用户。

## 9. 信件与打印

信件平台和打印机通过两个边界隔离：

```text
LetterService → PrintJob → PrintService → PrinterAdapter
```

`LetterService` 负责幂等、内容边界和打印策略。`PrintService` 负责有界队列和
job_id 去重。`PrinterAdapter` 才能调用真实打印机。

生产 Remote Adapter 必须在进入 LetterService 前完成：

- 身份认证；
- 请求签名；
- 时间戳和重放保护；
- bot_id 授权；
- 文件类型、大小和页数限制；
- 内容净化。

## 10. 错误边界

Voice：

- AudioProcessingError → 稳定音频错误码；
- ASRError → `asr_error`；
- LLMError → 对应 LLM code；
- 未知异常 → `internal_error`。

Vision：

- `unsupported_image_type`；
- `empty_image`；
- `image_too_large`；
- `invalid_image_dimensions`；
- `corrupted_image`；
- `gesture_model_not_found`；
- `gesture_inference_error`；
- `internal_error`。

错误响应不应包含密钥、完整远端响应或内部堆栈。

## 11. 并发原则

- Source 负责持续生产；
- Queue 负责隔离采集和推理速度；
- Audio 保完整性，Vision 保实时性；
- Whisper、MediaPipe、Silero 模型实例长期复用；
- 同一个模型实例默认单 worker；
- 同步推理通过 `asyncio.to_thread()`；
- 队列必须有界；
- 长驻任务必须支持结束、取消和资源关闭。

## 12. 当前未完成的设计闭环

- 真实 AudioFrameSource / ImageFrameSource；
- 真实“小A”模型或 ASR gate；
- 统一 `bot_main`；
- VoicePipeline 与 ServiceRegistry 的统一文本路由；
- DeviceAction 执行回执；
- WebSocket/HTTP 服务；
- 持久化；
- 游戏 UI；
- 真实打印；
- TTS。

新增生产功能时，应优先补齐这些 Adapter 和组合入口，而不是继续扩大单个 Pipeline。
