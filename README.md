# AI Hub OS · Voice Control + Community + Physical Letter

统一语音控制、用户社区、AI Agent、ESP32-S3 和热敏打印设备组成的桌面陪伴生态 MVP。

## 运行

```bash
npm run dev
```

- 应用：<http://127.0.0.1:18000>
- 统一语音控制：<http://127.0.0.1:18000/>
- 对话记录：<http://127.0.0.1:18000/conversations>
- 打印记录：<http://127.0.0.1:18000/prints>
- 账号设置：<http://127.0.0.1:18000/account>
- 社区：<http://127.0.0.1:18000/community>
- 匹配：<http://127.0.0.1:18000/match>
- Letter：<http://127.0.0.1:18000/letter>
- 设备模拟器：<http://127.0.0.1:18000/simulator.html>
- API：<http://127.0.0.1:18000/api/v1/posts>
- 健康检查：<http://127.0.0.1:18000/health>

当前实现：

- 邮箱注册、登录、退出、密码重置、邮箱验证占位流程和可撤销 Cookie 会话；
- 浏览器语音识别、DeepSeek 对话与统一意图识别；
- 动态桌面助手、语音状态机、文本备用输入和设备执行结果；
- 当前版本隐藏学习、娱乐、海龟汤与小游戏前端；
- 回忆相册、硬件照片自动入库、手机/电脑相册上传和热敏像素化处理；
- 生活化社区 Feed、分类、搜索、发布、详情、评论、点赞和收藏；
- 40/30/20/10 规则匹配展示、关注、忽略和写信入口；
- Letter 收件箱、发件箱、草稿、打印状态和纸张预览；
- AI 生成、口语写信润色和超长内容友好截断；
- Letter 创建、发送、数字送达和 Print Job；
- Letter 写信附图上传，自动适配 58mm / 384px 热敏纸尺寸；
- 384px Paper Letter 热敏模板、实时预览和 `/printer/image` 实体打印；
- 网页端浏览器语音输入，DeepSeek 意图识别、对话、写信、计划整理和打印确认；
- 语音写信支持 `over / 发送信件 / 结束` 自动发送和幂等防重；
- 对话、Todo、普通纸条和 Letter 等 384px 热敏打印模板；
- 所有 AI/语音打印动作均先生成预览，等待点击或二次语音确认；
- 设备状态、自动打印策略、安静时段和远程暂停；
- Letter → Web API → 384px 1-bit 位图 → ESP32 热敏打印机 → 状态回执；
- 登录/注册、账号设置和个人主页；
- 桌面与手机响应式布局；
- `/api/v1` 内存 Repository，数据库暂未接入。

## 本地成品账号

| 用户 | 邮箱 | 密码 | 设备 |
| --- | --- | --- | --- |
| 林安 | `hello@aihub.local` | `Demo1234` | 已绑定当前 ESP32 |
| Aiko | `aiko@aihub.local` | `Aiko1234` | 未绑定 |
| Mina | `mina@aihub.local` | `Mina1234` | 未绑定 |
| Noah | `noah@aihub.local` | `Noah1234` | 未绑定 |

这些是本地演示账号，邮箱已标记为验证通过，不会发送真实邮件。

生产级设计文档位于 `D:\AI_Hub_OS`。当前项目继续使用 `18000`，AI Hub OS 后续服务
使用文档中预留的 `19000–19999` 开发端口段。

## 验证

```bash
npm test
npm run build
```

设备入口：<http://127.0.0.1:18000/device>。当前 Web 与硬件的生产链路只保留
ESP32 热敏打印机输出和硬件照片上传；网页语音使用浏览器 `SpeechRecognition / webkitSpeechRecognition`。
