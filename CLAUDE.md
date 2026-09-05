# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概览

「栈知映」— 以 AI 生成编程教学的搜索、音视频与题目评测服务。**零第三方 npm 依赖**，后端仅用 Node 内置模块（`node:http`/`node:fs`/`node:crypto`/`node:url`/`node:path`），Node ≥ 20。

## 常用命令

```bash
npm start        # 启动服务（node server.js），默认 http://localhost:3000
npm run dev      # 开发模式（node --watch server.js，文件变更自动重启）
npm test         # 单元+集成测试（node --test tests/*.test.js，Node 内置测试运行器，无需安装）
```

无构建、无 lint、无第三方依赖，因此**不需要** **`npm install`**（运行时零依赖包）。PowerShell 脚本受限时用 `npm.cmd`。

# **[http://localhost:3000/](http://localhost:3000/%EF%BC%89)**

## 架构

**`server.js`（1138 行单文件）是整个后端**：HTTP 服务器 + 路由 + 存储 + AI 集成全部在此。启动后同时提供：

- **API**：所有接口前缀 `/api/v1`。核心路由见 [docs/API.md](docs/API.md)：
  - `POST /search` — 搜索词规范化
  - `POST /generations` — 异步课程生成（`202 Accepted`，轮询 `GET /tasks/{id}` → `GET /tasks/{id}/result`）
  - `POST /questions/generate`、`POST /questions/{id}/grade` — 出题/判题
  - `POST /video/generate`、`GET /video/status` — 幻灯片视频生成（异步）
  - `POST /chat` — AI 解题助手，Qwen **SSE 流式**输出
  - `GET /health`、`GET /metrics` — 运维探针
- **静态文件**：`search.html`、`watch.html`、`skill/index.html` 等由同一服务托管，支持 HTTP Range 请求（206）以支持媒体 seek。
- **存储**：JSON 文件存储（运行时自动创建 `data/store.json`）。`store` 对象提供集合式 CRUD（`find`/`add`/`update`）。生产可参考 `database/schema.sql` 换 PostgreSQL。

**关键辅助文件**：

- `mdrender.js` — 共享前端渲染器（Markdown + KaTeX 公式 + highlight.js 代码高亮，CDN 缺失时降级纯文本），`window.renderMarkdown(text)` 返回 HTML
- `vortex.js` — `search.html` 背景动画（canvas），`initVortex()`
- `docs/` — API.md（接口文档）、DEPLOYMENT.md（部署/安全说明）、TEST\_REPORT.md

## AI 提供方与配置（`.env`）

| 平台          | Key                                     | 用途                                                                      | 状态        |
| ----------- | --------------------------------------- | ----------------------------------------------------------------------- | --------- |
| 阿里云百炼 Qwen  | `QWEN_API_KEY`                          | 讲稿/幻灯片生成（`qwen-max`）、AI 出题、CosyVoice TTS（`cosyvoice-v3-flash`）、SSE 解题助手 | **核心，必配** |
| 火山方舟 ARK 豆包 | `ARK_API_KEY`                           | 讲稿生成回退 LLM（`doubao-1-5-pro-32k-250115`）                                 | 回退，建议配    |
| 第三方适配器      | `TTS_PROVIDER_URL`/`VIDEO_PROVIDER_URL` | 通用媒体服务（返回 `{url}`）                                                      | 可选        |

**重要——代码与** **`.env.example`** **不一致，别被误导**：

- `DOUBAO_TTS_API_KEY`、`TTS_PROVIDER` 在 `server.js` **完全未被引用**（豆包 TTS 回退未实现，配音只走 Qwen）。
- `createDoubaoTask`/`getDoubaoTaskStatus`（ARK Seedance 视频）**定义了但从未被调用**——是死代码，当前视频生成实际只产出 SVG 海报。
- 未配置任何 Key 时开发模式也能跑通：用静音 WAV + SVG 课程封面代替真实媒体。

## 两条独立的生成链路（易混淆）

1. **`/generations`（题目精讲课程）**：本地规则出题 → `buildLessonPlan` 构建分镜 → `makeAudio`（第三方 TTS 或静音 WAV）→ `makeVideo`（第三方视频或 SVG 海报）。**不走 Qwen LLM 生成讲稿**。
2. **`/video/generate`（知识幻灯片）**：`generateSlides`（Qwen LLM 生成 6–8 页 HTML 幻灯片 JSON，失败回退 ARK 豆包）→ `createTTS`（Qwen CosyVoice 分块合成合并 mp3）。

## 测试

- 用 Node 内置 `node:test`，`npm test` 跑全部。无单测过滤参数，跑单个文件：`node --test tests/server.test.js`。
- 测试在 `test.before` 中通过 `APP_DATA_DIR`/`APP_STORAGE_DIR` 指向临时目录隔离存储，直接从 `../server` 导入模块并 `server.listen(0)` 起真实 HTTP 服务。
- 覆盖：文本规范化/安全过滤、三类题型生成、分镜构建、判题、加密，以及「搜索 → 异步生成 → 轮询结果 → 判题」的 HTTP 集成链路。

## 约定与安全

- 输入会统一 Unicode NFC、换行与空白；文本上限 4000 字符；`cleanText` 拒绝 `<script>` 等注入内容。
- `API_KEY` 设置后所有 API 需 `Authorization: Bearer` 或 `X-API-Key`；定时安全比较。
- `encryptSensitive` 用 `DATA_ENCRYPTION_KEY`（sha256 派生）做 AES-256-GCM 加密，`userRef` 落盘前加密。
- 限流：每 IP 每分钟 60 请求；请求体 64KB 上限。
- 媒体文件名由时间戳+UUID 生成，不使用用户输入拼路径（防路径穿越）。
- `.env` 不提交仓库；生产按 `database/schema.sql` 接入 PostgreSQL 并用持久队列（Redis/SQS）替代 JSON 存储。

