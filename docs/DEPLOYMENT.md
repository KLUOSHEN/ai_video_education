# 部署与维护指南

## 启动

1. 安装 Node.js 20 或更高版本。
2. 在项目目录复制 `.env.example` 为 `.env`，为生产环境设置强 `API_KEY` 和第三方媒体服务地址。
3. 运行 `npm.cmd start`（PowerShell 若限制脚本，使用 `npm.cmd`）。
4. 打开 `http://localhost:3000/search.html`。

无需 `npm install`。运行时自动创建 `data/store.json` 和 `storage/{audio,video,poster}`；媒体文件名由时间戳和 UUID 组成，不使用用户输入拼接路径。

## 安全与性能

- 生产环境请将 `CORS_ORIGIN` 设置为正式前端域名，且启用 `API_KEY`。
- 服务实施请求大小（64KB）、文本长度、危险文本、路径穿越和每 IP 每分钟 60 请求限制。
- API Key 使用定时安全比较；敏感配置仅放在 `.env`，不要提交到仓库。`database/schema.sql` 中的 `encrypted_profile` 预留了 AES-GCM/密钥托管后的密文存储字段。
- JSON 文件存储适用于单实例演示。并发/多实例生产部署应按 `database/schema.sql` 接入 PostgreSQL，并将任务状态放入持久队列（如 Redis/SQS）。
- 将 `/api/v1/health` 用于负载均衡探针、`/api/v1/metrics` 接入监控；当 `failed` 任务或错误计数持续增长时配置报警。

## 维护

- 执行 `npm.cmd test` 运行单元测试。
- 定期备份 `data/store.json` 与 `storage`；媒体可按业务保留期限迁移到对象存储并删除本地副本。
- 更新第三方 API 时先在预发布环境验证其返回的媒体 URL 可访问，再切换生产配置。
