# 生产部署与 DevOps

## 1. 环境

| 环境 | 用途 | 数据 |
|---|---|---|
| local | 开发，Docker Compose | 生成数据 |
| test | CI/Testcontainers | 临时 |
| staging | 发布验证/迁移演练 | 脱敏或合成 |
| production | 公网服务 | 真实数据 |

环境完全隔离账号、数据库、桶、MQTT namespace、LLM Key 和域名。禁止 staging 调用生产设备。

端口分配以同目录的《端口与服务注册表》为唯一事实源。宿主机开发映射使用
`18000–18999` 专属号段；生产默认只公开 80/443，Phase 3 启用设备直连后才开放
8883。任何新增服务应先登记端口，再修改 Compose/Helm/防火墙。

## 2. 起步部署拓扑

早期推荐一台应用机 + 托管 PostgreSQL/对象存储，或两到三台主机：

```text
Internet
  -> CDN/WAF
  -> Nginx (80/443)
      -> web containers
      -> api containers
      -> realtime

Private network:
  PostgreSQL
  Redis-cache
  Redis-queue
  MinIO (若非云 S3)
  worker
  agent-runtime
  monitoring
  MQTT broker (Phase 3)
```

单机 Docker Compose 适合验证，不等于高可用。数据库和对象存储优先使用托管服务；若自建，必须配置异机备份和恢复演练。

## 3. 容器标准

- 多阶段构建、固定基础镜像 digest；
- 非 root 用户、只读 rootfs、最小 capability；
- `/health/live` 和 `/health/ready`；
- 优雅终止：停止接流量 → 完成/转移请求和 Job → 关闭连接；
- CPU/内存 limit；
- 镜像不包含 `.env`、模型 Key、源码临时文件；
- 生成 SBOM，扫描 OS/npm/pip 依赖；
- 镜像以 commit SHA 标记，不使用不可追踪 `latest` 部署。

## 4. Nginx/Ingress

职责：

- TLS 1.2+、HTTP/2/3（环境支持时）；
- HSTS、安全头、请求体上限；
- `/api`、`/_next`、静态资源路由；
- WebSocket upgrade 和 SSE 禁用缓冲；
- 基础 IP 限速（业务限流仍在 API）；
- 不代理大上传，客户端直传 S3。

示意：

```nginx
location /api/ {
  proxy_pass http://api:3000/;
  proxy_set_header X-Request-ID $request_id;
  proxy_set_header X-Forwarded-Proto $scheme;
  proxy_set_header Host $host;
  proxy_connect_timeout 3s;
  proxy_read_timeout 60s;
}

location /api/v1/agent-runs/stream/ {
  proxy_pass http://api:3000/;
  proxy_buffering off;
  proxy_read_timeout 300s;
}
```

生产配置还需可信代理列表、CSP、证书自动续期和真实 upstream 数量。

## 5. CI/CD

### Pull Request

1. format/lint/typecheck；
2. unit + integration；
3. OpenAPI/事件/数据库 schema drift；
4. 构建 Web/API/Runtime；
5. SAST、Secret scan、依赖和镜像 scan；
6. Playwright P0 E2E；
7. 迁移静态检查和预览环境（有条件）。

### main

1. 构建一次并签名镜像；
2. 推送 Registry；
3. 自动部署 staging；
4. 运行 migration dry-run、smoke、contract、基础性能；
5. 人工批准 production（成熟后可自动 canary）；
6. 数据库 expand migration；
7. 部署 canary → 指标门禁 → 全量；
8. 自动 smoke，失败回滚应用版本；
9. contract/drop 迁移延后到确认旧版本下线。

数据库迁移不能靠“回滚容器”自动逆转；优先前滚修复，破坏性迁移需备份和明确 runbook。

## 6. 发布策略

- Web/API：rolling 或 blue-green；
- Worker：新旧版本兼容队列 payload，按 schema_version 消费；
- Agent Runtime：按 run 固定版本，运行中不热切；
- 数据库：expand/contract；
- 固件：分批 OTA，错误门禁自动暂停。

Feature Flag 按用户百分比/角色/环境，服务端为事实源；Flag 有 owner、到期和清理任务。

## 7. 配置与 Secret

- `.env.example` 只含变量名；
- local 使用不入库 `.env.local`；
- prod 使用 Secret Manager/Vault/KMS；
- TLS、JWT、MQTT、S3、LLM Key 可轮换；
- Secret 访问最小权限并审计；
- 前端只暴露明确的 `NEXT_PUBLIC_*` 非敏感配置。

## 8. 可观测栈

开源自建组合：

- OpenTelemetry Collector；
- Prometheus + Alertmanager；
- Grafana；
- Loki（日志）；
- Tempo/Jaeger（Trace）；
- Sentry 可选用于前后端错误聚合。

Dashboard：

1. 平台总览：流量、5xx、P95、登录/发布成功；
2. 数据库：连接、慢查询、锁、复制/WAL、容量；
3. Redis/队列：内存、命中、backlog、oldest job、DLQ；
4. 文件：上传/扫描成功率、处理延迟、桶容量；
5. Agent：成功率、TTFT、成本、provider 429；
6. IoT：在线设备、连接/断开、命令 ACK、OTA 失败。

告警示例：

- 5 分钟 API 5xx > 3% 且请求量达到阈值；
- P95 持续超 SLO；
- DB 剩余空间 <20%、连接 >80%、复制延迟；
- 队列 oldest job 超 SLA；
- 备份未成功；
- Agent 日预算异常；
- OTA 失败率越过 rollout 门槛。

## 9. 备份与恢复

### PostgreSQL

- 每日 base backup + 连续 WAL，成熟目标 RPO 5 分钟；
- 跨主机/跨区域加密保存；
- 保留 7 日每日、4 周每周、若干月度（按合规调整）；
- 每月自动恢复校验，每季度业务恢复演练。

### 对象存储

- Versioning、生命周期和跨位置备份；
- 数据库 file record 与对象清单定期核对；
- 固件 release 长期不可变；
- 用户删除遵循延迟删除和备份过期机制。

### Redis

Cache 不恢复；Queue 使用 AOF/持久化但仍不能代替业务事实。关键任务在 PostgreSQL 有状态，可由 reconciler 重建。

恢复 Runbook 必须写清负责人、凭证获取、DNS/流量切换、数据校验和用户通知。

## 10. 容量与伸缩

MVP 初始假设需在上线前用压测校准：

- 10k 注册用户、1k DAU；
- 峰值 20–50 RPS；
- 100k 内容/评论；
- 1 TB 对象存储以内；
- Agent/设备尚未全量。

水平伸缩优先 Web/API/Worker；PostgreSQL 先做慢查询和索引，再读副本；Agent 按 provider/CPU/GPU/队列独立伸缩；MQTT Broker Phase 3 做会话/持久订阅容量测试。

容量阈值：

- DB CPU P95 >70% 或连接长期 >70%；
- API 单实例 CPU >65%；
- Queue wait 超 SLO；
- 对象存储未来 90 天达到 80%；
- Agent 并发或 provider rate limit 饱和。

## 11. Kubernetes 迁移条件

满足至少两项再迁移：

- 需要多可用区和自动故障恢复；
- 服务/Worker 类型明显增多；
- Agent/设备负载需独立弹性；
- 频繁发布且 Compose 编排成为瓶颈；
- 团队具备集群、网络、存储与值班能力。

迁移后使用 Helm/Kustomize + GitOps，PodDisruptionBudget、NetworkPolicy、HPA、Workload Identity；数据库/对象存储继续优先托管，不因 Kubernetes 而容器化一切。

## 12. 安全与运维

- 管理入口最小公开，可加 VPN/零信任访问；
- SSH Key、禁止密码、最小 sudo、自动安全更新；
- WAF/防 DDoS、Bot/爬虫限速；
- Egress allowlist 用于 Agent；
- 季度权限审查、依赖更新和漏洞修复 SLA；
- P0 事件有 on-call、状态页、复盘；
- 不在服务器手工修改代码，所有变更通过版本化发布。

## 13. 上线检查表

- [ ] 域名/TLS/HSTS/CSP/CORS；
- [ ] 生产 Secret 和轮换；
- [ ] 数据库迁移/备份/恢复验证；
- [ ] 对象存储 CORS、桶策略、扫描和生命周期；
- [ ] 邮件 SPF/DKIM/DMARC；
- [ ] 限流、上传限制、举报与封禁；
- [ ] 日志脱敏、指标、告警、状态页；
- [ ] 隐私政策、服务条款、社区规范、删除/导出；
- [ ] P0 E2E、性能和安全测试；
- [ ] 回滚、事故、数据泄露、供应商中断 Runbook。
