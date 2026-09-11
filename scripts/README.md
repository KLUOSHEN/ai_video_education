# 工具脚本

- `check-deploy.mjs`：检查 Node 版本、必要文件、静态构建和生产环境配置。
- `smoke-test.mjs`：临时启动主服务，检查首页、本地静态资源、健康接口和敏感路径隔离。
- `diagnostics/check-skilltree-depth.js`：检查技能树层级和倒挂边。
- `diagnostics/inspect-tasks.js`：查看本地 `data/store.json` 中的任务概要。
- `diagnostics/inspect-slides.js`：查看指定历史任务的幻灯片字段。
- `diagnostics/inline-next-export.mjs`：把 `out/index.html` 及其资源内联到根目录 `landing.html`。

优先通过根目录 `package.json` 中的 npm scripts 执行，路径会自动以仓库根目录解析。
