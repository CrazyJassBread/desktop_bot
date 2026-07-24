# 语音 LLM 会话设计（阶段一）

## 目标

在持续感知 Runtime 中增加两个由语音驱动的 LLM 模式：

- 写信模式：暂存多段 ASR 转录，结束后清理口语表达并润色为清晰、有文学性的信件正文；
- 问答模式：暂存多段问题描述，结束后生成直接、清晰的回答；
- 开始、结束和取消短语分别按模式在 YAML 中配置；
- 通过 OpenAI-compatible `/chat/completions` API 调用 LLM；
- 阶段一只输出结构化事件和专用 `logs/llm.log`，不调用打印机。

## 非目标

- 阶段一不生成或打印版式；
- 不提供流式 LLM 输出；
- 不持久化可恢复的会话；
- 不支持同时运行多个 LLM 会话；
- 不让 LLM 决定控制命令或会话状态；
- 不在 YAML 中保存 API Key。

## 架构

新增三个边界清晰的组件：

1. `LLMModeDetector`
   - 识别空闲状态下的写信/问答开始短语；
   - 支持普通开始短语和带 `{recipient}` 的收件人模板；
   - 生成明确的模式开始事件，不直接调用 LLM。
2. `LLMSessionManager`
   - 维护会话状态、收件人、转录缓冲、超时和字符限制；
   - 对当前模式执行完整句结束/取消匹配；
   - 组装模式专用 Prompt；
   - 异步调用 LLM Client 并发布结果事件。
3. `OpenAICompatibleClient`
   - 从环境变量读取 API Key；
   - 构造 `/chat/completions` 请求；
   - 校验 HTTP 和响应 JSON；
   - 将供应商差异统一为稳定错误类型。

`ApplicationController` 只负责把感知事件交给 Session Manager，并在 LLM 会话活跃时
抑制其他音频意图。视觉手势和照片功能不受影响。

## 配置

```yaml
llm:
  enabled: true
  base_url: https://api.example.com/v1
  api_key_env: LLM_API_KEY
  model: model-name
  timeout_seconds: 60
  temperature: 0.4
  max_output_tokens: 2000
  log_path: logs/llm.log
  user_nickname: 面包

  session:
    idle_timeout_seconds: 120
    max_duration_seconds: 900
    max_characters: 12000
    body_prefixes:
      - "正文："
      - "正文:"

  modes:
    letter:
      start_phrases:
        - 开始写信
        - 我要写信
      recipient_templates:
        - 我要给{recipient}写信
        - 帮我给{recipient}写封信
      recipient_prefixes:
        - 收件人是
        - 写给
      finish_phrases:
        - 小A，完成写信
        - 小A，信写完了
      cancel_phrases:
        - 小A，取消写信
        - 小A，放弃这封信

    qa:
      start_phrases:
        - 进入问答模式
        - 我有一个问题
        - 帮我回答
      finish_phrases:
        - 小A，请回答
        - 小A，问题说完了
      cancel_phrases:
        - 小A，取消问答
        - 小A，不要回答了
```

配置校验：

- `enabled` 为布尔值；
- 启用时 `base_url`、`api_key_env`、`model` 和 `user_nickname` 非空；
- 时间、字符和 token 限制为正数；
- 每个模式至少有一个开始、结束和取消短语；
- 写信模式至少有一个普通开始短语或收件人模板；
- `recipient_templates` 每项恰好包含一个 `{recipient}`；
- 同一模式中标准化后的结束和取消短语不能重复；
- 两个模式标准化后的开始规则不能相互重复。

## 文本标准化和控制命令

沿用现有标点、空白和大小写标准化方式。规则优先级：

1. 如果整条转录以配置的 `body_prefixes` 之一开始，去掉前缀后直接保存为正文；
2. 否则，如果标准化后的整条转录完全等于当前模式的取消短语，取消会话；
3. 否则，如果完全等于当前模式的结束短语，结束收集并调用 LLM；
4. 否则，将转录按顺序追加到缓冲。

结束和取消都不使用子字符串匹配。默认取消短语必须包含唤醒词和模式语义，避免正文
中的“取消”“写完了”等普通表达误触发。

空闲时的开始检测允许：

- 完整普通短语，例如“开始写信”；
- 普通短语出现在自然句中；
- 模板匹配，例如“我要给小明写信”，提取原始文本中的“小明”。

模板提取后必须得到非空收件人。匹配仅覆盖一个开始规则，按 YAML 顺序选择第一项。

## 会话状态

```text
idle
  ├─ 写信且已有收件人 → collecting
  ├─ 写信但无收件人 → awaiting_recipient
  └─ 问答 → collecting

awaiting_recipient → collecting / cancelled / failed
collecting → generating / cancelled / failed
generating → completed / failed
completed / cancelled / failed → idle
```

写信模式：

- 带模板的开始句直接记录收件人；
- 普通开始句进入 `awaiting_recipient`；
- 下一条以 `recipient_prefixes` 开始的转录提取收件人，不进入正文；
- 收件人为空、等待超时或收到取消命令时结束且不调用 LLM。

问答模式直接进入 `collecting`，输出对象使用 `user_nickname`。

限制：

- 每次接受正文后重置 120 秒 idle timeout；
- 从开始事件计时，最长 900 秒；
- 正文标准化前的总字符数最多 12000；
- 超限立即失败，不把截断内容发送给 LLM；
- 同一时间只允许一个会话；
- 活跃或生成中收到新的开始事件时忽略；
- Runtime 关闭时取消计时器和未完成的 LLM 请求。

## 与现有音频事件的关系

`KeywordASRProcessor` 仍发布 `speech.transcribed`，并在普通关键词检测前运行
`LLMModeDetector`。开始事件先于对应 transcript 事件发布。

Session Manager 记录触发开始的 `matched_event`，因此紧随其后的开始句不会进入正文。

LLM 会话活跃时：

- 所有音频来源的普通功能/模式意图由控制器抑制；
- 原始 `speech.transcribed` 仍交给 Session Manager；
- 照片、聊天和写信关键词出现在正文中不会触发功能；
- `Victory`、`Open_Palm` 等视觉事件继续正常处理。

## LLM 请求

Client 请求：

```http
POST {base_url}/chat/completions
Authorization: Bearer <API key from environment>
Content-Type: application/json
```

请求使用 `model`、`temperature`、`max_tokens` 和非流式 `messages`。只接受
`choices[0].message.content` 的非空字符串。

写信 System Prompt：

- 保留事实、姓名、关系、情绪和原意；
- 删除 ASR 重复、口头禅、停顿词和无意义碎片；
- 改善断句、逻辑、表达清晰度和文学性；
- 不虚构经历、承诺或事实；
- 只输出正文，不生成称呼、日期、签名或打印布局。

写信 User Prompt 包含收件人和按顺序编号的原始转录。

问答 System Prompt：

- 将多段口语转录理解为一个完整问题；
- 给出直接、准确、结构清晰的回答；
- 无可靠结论时明确不确定性；
- 只输出回答正文，不生成打印布局。

问答 User Prompt 包含昵称和按顺序编号的原始转录。

## 事件

- `llm.session_started`
  - 模式、会话 ID、收件人或昵称；
- `llm.recipient_set`
  - 写信收件人；
- `llm.transcript_buffered`
  - 模式、会话 ID、片段数、总字符数，不携带正文；
- `llm.session_cancelled`
  - 模式、会话 ID、匹配的取消命令；
- `llm.session_failed`
  - 模式、会话 ID、稳定原因；
- `llm.letter_completed`
  - 会话 ID、收件人、最终正文、输入片段数、耗时；
- `llm.answer_completed`
  - 会话 ID、昵称、最终回答、输入片段数、耗时。

失败原因包括：

- `llm_disabled`
- `api_key_missing`
- `recipient_required`
- `idle_timeout`
- `max_duration_exceeded`
- `max_characters_exceeded`
- `empty_content`
- `request_timeout`
- `http_error`
- `invalid_response`
- `connection_error`

所有终态必须在 `finally` 中释放当前会话，确保之后可重新进入模式。

## 专用日志

`logs/llm.log` 使用独立 logger 和轮转文件：

- 时间、会话 ID、模式、收件人/昵称；
- 原始 ASR 片段；
- Prompt 类型和字符数；
- LLM 输出；
- API 耗时；
- 取消、超时和错误原因。

日志不记录 API Key、Authorization header 或完整环境变量。LLM 完成事件会按现有事件
机制进入 `perception.log`；原始转录集合只进入 `llm.log`。

## 测试

自动化测试覆盖：

1. 两种模式的开始短语和收件人模板；
2. 普通开始句后的收件人获取；
3. 多段转录顺序和开始句排除；
4. 完整句结束、取消和正文前缀优先级；
5. 正文内出现结束/取消子串不会误触发；
6. 活跃会话抑制其他音频意图但不影响视觉事件；
7. idle timeout、最大时长和字符限制；
8. 取消不调用 LLM；
9. 两种模式生成不同 Prompt；
10. OpenAI-compatible 请求、API Key 环境变量和响应解析；
11. HTTP、超时、连接和响应格式错误；
12. 专用日志包含调试内容但不泄露 API Key；
13. 终态和 Runtime 关闭后的资源释放；
14. 现有 ASR、照片、打印、手势和 API 测试保持通过。
