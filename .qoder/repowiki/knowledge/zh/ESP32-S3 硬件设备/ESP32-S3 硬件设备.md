---
kind: external_dependency
name: ESP32-S3 硬件设备
slug: esp32-s3
category: external_dependency
category_hints:
    - vendor_identity
scope:
    - '**'
---

### ESP32-S3 硬件设备
- 角色：音频采集（I2S/PDM麦克风）和图像捕获（摄像头）的硬件端，主动将数据推送至Python后端
- 集成点：TCP PCM流式传输到8081端口，HTTP POST上传JPEG到8082端口
- 使用模式：ESP32固件负责本地编码（PCM s16le/16kHz单声道，JPEG 640×480），通过TCP/HTTP协议与后端通信
- 配置：在config.yaml中通过hardware.audio_*和hardware.vision_*参数控制监听地址和端口
- 验证：需参考官方ESP32-S3 SDK文档确认具体API实现