# 桌面 AI Bot 开发与调试指南

本文面向后续维护者。项目能力与状态见[项目总览](project-overview.md)，内部约束见
[设计说明](design.md)。

## 1. 开发环境

```bash
python3.11 -m venv .venv
source .venv/bin/activate

pip install -r requirements.txt
pip install -r requirements-dev.txt
pip install -r requirements-vision.txt
pip install -r requirements-vad.txt
```

模型目录：

```text
models/
├── faster-whisper-small/
└── gesture_recognizer.task
```

模型被 `.gitignore` 排除。Silero v6 ONNX 默认由 faster-whisper 包提供。

完整验证：

```bash
MPLCONFIGDIR=/tmp/ai-bot-matplotlib \
  .venv/bin/python -m pytest -q

.venv/bin/python -m scripts.smoke_test
.venv/bin/python -m compileall -q app tests
git diff --check
```

MediaPipe 在无图形上下文的 macOS 沙箱中可能无法创建 Metal/GL context；真实模型
smoke test 应在普通桌面进程或设备运行环境执行。

## 2. 当前入口

### 单次 WAV

```bash
python -m app.main \
  --wav records/el_0001.wav \
  --signal auto \
  --session bot-001 \
  --output console
```

CLI 会：

1. 读取 `config.yaml`；
2. 创建 ASR、LLM 和 Output；
3. 创建 `VoicePipeline`；
4. 处理一次 AudioRequest；
5. 输出 JSON 并退出。

CLI 不保留跨进程 session。

### 长驻 Runtime

代码入口是 `AssistantRuntime` 和 `AssistantDaemon`，但当前没有统一 CLI，也没有
真实硬件 Source。测试中通过有限 AsyncIterator 驱动：

```python
runtime = AssistantRuntime(config)
bridge = runtime.create_wake_voice_bridge(
    wake_backend,
    vad_backend,
    asr_backend,
    llm_backend,
)

daemon = AssistantDaemon(
    output,
    audio_source=audio_source,
    audio_bridge=bridge,
    image_source=image_source,
    vision_pipeline=vision_pipeline,
)

await daemon.run()
```

真实 Source 可以无限产生 frame，使 run() 一直运行。

## 3. 目录职责

```text
app/
├── main.py
├── config.py
├── schemas.py
├── core/
│   ├── events.py
│   ├── event_bus.py
│   ├── state.py
│   ├── service.py
│   └── service_registry.py
├── audio/
│   ├── loader.py
│   ├── preprocess.py
│   ├── validator.py
│   ├── stream_pipeline.py
│   ├── wake_gated_pipeline.py
│   ├── vad/
│   └── wake_word/
├── asr/
├── vision/
├── routing/
├── command/
├── llm/
├── services/
│   ├── time_service.py
│   ├── runner_game_service.py
│   ├── letter/
│   └── printing/
├── runtime/
│   ├── pipeline.py
│   ├── vision_pipeline.py
│   ├── assistant_runtime.py
│   ├── assistant_daemon.py
│   ├── interaction_coordinator.py
│   ├── vad_voice_bridge.py
│   └── wake_voice_bridge.py
├── transport/
├── remote/
└── output/
```

## 4. 常用修改入口

### 配置

修改 `app/config.py` 时必须同步：

1. Config dataclass；
2. `_validate()` 类型和范围；
3. `known_sections`；
4. `load_config()` 组装；
5. 根目录 `config.yaml`；
6. 测试和文档。

配置是严格模式，未知字段会被拒绝。

### Schema

`app/schemas.py` 是传输稳定边界。变更字段时同步：

- OutputAdapter；
- JSON 示例；
- Transport Adapter；
- Bot 端序列化；
- 测试。

不要把 NumPy 数组放进需要 JSON 序列化的 response。

### Voice 路由

`app/runtime/pipeline.py` 负责单次语音路由。不要在这里加入：

- 摄像头 SDK；
- 麦克风循环；
- 打印机 SDK；
- 远程平台；
- MediaPipe 初始化；
- 大段供应商逻辑。

修改优先级后至少运行 `tests/test_pipeline.py` 和全量测试。

### Vision

- JPEG 约束：`vision/image_loader.py`；
- 后端接口：`vision/base.py`；
- MediaPipe：`vision/mediapipe_gesture.py`；
- 20 帧缓存：`vision/frame_cache.py`；
- 防抖：`vision/gesture_stabilizer.py`；
- 编排：`runtime/vision_pipeline.py`。

MediaPipe 模型只初始化一次。生产摄像头应在 Source 层限帧，不要让 VisionPipeline
持有摄像头。

### VAD 和唤醒

- Silero ONNX：`audio/vad/silero_backend.py`；
- 通用 VAD 分段：`audio/stream_pipeline.py`；
- WakeWordBackend：`audio/wake_word/base.py`；
- 小A文本清理：`audio/wake_word/text.py`；
- 唤醒状态机：`audio/wake_gated_pipeline.py`；
- 语音桥：`runtime/wake_voice_bridge.py`。

Silero 流式输入必须是 16 kHz、512 samples、float32。

真实“小A”后端应实现 WakeWordBackend。若采用 ASR gate，建立独立 backend 或
gateway，不要把 ASR 依赖塞入通用 wake state machine。

### 服务

新增服务：

1. 继承 `BotService`；
2. 定义唯一 `service_id`；
3. 设置 priority；
4. `can_handle()` 只判断，不做副作用；
5. `handle()` 返回 ServiceResult；
6. 在 AssistantRuntime 注册；
7. 增加直接测试和 Runtime 集成测试。

设备操作必须转换为 DeviceAction。

## 5. 增加真实麦克风

实现：

```python
class BotMicrophoneSource(AudioFrameSource):
    def frames(self) -> AsyncIterator[np.ndarray]:
        ...
```

要求：

- 16 kHz；
- 单声道；
- float32；
- 每帧 512 samples；
- callback 不做推理；
- callback 线程安全地投递到 asyncio；
- 支持关闭；
- 队列溢出可观测。

Audio 不应静默丢帧。发生溢出时由 AssistantDaemon 重置当前语句。

## 6. 增加真实摄像头

实现：

```python
class BotCameraSource(ImageFrameSource):
    def images(self) -> AsyncIterator[ImageRequest]:
        ...
```

输入必须携带：

- JPEG bytes；
- content_type；
- session_id；
- captured_at_ms；
- 可选 request_id。

Vision queue 满时旧帧会被替换，这是为了实时性。摄像头 Source 仍应限制帧率，避免
无意义地解码和传输大量图像。

## 7. 增加“小A”真实后端

接口：

```python
class WakeWordBackend(ABC):
    async def process_frame(
        self,
        samples: np.ndarray,
        sample_rate: int,
    ) -> WakeWordResult:
        ...
```

至少测试：

- 安静环境不触发；
- 多说话人；
- 远距离；
- 电视和背景人声；
- “小爱”“小诶”等相似发音；
- 持续说话只触发一次；
- reset 后可再次触发。

### ASR gate 备选

如果不训练声学模型，可以：

```text
VAD utterance
→ ASR
→ strip_leading_wake_word()
→ 有前缀则路由，否则丢弃
```

此方案会对所有有效人声调用 ASR。目前没有实现，不应通过修改 Mock 来冒充。

## 8. 增加固定命令

在 `app/command/definitions.py` 增加 CommandDefinition：

- command_id；
- phrases；
- response；
- action；
- emotion；
- is_global。

如果需要 session 副作用，修改 handlers.py。增加完全匹配、包含匹配、模糊匹配、
歧义和误触发测试。

## 9. 增加 ASR / LLM 后端

### ASR

- 实现 `ASRBackend.transcribe(AudioData)`；
- 同步 SDK 使用工作线程；
- 将供应商异常转换为 ASRError；
- 模型惰性初始化；
- 不在 import 时下载模型；
- 在 main.py 工厂注册。

### LLM

- 实现 LLMBackend.generate；
- 支持 `include_history`；
- 返回 LLMReply；
- 使用稳定 LLMError code；
- 不记录密钥和完整远端正文；
- 在 main.py 工厂注册。

## 10. 信件平台接入

当前 RemoteEventGateway 不含网络服务。生产接入建议：

1. HTTP/WebSocket Adapter 验签；
2. 将外部请求转换为 LetterReceived；
3. RemoteEventGateway 调用 LetterService；
4. LetterService 根据 policy 创建 PrintJob；
5. PrintService 交给 PrinterAdapter；
6. 返回状态和 job_id。

在启用 auto_print 前必须完成：

- sender / bot 授权；
- event_id 幂等；
- 重放保护；
- 内容净化；
- 页数和每日任务限制；
- 打印失败重试策略。

## 11. 调试顺序

### Audio

1. Source 是否产生 512-sample frame；
2. wake score 是否达到阈值；
3. WakeAudioState；
4. VAD probability；
5. utterance 长度；
6. ASR latency / transcript；
7. 唤醒词前缀清理；
8. VoicePipeline 路由。

### Vision

1. JPEG 字节和 Content-Type；
2. 分辨率；
3. MediaPipe 模型路径；
4. detection label / score；
5. stabilizer history；
6. BotState active_service；
7. DeviceAction。

### LLM

1. 当前 voice mode；
2. history_enabled；
3. API key 环境变量存在但不要打印；
4. base_url 和 model；
5. LLMError code；
6. response JSON 和长度处理。

### 长驻 Runtime

查看 `AssistantDaemon.health()`：

```json
{
  "running": true,
  "audio_state": "sleeping",
  "audio_queue_size": 0,
  "image_queue_size": 0,
  "vision_cache_size": 20,
  "metrics": {}
}
```

Audio overflow 表示采集或消费速度不匹配；Vision dropped 是最新帧策略下的正常
指标，但持续过高意味着推理帧率需要下调。

## 12. 测试文件

| 文件 | 范围 |
| --- | --- |
| `test_audio.py` | WAV 和预处理 |
| `test_pipeline.py` | Voice 路由 |
| `test_routing.py` | 命令和 session |
| `test_llm.py` | LLM 和历史 |
| `test_output.py` | JSON 输出 |
| `test_config.py` | 配置 |
| `test_vad_stream.py` | VAD 和 Silero |
| `test_wake_word.py` | 小A门控、缓存、超时、Daemon |
| `test_vision.py` | JPEG、缓存、手势 |
| `test_services.py` | 时间、信件和打印 |

外部网络和真实硬件测试必须标记并默认跳过，不能让离线回归依赖凭据或设备。

## 13. 提交前检查

```bash
MPLCONFIGDIR=/tmp/ai-bot-matplotlib \
  .venv/bin/python -m pytest -q

.venv/bin/python -m scripts.smoke_test
.venv/bin/python -m compileall -q app tests
git diff --check
```

还应确认：

- 没有提交模型；
- 没有提交 API Key；
- 没有覆盖用户现有修改；
- 新配置已校验；
- 新 action 已记录；
- README、项目总览和设计文档状态一致。
