# AI Bot 持续感知服务

这是一个面向 Bot 硬件的轻量多模态感知进程。当前只负责持续接收音频和图像，
产生有意义的结构化事件：

```text
TCP PCM → Silero VAD → Faster Whisper → 关键词检测 → EventCache
HTTP JPEG → 最新帧 → MediaPipe → 手势稳定检测 → EventCache
```

普通闲聊、静音、无效语音和未稳定的视觉结果不会进入缓存。LLM、写信和设备动作
将在后续作为 `PerceptionEvent` 消费者接入。

详细设计见 [持续感知 Runtime](docs/perception-runtime.md)。

## 环境

项目要求 Python 3.11+：

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

测试依赖：

```bash
pip install -r requirements-dev.txt
```

模型文件不提交到 Git。默认配置使用：

- `models/faster-whisper-small/`
- `models/gesture_recognizer.task`

## 运行

同时启动音频和视觉：

```bash
python -m app
```

兼容入口：

```bash
python -m app.hardware_main
```

只启动一个通道：

```bash
python -m app --audio-only
python -m app --vision-only
```

覆盖监听地址：

```bash
python -m app \
  --audio-host 192.168.1.10 --audio-port 8080 \
  --vision-host 192.168.1.10 --vision-port 8081
```

每个 ASR 转写都会以 JSON 写入控制台和 `logs/perception.log`，包括未命中关键词
并被丢弃的普通文本。有效感知事件会另外输出一条事件日志。事件缓存在进程内，
不会保存原始 PCM、WAV、JPEG 或 RGB 历史。

## 硬件协议

音频：

- TCP `0.0.0.0:8080`
- 16 kHz
- 单声道
- signed 16-bit little-endian PCM
- Silero 每帧 512 samples

视觉：

- HTTP `POST http://0.0.0.0:8081/upload`
- 请求体为原始 JPEG
- 默认尺寸严格为 640×480
- 接收端只保留最新一张待处理图片

固件协议可分别使用以下脚本验证：

```bash
python -m scripts.receive_microphone
python -m scripts.receive_images
```

## 配置

[config.yaml](config.yaml) 只包含当前运行时真正使用的七部分：

- `audio`：采样率；
- `asr`：Faster Whisper 模型和推理设备；
- `hardware`：监听地址、端口和开关；
- `vad`：语音检测与断句阈值；
- `keywords`：唤醒、模式切换和写信关键词；
- `perception`：事件缓存、语句队列和视觉 FPS；
- `vision`：MediaPipe 模型、尺寸和稳定检测策略。

当前是 ASR 后关键词检测，因此每段有效人声都会执行一次 ASR，但只有命中词才
留下事件。未来可以在相同事件边界前增加专用 KWS，降低常态计算量。

## 测试

```bash
.venv/bin/python -m pytest -q
```

测试覆盖：

- 配置边界；
- VAD 断句、静音过滤和最长语句；
- 关键词优先级与闲聊过滤；
- 事件缓存容量和 TTL；
- 音频事件主链路；
- 视觉手势稳定触发和重新武装。

## 目录

```text
app/
├── main.py
├── hardware_main.py
├── config.py
├── factories.py
├── models.py
├── perception_events.py
├── event_cache.py
├── asr/
├── audio/
│   └── vad/
├── detection/
├── vision/
├── transport/
└── runtime/
```

未来功能应消费 `PerceptionEvent`，不要让 LLM 或业务逻辑反向依赖硬件协议、
VAD、ASR 或视觉模型。
