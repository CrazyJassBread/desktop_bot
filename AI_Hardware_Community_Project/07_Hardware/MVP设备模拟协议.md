# MVP 设备模拟协议

## 1. 用途

当前数据库与真实 MQTT Broker 暂不接入。主系统和独立硬件模拟器使用同源
`BroadcastChannel` 完成双向联动；不支持时回退到浏览器 Storage Event。

通道名：`ai-hardware-hub-device-v1`

这不是生产设备协议，但消息 envelope 与后续 MQTT 契约保持相同方向：

```json
{
  "schema": "device.message.v1",
  "messageId": "uuid",
  "source": "platform-app | hardware-simulator-*",
  "type": "device.command",
  "occurredAt": "RFC3339",
  "payload": {}
}
```

## 2. 消息

| 类型 | 方向 | 说明 |
|---|---|---|
| `simulator.hello` | 设备 → 平台 | 握手与能力声明 |
| `simulator.heartbeat` | 设备 → 平台 | 三秒心跳 |
| `simulator.goodbye` | 设备 → 平台 | 主动离线 |
| `platform.hello` | 平台 → 设备 | 下发当前 Device Shadow |
| `device.voice.input` | 设备 → 平台 | 语音识别文本和音频元信息 |
| `voice.session.accepted` | 平台 → 设备 | 语音回合已接收 |
| `device.command` | 平台 → 设备 | 亮度、音量、表情或显示命令 |
| `device.ack` | 设备 → 平台 | 命令完成回执 |
| `device.reported` | 设备 → 平台 | 上报设备影子 |
| `device.gesture.detected` | 设备 → 平台 | 标准化手势与置信度 |
| `assistant.response` | 平台 → 设备 | Agent 回复、动作和耗时 |
| `device.power` | 旧演示消息 | 仅兼容旧在线/离线切换；新实现统一使用 `device.command` |

## 3. 命令

```json
{
  "commandId": "cmd-*",
  "type": "device.brightness",
  "value": 40,
  "expiresInSeconds": 30
}
```

支持：

- `device.volume`: `0–100`
- `device.brightness`: `10–100`
- `device.emotion`: `curious | happy | sleepy | focus | sad`
- `device.display`: 最多 36 字符
- `device.power`: `wake | sleep | reboot | shutdown`

## 3.1 电源状态

```text
awake ──sleep──> sleeping ──wake──> awake
  │                  │
  ├──reboot──────────┴──> rebooting ──自动完成──> awake
  └──shutdown───────────> soft_off ──物理唤醒──> awake
```

- `sleeping` 是联网睡眠，保留控制通道，因此手机可远程唤醒；
- `soft_off` 关闭网络，网页发送 `wake` 会被拒绝；
- `soft_off` 只能通过按键、USB、定时器、外部 GPIO 或常供电电源管理器唤醒；
- 需要真正远程冷启动时，主 ESP32-S3 之外必须有常供电控制电路。

## 3.2 手势事件

```json
{
  "type": "device.gesture.detected",
  "payload": {
    "deviceId": "device-dnesp32s3-001",
    "gesture": "wave",
    "confidence": 0.97,
    "source": "simulated_sensor",
    "detectedAt": "RFC3339"
  }
}
```

当前标准化手势：`wave`、`palm`、`thumbs_up`、`double_tap`。未来无论来源是摄像头、
ToF、毫米波、触摸还是 IMU，都只向业务层发送标准化事件；原始图像默认不上传。

## 4. 替换真实硬件

1. 保留 `device.message.v1` envelope；
2. `DeviceBus.send()` 改为向 Device Gateway 发送 WebSocket/MQTT 消息；
3. 设备端按照 `commandId` 幂等并检查过期时间；
4. `device.ack` 与 `device.reported` 分开，前者是命令结果，后者是事实状态；
5. 音频由当前 transcript 演示字段改为对象引用或流式帧；
6. 设备身份改为每设备证书/密钥，不使用浏览器 source ID。
