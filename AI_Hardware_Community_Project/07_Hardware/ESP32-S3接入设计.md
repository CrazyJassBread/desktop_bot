# ESP32-S3 接入设计

## 1. 现状审计

审阅仓库：`https://github.com/CrazyJassBread/desktop_bot`，主分支 HEAD（审阅时）`810722bf4c13dc729c8bd0e015ac4222bb816b8d`。

仓库当前是 Python 3.11+ 电脑端语音处理程序，不是 ESP32-S3 固件。已实现：

- WAV 校验、单声道/16 kHz/float32 预处理；
- faster-whisper 与 Mock ASR；
- command/llm 模式路由、固定问答、指南 Agent；
- OpenAI 兼容 LLM；
- session 最近 6 轮内存历史；
- 统一 `AssistantResponse` JSON；
- `ASRBackend`、`LLMBackend`、`OutputAdapter`、`DuplexTransportAdapter` 抽象；
- 离线 smoke tests。

尚未实现：设备实时音频传输、HTTP/WebSocket/串口服务、TTS、持久 session。因而第三阶段必须同时建立真正的固件工程与传输服务，不能直接把现有仓库部署后称为设备云。

## 2. 仓库与职责建议

```text
desktop_bot       # Python Voice Runtime，可继续独立
dnesp32s3-fw      # ESP-IDF 固件：音频、网络、协议、OTA
platform          # Web/Core API/Agent/Device Control
contracts         # JSON Schema/Protobuf、版本与生成代码
```

固件建议 ESP-IDF 而不是只依赖 Arduino，便于 TLS、OTA、分区、安全启动、任务和诊断；若当前板级驱动基于 Arduino，可先作为 ESP-IDF component 或保留 PlatformIO 过渡。

## 3. 设备能力清单（接入前必须补录）

- 精确模组、Flash/PSRAM 容量、MAC/efuse 策略；
- 麦克风型号、I2S/PDM 引脚、采样率、通道、增益；
- Codec/DAC/功放/扬声器和回声消除能力；
- 屏幕分辨率、触摸/按键/LED；
- Wi-Fi/BLE、USB/串口；
- 分区表、Bootloader、Secure Boot/Flash Encryption 状态；
- 当前固件框架和 SDK 版本；
- 电源、低功耗和物理恢复方式。

未经这份清单，不冻结音频编码、OTA 分区和 UI payload 大小。

## 4. 固件分层

```text
board/       引脚、codec、display、按键
audio/       capture、VAD、AEC(如可用)、encode、playback
ui/          状态机、动画、文本
network/     Wi-Fi provisioning、time sync、TLS、reconnect
protocol/    MQTT/HTTP envelope、schema version、chunking
identity/    device key/cert、binding、rotation
ota/         manifest、download、verify、A/B、rollback
app/         session、command、offline fallback
diagnostic/  metrics、crash、safe mode
```

FreeRTOS 任务边界需防音频实时任务被网络/屏幕阻塞；环形缓冲区有上限，背压时可丢弃旧的非关键遥测，但不能静默拼接错误音频。

## 5. 设备身份与绑定

### 制造/首次启动

理想方案：每台设备注入唯一密钥/证书和 serial，服务端保存公钥/证书状态。原型阶段可首次启动生成 P-256 keypair，私钥保存在加密 NVS；服务端通过一次性注册流程签发短期/可轮换凭证。

禁止在所有设备固件中写同一个 MQTT 密码。

### 用户绑定

1. 用户 Web 端登录，创建短期 binding session；
2. 设备通过 BLE SoftAP/USB 获得 Wi-Fi 和 binding nonce；
3. 设备使用自身身份签名 challenge；
4. 用户输入设备显示的一次性码或按键确认；
5. 服务端原子绑定 owner，签发 scoped credential；
6. 旧 owner 转移必须先解绑/物理重置并清理私有数据。

配网凭证端到端保护，日志中不出现 SSID 密码。

## 6. 通信选择

| 通道 | 使用 |
|---|---|
| MQTT over TLS | 在线状态、命令、事件、设备影子、轻量响应 |
| HTTPS | 绑定、预签名音频上传、OTA 下载、较大资源 |
| WebSocket/SSE | 浏览器实时看设备和语音会话 |
| BLE/SoftAP/USB | 首次配网和本地诊断 |

音频不一定直接塞 MQTT。低码率短片段可分片 MQTT；更稳妥的 MVP 是 HTTPS 预签名上传完整 utterance，再通过 MQTT 发送对象引用。真正低延迟全双工语音可在验证后引入 WebSocket/WebRTC。

## 7. MQTT Topic 与 ACL

```text
v1/devices/{deviceId}/presence            # device -> cloud
v1/devices/{deviceId}/events              # device -> cloud
v1/devices/{deviceId}/state/reported      # device -> cloud
v1/devices/{deviceId}/state/desired       # cloud -> device
v1/devices/{deviceId}/commands            # cloud -> device
v1/devices/{deviceId}/commands/{id}/ack   # device -> cloud
v1/devices/{deviceId}/voice/sessions      # 双方轻量控制
```

设备只能 publish/subscribe 自己的 topic；用户浏览器不能直连 Broker，必须通过 API/Realtime Gateway。

消息 envelope：

```json
{
  "schema": "device.command.v1",
  "message_id": "uuid",
  "device_id": "uuid",
  "sent_at": "2026-07-23T12:00:00Z",
  "expires_at": "2026-07-23T12:00:30Z",
  "correlation_id": "uuid",
  "type": "display.text",
  "payload": {"text": "你好"},
  "signature": "optional-if-channel-bound"
}
```

设备验证过期时间、允许命令和 payload；以 `message_id` 去重。QoS：presence QoS 0，命令/ACK QoS 1；仍需应用幂等，因为 QoS 1 可能重复。

## 8. 在线状态与 Device Shadow

- MQTT LWT 发布 offline；
- 心跳 30–60 秒并带 firmware、uptime、RSSI、free heap、last error；
- 超过阈值标记 stale/offline；
- desired/reported 分离，版本递增；
- 影子用于期望配置，不用于高频遥测和实时音频；
- 云端 UI 显示“最后上报时间”，避免把旧状态当实时。

## 9. 语音链路

### Phase 3a：句级半双工

1. 本地按键/唤醒/VAD 开始采集；
2. 16 kHz mono PCM，经 Opus（板卡性能验证）或 WAV；
3. 上传完整 utterance（时长/大小上限）；
4. Voice Runtime 调用现有预处理/ASR；
5. command 优先本地/云端规则，复杂请求转 Agent；
6. 返回短文本和/或 TTS 对象 URL；
7. 设备播放并 ACK。

优点是与现有 WAV Pipeline 最接近，易于可靠交付。

### Phase 3b：流式低延迟

音频帧带 session、sequence、timestamp、codec；Gateway 做背压、乱序/丢包统计和会话超时。ASR 支持 partial/final；TTS 分块播放。指标分解：

- wake/VAD；
- uplink；
- ASR first/final；
- Agent TTFT/final；
- TTS first audio；
- device playback。

### 隐私

设备用明确灯光/屏幕表示录音/上传；默认不保存原始音频；为改进识别而保存必须单独同意、可删除、有保留期。唤醒词尽可能本地处理。

## 10. AssistantResponse v2 建议

复用现有字段并增加协议信息：

```json
{
  "schema": "assistant.response.v2",
  "session_id": "uuid",
  "turn_id": "uuid",
  "success": true,
  "mode": "agent",
  "transcript": "打开项目助手",
  "display": {"text": "已打开项目助手", "emotion": "neutral"},
  "speech": {"text": "好的", "audio_url": null, "codec": null},
  "action": {
    "name": "ui.open_agent",
    "arguments": {"agent_id": "uuid"},
    "status": "approved"
  },
  "timing": {},
  "error": null
}
```

`action.status` 明确 `proposed/approved/executed/failed`，防止模型只提出动作却被 UI 当成已执行。

## 11. OTA

- Manifest：model、hardware revision、version、channel、size、sha256、signature、min bootloader、rollout；
- 固件用离线受控私钥签名，设备内置验证公钥；
- A/B 分区，启动后健康确认，否则回滚；
- rollout 1% → 10% → 50% → 100%，按错误率/离线率自动暂停；
- 禁止降级到已撤销漏洞版本；
- 下载支持断点续传和电量/网络策略；
- Release 对象不可覆盖，审计发布者。

## 12. 断网与降级

- Wi-Fi/MQTT 指数退避加抖动；
- 网络不可用时保留本地音量、停止、返回主页等安全命令；
- 有界离线事件队列，按优先级丢弃；
- 云 Agent 不可用时明确告知，不伪造答案；
- 多次崩溃进入 safe mode，允许本地恢复/诊断；
- 物理长按恢复出厂设置并吊销旧凭证。

## 12.1 远程电源控制边界

- 屏幕休眠：只关闭显示/背光，Wi-Fi 与控制通道保留，可远程唤醒；
- 联网睡眠：降低频率并关闭非必要外设，定期或持续保持控制通道；
- Deep Sleep：Wi-Fi 断开，只能通过定时器、触摸、按键、USB 或配置的 GPIO 唤醒；
- 软关机：关闭应用外设后进入最低功耗状态，本质仍依赖唤醒源；
- 真正断电：主 ESP32-S3 无法接收网页命令，远程开机需要常供电 PMIC、负载开关、
  辅助 MCU 或其他带网络的电源控制器。

网页端“开机”应区分“联网睡眠唤醒”和“物理冷启动”。不得向用户承诺完全断电后
仍能通过软件唤醒。

## 12.2 手势识别演进

业务协议统一发送 `device.gesture.detected`，不直接耦合传感器实现。建议顺序：

1. 触摸/按键/IMU 手势，成本和隐私风险最低；
2. ToF 或毫米波完成靠近、挥手等低分辨率动作；
3. 摄像头手势只在明确需要时引入，优先端侧推理；
4. 默认只上传标准化手势与置信度，不上传原始图像；
5. 手势映射到电源/设备动作时仍经过 allowlist、冷却时间和安全策略。

## 13. 硬件测试门槛

- 72 小时 soak + 7 天联网稳定性；
- 弱网、路由重启、Broker 断开、证书过期；
- 音频 buffer 压力、最大 utterance、连续对话；
- 重复/乱序/过期命令；
- OTA 断电、损坏包、错误型号、回滚；
- 绑定抢占、恢复出厂、凭证吊销；
- Heap/任务栈/温度/功耗基线；
- HIL 测试台自动刷机、播放标准音频、采集串口和结果。
