# AI Bot 持续感知服务

这是一个面向 Bot 硬件的轻量多模态感知与功能控制进程。它持续接收音频和图像，
产生结构化事件，并把事件路由为聊天、拍照和语言切换命令：

```text
TCP PCM → VAD → ASR → 关键词/聊天路由 ┐
                                       ├→ ApplicationController → WebSocket
HTTP JPEG → MediaPipe → 稳定手势 ──────┘                       ├→ 功能程序
Open Palm → 异步等待 2 秒 → 最新 JPEG → AI 照片处理程序         └→ 网站
```

未进入聊天时，普通转写只作为 `speech.transcribed` 事件保留而不触发功能；进入
聊天后，普通转写会成为 `command.chat.ask`。网站和其他程序可以通过
`ws://<bot>:8090/api/events` 实时消费事件。

文档：

- [App 完整工作 Pipeline](docs/app-pipeline.md)：启动、信号来源、传输过程、
  最终输出和逐文件职责；
- [持续感知 Runtime](docs/perception-runtime.md)：核心运行策略和事件格式。

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

打开 Vision 实时测试窗口：

```bash
python -m app test
```

## 功能团队接入

默认 API 监听 `8090`：

```text
GET /api/health
GET /api/state
GET /api/events?after_sequence=0
WS  /api/events
POST /api/results
GET /api/photos/{capture_id}.jpg
```

聊天程序订阅 `command.chat.start`、`command.chat.ask` 和
`command.chat.stop`；网站订阅 `language.changed`、`photo.captured`、
`photo.printed`、`photo.print_failed`、`photo.completed` 以及聊天程序返回的
结果事件。事件都带有 `event_id`、
`sequence` 和 `schema_version`，消费方应按 `event_id` 去重。
功能程序完成任务后向 `/api/results` 提交 `event_type`、`session_id` 和
`payload`，结果会进入同一事件流并实时推送给网站。

AI 照片程序的 multipart HTTP 地址配置在
`application.photo_processor_url`。请求包含 `metadata` JSON、`image` JPEG 和
`Idempotency-Key: <capture_id>`。如果暂时不配置地址，照片仍会原子保存到
`application.photo_output_dir` 并产生可供网站获取的事件。

该模式只启动 Vision 接收端，不启动 Audio Runtime。窗口显示最新画面、单帧手势、
置信度和稳定事件。按 `q`、`Esc` 或关闭窗口退出。可通过 `--scale 1.5` 调整
窗口尺寸。

覆盖监听地址：

```bash
python -m app \
  --audio-host 192.168.1.10 --audio-port 8080 \
  --vision-host 192.168.1.10 --vision-port 8081
```

每个 ASR 转写都会以 JSON 写入控制台和 `logs/perception.log`，包括未命中关键词
并被丢弃的普通文本。有效感知事件会另外输出一条事件日志。事件缓存在进程内，
不会保存原始 PCM、WAV 或 RGB 历史；触发拍照打印后会保存对应 JPEG。

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

[config.yaml](config.yaml) 包含当前运行时使用的十部分：

- `audio`：采样率；
- `asr`：Faster Whisper 模型和推理设备；
- `hardware`：监听地址、端口和开关；
- `vad`：语音检测与断句阈值；
- `keywords`：唤醒、模式切换、写信和拍照打印关键词；
- `perception`：事件缓存、语句队列和视觉 FPS；
- `vision`：MediaPipe 模型、尺寸和稳定检测策略。
- `application`：默认语言、1 秒拍照、照片目录和下游处理地址；
- `printer`：打印机地址、384 像素图像参数、超时和 2 秒冷却；
- `api`：HTTP/WebSocket 集成接口。

尚未确定的语音入口可以添加到 `keywords.custom`。例如
`music.open: [打开音乐]` 会输出 `command.music.open`，不需要修改 ASR。

当前是 ASR 后关键词检测，因此每段有效人声都会执行一次 ASR。关键词负责开启或
退出功能；聊天模式中的普通转写会被路由给聊天处理程序。

识别到“拍照”“照相”“打印照片”“photo”“take a photo”等短语，或稳定检测到
`Victory` 手势后，会启动同一个照片打印流程：等待 1 秒，取届时最新相机帧，
灰度化并像素化，然后调用 `{printer.base_url}/printer/image`。`Open_Palm`
用于切换中英文。打印任务和随后的 2 秒冷却期间会忽略重复触发，不建立队列。

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
- 视觉手势稳定触发和重新武装；
- 打印图像转换、位图协议、触发去重和失败恢复。

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
├── control/
├── events/
├── features/
├── api/
├── vision/
├── transport/
└── runtime/
```

后续功能应消费 `command.*` 事件，不要让 LLM 或业务逻辑反向依赖硬件协议、
VAD、ASR 或视觉模型。
