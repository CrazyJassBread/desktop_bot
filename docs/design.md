# 桌面 AI 助手语音处理程序设计

## 模块边界

处理核心不依赖 CLI、终端或 JSON 文件。`VoicePipeline` 只依赖注入的
`ASRBackend`、`LLMBackend`、`ModeManager` 和配置对象：

```text
AudioRequest
  -> WAV loader / validator / preprocess
  -> ASRBackend
  -> normalize_text
  -> global command routing
  -> signal + session mode routing
  -> command / fixed QA / GuideAgent / conversational LLMBackend
  -> ResponseProcessor
  -> AssistantResponse
  -> OutputAdapter
```

- `app/audio`：读取 PCM WAV、校验时长、混为单声道、重采样和归一化。
- `app/asr`：Mock 与 faster-whisper 共享异步接口。
- `app/routing`：保守文本归一化、三级命令匹配和 session 状态。
- `app/command`：命令目录、状态型 handler 和固定问答。
- `app/llm`：Mock、OpenAI 兼容客户端、对话/指南提示词、历史和回答压缩。
- `app/output`：终端与 JSON 文件输出。
- `app/transport`：为 WebSocket、HTTP、串口和 Bot SDK 预留双向接口。
- `app/runtime`：只负责编排，不直接操作设备或绑定传输协议。

## 路由优先级

1. 外部 `cancel`（不读取音频）
2. 外部持续模式切换 `enter_llm_mode` / `exit_llm_mode`
3. 全局语音命令：停止、取消、退出聊天
4. 单次强制模式 `command_mode` / `llm_mode`
5. 语音进入聊天模式（控制语句不发送给 LLM）
6. session 当前模式
7. COMMAND 模式的普通命令和固定问答
8. 未匹配回退：默认调用一次性 `GuideAgent`；也可配置为固定提示或完整 LLM

`llm_mode` 只影响本次调用；`enter_llm_mode` 才修改 session。所有 session
状态由 `ModeManager` 实例持有，没有模块级可变状态。

## 指南智能体

`GuideAgent` 与持续聊天共用同一个 `LLMBackend`，但使用独立系统提示词，并显式
关闭 conversation history。它只负责 COMMAND/AUTO 下未匹配内容的简短回答：

- 最多 1～2 句话，不展开长对话；
- 不执行、不假装执行设备动作；
- 模糊内容只提出一个澄清问题；
- 成功回答保存为 `last_assistant_response`，但不加入 `conversation_history`；
- 响应标记 `metadata.llm_role=guide` 和当前 `session_mode`。

因此，指南回答不会把 session 切换到 LLM。显式进入聊天模式后，才使用完整系统
提示词与最近 N 轮历史。

## 错误边界

可预期错误转换为 `AssistantResponse(success=false)`，音频错误保留稳定错误码，
ASR 和 LLM 分别归一为 `asr_error` 与 `llm_error`。未知异常记录堆栈并返回
`internal_error`。响应中不包含凭据或原始异常细节。
