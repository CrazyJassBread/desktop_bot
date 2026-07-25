# MIMO Web 前端设计与页面原型

> 实现位置：`apps/web/`  
> 当前实现：原生 ES Modules MVP  
> 目标生产栈：Next.js + React + TypeScript + Tailwind CSS + shadcn/ui + Framer Motion + Zustand

## 1. 设计语言

视觉方向为“未来科技 + 温暖陪伴”，避免传统深色大屏和高饱和霓虹：

- 基础色：暖白 `#F7F5EF`、石墨 `#20221F`；
- 功能色：雾蓝、浅紫、桃色、薄荷绿；
- 字体：现代无衬线负责界面，Georgia/等宽体负责信件与热敏纸；
- 圆角：卡片 20–29px，控件 10–14px；
- 动效：呼吸、眨眼、打印纸伸出、彩蛋和游戏跳跃；
- 信息密度：Dashboard 可扫读，创作页留白充足，设备页强调可控和可追踪。

## 2. 全局布局

桌面端：

```text
┌──────────────┬────────────────────────────────────┐
│ MIMO         │ Page title                 Actions │
│ Today        ├────────────────────────────────────┤
│ Learn        │                                    │
│ Play         │          Route content             │
│ Life         │                                    │
│ Letters      │                                    │
│ Device       │                                    │
│ ──────────── │                                    │
│ Automations  │                                    │
│ Settings     │                                    │
│ Device/User  │                                    │
└──────────────┴────────────────────────────────────┘
```

移动端：顶部保留品牌与设备状态，底部使用六项主导航，所有设备控制按钮满足触控尺寸。

## 3. 页面原型

### Dashboard

- Greeting + 日期；
- 大型 Companion Hero：设备表情、FSM、对话/睡眠快捷键；
- 天气卡；
- 今日 Todo、学习连胜、AI 简报；
- Morning Brief、最近打印纸张预览。

### Education

- 左侧/主区：MIMO Tutor 聊天；
- 右侧：可翻转单词卡、学习进度；
- 手机端按 Tutor → Word → Plan 纵向排列。

### Entertainment

- Cloud Runner：按钮、键盘、手势三种输入；
- 海龟汤：是/否问题、线索、打印；
- Photo to Text：上传/拍照、OCR 结果、AI 总结；
- Daily Egg：每日一次。

### Life

- 手帐编辑器与心情选择；
- AI Reflection；
- 明确“仅供娱乐”的趣味签；
- 一周记忆时间线。

### Social

- AI Letter 表单、语气、生成纸张预览、打印；
- 笔友卡：兴趣、国家/城市、预计数字投递时间；
- AI 仅辅助表达和翻译。

### Device

- 设备插画、在线状态、固件、电量；
- 麦克风、摄像头、打印机、Wi-Fi、距离传感器、像素屏；
- 六项手机遥控；
- Idle / Active / Sleeping 状态机；
- 唤醒、睡眠、重启、软关机；
- 手势映射及实时事件。

### Automations

- 信息源 → AI Agent → 内容 → 打印/显示；
- 定时任务、来源、运行日志、58mm 打印模板。

## 4. 组件边界

```text
components/
├─ layout/
│  ├─ AppShell
│  ├─ Sidebar
│  ├─ MobileNavigation
│  └─ PageHeader
├─ companion/
│  ├─ DeviceAvatar
│  ├─ FsmBadge
│  ├─ HardwareStatus
│  └─ MobileRemote
├─ ai/
│  ├─ TutorChat
│  ├─ AgentPipeline
│  └─ AiReflection
├─ print/
│  ├─ ReceiptPreview
│  ├─ PrintButton
│  └─ TemplateCard
├─ education/
│  ├─ FlashCard
│  └─ StudyPlan
└─ ui/
   ├─ Button
   ├─ Card
   ├─ Switch
   ├─ Dialog
   └─ Toast
```

## 5. 生产版 Next.js 目录

```text
apps/web/
├─ app/
│  ├─ (auth)/login/page.tsx
│  ├─ (auth)/register/page.tsx
│  ├─ (product)/layout.tsx
│  ├─ (product)/page.tsx
│  ├─ (product)/education/page.tsx
│  ├─ (product)/entertainment/page.tsx
│  ├─ (product)/life/page.tsx
│  ├─ (product)/social/page.tsx
│  ├─ (product)/device/page.tsx
│  ├─ (product)/settings/page.tsx
│  └─ (product)/admin/page.tsx
├─ components/
├─ features/
│  ├─ auth/
│  ├─ education/
│  ├─ entertainment/
│  ├─ life/
│  ├─ letters/
│  ├─ device/
│  └─ automations/
├─ lib/
│  ├─ api-client.ts
│  ├─ realtime-client.ts
│  └─ device-command.ts
├─ stores/
│  ├─ device-store.ts
│  ├─ session-store.ts
│  └─ ui-store.ts
└─ types/
```

## 6. 状态策略

| 状态 | 生产实现 | 当前 MVP |
|---|---|---|
| 登录用户 | Server Session / HttpOnly Cookie | LocalStorage |
| 设备影子 | WebSocket + Zustand | DeviceBus + LocalStorage |
| 服务端数据 | TanStack Query | 内存/LocalStorage |
| 表单 | React Hook Form + Zod | 原生 FormData |
| UI 临时状态 | Zustand/组件状态 | DOM 状态 |

设备状态必须区分：

- `desired`：Web 想让设备达到的状态；
- `reported`：设备真实上报状态；
- `connection`：在线、离线、过期；
- `command`：排队、已发、设备 ACK、成功、失败、超时。

## 7. 当前实现说明

由于当前环境无法可靠拉取 npm 包，本轮先使用零依赖 ES Modules 完成可运行产品，而不是
停在静态设计稿。路由、领域状态、设备消息和 UI 组件边界已经按未来 React 迁移设计。
接入可用包管理环境后，可按 feature 逐页迁移为 Next.js，不需要重做信息架构或协议。

## 8. 可访问性与响应式

- 所有核心功能可以通过按钮完成，手势不是唯一入口；
- 表单有可见 label，状态通过文字和颜色共同表达；
- 支持 `prefers-reduced-motion`；
- 关键触控按钮不小于约 40px；
- 820px 以下切换移动导航，560px 以下重排内容；
- 摄像头与麦克风权限只在用户主动触发时请求。
