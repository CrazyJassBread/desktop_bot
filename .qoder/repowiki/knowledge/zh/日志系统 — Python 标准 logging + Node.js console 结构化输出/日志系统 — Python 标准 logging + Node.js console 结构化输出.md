---
kind: logging_system
name: 日志系统 — Python 标准 logging + Node.js console 结构化输出
category: logging_system
scope:
    - '**'
source_files:
    - app/factories.py
    - app/hardware_main.py
    - app/runtime/perception_daemon.py
    - apps/web/server.mjs
    - logs/perception.log
---

## 1. 使用的系统与框架
- Python 侧：使用标准库 `logging`，通过 `logging.basicConfig` 统一配置根 logger，输出到文件与 stdout。
- Node.js 侧：直接使用 `console.log` / `console.error` 输出 JSON 结构化日志，未引入第三方日志框架。

## 2. 核心文件与位置
- `app/factories.py`：集中定义 `setup_logging()`，负责初始化 Python 日志（级别、格式、FileHandler/StreamHandler）。
- `app/hardware_main.py`：入口调用 `setup_logging()`，并以 `desktop_assistant.hardware` 命名空间记录启动/停止信息。
- `app/runtime/perception_daemon.py`：以 `desktop_assistant.perception` 命名空间记录感知事件、ASR/Vision 错误等关键流程。
- `apps/web/server.mjs`：Node 服务用 `console.log(JSON.stringify({...}))` 输出带 `level`、`request_id`、`duration_ms` 的结构化请求日志。
- `logs/`：Python 默认写入 `logs/perception.log`；Node 侧另有 `.server-out.log`、`.server-err.log` 等。

## 3. 架构与约定
- **集中初始化**：所有 Python 进程在启动时调用 `factories.setup_logging(log_path=Path("logs/perception.log"))`，确保日志目录存在并设置统一的 `%(asctime)s %(levelname)s %(name)s %(message)s` 格式。
- **命名空间分层**：每个模块通过 `logging.getLogger("desktop_assistant.<module>")` 获取独立 logger，便于按组件过滤与分级控制。
- **结构化字段**：Node 侧将 `level`、`source`、`request_id`、`method`、`path`、`status`、`duration_ms` 等作为 JSON 字段输出，方便后续聚合分析。
- **双通道输出**：Python 同时写入文件与 stdout，便于容器化场景下由外部日志收集器抓取；Node 侧直接输出到 stdout/stderr，配合 `.log` 文件持久化。

## 4. 开发者应遵循的规则
- **Python**
  - 通过 `import logging; LOGGER = logging.getLogger("desktop_assistant.<your_module>")` 获取模块级 logger。
  - 不要重复调用 `basicConfig`，统一由 `setup_logging()` 管理。
  - 使用 `LOGGER.info/warning/error/exception` 记录业务与异常信息，避免裸 `print`。
  - 对可能抛出的 ASR/Vision 错误使用 `LOGGER.exception(...)` 自动附带 traceback。
- **Node.js**
  - 所有 `console.log` 必须输出可解析的 JSON 对象，至少包含 `level` 和 `source` 字段。
  - 为 HTTP 请求日志携带 `request_id` 以便跨链路追踪。
  - 测试环境可通过环境变量 `NODE_ENV=test` 抑制冗余请求日志。
- **通用**
  - 敏感信息不得写入日志。
  - 日志级别遵循：`INFO` 用于正常业务流程，`WARNING` 用于可恢复异常，`ERROR`/`EXCEPTION` 用于失败路径。