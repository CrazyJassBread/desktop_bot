# AI Hub OS 前端交接说明

交接版本：2026-07-25

## 1. 前端技术形态

当前前端是原生 ES Module 单页应用，不依赖 React/Vue 运行时：

- `apps/web/index.html`：HTML 入口
- `apps/web/app.js`：路由、页面模板、交互与 UI 状态
- `apps/web/styles.css`：完整桌面端与移动端样式
- `apps/web/services/api-client.js`：所有平台 API 调用
- `apps/web/services/companion-store.js`：设备与打印任务的前端状态结构
- `apps/web/services/device-bus.js`：设备事件总线预留
- `apps/web/favicon.svg`、`manifest.webmanifest`：品牌与 PWA 元数据

`dist/` 是已构建的静态参考产物。整合到其他框架时，应以 `apps/web/` 中的源码为准。

## 2. 当前保留页面

- `/`：统一语音控制中心
- `/login`、`/register`、`/forgot-password`、`/reset-password`
- `/community`、`/create-post`
- `/match`、`/match/preferences`
- `/letter`、`/letter/create`
- `/profile`、`/account`
- `/conversations`、`/prints`
- `/device`

学习、娱乐、海龟汤和小游戏入口在当前版本中隐藏，不应在新导航中重新显示。

## 3. 后端整合边界

前端统一请求同源 `/api/v1`，入口位于：

```text
apps/web/services/api-client.js
```

如果新前端和 API 不在同一个域名，需要把 `request()` 中的 API 前缀改为环境变量，并在服务端正确配置 CORS 和 Cookie。

认证依赖安全 Cookie：

```js
fetch("/api/v1/...", {
  credentials: "same-origin"
})
```

不要把 Access Token、Refresh Token、DeepSeek Key、MQTT 凭证或 ESP32 局域网 IP 放入浏览器代码。

打印路径必须保持：

```text
浏览器 → 平台 API → Device Gateway/ESP32 → 热敏打印机
```

浏览器不能直接访问打印机 IP。

## 4. 语音整合

网页端使用浏览器 Web Speech API：

```js
window.SpeechRecognition || window.webkitSpeechRecognition
```

- `localhost` 可以进行本地麦克风测试。
- 服务器部署必须使用 HTTPS。
- 用户第一次点击“开始聆听”时，由浏览器请求麦克风权限。
- 语音总控默认开启，自动打印默认关闭。
- 所有真正打印动作仍需用户确认。

## 5. 响应式要求

当前页面已经验证：

- 桌面端：1440 × 900
- 手机端：390 × 844
- 手机端无横向溢出
- 移动端使用底部导航
- 动态助手支持 `prefers-reduced-motion`

整合时不要移除以下核心响应式结构：

- `.topbar`
- `.control-statusbar`
- `.voice-command-stage`
- `.voice-live-panel`
- `.mobile-nav`

## 6. 本地参考运行

压缩包中的 `reference-app` 保留了 Mock API，供 UI 对照和接口联调：

```bash
npm install
copy .env.example .env.local
npm run dev
```

访问：

```text
http://127.0.0.1:18000
```

本地演示账号：

```text
hello@aihub.local / Demo1234
aiko@aihub.local  / Aiko1234
mina@aihub.local  / Mina1234
noah@aihub.local  / Noah1234
```

这些账号只用于本地 Mock，不得直接用于生产环境。

## 7. 已验证项目

- 20 项服务与热敏打印测试通过
- 16 项浏览器流程检查通过
- 登录、注册、会话刷新和退出流程通过
- 社区、匹配和信件路由可访问
- 语音开关默认开启
- 自动打印默认关闭
- 浏览器控制台无错误
- 384px 热敏模板、长文本分页和幂等打印测试通过

## 8. 推荐整合顺序

1. 先迁移全局颜色、排版、按钮、卡片和响应式断点。
2. 迁移登录与统一语音控制中心。
3. 接入 `api-client.js` 对应的认证和会话接口。
4. 迁移社区、匹配、信件、设备与打印记录页面。
5. 接入打印确认、幂等键和任务状态轮询。
6. 最后接入真实 Device Gateway，不在前端保存设备凭证。

