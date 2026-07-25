# Zeabur 云端 + 本地 Bot 网关部署

目标架构：

```text
Bot ──局域网──> 本地电脑网关 ──WSS 出站连接──> bot-cloud (Zeabur)
                                                    │
                                                    ├─ VAD / ASR / 手势 / LLM
                                                    ├─ 照片与信件处理
                                                    └─ WebSocket 指令回传
                         <── 表情/打印指令 ──────────┘

浏览器 ──HTTPS──> web (Zeabur) ──> /data/letters.sqlite 持久卷
bot-cloud ──Zeabur 内网 HTTP──> web
```

本地电脑不再运行 ASR、手势识别或 LLM，只接收 Bot 的 PCM/JPEG、封装转发，
并执行云端返回的 OLED 表情和热敏打印指令。本地连接由内向外发起，不需要路由器
端口映射。

## 一、在 Zeabur 创建服务

从同一个 Git 仓库创建两个服务，服务名分别设为 `cloud` 和 `web`。Zeabur 会按
名称自动选择 `Dockerfile.cloud` 和 `Dockerfile.web`。

### cloud 服务

设置：

```text
BOT_GATEWAY_TOKEN=<至少 32 字节的随机字符串>
AI_BOT_ASR_BASE_URL=https://你的-OpenAI-compatible-ASR-服务/v1
AI_BOT_ASR_MODEL=whisper-1
AI_BOT_ASR_API_KEY=<ASR API Key>
AI_BOT_LLM_BASE_URL=https://你的-OpenAI-compatible-服务/v1
AI_BOT_LLM_MODEL=<模型名>
AI_BOT_LLM_API_KEY=<API Key>
AI_HUB_WEB_URL=http://<web 服务的 Zeabur 私网主机名>:<私网端口>
AI_HUB_BRIDGE_TOKEN=<与 web 服务相同的随机字符串>
```

给服务生成一个 HTTPS 域名。不要手工固定 `PORT`，应用会读取 Zeabur 注入的值。

挂载一个持久卷：

```text
卷名: cloud-data
挂载目录: /data
```

该卷保存照片、信件预览和日志。默认云端配置通过
`/audio/transcriptions` 调用外部 ASR，不再下载或运行 Faster Whisper。

### web 服务

设置：

```text
AI_HUB_BRIDGE_TOKEN=<与 cloud 服务相同的随机字符串>
```

挂载一个持久卷：

```text
卷名: web-data
挂载目录: /data
```

给服务生成 HTTPS 域名。网页用户、登录会话和信件都保存在
`/data/letters.sqlite`。

在 web 服务的 Networking 页面复制私网主机名，填入 cloud 服务的
`AI_HUB_WEB_URL`，格式为 `http://主机名:端口`（本镜像通常为 `8080`，以
Networking 页面显示为准）。两个服务之间走 Zeabur 私网，
网页服务的公开域名只给浏览器访问。

## 二、启动本地网关

本地仍使用 `config/app.yaml` 中的 Bot 音频端口、图片端口、ESP 地址和打印机
配置。安装轻量依赖：

```bash
python -m venv .venv-gateway
source .venv-gateway/bin/activate
pip install -r requirements-gateway.txt
```

设置连接信息：

```bash
export BOT_CLOUD_URL="wss://<cloud 域名>/api/gateway"
export BOT_GATEWAY_TOKEN="<与 cloud 服务相同的令牌>"
# 可选；默认使用电脑主机名
export BOT_GATEWAY_ID="home-computer"
python -m app.gateway_main
```

网关连接成功后会显示 6 位配对码。用户登录 Web 服务，在“绑定这台电脑上的
Bot”中输入配对码。当前电脑同一时间只绑定一个用户；用户退出登录时自动解绑。
首次配对后，只要网关没有重启，在同一浏览器登录另一个账号会自动切换绑定。
写信开始时会锁定当前用户，因此会话过程中切换账号不会改变信件归属。

仅测试链路、不实际操作 OLED 和打印机时，可以添加 `--dry-run`。

网关会监听现有 Bot 协议：

- TCP `8080`：16 kHz、单声道、signed 16-bit little-endian PCM；
- HTTP `8081/upload`：JPEG；
- ESP OLED 与打印机仍使用 `config/app.yaml` 中的局域网地址。

## 三、验收

1. 打开 `https://<cloud 域名>/api/health`，确认云端服务运行。
2. 启动本地网关，日志应出现 `connected to cloud runtime`。
3. Bot 发送音频后，云端健康接口的 `audio.frames_received` 应持续增加。
4. Bot 上传 JPEG 后，云端应产生视觉事件。
5. 网页登录并输入终端配对码，确认页面显示网关在线。
6. 触发写信，确认信件保存到开始写信时的用户空间，且没有信件打印指令。
7. 退出登录后再次开始写信，确认返回 `user_not_bound`。
8. 重启 web 服务后重新登录，确认用户和信件仍存在。

生产环境不要在 Git、日志或 YAML 中保存三个令牌/API Key。令牌只放在 Zeabur
变量和本地操作系统的安全环境变量中。
