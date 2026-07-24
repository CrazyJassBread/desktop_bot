# ASR 与 Victory 触发照片打印设计

## 目标

在现有持续感知 Runtime 中增加照片打印工作流：

- ASR 文本包含拍照相关关键词时触发；
- 稳定的 `Victory` 手势触发；
- `Open_Palm` 接替原有的中英文切换功能；
- 触发后等待 1 秒，取得相机最新帧；
- 保存原始 JPEG；
- 将图像灰度化、像素化并转换为打印机位图；
- 调用打印机固件 HTTP 接口完成打印；
- 工作流执行期间忽略重复触发，结束后冷却 2 秒。

## 非目标

- 不增加打印任务队列；
- 不重试失败的打印任务；
- 不改变音频 VAD 或 ASR 模型；
- 不将打印预览图写入磁盘；
- 不引入语义模型判断拍照意图，使用确定性关键词匹配。

## 架构

保留现有 `PhotoCaptureManager` 作为工作流协调器，新增独立的
`ThermalPrinterClient`：

- `ApplicationController` 负责将感知事件映射为应用操作；
- `PhotoCaptureManager` 负责延迟、取帧、保存原图、调用打印机以及忙碌和冷却状态；
- `ThermalPrinterClient` 负责图像预处理、ESC/POS 位图打包、分块和 HTTP 请求；
- `LatestFrameStore` 继续保存相机最新帧；
- `KeywordDetector` 负责产生明确的 `feature.photo_print` 事件。

这样打印协议与图像算法可以独立测试和替换，不会侵入 ASR、手势识别或传输层。

## 配置

在 `KeywordConfig` 中增加 `photo_print` 关键词列表，默认包含：

- `拍照`
- `照相`
- `给我拍一张`
- `打印照片`
- `photo`
- `take a photo`
- `take a picture`

在 `config.yaml` 中将 `application.photo_delay_seconds` 设置为 `1.0`。

新增 `printer` 配置段：

```yaml
printer:
  enabled: true
  base_url: http://10.76.7.129
  width: 384
  max_chunk_height: 1200
  pixel_size: 6
  grayscale_levels: 4
  contrast: 1.2
  brightness: 1.0
  dither: true
  rotate_180: false
  timeout_seconds: 30
  cooldown_seconds: 2.0
```

配置加载时验证 URL 非空、数值为正、灰度级位于 `2..256`。打印功能关闭时，
触发事件产生 `photo.print_failed`，原因是 `printer_disabled`。

## 事件路由

`ApplicationController` 的事件行为调整为：

| 输入事件 | 新行为 |
| --- | --- |
| `feature.photo_print` | 启动照片打印工作流 |
| `gesture.victory` | 启动照片打印工作流 |
| `gesture.open_palm` | 切换中英文 |

`Victory` 不再切换语言，`Open_Palm` 不再拍照。

启动成功时产生 `command.camera.capture_after`，参数包含 `delay_ms=1000`。如果工作流
已经处于等待、处理、打印或冷却状态，新的触发被静默忽略，只写调试日志，不排队、
不重置倒计时，也不产生误导性的失败事件。

## 照片打印工作流

工作流状态如下：

```text
idle
  → countdown
  → processing
  → printing
  → cooldown
  → idle
```

处理步骤：

1. `schedule()` 在 `idle` 状态原子地占用唯一任务槽并创建后台任务。
2. 等待 `application.photo_delay_seconds`，默认 1 秒。
3. 从 `LatestFrameStore` 读取最新帧。
4. 如果没有帧或帧超过允许年龄，发布 `photo.capture_failed`。
5. 将原始 JPEG 原子保存到 `captured_photos/{capture_id}.jpg`。
6. 发布 `photo.captured`。
7. 在线程中用 Pillow 解码并转换打印图片。
8. 按高度上限切块并顺序调用打印机。
9. 所有分块成功后发布 `photo.printed`，随后发布 `photo.completed`。
10. 无论成功或失败，等待 `printer.cooldown_seconds`，默认 2 秒，再恢复 `idle`。

取消 Runtime 时不等待冷却，后台任务立即取消。

## 图像处理和打印协议

`ThermalPrinterClient` 复用 `tests/test_printer/utils.py` 已验证的算法语义，但生产代码
不从 `tests` 包导入：

1. 应用 EXIF 方向；
2. 透明背景铺白；
3. 保持比例缩放至配置宽度，默认 384；
4. 转灰度；
5. 调整亮度和对比度；
6. 缩小后以最近邻放大，形成像素块；
7. 量化到配置的灰度级；
8. 可选 Floyd–Steinberg 抖动，输出 Pillow `1` 模式；
9. 按行打包，每个字节高位对应左侧像素，黑色为 `1`；
10. 高度超过 `max_chunk_height` 时纵向分块。

每个分块按顺序发送：

```http
POST {base_url}/printer/image?width={width}&height={height}
Content-Type: application/octet-stream

<packed bitmap>
```

任何非 2xx 响应、连接错误、超时或无效图片都终止本次任务，不继续发送后续分块。

## 成功和失败事件

成功事件：

- `photo.captured`：原图已保存；
- `photo.printed`：所有分块已由打印机成功接收，包含 `capture_id`、分块数、尺寸；
- `photo.completed`：整个工作流完成。

失败事件：

- `photo.capture_failed`：没有相机帧、帧过期或保存失败；
- `photo.print_failed`：打印功能关闭、图片处理失败、HTTP 超时、网络错误或非 2xx。

失败事件携带稳定的 `reason` 字段和 `trigger_event_id`。日志可以记录异常详情，但事件
中不暴露堆栈或本机敏感信息。失败后仍进入冷却，确保状态最终恢复。

## 测试

测试优先覆盖：

1. 中文和英文拍照短语产生 `feature.photo_print`；
2. 无关文本不触发打印；
3. `Victory` 启动打印，`Open_Palm` 切换语言；
4. 语音和手势走同一调度入口；
5. 延迟后使用新的最新帧，而不是触发瞬间的帧；
6. 忙碌和冷却期间拒绝重复触发；
7. 成功、失败和取消后状态正确；
8. 灰度、像素化、尺寸、位图位序及高度分块正确；
9. HTTP 请求路径、参数、请求体和分块顺序正确；
10. 打印机超时或非 2xx 产生 `photo.print_failed`；
11. 配置默认值及非法配置校验；
12. 现有感知、照片、API 和视觉测试保持通过。

真实打印机调用不进入默认自动化测试；使用本地假 HTTP 服务验证协议，最终再以
`10.76.7.129` 做一次人工硬件验收。
