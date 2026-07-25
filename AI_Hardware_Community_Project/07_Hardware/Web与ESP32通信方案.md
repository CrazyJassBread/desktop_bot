# MIMO Web 与 ESP32-S3 通信方案

> 当前：浏览器设备模拟器 + DeviceBus v1  
> 目标：HTTPS 配网/绑定 + MQTTS 设备消息 + WebSocket 浏览器实时状态

## 1. 分层

```text
Web / Mobile PWA
       │ HTTPS + WSS (443)
       ▼
Core API + Realtime Gateway
       │                  │
       │ Device Shadow    │ Command/Events
       ▼                  ▼
 PostgreSQL/Redis    Device Gateway
                          │ MQTTS (8883)
                          ▼
                    ESP32-S3 / MIMO
                    ├─ Mic / ASR
                    ├─ Camera
                    ├─ Printer
                    ├─ Distance sensor
                    └─ Pixel display
```

生产环境不允许浏览器直接持有 MQTT 设备凭证。浏览器只连接 WSS，设备只连接 MQTTS。
Device Gateway 负责鉴权、Topic ACL、命令追踪、重放保护和协议转换。

## 2. 当前 MVP 连接方法

```bash
npm run dev
```

同时打开：

- Web：`http://127.0.0.1:18000/device`
- 设备模拟器：`http://127.0.0.1:18000/simulator.html`

两者通过 `BroadcastChannel` 的 `ai-hardware-hub-device-v1` 通道交换
`device.message.v1`。模拟器定期发送 heartbeat；网页发送 command；模拟器返回 ACK、
reported state、photo、gesture 和 printer completed。

## 3. 消息信封

```json
{
  "schema": "device.message.v1",
  "messageId": "uuid",
  "source": "mimo-web",
  "type": "device.command",
  "occurredAt": "2026-07-23T08:00:00.000Z",
  "payload": {}
}
```

所有会改变设备状态的生产命令还需包含：

```json
{
  "commandId": "uuid",
  "deviceId": "mimo-desk-01",
  "expectedVersion": 42,
  "expiresAt": "2026-07-23T08:00:30.000Z",
  "idempotencyKey": "uuid"
}
```

## 4. MQTT Topic

```text
devices/{deviceId}/state/reported       QoS 1 retained
devices/{deviceId}/state/desired        QoS 1 retained
devices/{deviceId}/commands/{commandId} QoS 1
devices/{deviceId}/acks/{commandId}     QoS 1
devices/{deviceId}/events               QoS 0/1
devices/{deviceId}/telemetry            QoS 0
devices/{deviceId}/print/jobs           QoS 1
devices/{deviceId}/ota                  QoS 1
```

ACL 只允许设备访问自己的 Topic。语音原始音频、图片和 OTA 固件不直接塞进 MQTT：
先申请短期签名 URL，再通过 HTTPS 分片上传/下载，MQTT 只传元数据和状态。

## 5. 命令契约

| command | payload | FSM 结果 |
|---|---|---|
| `device.record` | duration/language | listening → active |
| `camera.capture` | resolution/purpose | camera → active |
| `printer.print` | job/template/content | printing → active |
| `device.language` | CN/EN | 保持当前状态 |
| `device.game` | game id | game |
| `game.control` | up/down | game |
| `device.sync` | scope | 保持当前状态 |
| `device.power` | wake/sleep/reboot/soft_shutdown | 对应状态 |
| `device.mode` | idle/active/sleeping | 对应状态 |

打印任务的 ACK 只代表接收，`printer.completed` 才代表纸张输出完成。缺纸、过热、开盖等
必须用明确错误码上报，不能只显示超时。

## 6. FSM

```text
                     listen ──► LISTENING ──complete─┐
                    /                                │
IDLE ──wake──► ACTIVE ─camera─► CAMERA ───complete───┤
  ▲                 ├─print──► PRINTING ─complete────┤
  │                 ├─game───► GAME                  │
  │                 ├─sleep──► SLEEPING ──wake───────┘
  └──── reboot ─────┴─shutdown► SOFT_OFF ──wake/reboot
```

高优先级安全事件（低电量、打印机过热、固件错误）可以打断普通状态。打印、摄像头和录音
需要资源锁，避免并行访问导致内存不足。

## 7. 手势事件

统一事件：

```json
{
  "type": "device.gesture.detected",
  "payload": {
    "gesture": "open_palm",
    "confidence": 0.96,
    "frameTime": 1721700000000
  }
}
```

映射：

| gesture | 动作 | 允许状态 |
|---|---|---|
| `v_sign` | CN/EN 切换 | idle/active |
| `open_palm` | 拍照 | active |
| `up` | 游戏跳跃 | game |
| `down` | 游戏下蹲 | game |
| `wave` | 唤醒 | idle/sleeping |

需设置置信度阈值、500–1000ms 防抖和状态门禁。原始摄像头帧默认不上传。

## 8. 真实设备接入步骤

1. 在固件实现稳定的 Wi-Fi 配网和 NVS 存储；
2. 每台设备烧录唯一身份，生产环境使用客户端证书或安全芯片；
3. 先实现 heartbeat、reported shadow 和 command ACK；
4. 按顺序接入像素屏 → 电源/FSM → 打印机 → 麦克风 → 摄像头；
5. 加入断线重连、指数退避、离线命令过期和 watchdog；
6. 最后接入语音大文件、OCR、手势和 OTA；
7. 用本项目模拟器作为协议对照，不改变页面层。

## 9. 电源边界

- Sleep：ESP32 深睡/轻睡，Wi-Fi 可断开，由定时器、GPIO 或辅助电路唤醒；
- Soft off：主业务停止，但常供电控制器仍在线；
- Hard off：主电源断开，单靠 Web 或 MQTT 无法恢复；
- 远程硬开机：需要始终供电的 PMIC、辅助 MCU、RTC 或外部继电控制，并验证电池安全。

## 10. 端口

- 当前 Web 和模拟器共用已登记的 `18000`，没有占用新的宿主机端口；
- WebSocket Gateway 保留 `18020`；
- Agent/Voice 保留 `18100/18110`；
- Device Gateway、MQTT、OTA、Provisioning 保留 `18200/18210–18212/18220/18230`；
- OCR/视觉/手势 Runtime 先作为 `18100` Agent Runtime 内部模块，拆分前不得临时抢占其他端口；
- 其余 `18050–18999` 按《08_Server/端口与服务注册表.md》继续保留。
