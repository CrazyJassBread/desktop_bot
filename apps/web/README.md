# PrintPal Voice Control + Community + Letter MVP

无数据库的产品接口验证版本。统一语音控制、认证、社区、匹配、Letter、设备和打印状态全部通过
`/api/v1` 接口运行；服务重启后用户新增数据和会话重置。

## 启动

```bash
npm run dev
```

- Web：`http://127.0.0.1:18000`
- 统一语音控制：`http://127.0.0.1:18000/`
- 对话记录：`http://127.0.0.1:18000/conversations`
- 打印记录：`http://127.0.0.1:18000/prints`
- 账号设置：`http://127.0.0.1:18000/account`
- 社区：`http://127.0.0.1:18000/community`
- 匹配：`http://127.0.0.1:18000/match`
- Letter：`http://127.0.0.1:18000/letter`
- 图像工作台：`http://127.0.0.1:18000/images`
- 设备：`http://127.0.0.1:18000/device`
- 设备模拟器：`http://127.0.0.1:18000/simulator.html`
- API 健康检查：`http://127.0.0.1:18000/health`

## 本地成品账号

- `hello@aihub.local` / `Demo1234`（绑定当前 ESP32）
- `aiko@aihub.local` / `Aiko1234`
- `mina@aihub.local` / `Mina1234`
- `noah@aihub.local` / `Noah1234`

演示邮箱均视为已验证，不依赖真实邮件服务。

## 已接入接口

- `GET /api/v1/ai/status`
- `GET /api/v1/auth/session`
- `POST /api/v1/auth/{register|login|logout|forgot-password|reset-password}`
- `GET/PATCH /api/v1/account`
- `POST /api/v1/voice/turns`
- `POST /api/v1/voice/print-jobs`
- `GET /api/v1/photos`
- `POST /api/v1/photos`
- `POST /api/v1/photos/hardware`
- `POST /api/v1/printer/photos/:photoId`
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

## 图像与热敏打印

- 网页端可通过浏览器 `getUserMedia` 使用电脑或手机摄像头拍照，也可从本地相册上传
  JPG、PNG 或 WebP。
- 图像模块不调用云端图片模型。拍照或上传后，由服务端执行 384px 缩放、像素化、
  灰度量化和 Canny 轮廓增强，再生成热敏打印预览。
- 上传图片统一由服务端进行 EXIF 方向修正、384px 纸宽适配、像素块缩放、8 级灰度量化
  和 Canny 轮廓增强。默认参数与 `convert_to_pixel.py` 一致：4px、8 级灰度、80/160
  双阈值；不再使用容易产生密集横纹的误差扩散。
- 点击“打印照片”后必须再次确认，随后由
  `POST /api/v1/printer/photos/:photoId` 创建带幂等键的打印任务并经 Device Gateway 下发。
- 图片可通过“加入信件”进入 Letter 编辑页，作为邮件/信件附图随热敏信件模板打印。
- ESP32 侧也可自行完成拍照，再把 JPEG/PNG 以 multipart `image` 字段上传到
  `POST /api/v1/photos/hardware`，图片会出现在同一用户相册。
