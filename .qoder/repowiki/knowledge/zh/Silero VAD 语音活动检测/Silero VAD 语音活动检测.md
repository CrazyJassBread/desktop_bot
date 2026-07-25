---
kind: external_dependency
name: Silero VAD 语音活动检测
slug: silero-vad
category: external_dependency
category_hints:
    - framework_behavior
scope:
    - '**'
---

### Silero VAD 语音活动检测
- 角色：实时语音活动检测，使用ONNX模型进行帧级语音概率判断，支持状态保持和reset
- 集成点：app/audio/vad/silero_backend.py中维护hidden state h、cell state c和最近64 samples context
- 配置：config.yaml中vad.backend="silero"，speech_threshold=0.60，release_threshold=0.35
- 约束：必须使用16000Hz采样率和512 sample帧大小，否则启动时会抛出ConfigurationError