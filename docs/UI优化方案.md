# 「栈知映」UI 优化方案（效果预览版）

> 本方案基于四个 skill（ui-ux-pro-max / impeccable / react-bits 动效三件套 / karpathy-guidelines）产出的**完整优化蓝图**。
> **当前仅展示效果，未修改任何原页面代码。** 可视化效果请打开 `docs/design-preview.html`（浏览器直接运行，零依赖）。
> 确认方向后，按「实施路线」第 8 节分阶段落地。

---

## 1. 同类网站参考调研

| 参考 | 借鉴点 |
|---|---|
| [IntelliCourse（UX Design Awards）](https://ux-design-awards.com/winners/2025-1-intellicourse) | AI 课程产品的「学习= 旅程」叙事：进度可视化、场景化卡片、沉浸式深色学习区 |
| [TeachSpark（LLM 教学站）](https://github.com/MakeBoldSolutions/TeachSpark) | 解题助手对话区与课程内容并置的布局节奏 |
| [AI-Lab-UI-Design](https://github.com/Xmlong9/AI-Lab-UI-Design) | AI 学习平台现代浅色 UI：大留白、卡片层级、圆角体系 |
| [Astra AI](https://www.designrush.com/best-designs/websites/astra-ai-website-design) | AI 品牌的高质感：克制的渐变、玻璃拟态、字重对比 |
| 可汗学院 / LeetCode / B 站学习区（行业常识） | 学习页 = 内容区安静（Read/Operate 模式）、交互反馈清晰、进度感强 |

**共性结论**：优秀学习产品不做「五彩渐变模板」，而是 **内容优先 + 克制的品牌色 + 清晰的层级 + 有意义的动效**。

---

## 2. 现状诊断

### 2.1 三页现状速览

| 页面 | 现有风格 | 核心问题 |
|---|---|---|
| `search.html`（搜索首页） | 浅色蓝白 SaaS 模板 | 135° 渐变滥用、无品牌记忆点、视觉层级平、装饰性动画无降级 |
| `watch.html`（播放学习页） | 同上，信息密度高 | 功能齐全但层级平、观影区无沉浸感、弹层/答题交互反馈生硬 |
| `skill/index.html`（技能树） | 深色科技风（亮点） | 与另外两页风格**割裂**；扫光/扫描线/粒子等装饰动画偏多，无 reduced-motion 降级 |

### 2.2 系统性诊断（impeccable × ui-ux-pro-max 视角）

**「AI 塑料感」来源清单：**

1. **渐变滥用** — `linear-gradient(135deg, #4a8eff, #7c9bff)` / `(#4a8eff, #6366f1)` 出现在全部按钮、chip、头像、进度条（search/watch 内 40+ 处）。同一角度、同一蓝，视觉噪声高、无主次。
2. **模板蓝** — `#4a8eff` + `#6366f1` 是 AI 工具「默认蓝」，无品牌辨识度；阴影全部为 `rgba(74,142,255,.2)` 蓝色辉光，卡片靠「发光」而非「层级」区分。
3. **圆角/字号/间距无体系** — 圆角 8/10/12/16/50% 混用；字号 10~22px 跨度过大但层级不清晰。
4. **图标与 emoji** — FontAwesome 与 emoji 混用（ui-ux-pro-max 规则 4：统一 SVG 图标，emoji 不作图标）。
5. **品牌不统一** — skill 页（Orbitron/深色/扫描线）与 search/watch（蓝白模板）判若两站。
6. **无障碍缺口** — 多数可点元素无 `:focus-visible`；对比度不足的灰字（`#7a8eb0` on 白）；`prefers-reduced-motion` 未处理。
7. **动效无目的** — 常驻粒子/扫光/扫描线是「装饰」；真正的交互反馈（按压、弹层进出、答题成败）缺失或生硬。

---

## 3. 新设计系统（Design Tokens）

> 依据：ui-ux-pro-max `--design-system`（教育产品 + 技术感）+ color 库（LMS/Learning 方案）+ impeccable typeset/layout 规范综合定案。

### 3.1 风格方向

**「沉静电感 · 学习剧场」** —— 浅色为主、内容安静；深色仅用于 `watch.html` 观影/学习核心区（影院感）；品牌蓝紫（电感蓝）一脉相承于现状蓝色系，便于平滑迁移。

- `search.html`：明亮现代（大留白、卡片层级、克制渐变）
- `watch.html`：**观影沉浸模式**（播放器+字幕深色、操作区浅色，学习不刺眼）
- `skill/index.html`：保留科技气质但收敛装饰，与全站统一字体/组件语言

### 3.2 配色板（替换 `--primary: #4a8eff` 体系）

| Token | 值 | 用途 |
|---|---|---|
| `--primary` | `#4F6BF0` | 品牌主色（电感蓝紫，按钮/链接/高亮） |
| `--primary-deep` | `#3B4FE0` | hover / 按压 / 激活 |
| `--primary-soft` | `#EEF2FF` | 主色浅底（选中态、标签底） |
| `--cyan` | `#22C3E6` | 辅助青（连接线、次级信息、技能连线） |
| `--accent` | `#F59E0B` | 琥珀金（成就/进度/点亮/等级，情感奖励色） |
| `--success` / `--danger` | `#16A34A` / `#DC2626` | 判题正误语义色 |
| `--bg` / `--bg-soft` | `#F7F9FC` / `#FFFFFF` | 页面底 / 卡片底 |
| `--ink` / `--ink-2` / `--ink-3` | `#0F172A` / `#475569` / `#94A3B8` | 主/次/弱文字 |
| `--line` | `#E2E8F0` | 边框/分割线 |
| `--bg-dark` | `#0B1220` | 观影深色区（watch 播放器/字幕） |
| `--ink-light` | `#E6EDF7` | 深色区文字 |

**渐变仅保留 3 处品牌场景**：logo 徽标、主 CTA（`primary → cyan` 微渐变）、进度条高亮。其余一律纯色 + 层级。

### 3.3 字体（全站统一，含代码字体）

| 角色 | 字体 | 说明 |
|---|---|---|
| 中文正文/标题 | `Noto Sans SC` | 400/500/600/700 字重体系 |
| 西文/数字 | `Inter` | 与 Noto 同字重表 |
| 代码/时间戳/徽标数字 | `DM Mono` | 技术气质（skill 页沿用） |
| 品牌 display（可选） | `Orbitron` | 仅 logo 与 skill 页大标题，收敛使用 |

排版规则（apple-design §15 / impeccable typeset）：
- 大标题负 tracking（如 `letter-spacing: -0.02em`），正文 0
- 行高：标题 1.2~1.3，正文 1.6~1.75
- 层级 = 字重 × 字号 × 行高组合，不靠单一字号拉层级

### 3.4 圆角 / 间距 / 阴影体系

```
圆角: --r-sm 8 · --r-md 12 · --r-lg 16 · --r-xl 20 · pill 999
间距: 4 / 8 / 12 / 16 / 24 / 32 / 48（px）
阴影: --sh-1 0 1px 2px rgba(15,23,42,.05)
      --sh-2 0 4px 12px rgba(15,23,42,.07)
      --sh-3 0 12px 32px rgba(15,23,42,.12)   ← 去掉蓝色辉光
动效: --ease-out cubic-bezier(.23,1,.32,1) · --dur-1 160ms · --dur-2 250ms · --dur-3 350ms
```

### 3.5 组件规范要点

- **按钮**：主按钮纯色 `--primary`（hover `--primary-deep`）+ `:active scale(.97)`；次按钮描边式；文字按钮。仅主 CTA 允许微渐变。
- **卡片**：白底 + `--sh-1`（hover `--sh-2`），16px 圆角；不发光。
- **chip/标签**：`--primary-soft` 底 + 主色字，12px 圆角。
- **输入框**：1px `--line` 边框、focus 时 `--primary` 边框 + 2px ring（`--primary-soft`）。
- **弹层/抽屉**：scrim `rgba(15,23,42,.4)` fade 200ms；面板 scale(.96)+fade 250ms 入场，`transform-origin` 指向触发点。
- **图标**：统一 SVG（可用 FontAwesome 的 `<i>` 但**禁止 emoji 当图标**）。

---

## 4. 页面级优化清单

### 4.1 search.html（搜索首页）

| # | 组件 | 现状 → 优化 |
|---|---|---|
| 1 | 品牌区 | 保留乱码解码动画（特色动效）；logo 徽标改新渐变；标题字重 800 + 负 tracking；slogan 用 `--ink-2` |
| 2 | 搜索卡（chat-card） | 去 135° 渐变 → 白卡 + `--sh-2` + 顶部品牌色细边；气泡（ai/user）分层：ai 底 `--bg-soft`、user 底 `--primary` 白字；输入框 focus ring |
| 3 | 侧栏 | 历史条目 hover 底 `--primary-soft`、选中态左缘 3px 主色条；「职业加点图/错题本」入口改图标卡；折叠/展开过渡 250ms |
| 4 | 快捷知识点弹窗 | 弹层入场动效（见 5 节）；卡片式选项、hover 抬升 |
| 5 | 三行滚动 chip | chip 统一 `--primary-soft` 底 + 主色字；滚动提示箭头；点击回填动画（输入框内容出现，不滚动） |
| 6 | 两个抽屉（自我介绍/课堂配置） | 抽屉从右侧滑入 300ms + 表单 focus ring；角色选择（好奇宝宝/面试官/小白）卡片化单选 |
| 7 | AI 解题助手 | 悬浮球改新渐变 + 按压反馈；面板入场 scale+fade；消息「正在思考」骨架；rail 目录 scrollspy 高亮 |
| 8 | vortex 粒子 | 降低粒子数/透明度；`prefers-reduced-motion` 时整体关闭 |
| 9 | 错题本/学情诊断弹层 | 与 watch 共用规范（见下）；诊断雷达/趋势图加语义色 |

### 4.2 watch.html（播放学习页）

| # | 组件 | 现状 → 优化 |
|---|---|---|
| 1 | 顶栏 | `backdrop-filter: blur(12px) saturate(180%)` 毛玻璃（apple-design §12），内容在其下滚动 |
| 2 | 播放器 | 播放器+字幕区整体深色（`--bg-dark`，观影模式）；进度条 hover 显示时间提示、拖拽时加粗；控制按钮 `:active` 按压反馈；播放中静音/切字幕按钮状态可见 |
| 3 | 字幕区 | 行高 1.75、文字 `--ink-light`；字幕切换 150ms fade（不跳变） |
| 4 | 信息区 | 标题字重 700；元数据标签 chip 化；导出/打印按钮描边式 |
| 5 | 知识测评 | 选项卡片 hover 描边、选中 `--primary-soft` 底 + 主色框；提交 loading；判题后正确=绿、错误=红（语义色）；解析区展开动画 250ms；「举一反三」按钮生成时按钮态 |
| 6 | 右侧场景列表 | active 项主色描边 + 浅底 + 缩略图标点亮；点击跳转时列表项滚动到位 |
| 7 | 错题本/学情诊断弹层 | 统一弹层动效；错题「未复习」标记用琥珀色点；归因结果卡片化 |
| 8 | 聊天悬浮球 | 与 search 共用规范 |

### 4.3 skill/index.html（技能树）

| # | 组件 | 现状 → 优化 |
|---|---|---|
| 1 | 装饰动画收敛 | `badgeShine` 扫光、`scan` 扫描线、`drift` 粒子：降强度或仅保留 1 种；全部加 `prefers-reduced-motion` 降级 |
| 2 | 与全站统一 | 字体族对齐（Noto Sans SC 正文 / Orbitron 仅品牌）；侧栏/面板圆角阴影换用新 tokens（去掉蓝辉光） |
| 3 | 技能节点 | 点亮态加琥珀色成就点缀（对应「点亮技能」语义）；拖拽释放后回弹 spring 化（速度手递，apple-design §5） |
| 4 | 右侧分析面板 | 匹配度进度条换新渐变（primary→cyan）；Top3 职业卡片化；B 站推荐卡片 hover 抬升 |
| 5 | 返回按钮 | 更明显（主色描边按钮），保持「回到搜索」心智 |

---

## 5. 动效方案（react-bits 三件套产出）

依据 `find-animation-opportunities` 的 Gate（频率/目的/速度/功能）过滤后的**高杠杆清单**：

### 5.1 值得加 / 值得改的动效

| # | 位置 | 今日 | 目的 | 频率 | 建议动效 |
|---|---|---|---|---|---|
| 1 | 全站按钮 `:active` | 无按压反馈 | Feedback | 数十次/天 | `transform: scale(.97)` + `transition: transform 160ms ease-out` |
| 2 | 弹层/抽屉入场 | 生硬闪现 | 防止突兀变化 | 偶尔 | `scale(.96) + fade` 250ms ease-out，`transform-origin` 指向触发点；scrim fade 200ms |
| 3 | 错题本/学情弹层 | 无进出衔接 | 空间一致性 | 偶尔 | 同一路径进出（对称 easing，apple-design §7） |
| 4 | 字幕切换 | 瞬间替换 | 防止跳变 | 偶尔 | `opacity` cross-fade 150ms（不动 transform） |
| 5 | 视频生成完成 / 错题重做成功 | 静默 | Delight（罕见） | 罕见 | 一次 400ms 的轻量「完成」脉冲（琥珀色勾 + 卡片微弹，只一次） |
| 6 | 技能节点点亮 | 有 glow | 状态示意 | 偶尔 | 保留 glow 但降频；拖拽松手 spring（bounce .15，velocity 手递） |
| 7 | 历史列表项移除 | 直接消失 | 防止跳变 | 偶尔 | `opacity + translateY(-4px)` 160ms 退场（列表非高频操作，可接受） |
| 8 | 三行滚动 chip | 硬切行 | 状态示意 | 偶尔 | 行切换 200ms fade（`--ease-out`） |

### 5.2 明确拒绝（Gate 未过）

- **vortex 常驻粒子** — 分心且 100% 时间可见，高频 → 只留低透明度静态底噪或 `reduced-motion` 关闭
- **badgeShine / scan 扫描线** — 纯装饰、无目的 → 删或降为悬停触发
- **播放进度条动画** — 用户正在读取进度，功能性数据不该为风格而动 → 保持静态 + hover 预览
- **搜索回车 → 页面跳转** — 键盘高频操作 → 不做任何转场动画

### 5.3 无障碍动效底线（apple-design §14）

```css
@media (prefers-reduced-motion: reduce) {
  * { animation-duration: .01ms !important; transition-duration: .01ms !important; }
  .drawer, .overlay { transform: none !important; }   /* 退化为 opacity cross-fade */
}
@media (prefers-reduced-transparency: reduce) {
  .topbar, .chat-panel { background: #fff; backdrop-filter: none; }
}
```

---

## 6. 实施原则（karpathy-guidelines）

1. **零第三方依赖不变**（项目铁律）：全部优化 = 现有 CSS 变量替换 + 新增少量 class + 内联 SVG；不动后端 `server.js`、不动 JS 业务逻辑。
2. **Token 先行**：三个页面的 `:root` 统一为第 3 节设计系统 → 一次替换，全站生效（`--primary` 系、圆角、阴影、动效变量）。
3. **外科手术式**：每页按 4 节清单逐项替换，不顺手重构无关代码；保留既有 DOM 结构、class 命名、行为。
4. **可验证目标**：每阶段改完 → 截图对比清单 → 检查项：无水平滚动、focus 可见、reduced-motion 生效、375/768/1024/1440 断点不破。
5. **分批实施建议**：
   - 阶段 A（低风险高收益）：设计 tokens 替换（3 页 `:root`）→ 全局按钮/chip/卡片去渐变
   - 阶段 B：watch 观影深色区 + 弹层/抽屉动效 + 字幕 fade
   - 阶段 C：skill 页装饰收敛 + 与全站统一 + 无障碍降级
   - 阶段 D：search 品牌区/侧栏/抽屉/聊天面板精修
6. **不做的**：不改文案事实、不加新页面、不引框架、不动 API。

---

## 7. 如何看效果

打开 **`docs/design-preview.html`**（浏览器直接运行，无需后端）：

1. **新设计系统展板** — 配色板、字体排版、圆角/间距/阴影体系
2. **组件新旧对比** — 按钮/输入框/chip/卡片/聊天气泡/侧栏条目/进度条/场景项/播放器控件，左旧右新
3. **页面级示意** — search 首页（新浅色）、watch 播放页（深色观影模式）高保真缩略
4. **动效演示** — 按压反馈、弹层入场、字幕 cross-fade 可直接体验

确认方向后回复「按方案改」，我再按阶段 A→D 落地。
