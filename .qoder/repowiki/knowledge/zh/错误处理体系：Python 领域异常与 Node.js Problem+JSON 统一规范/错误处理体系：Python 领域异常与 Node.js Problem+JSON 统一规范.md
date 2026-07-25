---
kind: error_handling
name: 错误处理体系：Python 领域异常与 Node.js Problem+JSON 统一规范
category: error_handling
scope:
    - '**'
source_files:
    - app/asr/base.py
    - app/asr/faster_whisper_backend.py
    - app/api/server.py
    - apps/web/services/api-client.js
    - apps/web/api/mock-api.mjs
    - apps/web/app.js
---

## 1. 整体方案
本项目采用「分层错误模型」：
- Python 桌面端（aiohttp API + ASR/Vision 等后端）使用**领域异常类**（如 `ASRError`）表达业务失败，HTTP 层通过 aiohttp 的 `web.HTTPNotFound()`、400/202 等状态码返回。
- Node.js Web 前端与服务端（mock-api.mjs）统一遵循 **RFC 7807 Problem Details** 格式（`application/problem+json`），通过 `ApiProblem` 客户端错误类向上抛出，并在 UI 层以 toast 提示或表单字段级错误展示。

## 2. 关键文件与位置
- Python 领域异常定义：`app/asr/base.py`（`ASRError`）、`app/asr/faster_whisper_backend.py`（将第三方库异常包装为 `ASRError`）
- Python HTTP 路由与参数校验：`app/api/server.py`（aiohttp 路由，400/404/202 响应，WebSocket 事件流）
- Node.js 客户端错误封装：`apps/web/services/api-client.js`（`ApiProblem` 类 + `request` 统一 fetch 包装）
- Node.js 服务端问题体生成：`apps/web/api/mock-api.mjs`（`problem(status, code, title, detail, requestId, errors)` 工厂函数）
- 前端全局错误展示：`apps/web/app.js`（toast、表单 field-error、打印作业 error 字段）

## 3. 架构与约定
### Python 侧
- 每个可失败的后端模块定义自己的领域异常基类（目前 `ASRError`），所有实现类在捕获底层异常后重新抛出该领域异常，保证调用方只感知业务语义。
- HTTP 层不捕获业务异常，而是让 aiohttp 直接返回对应状态码；参数校验失败时直接返回 400 JSON，资源不存在返回 404，异步任务接受返回 202。
- WebSocket 事件流中通过 `asyncio.gather(..., return_exceptions=True)` 收集并发异常，避免单个消息失败导致连接中断。

### Node.js 侧
- 服务端统一通过 `problem()` 构造 RFC 7807 结构体，包含 `type`、`title`、`status`、`code`、`detail`、`requestId`、`errors[]` 字段，Content-Type 固定为 `application/problem+json`。
- 客户端 `ApiProblem` 继承 `Error`，保留 `status`、`code`、`problem` 原始体，所有 `fetch` 调用由 `api-client.js` 的 `request()` 统一拦截非 2xx 响应并抛出 `ApiProblem`。
- 前端 UI 层对 `ApiProblem` 做差异化处理：认证过期触发 `aihub:auth-expired` 事件；其他错误通过 `toast(message, 'error')` 提示；表单验证错误写入 `data-field-error` 元素。

## 4. 开发者应遵守的规则
1. **Python 后端**
   - 新增可失败能力时，优先定义领域异常类（参考 `ASRError`），不要直接抛 `Exception`。
   - 在 try/except 中捕获第三方库异常后，用 `raise NewError("..." ) from exc` 保留堆栈链。
   - HTTP 路由仅做参数校验与状态码映射，不吞异常；需要幂等性时使用 `Idempotency-Key` 头。
2. **Node.js 服务端**
   - 所有错误响应必须通过 `problem(status, code, ...)` 生成，禁止直接 `res.send({error})`。
   - 字段级校验错误需填充 `errors` 数组，每项包含 `field` 与 `message`。
   - 每次请求生成 `requestId` 并通过 `X-Request-ID` 响应头回传，便于链路追踪。
3. **Node.js 前端**
   - 所有 API 调用通过 `api.*` 方法发起，不要绕过 `request()` 包装。
   - catch 分支中区分 `ApiProblem`（显示 code + message）与普通 `Error`（显示 message）。
   - 用户可见的错误统一走 `toast()` 或表单 `data-field-error`，不要在 console 上静默忽略。
4. **跨层一致性**
   - 错误码使用大写蛇形命名（如 `REGISTRATION_INVALID`、`AUTHENTICATION_FAILED`、`PAYLOAD_TOO_LARGE`），保持前后端一致。
   - 敏感信息（密码、token）不得进入错误 detail 或 errors 数组。