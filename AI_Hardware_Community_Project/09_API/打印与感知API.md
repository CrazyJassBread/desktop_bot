# 打印与感知 API

## 1. 服务与端口

| 服务 | 地址 | 用途 |
|---|---|---|
| AI Hub Web/API | `127.0.0.1:18000` | 前端、打印代理、感知事件网关 |
| ESP32 HTTP | `10.76.10.141:80` | 文本打印、位图打印、走纸 |
| desktop_bot Audio | `0.0.0.0:8080` | 16 kHz、mono、signed 16-bit little-endian PCM |
| desktop_bot Vision | `0.0.0.0:8081/upload` | 640×480 JPEG |

浏览器只访问 AI Hub API，不直接访问 ESP32。这样可规避 CORS、隐藏局域网设备地址，
并可在后端统一完成 GB2312 编码、位图生成、超时与审计。

## 2. 热敏打印

### 2.1 原生文字

`POST /api/v1/printer/text`

```json
{
  "text": "你好呀！",
  "language": "zh",
  "font": "B",
  "bold": true,
  "underline": false,
  "invert": false,
  "width": 1,
  "height": 1,
  "align": "center",
  "feedAfter": 3
}
```

- `language=en`：代理向 ESP32 `/printer/text` 发送 JSON。
- `language=zh`：代理编码为 GB2312，并以 `application/octet-stream` 发送；样式放在查询参数。

### 2.2 Letter 模板预览

`POST /api/v1/printer/letter/preview`

请求字段：`subject`、`body`、`sender`、`recipient`、`date`、`letterId`。

返回 `previewDataUrl`、`width=384`、动态 `height` 和 `bodyWasClipped`。该接口不访问
打印机，可用于写信页面实时预览。

### 2.3 Letter 实体打印

`POST /api/v1/printer/letter`

服务端将信件生成 384px 黑白 SVG，光栅化为 1-bit 行优先位图，然后调用：

```http
POST http://10.76.10.141/printer/image?width=384&height={height}
Content-Type: application/octet-stream
```

每行占 `ceil(width / 8)` 字节；黑点为 `1`，白点为 `0`，最高位对应最左像素。
兼容旧固件时，`404` 会回退到 `/print-image`。默认按硬件仓库测试方式旋转 180°；
可通过 `ESP_PRINTER_ROTATE_180=false` 关闭。

打印顺序为：

1. `POST /printer/feed?lines=3`，在信件顶部留下空白；
2. 按完整文本行生成逻辑页；第一页使用完整信头，续页使用紧凑信头，每页不超过 800px；
3. `POST /printer/feed?lines=4`，让底部完整离开打印头并方便撕纸。

分页发生在光栅化之前，只在完整文本行之间分页，不会从字形或边框中间截断。每个逻辑页
独立旋转和光栅化，页间不走纸；接口响应包含 `batchCount`、每页 `height` 和 `bitmapBytes`。

实体打印要求 `Idempotency-Key`。前端使用 Print Job ID 生成稳定键，重复请求会返回首次
结果而不再次消耗热敏纸。

## 3. 感知事件网关

### 3.1 上报事件

`POST /api/v1/perception/events`

请求与 desktop_bot 的 `PerceptionEvent.to_dict()` 一致：

```json
{
  "event_type": "feature.write_letter",
  "source": "audio",
  "timestamp_ms": 1784862000000,
  "session_id": "bot",
  "payload": {
    "keyword": "帮我写信",
    "transcript": "小A，帮我写信，内容是明天见",
    "payload_text": "内容是明天见",
    "audio_duration_seconds": 1.28
  }
}
```

支持事件：`wake`、`mode.enter_chat`、`mode.exit_chat`、`feature.write_letter`、
`mode.toggle`、`gesture.thumb_up`、`gesture.thumb_down`、`gesture.open_palm`。

### 3.2 查询状态和事件

- `GET /api/v1/perception/status`
- `GET /api/v1/perception/events?afterMs={timestamp}`

MVP 使用最多 100 条内存事件。生产环境应替换为 MQTT/Kafka/NATS 等消息层，同时保留
相同的业务事件结构。

## 4. desktop_bot 接入点

仓库现有 `_record(event)` 已集中处理音频和视觉事件。将
`integrations/desktop_bot/web_event_forwarder.py` 复制到 desktop_bot，并在缓存写入后
异步调用 `WebEventForwarder.send(event)`。只转发结构化 JSON，不上传原始音频或图像。

不修改 desktop_bot 源码也可以直接使用日志 Sidecar：

```powershell
# 终端 1：在 desktop_bot 仓库运行感知服务
python -m app

# 终端 2：在 AI Hub OS 仓库运行事件桥
python .\integrations\desktop_bot\log_event_bridge.py `
  --log "D:\path\to\desktop_bot\logs\perception.log"
```

Sidecar 只解析 `perception event {json}` 日志，普通 ASR 文本日志不会进入 Web 网关。
