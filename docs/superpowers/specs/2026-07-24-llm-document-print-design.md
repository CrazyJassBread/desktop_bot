# LLM 文档排版打印设计（阶段二）

## 目标

将阶段一产生的 `llm.letter_completed` 和 `llm.answer_completed` 结果排版为经典极简
热敏纸文档，并通过现有打印机固件打印：

- 384 像素纸宽；
- 左上角显示收件人或用户昵称；
- 右上角显示不重叠的 40×44 像素风邮票；
- 写信和问答使用相同网格、不同像素图案；
- 支持中英文自动换行和连续长纸；
- 排版或打印失败时保留阶段一结果，不重新调用 LLM。

## 非目标

- 不让 LLM 输出 HTML、Markdown 模板或坐标；
- 不提供可视化版式编辑器；
- 不支持彩色、图片背景或真实邮票图片；
- 不修改照片打印的灰度像素化算法；
- 不在阶段二实现持久化打印队列或自动重试。

## 架构

新增 `DocumentRenderer`，职责仅为把结构化文本转换为 Pillow `1` 模式图像。

现有 `ThermalPrinterClient` 增加 `print_bitmap(image)`：

- 接受已经排版完成的 Pillow `1` 模式图像；
- 不执行照片缩放、灰度、像素化或抖动；
- 复用现有高度分块、位图打包和 `/printer/image` HTTP 协议。

新增 `LLMDocumentPrintManager`：

- 消费阶段一完成事件；
- 调用 Renderer；
- 在线程中调用 Printer Client；
- 维护单任务忙碌锁；
- 发布排版和打印结果事件。

阶段一与阶段二通过结构化事件连接，彼此不直接访问内部状态。

## 配置

```yaml
llm_document:
  enabled: true
  auto_print: true
  font_path: fonts/NotoSerifSC-Regular.otf
  sans_font_path: fonts/NotoSansSC-Regular.otf
  sender_name: 面包
  assistant_name: AI BOT
  paper_width: 384
  margin_left: 24
  margin_right: 24
  margin_top: 22
  margin_bottom: 28
  header_gap: 15
  recipient_width: 250
  stamp_width: 40
  stamp_height: 44
  body_font_size: 20
  meta_font_size: 14
  line_spacing: 10
```

校验：

- 启用时字体文件存在且可加载；
- 纸宽与现有打印机宽度一致；
- 所有尺寸和间距为正数；
- 左右边距、收件人列、间距和邮票宽度之和不超过纸宽；
- 正文字号和行距能够产生至少一行正文宽度；
- `sender_name` 和 `assistant_name` 非空。

字体不随代码仓库提交时，配置必须指向部署机器上的有效 OTF/TTC/TTF 文件。缺少中文
字体产生稳定失败事件，不使用不支持中文的 Pillow 默认字体。

## 经典极简布局

页面坐标：

```text
┌────────────────────────────────────┐
│ To 收件人/昵称       [40×44 像素邮票] │
│ A LETTER/THOUGHT FOR YOU           │
│ ────────────────────────────────── │
│                                    │
│ 正文按字体实际宽度自动换行             │
│                                    │
│                         署名/AI BOT │
│                         YYYY.MM.DD │
└────────────────────────────────────┘
```

Header 使用固定两列：

- 左列宽度不超过 `recipient_width`；
- 右列固定 `stamp_width × stamp_height`；
- 两列间隔 `header_gap`；
- 收件人名称在左列内按字符换行，永不进入邮票区域；
- 名称过长可以增加 Header 高度，但不缩小到不可读字号。

写信：

- `To {recipient}`；
- 副标题 `A LETTER FOR YOU`；
- 像素信封邮票；
- 正文使用衬线中文字体；
- 右下角为 `sender_name` 和日期。

问答：

- `To {user_nickname}`；
- 副标题 `A THOUGHT FOR YOU`；
- 像素问号邮票；
- 正文上方有小型 `ANSWER` 标签；
- 正文使用无衬线中文字体；
- 右下角为 `assistant_name` 和日期。

像素邮票由内置 7×8 二值矩阵按最近邻放大生成，不依赖外部图片资源。邮票外框为实线，
图案与边框保持至少 3 像素内边距。

## 中英文换行和页面高度

Renderer 使用 Pillow `textlength`/`textbbox` 按真实字体宽度测量：

- 中文可以在任意字符边界换行；
- 英文优先按单词换行，单词超过一行时按字符拆分；
- 保留显式换行和空段落；
- 不使用固定“每行 N 字”的估算；
- 不截断正文。

先计算 Header、正文所有行、署名和边距的总高度，再一次性创建最终 1-bit 页面。长文档
可以超过 1200 像素，Printer Client 按现有 `max_chunk_height` 从上到下分块，保持
顺序连续打印。

## 数据流与事件

```text
llm.letter_completed / llm.answer_completed
  → LLMDocumentPrintManager
  → DocumentRenderer.render_letter/render_answer
  → document.rendered
  → ThermalPrinterClient.print_bitmap
  → document.printed / document.print_failed
```

事件：

- `document.rendered`
  - LLM session ID、文档类型、宽高、正文字符数；
- `document.printed`
  - LLM session ID、文档类型、宽高、分块数；
- `document.render_failed`
  - LLM session ID、稳定原因；
- `document.print_failed`
  - LLM session ID、稳定打印错误原因。

LLM 完成事件已经包含最终文本，因此排版或打印失败后，用户可以从事件缓存和
`logs/llm.log` 获取内容；失败不会再次调用 LLM。

同一时间只打印一个 LLM 文档。打印忙碌时新的完成结果产生
`document.print_failed(reason=document_printer_busy)`，不排队，避免热敏打印任务无限
积压。

## 错误处理

排版失败：

- `font_unavailable`
- `invalid_layout`
- `empty_document`
- `render_error`

打印失败复用：

- `printer_disabled`
- `timeout`
- `http_error`
- `connection_error`

任何失败都写入 `logs/llm.log`，包含 LLM session ID，不删除阶段一输出。Runtime
关闭时取消未开始的排版；已经进入同步 HTTP 调用的线程依赖请求超时退出。

## 测试

自动化测试覆盖：

1. 写信和问答使用不同标题、署名和像素邮票；
2. Header 两列边界不重叠；
3. 长收件人仅在左列换行并增加 Header 高度；
4. 中英文、超长英文单词、显式换行和空段落；
5. 正文不截断且输出 Pillow `1` 模式；
6. 像素信封和问号矩阵按最近邻生成；
7. 长文档按 1200 像素高度顺序分块；
8. `print_bitmap` 不执行照片像素化；
9. 字体缺失、空正文和无效布局错误；
10. 打印忙碌、超时、HTTP 和连接错误；
11. LLM 结果只触发一次自动打印；
12. 打印失败不产生新的 LLM 请求；
13. 现有照片打印协议和全部阶段一测试保持通过。
