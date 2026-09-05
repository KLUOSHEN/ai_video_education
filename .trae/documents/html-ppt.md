# 方案：将「PPT 导出」改造为自包含 HTML 网页

## Context（背景与目标）

当前 watch.html 的"下载 PPT"按钮调后端 `/api/v1/video/pptx`，产出 Office 格式 `.pptx`：
- 优先走 `buildPptxViaPython`（依赖 `.trae/skills/ppt-master` 的 Python + python-pptx 编译链）
- 失败时走 `buildPptx`（Node 零依赖）

用户希望"整个展示出来的 PPT 实际是个 HTML 网页"——即导出的成品是一个**自包含的 `.html` 文档**，浏览器打开即逐页展示整份幻灯片，而非 Office 二进制。

用户已确认的三点决策：
1. **替换 .pptx 为 .html**（导出的成品格式改为自包含 HTML）
2. **公式/代码高亮用轻量自研渲染**（不引入完整 KaTeX / highlight.js，控制单文件体积）
3. **不含翻页/全屏放映交互**（导出为逐页纵向静态展示的网页）

目标形态：导出一个**单文件 .html**，内含全部幻灯片（一页一区块、从上到下排布）、轻量公式渲染、轻量代码高亮、每页内嵌可播放的语音音频（Base64）。完全离线、零外部依赖、双击即可在浏览器观看。

## 为什么在前端生成而不是后端

- watch.html 已在浏览器里持有 `slides` 数据、每页音频 URL、style、images，无需再回后端取
- 页面已有 `downloadFile(name, content, mimeType)` Blob 下载函数（[watch.html:L2211-2219](file:///c:/Users/ASUS/Desktop/前端/网页.html/watch.html)）
- 参考现成先例 `openPrintView()`（[watch.html:L2221-2271](file:///c:/Users/ASUS/Desktop/前端/网页.html/watch.html)）：前端拼一段自包含 HTML 字符串并交给新窗口/导出
- 改动集中在 watch.html，零后端、零 Python 依赖，风险最小

## 实现方案

### 1. 新增前端函数 `generateHtmlPpt()`（watch.html 内）

负责：收集数据 → 组装自包含 HTML 字符串 → 触发 `.html` 下载。

**数据收集**
- 取当前演示的 `slides` 数组（与 `downloadPptx` 里取 `taskId` 同一来源，当前页已有）
- 取 style（视觉主题，注入内联 CSS 变量，沿用现有 5 套 `PPT_STYLES` 视觉观感）
- 逐页语音音频：对每页音频 URL 执行 `fetch(url) → blob → FileReader.readAsDataURL` 得到 Base64，注入 `audios` 映射

**自包含 HTML 模板结构**
```
<!DOCTYPE html><html><head><meta charset=utf-8 />
  <style> 内联版式 CSS（页面容器 .slide、标题/正文/图表/表格/audio 样式） </style>
</head><body>
  <script> window.__PPT__ = { query, style, slides, audios:{idx:dataURL} }; <\/script>
  <script> 内联渲染脚本：逐页把 slide 渲染成 .slide 区块，处理公式/代码/图表/音频 <\/script>
</body></html>
```

**内联渲染脚本职责**
- 逐页生成 `.slide` 区块（title/subtitle/text/left/right/bottom），整体纵向排布
- 复用并移植 watch.html 中现有绘制函数的**渲染逻辑**（以字符串/HTML 形式）：图表、表格、visuals——参考 [renderSlideCard:3165-3285](file:///c:/Users/ASUS/Desktop/前端/网页.html/watch.html)、图表绘制区 [2906-3063](file:///c:/Users/ASUS/Desktop/前端/网页.html/watch.html)
- **轻量公式渲染**：内联 `renderMath(str)` 处理 `$…$`/`$$…$$`，将常见 LaTeX（`^`上标、`_`下标、`\frac`、`\sqrt` 等）转为 HTML 上标/下标/分数 span，纯文本转义防注入
- **轻量代码高亮**：内联 `highlightCode(code, lang)` 用少量关键词/数字/注释正则给 `<pre><code>` 上色（按需求不需要 highlight.js 完整库）
- **音频**：每页末尾放 `<audio controls preload="none" src="{audios[idx]}">`，可单独播放；不自动连播

**触发下载**：组装完成后调 `downloadFile('教学幻灯片-xxx.html', html, 'text/html')`

### 2. 修改"下载 PPT"按钮 [downloadPptx:2169-2188](file:///c:/Users/ASUS/Desktop/前端/网页.html/watch.html)
- 把 `downloadPptx()` 的实现替换为调用 `generateHtmlPpt()`
- 首行 `cache`/`alert` 提示与现有一致（无内容时 alert 提示）
- 下载文件名改 `.html` 后缀
- 按钮文案「下载 PPT」改为「导出 HTML 版」（可选，不改也行，文件后缀已区分）

### 3. 后端 .pptx 链路处理（保守，不删共用逻辑）
- watch.html 不再请求 `/api/v1/video/pptx`，前端 .pptx 依赖移除
- server.js 的 `buildPptxViaPython` / `buildPptx` / `/video/pptx` 路由与 `.trae/skills/ppt-master` **本次不删除**（避免影响可能复用它们的其它页面，如 search.html 的视频链路；实现时先用 Grep 确认引用面，若确认无他处使用再与用户确认是否移除）

## 涉及文件
- `c:\Users\ASUS\Desktop\前端\网页.html\watch.html` —— 新增 `generateHtmlPpt()` + 相关内联模板/渲染函数；`downloadPptx` 改为导出 HTML；`downloadFile` 复用

不改动：`server.js`、`pptx-svg.js`、`pptx.js`、`mdrender.js`、`.trae/skills/ppt-master`（本次仅前端产出 HTML，不动渲染基础设施）

## 验证
1. `node server.js` 启动，访问 `http://localhost:3000/watch.html`，生成一份含幻灯片的任务
2. 点击"下载 PPT / 导出 HTML 版"按钮 → 下载得到 `.html` 文件
3. 双击用浏览器打开：逐页看到全部幻灯片、公式显示数学样式、代码有高亮、每页音频控件可播放
4. 断网/离线状态下打开该 .html，确认完全自包含（无外部 CDN 请求、无报错）
5. 回到 watch.html 控制台，确认原 `/api/v1/video/pptx` 不再被请求