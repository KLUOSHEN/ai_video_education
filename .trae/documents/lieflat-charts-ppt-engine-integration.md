# 集成 lieflat-charts 作为 PPT 内部图表引擎

## 背景

当前 PPT 系统的图表渲染（`renderDiagram` 函数 in `watch.html`）使用简单的内联 SVG 绘制 13 种图表类型，视觉风格较为基础。lieflat-charts 是一个专业的数据可视化 skill，提供 64 张图型、3 套视觉风格系统（Lupi/Glance/Basics）、完整的设计 token 系统（`mono-tokens.js`）和 3 套彩色预设（`color-presets.js`）。

目标是将 lieflat-charts 作为 PPT 的图表渲染引擎，在保持现有 LLM 数据流和图表类型接口不变的前提下，提升图表的视觉品质。

## 现状

- **前端渲染**：`watch.html` 中 `renderDiagram(dia, accent, accentLight, textMain)` 函数（L3061-L3409），返回 600×200 的 SVG 字符串
- **服务端**：`server.js` LLM prompt（L920-L1004）定义图表类型和数据格式
- **后端导出**：`pptx-svg.js` 中的 `parseChart()` 和 `chartFallback()` 用于 PPTX 导出
- **lieflat-charts**：GitHub 仓库 `https://github.com/larashero3-dotcom/lieflat-charts`，包含 `SKILL.md`、`catalog.md`、`mono-tokens.js`、`color-presets.js` 和 gallery 实现文件

## 方案

### 架构

```
renderDiagram(dia, accent, accentLight, textMain)  ← 入口不变
  |
  ├── renderLieflatChart(dia, ...)  ← 新增委托
  |     ├── parseLegacyData(dia)    ← 解析 LLM 字符串格式
  |     ├── buildTokens()           ← 应用设计 token
  |     ├── selectPreset()          ← 选择色系预设
  |     └── chartAdapter(data)      ← 调用对应图型渲染函数
  |
  └── 原代码作为 fallback（未迁移的图型/解析失败时使用）
```

### 渐进式增强

新引擎先尝试渲染，成功则返回结果；失败则回退到原代码。所有已有图型保持不变，逐阶段迁移。

## 实施步骤

### 阶段 1：基础框架（lieflat-charts.js 创建 + 第一个图型）

1. **创建 `lieflat-charts.js`**（新文件）包含：
   - `buildTokens()` - 设计 token 系统（从 `mono-tokens.js` 提取核心设计规则）
   - `selectPreset()` / `applyPreset()` - 色系预设选择（从 `color-presets.js` 提取）
   - `parseLegacyData()` - 数据解析器（兼容 6 种 LLM 数据格式）
   - `renderLieflatChart()` - 主入口路由
   - 第一个图型：`renderG1_Pie()` - 饼图（最常用类型）

2. **修改 `watch.html`**：
   - 在 `</body>` 前添加 `<script src="lieflat-charts.js">`
   - 在 `renderDiagram()` 函数开头插入 6 行委托代码

### 阶段 2：核心图型迁移（12 种图表类型）

从 lieflat-charts gallery 中提取 SVG 渲染代码，适配到 600×200 画布：

| 当前图型 | lieflat-charts 映射 | 适配要点 |
|---------|-------------------|---------|
| pie_chart | G1 Pie | 厚线条、大扇区标签 |
| donut_chart | G2 Donut | 中心总计数值 |
| bar_chart | G4 Bar | 柱端胶囊圆角 |
| line_chart | G3 Line | 发丝线与粗线自适应 |
| area_chart | G7 Area | 半透明填充 |
| scatter_chart | G11 Scatter | 大标记点 |
| radar_chart | G8 Radar | 多轴网格 |
| bubble_chart | G12 Bubble | 气泡大小编码 |
| funnel | G5 Funnel | 逐级递减梯形 |
| waterfall | G6 Waterfall | 累计连接线 |
| gauge | G14 Gauge | 弧形仪表 |
| heatmap | G13 Heatmap | 颜色矩阵 |

### 阶段 3：特殊图型（complexity_curve 多系列）

从 Lupi 系提取 L8 Multi-Line 用于 `complexity_curve` 的多曲线对比。

### 阶段 4：视觉统一与打磨

- 统一字体尺寸、描边宽度、间距
- 确保色系预设轮换，每页图表有新鲜感
- 处理边缘情况（空数据、单点、长标签）

### 阶段 5：（可选）后端集成

- `pptx-svg.js` 中的 `chartFallback()` 也使用 lieflat-charts 渲染
- 使 `lieflat-charts.js` 兼容 Node.js（IIFE 双模式导出）

## 关键设计决策

1. **数据格式不变**：LLM prompt 保持现有格式，由 `parseLegacyData()` 在渲染前转换
2. **仅用纯 SVG 图型**：不使用依赖 Chart.js/ECharts 的图型，避免 CDN 加载
3. **原代码作为安全网**：任何失败情况自动回退，系统始终可用
4. **特殊图型不动**：flow/array/tree/compare/formula 不迁移，保持原渲染

## 待修改文件

- `c:\Users\ASUS\Desktop\前端\网页.html\lieflat-charts.js` - **新建**
- `c:\Users\ASUS\Desktop\前端\网页.html\watch.html` - **修改**（L3061 前插入委托代码 + 添加 script 标签）
- `c:\Users\ASUS\Desktop\前端\网页.html\server.js` - **(可选)** 阶段 5
- `c:\Users\ASUS\Desktop\前端\网页.html\pptx-svg.js` - **(可选)** 阶段 5

## 验证方式

1. 生成 PPT，确认所有图表类型都能正常渲染
2. 对比新旧渲染效果（视觉品质提升）
3. 测试边缘情况：空数据、单数据点、超长标签
4. 确认 flow/array/tree/compare/formula 保持不变