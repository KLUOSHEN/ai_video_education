# watch.html 升级为 frontend-slides 固定16:9演示文稿（保留逐页音频）

## Context（背景与目标）
- 用户通过开源 skill「frontend-slides」（克隆于 `_frontend-slides-tmp\`）把 `watch.html` 页面内的幻灯片主展示区，从现在的「单张白卡逐页切换」升级为**固定 1920×1080 舞台、整台等比缩放、翻页+滑入动画+内联编辑**的专业演示文稿。
- 用户决策（已确认）：**页面内直接演示**；**演示 + 逐页音频并存**（保留底部播放条，点播放按每页真人语音自动翻页）。
- 数据复用后端已有 slides：`window._slidesData`、`window._slideStyle`（5套主题）、`_slideImages`、`_slideAudioList`。不改后端、不改导出功能。
- 工作目录：`c:\Users\ASUS\Desktop\前端\网页.html`。后端端口 3000 被占，用 `PORT=3002`。

## 唯一改动文件
**`watch.html`（单文件，CSS/JS 全内联）**，改三处：`<style>` 末尾追加 deck 样式、`<script>` 追加控制器/编辑器、`loadSlideshow` 闭包(L2650)接桥。

## 一、引入 frontend-slides 基础样式（作用域化，非全窗口）
整份参照 `_frontend-slides-tmp\viewport-base.css`，但**必须作用域到 `#playerPoster .deck-*`**，并以 `#playerPoster` 容器（已有 `width:100%;height:100%`，父级 `.player-container` 自带 `aspect-ratio:16/9`）为缩放基准：
- `.deck-viewport{position:absolute;inset:0;overflow:hidden}`（不用 fixed，避免锁死整页滚动）
- `.deck-stage{position:absolute;left:0;top:0;width:1920px;height:1080px;transform-origin:0 0}`
- `.slide{position:absolute;inset:0;visibility:hidden;opacity:0;pointer-events:none}`，`.slide.active/.visible` 显示；**禁用 display:none**
- 保留 @media print 逐页分页、prefers-reduced-motion
- grep 已确认 watch.html 无既有 `.slide` 冲突，可保留原类名

## 二、主题变量（不污染全局 `:root`）
用独立前缀 `--dk-*` 变量，挂在 deck 根容器。5 套主题映射 JS class：
`教学清新→fresh / 极简白→minimal / 深色科技→tech / 商务蓝→biz / 活泼多彩→color`。
每套含 `--dk-bg / --dk-bg-deep / --dk-text / --dk-text-sub / --dk-accent / --dk-accent-soft / --dk-card / --dk-card-border / --dk-font-display / --dk-font-body / --dk-title-size / --dk-body-size / --dk-pad`。
头部追加 Google Fonts（Space Grotesk + Manrope，符合 skill「禁系统字体当 display」；断网降级 Segoe UI）。

## 三、剧场式排版类 `.dk-*`
`.dk-pad-area`(安全区) / `.dk-kicker`(小标) / `.dk-title` / `.dk-subtitle` / `.dk-index`(01) / `.dk-pageno`(超大水印页码) / `.dk-region`(区块小标题) / `.dk-cols` / `.dk-col` / `.dk-card` / `.dk-chart` / `.dk-art` / `.dk-bottom` / `.dk-reveal`(滑入，配合 `.slide.visible .dk-reveal` + nth-child 错峰)。

## 四、新增 JS：SlidePresentation 控制器类
（提炼自 `_frontend-slides-tmp\bold-template-pack\deck-stage.js`，去 Shadow DOM 化，暴露实例给闭包）
- `setupScale()`：按 `viewport.clientWidth/Height` 计算 `translate(x,y) scale(s)`，resize 监听
- `setupKeys()`：←/→/空格/PageUpDown/Home/End，输入框内与组合键跳过
- `setupWheel()` / `setupTouch()`：viewport 内滚轮、横向滑
- `goTo(i,reason)`：切 `.active/.visible`，**同页 return 防递归**，触发 `onChange({index,previousIndex,reason})` 回调；另设 `_flash()` 页码提示
- `buildDeck(poster, slides)`：一次性把全部 slides 渲染为 `.slide` 进 `.deck-stage`，实例化控制器，存 `window._deck`

## 五、每张 slide 剧场内容 `renderDeckSlideInto(sec, slide, idx)`
复用现有渲染器（带行号）填内容：
- `renderVisual(v,accent,accentLight,textMain,textSub)`（L3254）→ 视觉卡
- `renderDiagram(dia,...)`（L3083）、`renderContentBlock(...)`（L3359）、`renderMathExpr`（L3072）、配图 `_slideImages[idx]`
- 布局：覆盖 default/two_col/left_text/split；triple 退化为两列+卡网格
- 结构：`.dk-pad-area` 内放 kicker + title + subtitle + `.dk-cols`(左:要点/配图，右:可视化分析/图表) + `.dk-bottom`；外侧 `.dk-index` + `.dk-pageno` 水印

## 六、音频与翻页协同（唯一同步入口）
闭包内 `currentSlideIdx` 是唯一状态；设定 `deck.onChange` 为音画同步入口：
```js
deck.onChange = ({index}) => {
  const changed = (index !== currentSlideIdx);
  currentSlideIdx = index; highlightScene(index); window._currentSlideIdx = index;
  if (changed && isSlidePlaying) playPageAudio(index);   // 手动/自动翻页才重启语音
};
```
- `playPage(index)` 原实现(L2768)的 `renderSlideCard(...)` 改为 `deck.goTo(index)`；音频起停收敛到 `playPageAudio(idx)`（onended → `deck.next()` 自动翻下页）
- `loadSlideshow` 首渲染(L2715) `renderSlideCard` → `buildDeck` + `activateSlide(0)`；`stopPlayback`(L2877)、`seekTo` 内 3 处、旧整段音频 ended(L2841)、`_slideSkipTime` 等所有 `renderSlideCard` 调用改走 `activateSlide(idx)`
- 公开 `window._deckShow(idx)` 供外部/侧边栏跳页
- `jumpToSlide` / `_slideJumpTo` / `renderSlides` 侧边栏缩略图基本不改

## 七、内联编辑（html-template.md 强制规范）
- **禁 CSS `~` 兄弟选择器**；用 JS + 400ms 延时显示/隐藏
- 左上热区鼠标逼近 400ms 显示 ✏️；悬停离开 400ms 隐藏；点热区或按 `E` 进入编辑
- 进入编辑时：暂停音频、`isSlidePlaying=false`、清 rAF，避免自动翻页切走编辑目标
- `Ctrl+S` 把 DOM 编辑写回 `window._slidesData` 并 `localStorage`（key `watch_deck_edit_<task_id>`）
- 可编辑：`.dk-title/.dk-subtitle/.dk-bottom/.dk-kicker`，contenteditable

## 融入深色科技背景
舞台黑边 letterbox（`--dk-bg-deep:#0b1220`）与 watch.html 全局深色背景同源；`.player-overlay` 进度条/控制条保持不动，作为「剧场台前」控制区即可。

## 验证
1. 启动：`cd c:\Users\ASUS\Desktop\前端\网页.html; $env:PORT=3002; node server.js`
2. 打开：`http://localhost:3002/watch.html?task_id=<历史任务ID>`
3. 检查：16:9 整台缩放不变形（改变窗口宽度）；翻页（键盘/滚轮/触屏/侧边栏）触发 `.slide.active` + `.dk-reveal` 动画；点播放逐页语音随页切换、进度条走 rAF、语音 ended 自动 `deck.next()`；播放中手动翻页即切换语音；5 套 `_slideStyle` 主题变量正确且不污染图标/侧栏；左上热区按 E 进入编辑、编辑时音频暂停、Ctrl+S 存 localStorage。

## 不做（本次范围外）
- 不改 `server.js`、后端、`generateHtmlPpt()` 导出、其余 watch.html 功能
- 不动 `_frontend-slides-tmp\`（只读参考）