# 栈知映（AI Video Education）

AI 教学内容生成与学习平台。当前可部署主体是零运行时依赖的 Node.js 服务：同一进程提供 `/api/v1` API、静态学习页面和 Next.js 导出的落地页。

## 目录结构

```text
.
├─ server.js                 # 主服务、API 路由、静态文件托管
├─ *.html / 浏览器端 *.js    # 当前线上页面（保留根路径以兼容已有 URL）
├─ app/ components/ public/  # Next.js 落地页源码
├─ data/                     # RAG 索引与本地 JSON 数据
├─ storage/                  # 运行时生成的音视频、图片与 PPTX
├─ backend/ai_classroom/     # 可选 Django 原型，由 /ai-api 代理
├─ skill/ skilltree-app/ shu/# 技能树相关静态子应用
├─ scripts/                  # 部署检查与诊断工具
├─ tests/                    # Node 主服务回归测试
├─ database/                 # PostgreSQL 目标结构草案
└─ docs/                     # API、部署、教程与设计说明
```

根目录的 HTML 和浏览器脚本暂不移动：`server.js` 直接按现有 URL 托管它们，移动会破坏书签和页面间跳转。服务端源码、配置、数据和文档已由公开文件白名单隔离，不能通过 HTTP 下载。

## 本地启动

```powershell
npm.cmd ci
Copy-Item .env.example .env
npm.cmd run build
npm.cmd start
```

浏览器打开 `http://localhost:3000/`，核心学习页为 `http://localhost:3000/search.html`。

## 上线前检查

```powershell
npm.cmd test
npm.cmd run build
npm.cmd run smoke
npm.cmd run check:deploy -- --strict
```

详细的环境变量、持久化和反向代理要求见 [部署指南](docs/DEPLOYMENT.md)，接口见 [API 文档](docs/API.md)。

## 两套后端的关系

- `server.js` 是当前主后端，也是 `npm start` 的入口。
- `backend/ai_classroom` 是可选 Django 服务；仅当需要它的独立 API 时部署，并用 `AI_CLASSROOM_BASE` 让 Node 的 `/ai-api/*` 代理过去。
- 单实例演示可继续使用 `data/store.json`；多实例生产环境需要把业务数据和任务状态迁移到 PostgreSQL/队列。
