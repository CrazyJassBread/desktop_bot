# 本地完整测试

## 1. 首次准备

确认以下内容存在：

```text
.venv/bin/python
config/llm.yaml
models/faster-whisper-small/
models/gesture_recognizer.task
```

建议创建本地设置文件：

```bash
cp .env.local.example .env.local
```

语音写信前，需要在网页注册发件人和收件人账号。发件人通过网关启动时显示的
6 位配对码绑定当前电脑，不再需要配置固定发件人邮箱。

## 2. 一键启动

```bash
./run-demo.sh
```

首次启动需要构建 Docker 镜像。脚本会自动创建演示账号，并用电脑麦克风和
摄像头模拟 Bot；启动服务前会先运行自动测试。看到“本地网关开始监听电脑
麦克风”后，打开终端实际显示的网址。默认是：

- 网页：<http://127.0.0.1:18000>
- App 健康状态：<http://127.0.0.1:8090/api/health>

如果端口已经被其他程序占用，脚本会自动改用后续可用端口，例如把网页改到
`18001`；此时必须使用终端显示的新网址。

演示账号密码均为 `demo-password-123`：

- `demo-sender@local.test`：发件人
- `demo-recipient@local.test`：收件人“演示小明”

终端显示“电脑 Bot 配对码”后：

1. 使用发件人账号登录网页；
2. 在“绑定这台电脑上的 Bot”中输入配对码；
3. 确认页面显示“本机 Bot 已连接”。

如果默认麦克风不正确：

```bash
./run-local.sh --list-mics
./run-demo.sh --input-device 2
./run-demo.sh --camera-device 1
```

如果 macOS 没有授予终端摄像头权限，或摄像头无法读取，演示不会退出，而会
自动切换为图片上传模拟。按照终端显示的地址向
`http://127.0.0.1:8081/upload` 上传 JPEG 即可测试视觉链路。

## 3. 测试智能问答

依次说，每句话说完后稍作停顿：

```text
进入问答模式
请介绍一下强化学习
小A，请回答
```

验收结果：

- 终端先显示 ASR 转写；
- App 产生 `llm.session_started`、`llm.transcript_buffered`；
- 最后产生 `llm.answer_completed`，其中包含回答文本。

也可以一次说出“帮我回答什么是强化学习”，系统会把启动短语后面的内容直接
作为问题。

## 4. 测试语音写信

依次说：

```text
我要给演示小明写信
正文：谢谢你最近的帮助，祝你一切顺利
小A，完成写信
```

验收结果：

- App 产生 `llm.letter_completed`；
- 信件 PNG 生成成功；
- 不产生信件打印指令；
- 双方账号均已注册时，信件会出现在网页收件箱和已发送列表；
- 退出发件人账号后再次写信，应产生 `user_not_bound`，而不是保存到旧账号。

## 5. 测试手势拍照并打印

默认情况下电脑摄像头会持续作为 Bot 视觉输入。面对摄像头稳定举出
`Victory` 手势，等待约一秒即可触发拍照。

如果不希望使用摄像头，可运行 `./run-demo.sh --no-camera`，再准备一张清晰
包含 `Victory` 手势的图片，连续发送数次：

```bash
for i in 1 2 3 4; do
  curl -sS -X POST \
    -H "Content-Type: image/jpeg" \
    --data-binary @victory.jpg \
    http://127.0.0.1:8081/upload
done
```

验收结果：

- App 产生 `gesture.victory`；
- 倒计时后产生 `photo.captured` 和 `photo.completed`；
- 安全演示模式下显示 `dry-run print`。

没有手势样例图时，也可以先用语音“请拍照”测试拍照与打印链路；此时仍需先向
`8081/upload` 发送至少一张普通 JPEG，供系统保存为当前画面。

## 6. 停止和排错

前台运行时按 `Ctrl+C`。网页数据库、生成的信件、照片和日志保存在 Docker
数据卷中，不会随普通停止操作删除。如果服务留在后台：

```bash
./stop-local.sh
```

查看服务状态和日志：

```bash
docker compose -f compose.local.yaml ps
docker compose -f compose.local.yaml logs --tail=100 cloud
docker compose -f compose.local.yaml logs --tail=100 web
```

浏览器的 Web Speech API 只适合以后增加“网页直接说话”的演示入口。它的浏览器
兼容性、权限和离线能力不统一，而且无法直接接收 Bot 的 TCP 音频，因此当前
完整链路仍使用本地 Faster Whisper；Zeabur 生产环境可切换到外部 ASR API。
