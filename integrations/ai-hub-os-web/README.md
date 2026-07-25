# AI Hub Letter Space

网页端是一个可以独立部署和使用的写信平台，核心功能包括：

- 用户注册与登录；
- 通过注册邮箱发送和接受笔友申请；
- 向已成为笔友的用户写信和收信；
- 查看收件箱与已寄出信件；
- 新建、继续编辑和删除草稿，寄出后自动移出草稿箱；
- 使用 SQLite 持久保存账户、会话、笔友、草稿和信件。

Bot 语音信件同步接口作为兼容能力保留，但不是网页平台运行或部署的必要条件。
浏览器语音、照片和打印不属于当前网页平台范围。

## 运行

需要 Node.js 22 或更高版本。

```bash
cd integrations/ai-hub-os-web
cp .env.example .env.local
```

直接启动服务：

```bash
npm run dev
```

访问 `http://127.0.0.1:18000`。数据库默认保存在
`data/letters.sqlite`，服务重启后数据仍然保留。

## Zeabur 部署

只部署写信平台时，创建一个名为 `web` 的服务并连接当前 Git 仓库。Zeabur 会使用
仓库根目录的 `Dockerfile.web`。

为服务挂载持久卷：

```text
挂载目录: /data
```

数据库保存在 `/data/letters.sqlite`。不要手工设置 `PORT`；服务会读取 Zeabur
注入的端口。SQLite 部署保持一个服务副本，并为 `/data` 设置定期备份。

纯网页模式不需要创建 `cloud` 服务，也不需要设置 ASR、LLM、Bot 网关或打印机
相关变量。

## 可选：连接 App 语音写信

先在网页注册发件人和收件人账号。Cloud 与网页服务设置相同的内部令牌：

```bash
export AI_HUB_BRIDGE_TOKEN="与网页端相同的令牌"
```

本地网关连接后显示 6 位配对码。发件人登录网页，在信件页面输入该配对码。
同一浏览器会记住本次配对；网关未重启时，切换登录账号会自动切换电脑绑定。
Cloud 会在语音写信开始时锁定当前登录用户。`config/app.yaml` 中的
`web_letter_sync.enabled` 已开启。App 收到
`llm.letter_completed` 后，会把信件发送到：

```text
POST /api/v1/app/voice-letters
Authorization: Bearer <AI_HUB_BRIDGE_TOKEN>
```

App 使用写信开始时锁定的用户 ID 找到发件人。语音中的收件人可以是已注册
用户的邮箱或昵称；如果昵称重名，需要说出或传入准确邮箱。写入成功后，数据库
只保存一条信件记录，发件人可在“已发送”查看，收件人可在“收件”查看。

App 事件 ID 会作为幂等键；网络重试不会重复生成同一封信。

## API

```text
GET  /health
POST /api/v1/auth/register
POST /api/v1/auth/login
POST /api/v1/auth/logout
GET  /api/v1/auth/session
GET  /api/v1/letters?box=all|inbox|sent
POST /api/v1/letters
GET  /api/v1/friends
POST /api/v1/friends/request
POST /api/v1/friends/{user_id}/accept
GET  /api/v1/drafts
POST /api/v1/drafts
PUT  /api/v1/drafts/{draft_id}
DELETE /api/v1/drafts/{draft_id}
GET  /api/v1/gateways
POST /api/v1/gateways/bind
POST /api/v1/app/gateways/presence
GET  /api/v1/app/gateways/{gateway_id}/owner
POST /api/v1/app/voice-letters
```

登录使用 HttpOnly、SameSite=Lax 会话 Cookie，密码使用随机盐和 scrypt
派生后存储。App 写信接口独立使用共享令牌，不接受浏览器登录 Cookie 代替。

## 验证

```bash
npm test
npm run build
```
