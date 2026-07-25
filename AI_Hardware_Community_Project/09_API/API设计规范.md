# API 设计规范

## 1. 基础约定

- Base URL：`https://api.example.com/api/v1`
- 数据：`application/json; charset=utf-8`
- 时间：RFC3339 UTC，例如 `2026-07-23T08:00:00Z`
- ID：不透明字符串，不向客户端承诺 UUID 结构
- 鉴权：短期 Bearer Access Token；Refresh Token 使用安全 Cookie
- API 文档：OpenAPI 3.1，CI 检查 breaking change
- 版本：URL 主版本；新增可选字段不升版本，删除/改变语义才升

请求 Header：

```http
Authorization: Bearer <access_token>
X-Request-ID: <optional-client-id>
Idempotency-Key: <required-for-selected-writes>
If-Match: "version-3"
```

响应 Header：

```http
X-Request-ID: req_...
ETag: "version-4"
RateLimit-Limit: 60
RateLimit-Remaining: 42
RateLimit-Reset: 1721720000
```

## 2. 响应模型

单资源直接返回资源；列表：

```json
{
  "data": [],
  "page": {
    "next_cursor": "opaque-token",
    "has_more": true
  }
}
```

Cursor 必须签名/编码，客户端不得解析。稳定排序至少包含 `(sort_field, id)`。

错误：

```json
{
  "error": {
    "code": "VALIDATION_FAILED",
    "message": "请求参数不合法",
    "details": [
      {"field": "title", "reason": "max_length", "limit": 200}
    ],
    "request_id": "req_01...",
    "retryable": false
  }
}
```

状态码：

| HTTP | 用途 |
|---|---|
| 200/201/204 | 成功 |
| 400 | 语法/通用参数错误 |
| 401 | 未认证/令牌失效 |
| 403 | 已认证但无权限 |
| 404 | 不存在或不可见 |
| 409 | 唯一/版本/状态冲突 |
| 413 | 请求/文件过大 |
| 415 | 不支持的媒体类型 |
| 422 | 语义/字段校验 |
| 429 | 限流/配额 |
| 500 | 未知内部错误 |
| 502/503/504 | 依赖失败/过载/超时 |

## 3. 认证 API

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/auth/register` | 注册，需幂等/风控 |
| POST | `/auth/login` | 登录 |
| POST | `/auth/refresh` | 旋转 refresh cookie |
| POST | `/auth/logout` | 撤销当前 session |
| POST | `/auth/logout-all` | 撤销全部 session |
| POST | `/auth/verify-email` | 单次 token 验证 |
| POST | `/auth/password/forgot` | 始终返回通用成功 |
| POST | `/auth/password/reset` | 重置并撤销旧 session |
| GET | `/auth/sessions` | 会话列表 |
| DELETE | `/auth/sessions/{id}` | 撤销指定会话 |

登录响应可返回 access token 和 user；refresh token 只通过 `Set-Cookie`。

## 4. 用户 API

| 方法 | 路径 |
|---|---|
| GET/PATCH | `/me` |
| GET | `/users/{username}` |
| GET | `/users/{username}/contents` |
| GET | `/users/{username}/followers` |
| GET | `/users/{username}/following` |
| PUT/DELETE | `/users/{id}/follow` |
| POST | `/creator-applications` |
| GET | `/me/creator-application` |

公开用户对象不返回 email、精确 IP、封禁内部原因等私有字段。

## 5. 内容 API

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/contents` | 创建草稿 |
| GET | `/contents` | Feed/筛选 |
| GET | `/contents/{idOrSlug}` | 详情 |
| PATCH | `/contents/{id}` | 更新草稿/内容，带 version |
| POST | `/contents/{id}/publish` | 幂等发布 |
| POST | `/contents/{id}/archive` | 归档 |
| DELETE | `/contents/{id}` | 软删除 |
| GET | `/contents/{id}/revisions` | 作者/管理员 |
| GET | `/contents/{id}/assets` | 资源 |

创建草稿：

```json
{
  "type": "project",
  "title": "ESP32 桌面助手",
  "visibility": "public",
  "category_id": "..."
}
```

更新：

```json
{
  "version": 3,
  "title": "新标题",
  "body_markdown": "...",
  "tag_ids": ["..."],
  "project": {
    "repository_url": "https://github.com/...",
    "license_spdx": "MIT",
    "hardware_platforms": ["DNESP32S3"]
  }
}
```

若 version 过期返回 `409 CONTENT_VERSION_CONFLICT` 和当前 version，不返回未经授权的完整内容。

## 6. 互动 API

| 方法 | 路径 |
|---|---|
| GET/POST | `/contents/{id}/comments` |
| PATCH/DELETE | `/comments/{id}` |
| PUT/DELETE | `/contents/{id}/like` |
| PUT/DELETE | `/contents/{id}/bookmark` |
| GET | `/me/bookmarks` |
| POST | `/reports` |

关系接口为幂等；重复 PUT 返回当前状态，不创建重复行。评论 POST 使用 Idempotency-Key，防弱网重复提交。

## 7. 文件 API

### 创建上传意图

`POST /files/upload-intents`

```json
{
  "filename": "board.zip",
  "size_bytes": 123456,
  "mime_type": "application/zip",
  "purpose": "project_attachment",
  "sha256": "optional..."
}
```

响应：

```json
{
  "file_id": "...",
  "upload": {
    "method": "PUT",
    "url": "https://...",
    "headers": {"Content-Type": "application/zip"},
    "expires_at": "..."
  },
  "limits": {"max_size_bytes": 104857600}
}
```

### 完成上传

`POST /files/{file_id}/complete`，服务端 HEAD 校验后进入 scanning。完成并不表示文件可公开。

其他：

| 方法 | 路径 |
|---|---|
| GET | `/files/{id}` |
| GET | `/files/{id}/download`（302/短时 URL） |
| DELETE | `/files/{id}` |
| GET | `/me/files` |

## 8. 搜索与通知

- `GET /search?q=&type=&tag=&sort=&cursor=`
- `GET /notifications?unread=true&cursor=`
- `POST /notifications/read` 批量上限；
- `PUT /notifications/read-all`；
- `GET/PATCH /notification-preferences`。

搜索词最大长度、复杂度与频率受限；响应可返回 `highlights`，必须安全转义。

## 9. Agent API（Phase 2）

| 方法 | 路径 |
|---|---|
| POST/GET | `/agents` |
| GET/PATCH | `/agents/{id}` |
| POST | `/agents/{id}/versions` |
| POST | `/agents/{id}/versions/{version}/publish` |
| POST | `/agent-runs` |
| GET | `/agent-runs/{id}` |
| POST | `/agent-runs/{id}/cancel` |
| GET | `/agent-runs/{id}/events`（SSE） |
| POST | `/agent-runs/{id}/approvals/{approvalId}` |
| POST/GET | `/knowledge-bases` |
| POST | `/knowledge-bases/{id}/documents` |
| POST/GET | `/schedules` |

创建运行：

```json
{
  "agent_id": "...",
  "version": "1.2.0",
  "input": {"question": "..."},
  "conversation_id": "...",
  "max_cost_micros": 200000
}
```

SSE event：

```text
id: 17
event: run.output.delta
data: {"run_id":"...","sequence":17,"text":"..."}
```

事件包括 `run.status`、`run.output.delta`、`tool.requested`、`approval.required`、`tool.completed`、`run.completed`、`run.failed`。客户端重连携带 `Last-Event-ID`。

## 10. Device API（Phase 3）

| 方法 | 路径 |
|---|---|
| POST | `/device-bindings` |
| POST | `/device-bindings/{id}/confirm` |
| GET | `/devices` |
| GET/PATCH/DELETE | `/devices/{id}` |
| POST | `/devices/{id}/commands` |
| GET | `/device-commands/{id}` |
| GET | `/devices/{id}/events` |
| POST | `/devices/{id}/ota` |

设备命令：

```json
{
  "type": "display.text",
  "payload": {"text": "Hello"},
  "expires_in_seconds": 30
}
```

必须传 Idempotency-Key。响应 202 表示接受投递，不代表设备已执行；客户端轮询或订阅 ACK/complete。

## 11. WebSocket

连接：`wss://api.example.com/realtime`，握手使用短期票据，不在 URL 长期暴露 access token。

Envelope：

```json
{
  "type": "notification.created.v1",
  "event_id": "...",
  "sequence": 101,
  "occurred_at": "...",
  "data": {}
}
```

服务端不保证无限历史；断线后客户端以 REST 拉取事实。心跳、最大消息、订阅数和慢消费者策略必须定义。

## 12. 内部 API

Runtime 使用服务身份 + mTLS 或签名 JWT：

- `POST /internal/v1/agent-runs/{id}/events`
- `POST /internal/v1/agent-runs/{id}/complete`
- `POST /internal/v1/voice/turns`
- `POST /internal/v1/devices/{id}/reported-state`

Capability Token 至少包含 `sub`、`aud`、`run_id/device_id`、`scopes`、`exp`、`jti`。内部 API 仍进行对象级授权，不能只因来自内网就信任。

## 13. MQTT 契约

Schema 用 JSON Schema/Protobuf 在 `contracts` 包版本化。命令必须有 message ID、correlation、时间、过期、类型、payload。兼容规则：

- 新增可选字段向后兼容；
- 不复用旧字段改变语义；
- 固件忽略未知可选字段；
- 不兼容变更新 schema/topic 主版本；
- 云端至少支持当前和上一稳定固件协议。

## 14. Webhook（Phase 4）

- 用户配置 HTTPS endpoint 和事件 allowlist；
- body 带 event ID/timestamp；
- HMAC-SHA256 签名，secret 可轮换；
- 重试指数退避，接收端按 event ID 幂等；
- 防 SSRF，不允许内网地址；
- 投递日志和禁用阈值；
- 不在 webhook 发送不必要 PII。

## 15. API 变更流程

1. 修改 OpenAPI/Schema；
2. 生成客户端和契约测试；
3. CI 检测 breaking change；
4. 服务端先支持新旧；
5. 客户端迁移并观测；
6. 公告弃用和截止日期；
7. 移除旧字段/版本。

