# desktop_bot × AI Hub OS 联动协议

本文以 `CrazyJassBread/desktop_bot` 当前 `main` 分支为准。AI Hub OS 不读取原始 PCM、
RGB 或 MediaPipe 结果，而是消费 desktop_bot 产生的结构化事件。

## 端口保留

| 端口 | 所属服务 | 协议 | 用途 |
| ---: | --- | --- | --- |
| 80 | ESP32 热敏打印机 | HTTP | `/printer/text`、`/printer/image`、`/printer/feed` |
| 8080 | desktop_bot Audio | TCP | 16 kHz、mono、signed s16le PCM |
| 8081 | desktop_bot Vision | HTTP | `POST /upload`，640×480 JPEG |
| 8090 | desktop_bot API | HTTP + WebSocket | health、state、events、results、photos |
| 18000 | AI Hub OS Web/API | HTTP | 前端、DeepSeek、意图路由、打印模板、照片回调 |

不要让 Web 服务占用 8080、8081 或 8090；这些端口专门保留给持续感知进程。

## 启动与配置

AI Hub OS `.env.local`：

```dotenv
DESKTOP_BOT_BASE_URL=http://127.0.0.1:8090
DESKTOP_BOT_WEBSOCKET_PATH=/api/events
DESKTOP_BOT_BRIDGE_ENABLED=true
```

desktop_bot `config.yaml`：

```yaml
application:
  photo_processor_url: "http://127.0.0.1:18000/api/v1/hardware/photo/process"

api:
  enabled: true
  host: 0.0.0.0
  port: 8090
  websocket_path: /api/events
```

如果两个服务不在同一台电脑，将 `127.0.0.1` 替换为对应服务所在电脑的局域网 IP，
并仅在可信局域网或反向代理鉴权后开放。

## 事件消费

AI Hub OS 后端连接：

```text
WS ws://<desktop_bot>:8090/api/events
GET http://<desktop_bot>:8090/api/events?after_sequence=<last_sequence>
```

WebSocket 负责实时事件；断线重连后通过 `after_sequence` 补取。每个事件按
`event_id` 去重，并记录 `schema_version`。

主要事件映射：

| desktop_bot 事件 | AI Hub OS 动作 |
| --- | --- |
| `command.chat.start` | 页面进入“聆听中” |
| `command.chat.ask` | 问题送入 DeepSeek，生成可打印回答 |
| `command.chat.stop` | 退出语音对话模式 |
| `command.letter.compose` | 进入 AI 写信或润色口语正文 |
| `command.language.set` / `language.changed` | 同步中英文状态 |
| `command.camera.capture_after` | 显示拍照倒计时状态 |
| `photo.captured` / `photo.completed` | Photo 2 Text 页面展示照片 |

## AI 结果回传

AI Hub OS 完成功能后调用：

```http
POST http://<desktop_bot>:8090/api/results
Content-Type: application/json
```

聊天示例：

```json
{
  "event_type": "chat.completed",
  "session_id": "bot",
  "payload": {
    "trigger_event_id": "source-event-id",
    "question": "为什么天空是蓝色的？",
    "answer": "……",
    "intent": "CHAT",
    "requires_confirmation": true,
    "printable": {
      "kind": "chat",
      "title": "MIMO 对话",
      "content": "……"
    },
    "provider": "deepseek",
    "model": "deepseek-v4-flash"
  }
}
```

`printable` 只是待确认内容。LLM 和 desktop_bot 事件不能直接调用打印机；必须由用户
在网页点击“确认并打印”或再次说出“开始打印”后，AI Hub OS 才调用 ESP32 打印接口。

## 照片下游回调

Open Palm 稳定触发后，desktop_bot 延迟 2 秒保存最新 JPEG，并以 multipart 上传：

```http
POST /api/v1/hardware/photo/process
Idempotency-Key: <capture_id>
Content-Type: multipart/form-data

metadata: JSON
image: image/jpeg
```

AI Hub OS 校验 JPEG、2 MiB 上限和 `capture_id`，最多在内存保留 20 张，返回可供
网页显示的 `image_url`。当前 DeepSeek V4 接口是文本模型，因此 OCR/视觉描述必须
另外接入视觉模型；不能把未识别图片伪装成真实 OCR 结果。

## 兼容入口

`POST /api/v1/perception/events` 仍保留给模拟器和旧版联调，但真实 desktop_bot 应优先
使用其 8090 WebSocket 事件流。桥接状态可通过：

```text
GET /api/v1/hardware/bridge/status
GET /api/v1/hardware/bridge/state
```

## 板载麦克风写信实测

音频方向是 ESP32-S3 主动连接运行 desktop_bot 的电脑，而不是浏览器直接连接板载麦克风：

```text
ESP32-S3 麦克风
  → TCP <电脑局域网 IP>:8080（16 kHz / mono / s16le PCM）
  → Silero VAD 自动断句
  → Faster Whisper ASR
  → desktop_bot :8090/api/events
  → AI Hub OS Bridge
  → DeepSeek 整理
  → Letter API
```

desktop_bot 可继续使用仓库默认的 `hardware.audio_*` 配置。为了让硬件在关键词层也
产生显式提交命令，可在其 `config.yaml` 增加：

```yaml
keywords:
  custom:
    letter.send:
      - over
      - 发送信件
      - 结束写信
      - 结束
```

即使暂时不增加该配置，AI Hub OS Bridge 也会消费 `speech.transcribed`，在写信
模式中识别相同结束词。

启动顺序：

```powershell
# desktop_bot 仓库
python -m app --audio-only

# AI Hub OS 仓库
npm start

# 另开一个终端观察真实板载麦克风联调
npm run test:hardware-mic
```

测试时依次对板载麦克风说：

1. “我要给妈妈写一封信”；
2. 一段信件正文；
3. “over”、“发送信件”或“结束”。

成功时会依次看到 `speech.transcribed`、`letter.listening`、
`letter.content_buffered`、`letter.sending`、`letter.sent`。同一次写信会话
使用固定 `Idempotency-Key`，结束词被重复识别也不会重复发信。

网页麦克风采用同样的状态机和结束词。结束词只会自动发送数字信件并创建收件人的
打印任务，不会让发件人设备立即误打印。

语音信件提交接口：

```http
POST /api/v1/letters/voice/send
Idempotency-Key: <voice-session-key>
Content-Type: application/json

{
  "sessionId": "bot",
  "recipient": "妈妈",
  "subject": "来自语音的一封信",
  "body": "语音识别得到的正文",
  "source": "desktop_bot_microphone"
}
```
