# AI Hub Letter Space

精简后的网页端只负责四件事：

- 用户注册与登录；
- 使用 SQLite 持久保存用户、会话和信件；
- 展示当前用户的全部、收件和已发送信件；
- 接收 App 完成的语音信件，并让同一封信同时出现在发件人与收件人的信件空间。

社区、匹配、浏览器语音、照片、设备管理和打印接口均已移除。

## 运行

需要 Node.js 22 或更高版本。

```bash
cd integrations/ai-hub-os-web
cp .env.example .env.local
```

编辑 `.env.local`，为 `AI_HUB_BRIDGE_TOKEN` 设置一个足够长的随机值，然后加载
环境变量并启动服务：

```bash
set -a
source .env.local
set +a
npm run dev
```

访问 `http://127.0.0.1:18000`。数据库默认保存在
`data/letters.sqlite`，服务重启后数据仍然保留。

## 连接 App 语音写信

先在网页注册发件人和收件人账号。启动 App 前设置：

```bash
export AI_HUB_SENDER_EMAIL="sender@example.com"
export AI_HUB_BRIDGE_TOKEN="与网页端相同的令牌"
```

`config/app.yaml` 中的 `web_letter_sync.enabled` 已开启。App 收到
`llm.letter_completed` 后，会把信件发送到：

```text
POST /api/v1/app/voice-letters
Authorization: Bearer <AI_HUB_BRIDGE_TOKEN>
```

App 使用 `AI_HUB_SENDER_EMAIL` 找到发件人。语音中的收件人可以是已注册用户的
邮箱或昵称；如果昵称重名，需要说出或传入准确邮箱。写入成功后，数据库只保存
一条信件记录，发件人可在“已发送”查看，收件人可在“收件”查看。

App 事件 ID 会作为幂等键；网络重试不会重复生成同一封信。

## API

```text
GET  /health
POST /api/v1/auth/register
POST /api/v1/auth/login
POST /api/v1/auth/logout
GET  /api/v1/auth/session
GET  /api/v1/letters?box=all|inbox|sent
POST /api/v1/app/voice-letters
```

登录使用 HttpOnly、SameSite=Lax 会话 Cookie，密码使用随机盐和 scrypt
派生后存储。App 写信接口独立使用共享令牌，不接受浏览器登录 Cookie 代替。

## 验证

```bash
npm test
npm run build
```
