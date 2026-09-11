# 部署与维护指南

## 当前部署拓扑

- 主进程：Node.js 20+，入口 `server.js`，默认监听平台注入的 `PORT`。
- 落地页：Next.js 静态导出到 `out/`，仍由主进程托管，不需要单独启动 Next 服务。
- 可选服务：`backend/ai_classroom` 是 Django 原型；只有使用 `/ai-api/*` 时才需要单独部署并配置 `AI_CLASSROOM_BASE`。

## 构建与启动

1. 安装 Node.js 20 或更高版本。
2. 运行 `npm ci` 安装锁定版本的构建依赖。
3. 复制 `.env.example` 为 `.env`，设置生产密钥、正式域名和第三方 AI 服务。
4. 运行 `npm run build` 生成 `out/`；缺少这一步时 `/` 首页不可用，但 `/search.html` 仍能打开。
5. 依次运行 `npm test`、`npm run smoke` 与 `npm run check:deploy -- --strict`。
6. 运行 `npm start`，健康探针使用 `/api/v1/health`。

运行时自动创建 `data/store.json` 和 `storage` 下的产物目录；媒体文件名由时间戳和 UUID 组成，不使用用户输入拼接路径。

推荐平台命令：

```text
Build: npm ci && npm run build
Start: npm start
Health: /api/v1/health
```

## 生产环境变量

至少配置：

- `API_KEY`：保护 API 的访问凭证。现有浏览器页面不会把密钥写入前端；启用后需由可信反向代理为同站 API 请求注入 `X-API-Key`，否则页面调用会返回 401。公开演示若不启用它，应在平台入口使用整站访问控制。
- `DATA_ENCRYPTION_KEY`：至少 32 字节的随机值，不能沿用示例值。
- `CORS_ORIGIN`：正式前端来源，例如 `https://example.com`，不要使用 `*`。
- `QWEN_API_KEY` 或 `ARK_API_KEY`：至少配置实际生成链路使用的一项。
- `APP_DATA_DIR`、`APP_STORAGE_DIR`：指向平台的持久卷；容器临时磁盘重启后会丢失数据。

第三方模型、TTS 和视频服务的完整变量见根目录 `.env.example`。

若部署在 Railway、Render、Fly.io 或云服务器等容器平台，可直接使用仓库根目录的 `Dockerfile`：

```bash
docker build -t stackknow .
docker run --env-file .env -p 3000:3000 \
  -v stackknow-data:/app/data \
  -v stackknow-storage:/app/storage \
  stackknow
```

容器已使用非 root 用户运行，包含 Node.js 20、Python 与 edge-tts，并内置 `/api/v1/health` 健康检查。`data` 和 `storage` 必须挂载持久卷。

反向代理会设置 `X-Forwarded-For` 时，可配置 `TRUST_PROXY=true`；仅在代理会清除客户端伪造头的情况下启用。`RATE_LIMIT_MAX`、`REQUEST_TIMEOUT_MS`、`HEADERS_TIMEOUT_MS` 和 `KEEP_ALIVE_TIMEOUT_MS` 可按平台限制调整。

## 安全与性能

- 静态文件仅允许公开页面、浏览器资源和 `/storage/` 产物；不要删除 `server.js` 中的公开路径白名单。
- 生产环境请将 `CORS_ORIGIN` 设置为正式前端域名，且启用 `API_KEY`。
- 服务实施请求大小（8MB）、文本长度、危险文本、路径穿越和每 IP 每分钟 60 请求限制。
- API Key 使用定时安全比较；敏感配置仅放在 `.env`，不要提交到仓库。`database/schema.sql` 中的 `encrypted_profile` 预留了 AES-GCM/密钥托管后的密文存储字段。
- JSON 文件存储适用于单实例演示。并发/多实例生产部署应按 `database/schema.sql` 接入 PostgreSQL，并将任务状态放入持久队列（如 Redis/SQS）。
- 将 `/api/v1/health` 用于负载均衡探针、`/api/v1/metrics` 接入监控；当 `failed` 任务或错误计数持续增长时配置报警。

## 维护

- 执行 `npm.cmd test` 运行单元测试。
- 定期备份 `data/store.json` 与 `storage`；媒体可按业务保留期限迁移到对象存储并删除本地副本。
- 更新第三方 API 时先在预发布环境验证其返回的媒体 URL 可访问，再切换生产配置。
