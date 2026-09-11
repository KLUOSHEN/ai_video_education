# 更新日志

「栈知映」(StackKnow) 的所有值得注意的变更都会记录在此文件中。格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)。

## 2026-09-10

### 新增

- **知识库智能问答（RAG）**：新增 `knowledge.html` 页面，左侧为知识库管理（文档上传入库、标题/分类/来源类型/出处录入、文档与知识片段统计、按分类筛选），右侧为基于检索增强生成的问答——回答附命中来源（可展开原文）并支持连续追问与示例问题。
- **全新 RAG 引擎** **`rag.js`**（零第三方依赖）：文档切片 → 文本向量化 → 余弦相似度 Top-K 检索 → 依据证据作答。向量化优先调用阿里云百炼 DashScope `text-embedding`，未配置 Key 时自动降级为本地字符二元组哈希向量，保证离线可跑通；索引以 `rag-index.json + rag-index.vectors.bin` 双文件持久化，兼容旧稀疏向量迁移。
- **知识库后端接口**（`server.js`，位于 `/api/v1/knowledge/*`）：`GET /knowledge`（列表与统计）、`POST /knowledge/ingest`（入库）、`POST /knowledge/delete`（删除）、`GET /knowledge/doc/<id>`（文档详情）、`POST /knowledge/ask`（带历史上下文的 RAG 问答）。
- **DAG 工作流引擎** **`workflow.js`**（零依赖）：将 `server.js` 中硬编码的多步异步流水线改造为数据驱动的工作流——JSON 描述节点与条件边，按依赖就绪度并发调度，节点状态机含 `pending/running/success/error/skipped`，边条件支持 `success/error/always`，并对定义做结构/引用/无环校验。
- **RAG 注入生成流程**：幻灯片生成接入工作流新节点 `rag_search`（知识库检索），检索到的教学参考片段自动注入提示词作为优先依据，生成内容更贴合自有讲义/教材。
- **AI 白板小课堂·后端接口测试台** **`ai-test.html`**：可视化配置并调用各后端接口（经 `/ai-api/* → Django :8000/api/*` 代理），含后端健康状态徽标与请求/响应面板。
- **首页与导航文案更新**：`landing.html` 及 `components/originkit/ui/hero-35/` 模块描述统一为「搜索 · 生成 · 测评 · 技能树」，突出产品成长路径定位。
- **AI 生成过程可视化**：`search.html` 生成遮罩改为嵌入 workflow 同款 DAG 节点连线动画，节点随流程推进呈现运行/完成/出错状态，过程更直观。

### 移除

- **删除论坛示例**：移除 `forum/`（`forum/index.html`、`forum.css`、`forum.js`）及参考项目 `Design Learning Forum Layout/`。

## 2026-09-05

### 安全

- **移除硬编码密钥**：删除 `server.js` 与 `skilltree-app/server.js` 中硬编码的 DeepSeek API Key，统一迁移至 `.env`（`DEEPSEEK_API_KEY`），避免密钥随代码泄露。

## 2026-09-04

### 新增

- **HTML 版 PPT 与 16:9 舞台演示**：`watch.html` 演示区升级为固定 1920×1080 舞台，整体等比缩放；支持逐页翻页动画、顶部进度条、页脚页码、逐页旁白音频、末页随堂测验，以及核心要点/正文的内联编辑（`contenteditable`，保存到 `localStorage`，键 `watch_deck_edit_<taskId>`）。
- **8 种新图表类型**：散点图 `scatter`、环形图 `donut`、漏斗图 `funnel`、雷达图 `radar`、气泡图 `bubble`、瀑布图 `waterfall`、仪表盘 `gauge`、热力图 `heatmap`（现有图表类型共 17 种），`watch.html` 与 `pptx-svg.js` 均已实现 SVG 渲染。
- **图表类型多样性约束**：生成提示词强制整份 PPT 轮换图表、相邻页不重复、同一图表在一份 PPT 中最多出现 2 次，并鼓励使用散点/环形/漏斗/雷达/气泡/瀑布/仪表盘/热力图等新颖图表。
- **树形图全新布局** **`renderTreeSvg`**：真实树布局（叶子占满全宽、父节点居中于子节点上方），节点半径按标签长度自适应，标签完整显示不截断；支持「根->子->孙」路径行与「每层逗号分隔」两种数据格式。
- **页面布局从 6 种扩展至 11 种**：新增 `chart_top`（图在上、要点在下）、`chart_left`（图在左、要点在右，`two_col` 镜像）、`cards`（四宫格彩色编号卡片 ①②③④）、`timeline`（横向时间线/步骤，编号圆点+连线）、`focus`（金句大字号居中聚焦）；连同原有 `two_col` / `split` / `bottom_bar` / `triple` / `left_text` / `default`。
- **布局程序化去重** **`enforceDistinctLayouts()`**（`server.js`）：LLM 返回幻灯片后、保存前强制执行，保证每一页版式互不相同（页数 ≤ 11 时全篇无重复）；替换时按内容智能选型（有图表页优先 `two_col`/`chart_top`/`chart_left`/`left_text`，对比内容优先 `split`，首页 `default`、末页 `focus`/`bottom_bar`，其余用 `cards`/`timeline`/`triple` 填充）。
- **PPT 编辑模式（✏️ 按钮** **`deckEditBtn`）**：进入编辑模式时音视频自动暂停并锁定播放状态，退出编辑自动恢复播放。

### 优化

- **图表可读性**：图表画布由 520×160 放大至 600×200，内边距加大，图表内字号提升（饼图标签 10→15px、柱状数值 9→14px），内容更分散、不拥挤。
- **正文/要点字号整体加大**（标题保持 96px 不变）：正文 `.dk-col`/`p` 40→35px、要点 `.vcard li` 35px、表格 `th/td` 33px、安全区 `.dk-pad-area` 40px、要点列表 `ul/li` 16px、纯文本要点多行 22px、代码块 16px。
- **翻页交互增强**：支持键盘（←/→/空格/PageUp/PageDown/Home/End）、鼠标滚轮、触屏滑动翻页。
- **页面布局真正生效**：修复实际渲染路径——真正的舞台渲染函数 `renderDeckSlideInto()` 此前完全忽略 `slide.layout`（仅按主题 neogrid/rawgrid/blue 拼版式），现重写为按 11 种布局分支渲染，使每页版式可见地不同。

### 移除

- **删除 AI 配图生成功能**：移除 `generating_images` 状态与 `ensureSlideImages` 调用，生成进度条只显示「生成讲稿 → 合成语音 → 完成」。
- **删除「导出笔记」**：按钮及 `exportNote()` 函数。
- **删除「打印 / PDF」「下载 PPT」「下载朗读音频」**：按钮及对应函数（`exportNote`、`generateHtmlPpt`、`downloadPptx`、`downloadAudio`、`downloadFile`、`openPrintView`）与 `PPT_HTML_CSS` / `PPT_HTML_JS` 模板常量。
- **移除 AI 教师语音选项**：删除龙小羊 / 洛心 / 海洋语音选择及相关 `openClassConfig()` / `saveClassConfig()` / `buildPersonaContext()` 语音逻辑。

### 修复

- **翻页时多个音频同时播放**：引入 `playingAudio` 变量，翻页前先暂停上一段音频。
- **树节点挤成一团、标签被截断**：改用 `renderTreeSvg` 真实树布局与自适应节点半径。
- **所有页面版式雷同**：根因是 `renderDeckSlideInto` 忽略 `slide.layout`；已重写按 11 种布局分支渲染，并由后端 `enforceDistinctLayouts()` 程序化保证每页不同。

## 2026-09-02

### 新增

- **技能树节点拖动**:`generate.html`(AI 生成技能树)与 `skilltree-app/skilltree.html`(技能树)中的技能节点现在可以像「职业加点图」的技能点一样自由拖动。
  - 拖动时节点之间的依赖连线实时重绘跟随。
  - 拖动后的布局保存到浏览器 localStorage(刷新 / 重开保持)。
  - 已区分「点击」(打开右侧详情)与「拖动」(移动节点)。
  - 空白处拖动平移画布、滚轮缩放保持不变。
- **生成知识点详解**:技能树右侧详情卡新增「✨ 生成知识点详解」按钮,一键调用 AI 生成该节点的文字讲解。
  - 后端新增 `POST /api/v1/skill/explain`(DeepSeek)。
  - 覆盖 `generate.html`、`skilltree-app/skilltree.html`、`skilltree.html`。
- **幻灯片真实 PPT 导出**:新增 Python「ppt-master」管线,把幻灯片 JSON 导出为真实 `.pptx`(原生图表 / 表格、过渡动画、AI 配图),并支持逐页旁白音频打包下载。
- **AI 配图**:幻灯片生成时经 Qwen 自动生成封面 + 空白页配图(4:3),展示于预览页并嵌入 `.pptx`。
- **幻灯片生成更灵活**:把幻灯片生成从「固定模板」升级为「参数化风格 + 篇幅 / 长度自适应」,风格全链路贯通。
  - **多视觉风格**:搜索页「深度交互」抽屉新增「视觉风格」单选(5 种),选择随 `/video/generate` 请求传入后端,并持久化到浏览器。
    - 教学清新 / 极简白 / 深色科技 / 商务蓝 / 活泼多彩
  - **风格规则注入**:`generateSlides(query, persona, style)` 按所选风格把对应设计规则(`PPT_STYLES` 的配色、字体、图表色系、卡片质感)注入 LLM prompt,而非固定一套模板。
  - **篇幅自适应**:页数不再固定,由 LLM 按知识点复杂度自行决定 3–12 页(简单知识点页数少、复杂页数多),并按「核心思想 → 公式 / 算法推导 → 实例数字演算 → 复杂度分析」等认知逻辑自然组织。
  - **讲解长度灵活**:`text` 讲解字段长度按内容需要(简单页 ≥100 字、复杂页 200–350 字),要求把公式完整读出来、把演算过程逐步讲出来。
  - **风格贯通全链路**:`search.html → /video/generate → videoTask.style → /video/status → watch.html`(预览按 `_PALS` 调色板渲染)→ `pptx-svg.js`(`STYLE_COLORS` 生成 SVG / PPT)→ AI 配图(`IMG_STYLE_HINT` 决定插画风格)。

### 优化

- `watch.html` 播放器与场景导航布局迭代,缩略图改为逐像素整页 SVG。
- 技能树入口串联:「职业加点图」→「技能树」→「AI 生成」。

### 修复

- 修复 Python 生成目录 `mkdir` 权限问题(`0o700` → `0o755`)。
- 修复 Qwen 图像生成国际端点 SSL 失败(改用国内端点 `dashscope.aliyuncs.com`)。
- 修复 `svg_quality_checker` 多项约束:根分组 `data-pptx-bounds`、原生图表 `data-pptx-fallback-sha256`、图表标题溢出、流程图框溢出、图片路径等。

