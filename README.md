# 桌面 AI 助手电脑端语音处理程序

基于 Python 3.11+ 的最小可用语音处理核心。当前以本地 PCM WAV 为输入，
完成音频预处理、ASR、模式路由、固定命令 / 固定问答 / LLM、回答压缩，并输出
统一 JSON。它不会真正操作 UI、扬声器或打印机，而是返回可由 Bot 端执行的
`action`。

## 处理流程

```text
WAV 文件
→ 文件与时长检查
→ 单声道 / 16 kHz / float32 预处理
→ ASR
→ 文本标准化（仅用于命令匹配）
→ 控制信号与 session 模式路由
→ 固定命令 / 固定问答 / LLM
→ 小屏显示与播报文本压缩
→ AssistantResponse JSON
```

核心模块之间通过 `ASRBackend`、`LLMBackend`、`OutputAdapter` 和
`DuplexTransportAdapter` 抽象接口解耦。详细设计见
[docs/design.md](docs/design.md)。后续开发、扩展和排错请参考
[开发与调试指南](docs/development-guide.md)。

## 两种交互模式

- `command`：默认模式。优先匹配本地动作命令或固定问答；未匹配时默认调用一次
  指南智能体给出简短回答，但不会改变 session 模式。
- `llm`：把识别文本交给 LLM，并保存每个 session 独立的最近 6 轮历史。

外部控制信号：

| 信号 | 行为 |
| --- | --- |
| `auto` | 根据语音与 session 当前模式决定 |
| `command_mode` | 仅本次请求强制固定模式 |
| `llm_mode` | 仅本次请求强制 LLM，不永久切换 |
| `enter_llm_mode` | session 持续进入 LLM 模式 |
| `exit_llm_mode` | session 退出 LLM 并清空历史 |
| `cancel` | 立即取消，不读取 WAV |

语音中的停止、取消和退出聊天是全局命令，在两种模式下都优先处理。进入 / 退出
模式的语音本身不会发送给 LLM。

## 安装

```bash
python3.11 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

开发与测试：

```bash
pip install -r requirements-dev.txt
```

标准安装包含 faster-whisper 本地推理依赖。模型文件不进入 Git；当前工作区已将
small 模型保存在 `models/faster-whisper-small/`。

## 配置

默认读取仓库根目录的 `config.yaml`，也可以用 `--config` 指定其他 YAML。
所有字段都有默认值；未知字段、错误类型、非法时长或阈值会被拒绝。

重要配置：

- `asr.backend`: `mock` 或 `faster_whisper`
- `interaction.unmatched_command_behavior`: `prompt`、`guide`（默认）或 `llm`
- `command.fuzzy_threshold`: 模糊匹配最低分
- `llm.backend`: `mock`、`openai` 或 `openai_compatible`
- `output.json_output_path`: JSON 文件输出路径

Mock ASR 默认按文件名映射，例如 `home.wav` → “返回主页”、`name.wav` →
“你叫什么名字”、`rl.wav` → “什么是强化学习”。也可以在配置中增加：

```yaml
asr:
  backend: mock
  mock_transcripts:
    custom.wav: 自定义识别文本
```

未匹配策略：

- `prompt`：只返回固定的“没有找到指令”提示，不调用 LLM。
- `guide`：调用一次指南智能体，使用专用简短提示词，不读取或写入聊天历史；
  `AssistantResponse.mode` 为 `llm`，metadata 包含 `llm_role: guide`，但 session
  仍保持 `command`。
- `llm`：按完整聊天提示词调用 LLM，并写入对话历史。

指南智能体适合 AUTO 下的一般知识问答和简短澄清。它不会声称已执行设备操作；
复杂连续对话仍需使用“进入聊天模式”或 `enter_llm_mode`。

## CLI

```bash
python -m app.main \
  --wav ./input/home.wav \
  --signal auto \
  --session bot-001 \
  --output console
```

常用示例：

```bash
# 固定模式
python -m app.main --wav ./input/home.wav --signal command_mode

# 本次强制使用 LLM
python -m app.main --wav ./input/rl.wav --signal llm_mode

# 进入持续 LLM 模式
python -m app.main --wav ./input/enter.wav \
  --signal enter_llm_mode --session bot-001

# 写入 output/latest_response.json
python -m app.main --wav ./input/home.wav --output json
```

注意：每次 CLI 调用都是独立进程，因此内存 session 不跨 CLI 进程保留。持续会话
应在同一长驻进程中复用一个 `VoicePipeline` / `ModeManager`；未来传输服务也应
采用这种方式。

## faster-whisper

安装运行依赖：

```bash
pip install -r requirements.txt
```

修改配置：

```yaml
asr:
  backend: faster_whisper
  model: models/faster-whisper-small
  model_dir: models
  device: cpu
  compute_type: int8
  language: zh
```

当前仓库配置直接从 `models/faster-whisper-small/` 离线加载。若把 `model`
配置为 `small` 等模型名，首次识别时会下载到 `model_dir`。同步推理通过工作
线程执行，固定 `language: zh`、`task: transcribe` 并开启 `vad_filter`，不会
阻塞 asyncio 事件循环。后续可通过配置切换 `base`、`medium` 等模型，或新增
其他 `ASRBackend`，Pipeline 无需修改。

## OpenAI 兼容 LLM
先在 shell 中进行环境变量设置

```bash
export OPENAI_API_KEY="..."
```

```yaml
llm:
  backend: openai_compatible
  model: your-model-name
  base_url: https://your-compatible-endpoint/v1
  api_key_env: OPENAI_API_KEY
  timeout_seconds: 30
```

客户端要求 JSON 对象输出并校验文本字段。网络异常转换为 `llm_error`；无法解析
的内容使用安全回退回答。

DeepSeek 示例：

```bash
export DEEPSEEK_API_KEY="..."
```

```yaml
llm:
  backend: openai_compatible
  base_url: https://api.deepseek.com
  api_key_env: DEEPSEEK_API_KEY
  model: your-deepseek-model
```

为兼容旧配置，直接把 `https://...` 写进 `llm.backend` 也会被识别为 OpenAI
兼容地址，但推荐始终使用独立的 `base_url` 字段。

环境变量必须在启动 CLI 的同一个终端或父进程中设置。可以先确认：

```bash
test -n "$DEEPSEEK_API_KEY" && echo "key configured"
```

常见结构化错误包括 `llm_api_key_missing`、`llm_authentication_error`、
`llm_model_not_found`、`llm_rate_limited`、`llm_timeout` 和
`llm_connection_error`。

## 输出示例

```json
{
  "success": true,
  "mode": "command",
  "transcript": "返回主页",
  "display_text": "正在返回主页。",
  "spoken_text": "正在返回主页。",
  "emotion": "neutral",
  "action": "ui.home",
  "metadata": {
    "audio_duration_seconds": 0.5,
    "asr_latency_ms": 0.02,
    "command_score": 100.0,
    "total_latency_ms": 0.3
  },
  "error": null
}
```

终端适配器输出格式化 JSON；文件适配器以 UTF-8、`ensure_ascii=false` 和两空格
缩进写入 `output/latest_response.json`。日志写入 `logs/assistant.log`，不会记录
API Key。

## 测试

```bash
python -m pytest -q
python -m scripts.smoke_test
```

离线 smoke test 覆盖固定命令、固定问答、Mock LLM、持续进入 / 退出模式、单次
强制命令 / LLM、损坏 WAV、空识别结果和 JSON 文件输出。

## 尚未实现

- Bot 与电脑之间的实时音频传输
- WebSocket / HTTP / 串口服务实现
- TTS
- 真实 UI、音量和播放控制
- 真实打印机控制
- session 数据库持久化

后续传输接入需要实现 `DuplexTransportAdapter.receive_request()` 和
`OutputAdapter.send_response()`，将协议消息转换为 `AudioRequest`，并把
`AssistantResponse` 序列化回传。Pipeline 无需随协议变化。
