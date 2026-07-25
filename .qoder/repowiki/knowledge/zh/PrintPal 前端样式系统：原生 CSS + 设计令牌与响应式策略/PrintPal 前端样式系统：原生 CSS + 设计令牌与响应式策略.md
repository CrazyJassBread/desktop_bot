---
kind: frontend_style
name: PrintPal 前端样式系统：原生 CSS + 设计令牌与响应式策略
category: frontend_style
scope:
    - '**'
source_files:
    - apps/web/styles.css
    - apps/web/index.html
    - apps/web/server.mjs
    - apps/web/scripts/build.mjs
    - apps/web/manifest.webmanifest
---

## 1. 样式系统与工具链
- 纯原生 CSS，无任何 CSS-in-JS、Tailwind、Sass/Less 等预处理或框架依赖。
- 通过 `index.html` 直接引入 `/styles.css`，由 Node 静态服务器（`apps/web/server.mjs`）提供。
- 构建脚本位于 `apps/web/scripts/build.mjs`，测试脚本 `run-tests.mjs`，均为自定义 Node 脚本，无 Webpack/Vite 等打包器。
- 项目使用 ES Module（`"type": "module"`），Node >=22 运行环境。

## 2. 核心文件与位置
- 主样式入口：`apps/web/styles.css`（约 356 行，集中管理全部视觉样式）
- HTML 入口：`apps/web/index.html`（引用 favicon、manifest、styles.css、app.js）
- 服务与构建：`apps/web/server.mjs`、`apps/web/scripts/build.mjs`、`apps/web/scripts/run-tests.mjs`
- PWA 配置：`apps/web/manifest.webmanifest`、`apps/web/favicon.svg`

## 3. 架构与设计约定
### 设计令牌（Design Tokens）
- 所有颜色、阴影、字体族均通过 `:root` CSS 变量定义：
  - 色彩体系：`--ink`、`--muted`、`--faint`、`--line`、`--paper`、`--surface` 及主题色 `--blue`、`--rose`、`--mint`、`--amber`、`--lilac`、`--danger`
  - 阴影：`--shadow` 统一卡片投影
  - 字体：`Inter, "SF Pro Display", "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif`，兼顾中英文排版
- 全局基础样式：`box-sizing: border-box`、`scroll-behavior: smooth`、无障碍焦点环 `outline: 3px solid rgba(91,118,176,.25)`

### 组件化命名约定
- 采用 BEM 风格类名：`.hub-app`、`.topbar`、`.page`、`.post-card`、`.composer-card`、`.letter-layout`、`.device-hero`、`.voice-agent-card` 等
- 按钮体系：`.primary-button`、`.outline-button`、`.ghost-button`、`.text-button`、`.round-button`、`.circle-button`、`.avatar-button`
- 状态与反馈：`.loading-view`、`.fatal-state`、`.toast`、`.send-result-card`（success/warning/error 变体）
- 布局容器：`.hub-main`、`.page`、`.home-grid`、`.community-layout`、`.composer-layout`、`.letter-layout`、`.device-content-grid`

### 响应式策略
- 基于 `@media(max-width: ...)` 的断点系统：1080px、820px、600px 三档
- 移动端底部导航 `.mobile-nav`（5 列网格，支持 safe-area-inset）
- 弹性 Grid/Flex 布局，配合 `clamp()` 实现流体字号与间距
- 小屏下隐藏次要元素（如 `.top-search span`、`.desktop-nav`），突出核心操作

### 动画与交互
- CSS 关键帧：`@keyframes loading`（加载指示）、`@keyframes voicePulse`（语音脉冲）、`@keyframes blink`（设备眨眼）、`@keyframes quiz-float`（选项浮动）
- 过渡效果：按钮 hover 的 `transform: translateY(-1px)`、模态框 backdrop-filter 模糊
- 无障碍：`aria-live` 区域、`:focus-visible` 焦点环、语义化标签

## 4. 开发者规范
- **新增样式**：优先复用现有 CSS 变量和类名，避免硬编码颜色值
- **组件样式**：遵循 `.component-name` 命名，保持单一职责，按功能区块组织（Home/Community/Composer/Match/Letters/Device/Profile/Admin/Auth/Companion/Voice/Entertainment/Life）
- **响应式**：使用 `clamp()` 和相对单位，确保 320px+ 可访问性
- **性能**：避免过度嵌套，利用 CSS Grid/Flex 替代复杂布局，减少重绘
- **可访问性**：保留 `aria-live` 区域，为交互元素添加 `:focus-visible` 样式
- **主题扩展**：通过 `:root` 变量扩展新颜色，而非新增全局变量

## 5. 与硬件集成的视觉适配
- 热敏打印预览：`.compose-paper.thermal-preview` 模拟 384px 热敏纸宽度
- 设备模拟器：`.device-avatar`、`.device-screen`、`.eye`、`.mouth` 等类实现桌面机器人小P 的面部表情动画
- 语音控制：`.voice-agent-card.listening` 状态下的脉冲动画，实时反馈录音状态
- 打印队列：`.print-job-row` 展示打印任务状态（success/pending/error）

该样式系统以极简原生 CSS 为核心，通过设计令牌保证视觉一致性，结合响应式断点和无障碍特性，为 PrintPal 的桌面陪伴生态提供了统一的前端美学基础。