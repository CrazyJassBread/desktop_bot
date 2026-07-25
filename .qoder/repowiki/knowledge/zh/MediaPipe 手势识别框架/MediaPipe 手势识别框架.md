---
kind: external_dependency
name: MediaPipe 手势识别框架
slug: mediapipe
category: external_dependency
category_hints:
    - framework_behavior
scope:
    - '**'
---

### MediaPipe 手势识别框架
- 角色：视觉手势识别后端，支持最多2只手的同时检测，输出label、confidence和handedness信息
- 集成点：app/vision/mediapipe_gesture.py中使用GestureRecognizer，RunningMode.IMAGE，CPU delegate
- 使用模式：对每只手的检测结果只取置信度最高的类别，低于score_threshold的检测被过滤
- 配置：config.yaml中vision.backend="mediapipe"，gesture_model="models/gesture_recognizer.task"，max_hands=2
- 验证：需参考official docs确认GestureRecognizer的具体API和手势分类器配置