---
kind: build_system
name: 构建系统与制品管理（Node.js + Python 双栈 MVP）
category: build_system
scope:
    - '**'
source_files:
    - package.json
    - requirements.txt
    - pytest.ini
    - apps/web/scripts/build.mjs
    - apps/web/scripts/run-tests.mjs
---

本项目为 PrintPal 桌面陪伴生态 MVP，采用 Node.js Web 前端与 Python 桌面端感知服务的双栈架构。构建系统相对轻量，遵循 MVP 快速迭代风格，尚未引入统一的 Makefile、Dockerfile 或 CI/CD 流水线。

**1. Node.js 前端构建体系**
- 根 `package.json` 定义项目元信息（name: ai-hub-os-companion-mvp, version: 0.5.0），通过 `engines.node >= 22` 锁定运行时版本。
- 构建脚本位于 `apps/web/scripts/build.mjs`：执行静态文件校验（检查 index.html、styles.css、app.js 等必需文件存在且非空）、HTML 模板标记验证（id="app"、manifest.webmanifest、app.js 引用）、将源码复制到 `dist/` 目录并生成 `build-meta.json` 构建产物元数据。
- 测试运行器 `apps/web/scripts/run-tests.mjs` 使用 Node.js 内置 `--test` 模式自动发现 `apps/web/tests/*.test.mjs` 文件，设置 `NODE_ENV=test` 和空 `DEEPSEEK_API_KEY` 环境变量后执行。
- 开发/启动命令通过 `node --env-file-if-exists=.env.local` 加载本地环境变量，支持 `.env.local` 覆盖。

**2. Python 桌面端依赖管理**
- `requirements.txt` 声明核心依赖：numpy>=1.26、PyYAML>=6.0、faster-whisper>=1.2、onnxruntime>=1.14、mediapipe>=0.10、opencv-python>=4.10、Pillow>=10、aiohttp>=3.10，全部使用语义化版本约束。
- `pytest.ini` 配置 pytest：启用 `asyncio_mode = auto`，测试路径为 `tests` 目录，定义 `live` marker 标记需要外部凭据和网络访问的测试用例。
- Python 模块以包形式组织（`app/` 为主应用，`integrations/` 为集成桥接，`scripts/` 为调试工具），无虚拟环境管理脚本，依赖安装需手动执行 `pip install -r requirements.txt`。

**3. 构建流程与约定**
- 前端构建输出到根 `dist/` 目录，包含 HTML、CSS、JS 及 `build-meta.json` 元数据文件。
- 后端无编译步骤，直接通过 `python -m app` 或 `python app/main.py` 运行。
- 测试分离：Node.js 使用内置 `--test` 运行器，Python 使用 pytest，两者均通过根级 npm scripts 统一入口。
- 环境变量通过 `.env.example` 提供模板，运行时通过 `--env-file-if-exists=.env.local` 动态加载。

**4. 缺失的构建能力**
- 无 Makefile、Dockerfile、docker-compose.yml 等容器化配置。
- 无 GitHub Actions / CI 配置文件（`.github/workflows/` 不存在）。
- 无跨平台打包脚本（如 Electron、PyInstaller）。
- 无版本发布自动化，版本号硬编码在 `package.json` 中。

**开发者应遵循的约定**
- 修改前端代码后必须运行 `npm run build` 生成 `dist/` 产物。
- Python 依赖变更需同步更新 `requirements.txt`，并在所有环境中重新安装。
- 新增测试文件需符合命名约定：Node.js 测试放在 `apps/web/tests/*.test.mjs`，Python 测试放在 `tests/` 目录。
- 敏感配置通过 `.env.local` 覆盖，禁止提交实际密钥到版本库。