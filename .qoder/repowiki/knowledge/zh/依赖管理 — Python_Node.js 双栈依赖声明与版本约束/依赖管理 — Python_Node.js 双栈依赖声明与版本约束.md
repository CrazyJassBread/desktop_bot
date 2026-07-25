---
kind: dependency_management
name: 依赖管理 — Python/Node.js 双栈依赖声明与版本约束
category: dependency_management
scope:
    - '**'
source_files:
    - requirements.txt
    - requirements-dev.txt
    - package.json
    - node_modules/.package-lock.json
    - models/.locks/models--Systran--faster-whisper-small/snapshots
---

## 1. 使用的系统与工具
- **Python 生态**：使用 `pip` + `requirements.txt` / `requirements-dev.txt` 进行依赖声明，未使用 `pyproject.toml`、`poetry` 或 `conda`。
- **Node.js 生态**：使用 `package.json` + `package-lock.json`（lockfileVersion 3）锁定依赖，通过 npm 安装，未启用私有 registry 或 vendoring。
- **模型文件**：语音识别模型通过 HuggingFace Hub 缓存到 `models/.locks/models--Systran--faster-whisper-small/`，由 `faster-whisper` 自动下载与管理。

## 2. 关键文件与位置
- `requirements.txt`：运行时 Python 依赖，包含 numpy、PyYAML、faster-whisper、onnxruntime、mediapipe、opencv-python、Pillow、aiohttp。
- `requirements-dev.txt`：开发依赖，引入 pytest 和 pytest-asyncio，并通过 `-r requirements.txt` 复用运行时依赖。
- `package.json`：根级 Node 项目元数据，声明 node 引擎要求 `>=22`，仅两个直接依赖 `iconv-lite` 与 `sharp`。
- `node_modules/.package-lock.json`：npm 锁文件，记录精确版本与完整性校验哈希。
- `models/.locks/`：HuggingFace 模型缓存目录，按 snapshot hash 固定模型版本。

## 3. 架构与约定
- **分层依赖**：运行时代码与测试依赖分离，通过 `requirements-dev.txt` 引用 `requirements.txt`，避免重复声明。
- **版本约束策略**：Python 依赖普遍采用 `>=X,<Y` 的半开区间约束（如 `numpy>=1.26`、`mediapipe>=0.10,<0.11`），在兼容范围内允许小版本升级；Node 依赖使用 `^` 语义化版本（如 `sharp^0.35.3`）。
- **无私有仓库**：所有依赖均从公共源获取（pypi.org、npmjs.org），未配置 `.npmrc`、`pip.conf` 或 `~/.netrc`。
- **无 vendoring**：未使用 `pip install --no-deps --target` 或 `npm pack` 将依赖打包进仓库，`node_modules` 存在于根目录但被 `.gitignore` 忽略。

## 4. 开发者应遵循的规则
- 新增 Python 依赖时，优先放入 `requirements.txt`，仅在开发工具链中使用时添加到 `requirements-dev.txt`。
- 保持 `>=X,<Y` 的版本区间风格，避免使用 `==` 锁定过死，确保 CI 能拉取安全补丁。
- Node 依赖更新后需提交 `package-lock.json`，保证多环境一致性。
- 模型文件不得手动修改 `models/.locks/` 下内容，应通过 `faster-whisper` 官方机制更新。
- 如需引入私有包，应在根目录添加 `.npmrc` 与 `pip.conf`，并在 README 中说明认证方式。