# AI Hub OS Companion + Community + Letter MVP

无数据库的产品接口验证版本。学习、娱乐、生活、社区、匹配、Letter、设备和打印状态全部通过
`/api/v1` 接口运行；服务重启后演示数据重置。

## 启动

```bash
npm run dev
```

- Web：`http://127.0.0.1:18000`
- 学习：`http://127.0.0.1:18000/education`
- 娱乐：`http://127.0.0.1:18000/entertainment`
- 生活：`http://127.0.0.1:18000/life`
- 社区：`http://127.0.0.1:18000/community`
- 匹配：`http://127.0.0.1:18000/match`
- Letter：`http://127.0.0.1:18000/letter`
- 设备：`http://127.0.0.1:18000/device`
- 设备模拟器：`http://127.0.0.1:18000/simulator.html`
- API 健康检查：`http://127.0.0.1:18000/health`

## 已接入接口

- `GET /api/v1/ai/status`
- `POST /api/v1/ai/orchestrate`
- `POST /api/v1/ai/tutor`
- `POST /api/v1/games/turtle-soup/answer`
- `POST /api/v1/ai/ocr`
- `GET /api/v1/photos`
- `POST /api/v1/photos`
- `POST /api/v1/photos/hardware`
- `POST /api/v1/ai/journal/summary`
- `POST /api/v1/ai/fortune`
- `GET/POST /api/v1/posts`
- `GET /api/v1/posts/:id`
- `POST /api/v1/posts/:id/comments`
- `POST /api/v1/posts/:id/reactions`
- `GET /api/v1/matches`
- `POST /api/v1/matches/:id/feedback`
- `GET/POST /api/v1/letters`
- `POST /api/v1/letters/:id/send`
- `POST /api/v1/letters/voice/send`
- `POST /api/v1/ai/letter/{generate|polish}`
- `POST /api/v1/printer/content`
- `POST /api/v1/printer/content/preview`
- `POST /api/v1/printer/text`
- `POST /api/v1/printer/letter`
- `POST /api/v1/printer/letter/preview`
- `GET /api/v1/devices`
- `GET /api/v1/devices/:id/status`
- `PUT /api/v1/devices/:id/print-policy`
- `GET /api/v1/print-jobs`
- `POST /api/v1/print-jobs/:id/device-status`

当前 Repository 为进程内存实现，API Client、状态和错误契约可在接 PostgreSQL 后保持不变。
网页端语音只使用浏览器内置 Web Speech API；硬件侧只接收后端转发的打印任务。
拍照动作由硬件端自己完成，完成后将 JPEG/PNG 以 multipart `image` 字段上传到
`POST /api/v1/photos/hardware`，应用端只负责相册展示、热敏像素化和 Letter 附图打印。

## 浏览器语音转文字

浏览器语音入口使用标准或 Chromium 前缀的 Web Speech API：

```js
window.SpeechRecognition || window.webkitSpeechRecognition
```

实现位于：

- `services/browser-speech-recognition.js`：识别生命周期、连续聆听、静音检测和错误处理；
- `app.js` 的 `startVoiceRecognition()`：更新输入框并把最终文字交给现有语音指令流程；
- `tests/browser-speech-recognition.test.mjs`：标准/前缀 API、静音提交、自动续听和权限错误测试。

行为约定：

- 实时显示临时和最终识别文本；
- 最后一次识别结果后静音 4 秒自动提交；
- 浏览器提前结束识别时自动续听；
- 再次点击麦克风按钮可以手动结束；
- 每次最多提交 1,500 个字符；
- 不支持 Web Speech API 或麦克风权限被拒绝时保留文字输入。

本地 `localhost` 可以使用麦克风；非本地部署必须通过 HTTPS 才能稳定申请浏览器
麦克风权限。浏览器语音输入与 ESP32 TCP PCM 输入是两条不同链路。
