# MIMO AI Desktop Companion Project

> 版本：MVP v0.3  
> 日期：2026-07-23  
> 状态：智能桌面伴侣前端已实现

## 1. 项目一句话

面向个人用户的 AI 智能桌面伴侣：通过 Web 管理 ESP32-S3 的语音、摄像头、
像素屏、传感器和热敏打印机，并让教育、娱乐、生活、信件与自动信息 Agent
形成“用户 → Web → AI → 硬件 → 真实输出”的闭环。社区与市场保留为后续扩展。

## 2. 本轮关键决策

| 领域 | 决策 |
|---|---|
| MVP 范围 | Dashboard、教育、娱乐、生活、AI 信件、设备控制、自动消息与打印 |
| 前端 | Next.js 15+、TypeScript、App Router、Tailwind CSS、shadcn/ui、TanStack Query |
| 核心后端 | NestJS 模块化单体；业务稳定后再按负载拆服务 |
| AI/语音 | Python FastAPI 独立 Runtime；复用 `desktop_bot` 现有 Pipeline |
| 数据库 | PostgreSQL 17；MVP 先用 PostgreSQL 全文检索 |
| 缓存/队列 | Redis + BullMQ |
| 文件 | S3 兼容对象存储；开发/私有化部署使用 MinIO |
| 向量库 | 第二阶段引入 Qdrant，不在 MVP 提前增加运维负担 |
| 设备通信 | MQTT 为设备长连接主通道，HTTPS 负责配网/绑定/升级，WebSocket 面向浏览器实时状态 |
| 部署 | Docker Compose 起步；规模化后迁移 Kubernetes |
| 仓库策略 | Monorepo 管理 Web/核心 API/共享契约；Voice Runtime 与固件可独立仓库、契约版本化 |

## 3. 文档地图

- `01_Product/产品规划与路线图.md`：定位、用户、MVP、指标、商业化和阶段计划
- `02_Architecture/系统架构设计.md`：上下文、模块边界、关键链路、非功能指标与 ADR
- `03_Frontend/前端架构与页面设计.md`：路由、组件、状态、权限、SEO、测试
- `04_Backend/后端服务设计.md`：NestJS 模块、事务、事件、后台和安全设计
- `05_Database/数据库设计.md`：核心 ER、表字段、索引、审计与数据生命周期
- `05_Database/schema.sql`：MVP 可执行的 PostgreSQL DDL 基线
- `06_AI_Agent/AI_Agent架构设计.md`：Agent 定义、运行、权限、RAG、调度和评估
- `07_Hardware/ESP32-S3接入设计.md`：现有仓库审计、设备身份、协议、OTA 和语音链路
- `08_Server/生产部署与DevOps.md`：环境、Compose/K8s 演进、CI/CD、监控、备份和容量
- `08_Server/端口与服务注册表.md`：项目专属端口段、现有/预留服务、公网暴露与冲突检查
- `09_API/API设计规范.md`：REST/WebSocket/MQTT 契约、错误模型、幂等和分页
- `09_API/openapi.yaml`：MVP 核心接口 OpenAPI 3.1 骨架
- `10_Development_Log/2026-07-23_立项与架构基线.md`：本次决策、风险和下一步

## 4. 推荐仓库布局

```text
ai-hardware-community/
├─ apps/
│  ├─ web/                  # Next.js
│  ├─ api/                  # NestJS 模块化单体
│  ├─ worker/               # BullMQ 消费者
│  └─ admin/                # 可先并入 web
├─ packages/
│  ├─ api-client/           # OpenAPI 生成客户端
│  ├─ contracts/            # DTO、事件、MQTT Schema
│  ├─ ui/                   # 设计系统
│  ├─ config/               # ESLint/TS/测试配置
│  └─ observability/        # 日志、Tracing
├─ services/
│  ├─ agent-runtime/        # Python/FastAPI
│  └─ voice-runtime/        # desktop_bot 的服务化封装
├─ firmware/
│  └─ dnesp32s3/            # 真正的 ESP32-S3 固件
├─ infra/
│  ├─ compose/
│  ├─ nginx/
│  ├─ migrations/
│  └─ monitoring/
└─ docs/
```

## 5. 第一批开发 Epic

1. 工程基建与环境：Monorepo、CI、Compose、配置和可观测性。
2. 身份与权限：注册、登录、邮箱验证、刷新令牌、RBAC、封禁。
3. 社区内容：文章/项目/动态统一内容模型、草稿、审核、发布。
4. 互动关系：评论、点赞、收藏、关注、通知。
5. 文件中心：预签名直传、校验、扫描、图片处理、下载计数。
6. 搜索发现：首页、分类/标签、全文检索和基础热榜。
7. 用户中心：资料、作品、收藏、关注关系、创作者认证申请。
8. 管理后台：用户、内容、举报、文件、审计日志。

## 5.1 当前可运行 MVP（2026-07-23）

已在仓库 `apps/web/` 落地无数据库产品验证版，包括 10 个产品路由、响应式手机遥控、
AI 教育/生活/信件交互、自动消息打印流和独立 MIMO One 硬件模拟器。主应用与
模拟器通过设备总线双向传输命令、ACK、设备状态、打印任务和手势事件。

当前运行端口为 `18000`，符合《08_Server/端口与服务注册表.md》。数据库、
真实 MQTT 和真实 ESP32 固件将在模拟联动体验验证后接入。原社区方案文档保留为
历史与第四阶段扩展参考，新版产品、前端和通信方案见对应目录内 `AI智能桌面设备*` 文档。

## 6. Definition of Done

功能只有在满足以下条件后才视为完成：

- 需求验收条件、API 契约、数据库迁移和权限规则齐全；
- 核心单元测试、接口集成测试和关键 E2E 通过；
- 日志不包含密码、令牌、API Key、完整语音或敏感正文；
- 在 staging 通过迁移、回滚、备份恢复和基础压测；
- 可观测：有结构化日志、关键指标、错误告警和 request/trace ID；
- 文档与实现同一次变更提交。
