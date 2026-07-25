# 持续感知 Runtime

当前生产入口是：

```bash
python -m app
```

它只运行两条长期任务：

```text
TCP PCM → Silero VAD → 完整语句 → Faster Whisper → KeywordDetector
                                                        ↓
                                                   EventCache

HTTP JPEG → 最新帧槽（容量 1）→ MediaPipe → GestureStabilizer
                                                   ↓
                                              EventCache
```

## 音频

- 输入固定为 16 kHz、单声道、signed 16-bit little-endian PCM；
- Silero 使用 512-sample 帧；
- 静音和过短声音不进入 ASR；
- ASR 直接读取内存中的 `AudioData`，不生成临时 WAV；
- 外部 VAD 已经完成语句切分，所以硬件入口关闭 Whisper 内部 VAD；
- 每个 ASR 结果都会输出到 CLI 和 `logs/perception.log`，无论是否命中关键词；
- 每条非空转写产生 `speech.transcribed`；命中 `keywords` 时另外产生显式意图；
- 聊天开启后，未命中关键词的转写会被控制器转换为 `command.chat.ask`；
- ASR 较慢时，完整语句通过小型有界队列隔离，队列满时丢弃整段语句，不拼接
  断裂音频。

音频事件示例：

```json
{
  "event_type": "feature.write_letter",
  "source": "audio",
  "session_id": "bot",
  "payload": {
    "keyword": "帮我写信",
    "transcript": "小A，帮我写信，内容是明天见",
    "payload_text": "内容是明天见",
    "audio_duration_seconds": 1.28
  }
}
```

`payload_text` 当前是去除匹配关键词后的标准化文本。未来接入写信功能时，可以再
加入更精细的参数提取。

## 视觉

- 接收端只保留最新的一张待处理 JPEG；
- `perception.vision_max_fps` 限制模型推理频率；
- 不保留历史 RGB 帧；
- `Victory` 稳定后产生 `gesture.victory`，控制器切换中英文；
- `Thumb_Up` 稳定后产生 `gesture.thumb_up`；
- `Open_Palm` 稳定后启动独立的 2 秒拍照任务，任务取得届时最新的 JPEG；
- 手势持续保持时只触发一次，消失达到 `release_frames` 后重新允许触发。

## 缓存

`EventCache` 只保存结构化事件：

- 数量上限由 `perception.event_cache_capacity` 控制；
- TTL 由 `perception.event_ttl_seconds` 控制；
- 默认不保存 PCM、WAV、JPEG 或 RGB 历史；
- Runtime 日志会以 JSON 输出每个有效事件。

当前缓存只在进程内存在。LLM、写信、照片处理和设备动作应消费 `command.*`
事件，网站可通过 `/api/events` 的 WebSocket 或事件历史接口接入。

## 健康指标

`PerceptionDaemon.health()` 包含：

- 收到的音频帧数和完整语句数；
- 丢弃的完整语句数；
- ASR 调用、错误和关键词命中次数；
- 收到及处理的视觉帧数；
- 视觉错误和稳定事件数；
- 当前缓存数量与语句队列长度。
