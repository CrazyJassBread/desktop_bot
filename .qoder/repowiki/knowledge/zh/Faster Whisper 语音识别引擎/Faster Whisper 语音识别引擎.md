---
kind: external_dependency
name: Faster Whisper 语音识别引擎
slug: faster-whisper
category: external_dependency
category_hints:
    - sdk_real_api
scope:
    - '**'
---

### Faster Whisper 语音识别引擎
- 角色：中文语音转文本的核心ASR后端，使用CPU int8量化模型进行本地推理
- 使用模式：接收AudioData样本，固定task="transcribe"和language="zh"，vad_filter=False（因为前面已有Silero VAD断句）
- 配置：config.yaml中asr.backend="faster_whisper"，model="small"，device="cpu"，compute_type="int8"
- 验证：需参考official docs确认具体的transcribe方法参数和模型格式