---
kind: configuration_system
name: 配置系统 — YAML + dataclass 强类型校验与命令行覆盖
category: configuration_system
scope:
    - '**'
source_files:
    - app/config.py
    - config.yaml
    - app/hardware_main.py
    - .env.example
    - tests/test_config.py
---

## 1. 采用的系统与方案
- 配置文件格式：YAML（`config.yaml`），通过 `yaml.safe_load` 加载。
- 配置模型：Python `dataclass`，每个配置段对应一个 dataclass（如 `AudioConfig`、`ASRConfig`、`HardwareConfig`、`VADConfig`、`KeywordConfig`、`PerceptionConfig`、`VisionConfig`、`ApplicationConfig`、`APIConfig`），顶层由 `AppConfig` 聚合。
- 校验机制：自定义 `_validate` 函数对数值范围、端口冲突、阈值顺序、必填字段等进行严格校验，失败时抛出 `ConfigurationError`。
- 运行时覆盖：通过 `argparse` 在 `hardware_main.py` 中提供 `--config`、`--audio-host`、`--audio-port`、`--vision-host`、`--vision-port`、`--session`、`--scale` 等参数，可在启动时覆盖部分配置项。
- 环境变量：`.env.example` 定义了 DeepSeek API Key、ESP32 打印机地址、Web 服务端口等环境变量，供 Node.js Web 端与服务端使用。

## 2. 关键文件与包
- `app/config.py`：核心配置加载与校验逻辑，定义所有 dataclass 模型、`_SECTIONS` 映射、`load_config()` 入口。
- `config.yaml`：仓库级默认配置，包含 audio、asr、hardware、vad、keywords、perception、vision、application、api 等全部配置段。
- `app/hardware_main.py`：CLI 入口，解析命令行参数并调用 `load_config(args.config)` 加载配置，再构建 PerceptionDaemon。
- `app/main.py`：简单转发到 `hardware_main.main`。
- `.env.example`：Node.js/Web 服务端的环境变量模板。
- `tests/test_config.py`：覆盖默认值、仓库配置加载、错误类型/未知段/未知选项/端口冲突等场景的单元测试。

## 3. 架构与设计约定
- **分层结构**：`config.yaml` → `load_config()` → `AppConfig` dataclass → 各子 dataclass → `_validate()` 统一校验。
- **白名单机制**：`_SECTIONS` 字典声明允许的配置段，未知段直接报错；每个 dataclass 通过 `__dataclass_fields__` 拒绝未知字段。
- **强类型约束**：所有数值字段都有正数/整数/非负等校验，端口限制 1–65535 且互不冲突，VAD 阈值必须满足 `0 ≤ release ≤ speech ≤ 1`。
- **依赖约束**：如 Silero VAD 要求 `target_sample_rate=16000`、`audio_frame_samples=512`，否则抛错。
- **可选功能开关**：`hardware.audio_enabled`、`hardware.vision_enabled`、`vad.enabled`、`vision.enabled`、`application.photo_enabled`、`api.enabled` 控制模块启停。
- **运行时覆盖优先级**：命令行参数 > config.yaml > dataclass 默认值。

## 4. 开发者应遵循的规则
- 新增配置项必须在 `app/config.py` 中对应的 dataclass 添加字段，并在 `_SECTIONS` 中注册（如需新段）。
- 所有新增字段需在 `_validate` 中添加类型与范围校验，确保配置安全。
- 不要硬编码配置值，应从 `AppConfig` 读取；如需运行时覆盖，应在 `build_daemon` 中处理对应 CLI 参数。
- 敏感信息（API Key、设备地址等）放入 `.env`，不要写入 `config.yaml` 或代码。
- 修改 `config.yaml` 后需同步更新 `tests/test_config.py` 中的断言，保证配置契约稳定。
- 新增配置段时，保持键名与 dataclass 字段名一致，避免 `_build` 报 unknown options 错误。