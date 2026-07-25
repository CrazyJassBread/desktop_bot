# Desktop Bot

Desktop Bot 是一个面向桌面机器人硬件的持续感知与交互服务。它接收麦克风音频和
摄像头图像，完成语音活动检测、语音识别、关键词/会话路由、手势识别、LLM
问答与写信，并通过 HTTP/WebSocket API 向其他程序发布结构化事件。

## 主要功能

- 音频：接收 Bot 的 TCP PCM，或在 `mic-test` 模式下使用电脑麦克风。
- 语音处理：Silero VAD 断句，Faster Whisper 中文 ASR。
- LLM：支持 OpenAI-compatible API、智能问答和写信会话。
- 信件：LLM 完成写信后生成 Slowly 风格的黑白信笺，添加收件人、
  像素邮票、日期邮戳和用户署名，并自动使用热敏打印机输出。
- 视觉：接收 Bot 上传的 JPEG，使用 MediaPipe 识别稳定手势。
- 照片：语音或 `Victory` 手势触发延迟拍照、图像处理和热敏打印。
- 表情：把监听、生成、打印、完成和失败状态转换为 Bot OLED 表情。
- API：提供健康状态、应用状态、事件历史、WebSocket 事件流和照片访问。
- 日志：感知事件与 LLM 会话分别写入独立日志。

核心数据流：

```text
Bot TCP PCM / 电脑麦克风
        → Silero VAD → Faster Whisper → 关键词/LLM 会话
                                              │
Bot HTTP JPEG → MediaPipe → 稳定手势 ─────────┤
                                              ↓
                                ApplicationController
                                              ↓
                              Event API / 照片 / 打印机
```

## 环境要求

- Python 3.11+
- macOS、Linux 或 Windows
- 使用电脑麦克风时，需要允许终端或 Python 访问麦克风
- 使用视觉功能时，需要 MediaPipe 手势模型
- 默认 ASR 配置需要本地 Faster Whisper 模型

创建环境并安装依赖：

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

安装测试依赖：

```bash
pip install -r requirements-dev.txt
```

默认配置期望以下模型文件存在：

```text
models/faster-whisper-small/
models/gesture_recognizer.task
```

模型文件不会提交到 Git。可以在 `config/app.yaml` 中修改 ASR 和手势模型路径。

## 配置

公开配置位于 `config/app.yaml`，主要包括：

- `audio`、`vad`、`asr`：采样率、断句和语音识别；
- `hardware`：Bot 音频和图像监听地址；
- `vision`：图像尺寸、手势模型和稳定检测参数；
- `keywords`：唤醒词、聊天、拍照和自定义命令；
- `llm`：LLM 开关、会话限制和语音控制短语；
- `application`、`printer`：照片处理和打印；
- `bot_expression`：Bot ESP 地址、表情接口和短动作时长；
- `letter`：信件预览、字体、像素邮票、邮戳和自动打印；
- `api`：HTTP/WebSocket 服务。

### 配置 LLM

复制私密配置模板：

```bash
cp config/llm.example.yaml config/llm.yaml
```

填写 OpenAI-compatible 服务信息：

```yaml
base_url: https://provider.example/v1
model: provider-model-name
api_key: your-api-key
```

然后确认 `config/app.yaml` 中：

```yaml
llm:
  enabled: true
```

`config/llm.yaml` 已被 Git 忽略。不要把 API key 写入公开配置、代码或日志。

### 配置 Bot 表情

Bot 表情通过 `POST /oled/expression` 发送。修改 ESP 地址：

```yaml
bot_expression:
  enabled: true
  base_url: http://10.76.11.223
  endpoint: /oled/expression
  timeout_seconds: 5
  action_duration_seconds: 2
```

`happy`、`angry`、`tired`、`default` 用于持续状态；`blink`、`laugh`、
`confused` 是短动作，播放结束后会恢复到当时的持续状态。网络发送失败只记录
日志，不会中断语音、视觉或打印流程。

默认状态转换：

- 唤醒、进入会话、触发拍照：`blink`，随后保持 `happy`；
- ASR、LLM 生成、照片处理、信件渲染或打印：保持 `tired`；
- 问答、照片或信件成功完成：`laugh`，随后恢复 `default`；
- ASR、LLM、照片或打印失败：`confused`，随后保持 `angry`；
- 退出或取消会话：恢复 `default`。

## 运行方式

### 完整 Bot 模式

启动音频、视觉和 API：

```bash
python -m app
```

仅启动一个输入通道：

```bash
python -m app --audio-only
python -m app --vision-only
```

覆盖监听地址或端口：

```bash
python -m app \
  --audio-host 0.0.0.0 --audio-port 8081 \
  --vision-host 0.0.0.0 --vision-port 8082
```

### 使用电脑麦克风测试 LLM

列出输入设备：

```bash
python -m app mic-test --list-input-devices
```

使用系统默认麦克风：

```bash
python -m app mic-test
```

按编号或名称选择设备：

```bash
python -m app mic-test --input-device 2
python -m app mic-test --input-device "MacBook Microphone"
```

`mic-test` 只启用音频链路，不监听 Bot 音频端口，也不启动视觉输入。按
`Ctrl+C` 停止。

### Vision 实时测试

```bash
python -m app test
python -m app test --vision-port 9000 --scale 1.5
```

Bot 向显示的 `/upload` 地址发送 JPEG。按 `q`、`Esc` 或关闭窗口退出。

## 语音交互

LLM 问答流程：

```text
你：进入问答模式
你：请介绍强化学习的基本概念
你：小A，请回答
```

取消问答：

```text
你：小A，取消问答
```

写信流程：

```text
你：我要给小明写信
你：正文：谢谢你最近的帮助
你：小A，完成写信
```

写信完成后，系统会自动：

1. 将 LLM 正文排版成 384 点宽的黑白信笺；
2. 在左上角显示收件人，在右上角添加随机像素邮票和日期邮戳；
3. 在正文末尾显示 `llm.user_nickname` 作为署名；
4. 将 PNG 预览保存到 `generated_letters/`；
5. 使用独立的清晰文字打印通道发送到热敏打印机。

可在 `config/app.yaml` 的 `letter` 部分关闭自动打印、固定邮票主题、
隐藏署名或设置 Linux 上的中文字体路径。信件打印不会使用照片的像素化和
抖动参数。

取消写信：

```text
你：小A，取消写信
```

LLM 会话控制短语要求单独说出。若 ASR 把多句话合并为一个长句，请降低环境噪声、
靠近麦克风，或调整 `config/app.yaml` 中的 VAD 阈值和最大语句时长。

项目还保留一套不调用内置 LLM 的普通聊天事件：

- `进入聊天模式`、`开始聊天`、`智能问答`：产生 `command.chat.start`；
- `退出聊天模式`、`结束聊天`、`返回普通模式`：产生
  `command.chat.stop`。

普通聊天事件需要外部聊天程序消费；它与 `进入问答模式` 启动的内置 LLM 会话
不同。

## Bot 输入协议

音频：

- TCP `0.0.0.0:8081`
- 16 kHz、单声道、signed 16-bit little-endian PCM
- 每个 VAD 帧 512 samples

图像：

- HTTP `POST http://0.0.0.0:8082/upload`
- `Content-Type: image/jpeg`
- 默认尺寸 640 × 480
- 默认最大 2 MiB
- 接收端只保留最新一张待处理图片

固件输入可以分别用以下诊断工具验证：

```bash
python -m scripts.receive_microphone
python -m scripts.receive_images
```

## Web MVP

网页端位于 `integrations/ai-hub-os-web`，要求 Node.js 22 或更高版本。它提供
用户注册、登录、SQLite 信件持久化，以及收件箱和已发送信件查看。

```bash
cd integrations/ai-hub-os-web
cp .env.example .env.local
set -a
source .env.local
set +a
npm run dev
```

默认页面地址为 `http://127.0.0.1:18000`，SQLite 数据库位于
`integrations/ai-hub-os-web/data/letters.sqlite`。

App 完成语音写信后，会将信件同步到网页数据库。发件人和收件人须先注册；
启动 App 前，将 `AI_HUB_SENDER_EMAIL` 设置为发件人的注册邮箱，并让
`AI_HUB_BRIDGE_TOKEN` 与网页端使用相同值。同一封信只保存一条记录，但会同时
出现在发件人的“已发送”和收件人的“收件”空间。完整配置和接口说明参见
`integrations/ai-hub-os-web/README.md`。

当前端口分配：

- `8081`：Bot 麦克风 TCP PCM；
- `8082`：Bot 图像 HTTP 上传；
- `8090`：Desktop Bot HTTP/WebSocket API；
- `18000`：AI Hub OS Web。

## API

默认 API 地址为 `http://127.0.0.1:8090`：

```text
GET  /api/health
GET  /api/state
GET  /api/events?after_sequence=0
WS   /api/events
POST /api/results
GET  /api/photos/{capture_id}.jpg
GET  /api/letters/{letter_id}.png
```

WebSocket 和事件历史返回统一的 `PerceptionEvent`，包含 `event_id`、
`sequence`、`event_type`、`source`、`session_id` 和 `payload`。

外部功能程序完成任务后，可以提交结果：

```bash
curl -X POST http://127.0.0.1:8090/api/results \
  -H 'Content-Type: application/json' \
  -d '{
    "event_type": "external.completed",
    "session_id": "bot",
    "payload": {"status": "ok"}
  }'
```

## 日志与排错

```text
logs/perception.log  ASR 转写、关键词、感知事件和控制器事件
logs/llm.log         LLM 会话、缓存文本、生成结果和错误
```

常见问题：

- `llm.session_rejected / disabled`：将 `llm.enabled` 设置为 `true`。
- `llm.session_rejected / not_configured`：创建并填写
  `config/llm.yaml`。
- 麦克风列表为空：检查系统输入设备和终端麦克风权限。
- 命令经常识别失败：检查 `transcript`，并调整 VAD 或更换输入设备。
- 视觉模型启动失败：检查 `vision.gesture_model` 指向的文件。
- 端口占用：修改 `hardware` 或 `api` 下的端口。

## 测试

```bash
.venv/bin/python -m pytest -q
```

测试覆盖配置校验、VAD、麦克风输入、ASR/关键词路由、LLM 会话、运行时、照片和
打印机客户端。测试使用模拟音频和模型，不会调用真实 LLM。

## 项目结构

```text
app/
├── api/          HTTP 与 WebSocket API
├── asr/          Faster Whisper 和测试后端
├── audio/        VAD 与流式音频断句
├── control/      应用状态和事件路由
├── detection/    关键词检测
├── features/     照片和热敏打印
├── llm/          模式检测、会话和 API 客户端
├── runtime/      持续感知运行时
├── transport/    Bot 网络输入与电脑麦克风
└── vision/       图像解码、手势识别和稳定器

config/           公开配置和私密配置模板
scripts/          硬件协议诊断与 Vision 测试
tests/            自动化测试
models/           本地模型（不提交）
logs/             运行日志（不提交）
```
