# 「真课件」系统实现计划

## Context

现有 PPT 管线（server.js `/video/generate` + watch.html deck 播放器）生成的是静态幻灯片 + 逐页 Qwen CosyVoice 配音。用户要求升级为借鉴 OpenMAIC 理念的"真课件"：

1. **每页讲解脚本 + spotlight**：LLM 生成分句讲稿，每句绑定页面元素，TTS 讲到哪句、屏幕对应区域高亮（句级同步）
2. **TTS 换 edge-tts**：免费、音质好、已验证环境可用（`python -m edge-tts 7.2.8`，Node v24）；**前端提供音色选择按钮，可随时切换并重新合成**
3. **可交互场景**：首批 3 个模板——排序仿真、二分查找仿真（canvas 2D）、3D 函数曲面（Three.js）；LLM 只选模板+填受钳制的参数，绝不生成代码/eval
4. **更强动效**：元素入场 stagger、spotlight 遮罩挖洞、转场增强
5. 新建独立 v2 JSON 格式（借鉴 OpenMAIC DSL），**不硬编码内容**；旧 v1 任务向后兼容

关键事实：server.js（3301 行，原生 http 零 npm 依赖，端口 3002）已有 `spawn("python", ...)` 先例；watch.html 的 `renderDeckSlideInto`/`buildDeck`/`_setupWheel`/ca-* 动画是核心资产，v2 每页 = v1 slide 全字段 + 新增字段，可直接复用渲染层。

## 数据流

```
search.html [真课件开关] → POST /api/v1/courseware/generate {query, voice}
  → 大纲(复用 generateOutline, 增 scene_hint) → 逐页(复用 generateOneSlide) → 校验场景(validateScene)
  → 逐页 narration pass(LLM 生成分句讲稿+target+fx) → 逐句 edge-tts 合成(4并发) → 回填 audio URL
watch.html?task_id= → GET /video/status 双读(coursewareTasks → format:2)
  → buildDeck 复用渲染(data-el 锚点 + scene 占位) → CoursewarePlayer 逐句播放链驱动 spotlight/翻页
音色切换：watch.html 音色下拉 → POST /courseware/resynth {task_id, voice} → 仅重跑 TTS 阶段
```

## 步骤

### 1. server.js — edge-tts 合成层
- `probeEdgeTts()`：启动时 spawn `python -m edge_tts --list-voices`（10s 超时）缓存 `EDGE_TTS_OK`；不可用时回退现有 `qwenTtsBuffer`
- `edgeTtsBuffer(text, {voice, rate})`：spawn `python -m edge_tts --text <text> --write-media <tmp.mp3>`（args 数组无 shell，天然防注入），60s 超时 kill，失败重试 1 次
- 音色：`EDGE_TTS_VOICE` 默认 `zh-CN-XiaoxiaoNeural`，可选 `zh-CN-YunxiNeural`/`zh-CN-YunjianNeural`/`zh-CN-XiaoyiNeural`；语速 `EDGE_TTS_RATE` 默认 `+8%`

### 2. 新建 courseware-schema.js（v2 格式单一事实来源，仿 ppt-schema.js）
页面结构 = v1 slide 全字段 + 三个新字段：
```json
{ "...v1字段(title/layout/points/visuals/diagram...)": "",
  "scene": { "template": "sort-sim", "params": { "algorithm": "quick" }, "caption": "快排演示" },
  "narration": [ { "text": "先看这组柱子的交换过程", "target": "scene", "fx": "spot" } ] }
```
- `SCENE_REGISTRY`：`sort-sim`（algorithm∈bubble/insertion/quick/merge，size 8-32）、`binary-search-sim`（size 8-32）、`surface-3d`（fnExpr **枚举**：sin(x)·cos(y) / x²−y² / sin(√(x²+y²))；gridN 20-80）；params 逐项钳制（int range / enum 白名单 / 数组截断），template 不在注册表 → 置 null
- `deriveElements(slide)`：从页内容派生合法 spotlight 锚点 id（title/subtitle/pts/txt/diagram/vis-N/bottom/scene）
- `validateNarration(arr, elements)`：3-8 句；target 非法→null；fx∈spot/pulse/underline/zoom/none；text ≤80 字
- `buildCoursewarePromptSpec()`：narration/scene 的 prompt 注入段

### 3. server.js — 生成流水线 `generateCoursewareStaged(query, persona, style, voice, onProgress)`
- 复用 `generateOutline`（prompt 增补：约 1/3 页给 `scene_hint`，只能从注册表 id 选）+ `generateOneSlide` + `enforceDistinctLayouts`；scene 页占用 vis 槽位
- 逐页 `generateNarration(slide, idx)`：`llmJson` 注入本页内容摘要 + `deriveElements` 合法 id 清单，输出 `[{text,target,fx}]`；失败带 errors 重试 1 次，再失败降级单句 `{text, target:null, fx:"none"}`
- `createCoursewareTTS(pages, voice)`：展平全部句子 → 4 并发 `edgeTtsBuffer` → 逐句写 `storage/audio/cw-<taskId>-p<i>-s<j>.mp3` → 回填 `narration[j].audio`；**按页聚合后每页一次 store.update**（避免单文件 JSON 写放大）
- 进度状态机：`generating_outline → generating_pages → generating_narration → generating_tts → slides_ready`

### 4. server.js — 路由
- `JsonStore` 初始 data 加 `coursewareTasks: []`（spread 合并自动补齐，无迁移）
- `POST /courseware/generate`：入参同 video/generate + `voice`；setImmediate 跑流水线；返回 `{task_id}`
- `POST /courseware/resynth`：`{task_id, voice}` → 仅重跑 `createCoursewareTTS`，期间 status 显示 `generating_tts`
- `GET /video/status`：videoTasks 未命中时回退查 coursewareTasks，返回 `{format:2, pages, voice, ...}` → 历史入口 `watch.html?task_id=` 零改动复用

### 5. 新建 scene-templates.js（前端场景库）
- `window.SCENE_TEMPLATES = { "sort-sim": {...}, "binary-search-sim": {...}, "surface-3d": {...} }`
- 每模板：`{ id, label, needsThree, mount(el, params, ctl) → { dispose(), setParams(p), spotlightPart } }`
- 仿真类：canvas 2D + rAF；播放/暂停/单步/调速控件；`dispose()` 停循环（翻页时必调）
- `surface-3d`：首次使用时动态注入 cdnjs 的 `three@0.128`（unpkg 曾被跟踪防护拦截，勿用），可拖拽旋转滚轮缩放
- `ctl`：通用参数面板（range→slider、enum→select），改动热更新 `setParams`

### 6. 新建 courseware-engine.js（播放器引擎）
- `class CoursewarePlayer`：逐句播放链 `new Audio(sentence.audio)` → `onended` → 下一句 + `applySpotlight(target, fx)`；页内播完 → `deck.goTo(i+1)`；手动翻页中断当前链从新页第 0 句开始；当前句播时预取下一页前 2 句消除空隙
- `applySpotlight`：fixed 遮罩 div `box-shadow: 0 0 0 9999px rgba(2,6,23,.55)` 挖洞定位到 `[data-el]` 元素（getBoundingClientRect），0.45s 位置过渡；`pulse/underline/zoom` 在目标上叠加 `.cw-fx-*` class
- 音色切换 UI：播放器控制条加音色下拉（4 个中文音色，localStorage 记忆）→ 调 `/courseware/resynth` → 轮询完成后无缝用新音频

### 7. watch.html 集成（纯增量，不动 96px 标题/dk 尺寸/PPT_HTML_JS 模板字符串区域）
- `<head>` 引入 `courseware-engine.js`、`scene-templates.js`；新增约 80 行 `.cw-*` CSS（spotlight/入场 stagger/转场）
- `renderDeckSlideInto`：各槽位模板补 `data-el="..."` 属性；`slide.scene` 存在时渲染 `<div class="cw-scene" data-el="scene">` 占位，`.slide.active` 时 `mountSceneFor`，离开时 dispose
- `loadSlideshow`：`data.format === 2` 分支——`slides = data.pages` 走现有 buildDeck，再 `window._cw = new CoursewarePlayer(...)`；v1 路径零改动；quiz 末页保留（无 narration，播完自动进入）
- 状态文案：`generating_narration → 'AI 正在编写分句讲稿…'`、`generating_tts → 'Edge-TTS 正在合成配音…'`

### 8. search.html 入口
- 生成按钮旁加模式开关「PPT 课件 / 真课件」；真课件 → `POST /api/v1/courseware/generate` → 跳 `watch.html?task_id=…&q=…`（同现有链路）

## 依赖顺序

1、2、5 可并行 → 3 → 4 → 6 → 7 → 8 → 9

## 验证

1. `node --check server.js`；重启 3002（`node server.js`）
2. search.html 生成一次真课件：核对 status 各阶段推进、pages 含 narration/scene、每句 audio URL 可访问
3. watch.html 播放：句级 spotlight 跟随、页间自动翻页、手动翻页中断正确、scene 页交互（拖参数/旋转）与 dispose 无泄漏、音色切换重合成后音频更新
4. 回归：旧 v1 task_id 打开仍正常；`/api/v1/health`；edge-tts 断网场景（临时改 PATH）回退 Qwen 不阻塞生成
5. Three.js 仅在含 surface-3d 页时加载（Network 面板确认）

## 风险

- **watch.html 是巨型文件**：所有改动纯增量字符串拼接，绝不触碰 PPT_HTML_JS 模板字面量区域（已知转义 bug 被用户搁置）
- **edge-tts 非官方接口**：微软可能变更协议（7.2.8 已适配 Sec-MS-GEC）；保留 Qwen 回退
- **句数多时 TTS 耗时**：10 页 × 6 句 = 60 次合成，4 并发约 1-2 分钟；进度条按句计数透出
- **单文件 JSON 写放大**：TTS 回填必须按页批量 update
