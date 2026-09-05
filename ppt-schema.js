// ── PPT 内容 Schema：单一事实来源 ──
// 定义 slides JSON 的枚举、prompt 格式规格、以及生成结果的校验/归一化。
// server.js（生成、patch 校验）与 /api/v1/ppt/schema 端点（前端只读）共用本模块。

// 布局池（与 watch.html renderDeckSlideInto 的 11 个分支一一对应）
const LAYOUT_POOL = [
  "two_col", "split", "bottom_bar", "triple", "left_text", "default",
  "chart_top", "chart_left", "cards", "timeline", "focus",
];

// visuals 类型白名单
const VISUAL_TYPES = ["list", "table", "formula", "highlight", "quote", "badge", "code"];

// diagram 类型白名单（与 watch.html renderDiagram 支持的分支一致）
const DIAGRAM_TYPES = [
  "line_chart", "bar_chart", "complexity_curve", "pie_chart", "area_chart",
  "scatter_chart", "donut_chart", "funnel", "radar_chart", "bubble_chart",
  "waterfall", "gauge", "heatmap", "array", "flow", "tree", "compare",
];

// 每页字段规格（供 /ppt/schema 端点透出，前端可用于兜底判断）
const SLIDE_FIELDS = {
  title: { type: "string", required: true, editable: true },
  subtitle: { type: "string", required: false, editable: true },
  text: { type: "string", required: true, editable: true },
  layout: { type: "enum", allowed: LAYOUT_POOL, default: "two_col", editable: false },
  left: { type: "string", required: false, editable: true },
  right: { type: "string", required: false, editable: false },
  bottom: { type: "string", required: false, editable: true },
  code: { type: "string", required: false, editable: false },
  visuals: { type: "array<visual>", required: false, editable: false },
  diagram: { type: "diagram|null", required: false, editable: false },
};
const PATCHABLE_FIELDS = ["title", "subtitle", "text", "left", "right", "bottom", "code"];

// ── prompt 规格：由枚举生成注入 LLM prompt 的三段文本（输出格式 / 布局规则 / 数据格式约定）──
// 迁移自 server.js generateSlides 内联 prompt，改枚举只需改本文件。

function buildPromptSpec() {
  return {
    outputFormat: `{"slides":[{"title":"深蓝大标题","subtitle":"灰色副标题","text":"讲解文字，长度按内容需要，口语化但信息密集，必须具体到公式、数字和关键步骤，像老师授课一样把公式读出来","layout":"${LAYOUT_POOL.join(" / ")}","left":"左侧内容：3-5 个要点或定义，每行一个，要点必须具体（含公式/数字/术语）","right":"右侧内容：图表数据或表格，data 格式见下","visuals":[{"type":"${VISUAL_TYPES.join("/")}/code","data":"对应数据，code 类型时 data 为代码文本并配 lang 字段指定语言","caption":"说明文字"}],"diagram":{"type":"${DIAGRAM_TYPES.join(" / ")}","data":"对应数据","caption":"图表下方说明"}}]}`,
    layoutRules: [
      "- two_col：左文字要点 + 右 diagram 图表",
      "- split：左右两栏对比，每栏都有小标题和要点",
      "- bottom_bar：结论/重点页，文字居中突出，底部配蓝色强调条",
      "- triple：顶部标题 + 下方左中右三卡片，每张卡片含小标题、图标、要点",
      "- left_text：左侧文字 + 右侧多个小 visuals 组合",
      "- default：单栏居中，仅用于开篇或结尾封面",
      "- chart_top：diagram 图表放在上方，要点/正文放在下方",
      "- chart_left：diagram 图表放在左侧，要点/正文放在右侧（与 two_col 镜像）",
      "- cards：要点拆成 4 张彩色编号卡片（①②③④）平铺",
      "- timeline：要点按横向时间线/步骤排列（编号圆点 + 连线）",
      "- focus：金句/核心结论大字号居中聚焦，配支撑要点与图表",
    ].join("\n"),
    dataFormats: [
      '- table: 用 | 分隔列，\\n 分隔行，如 "维度|时间|空间\\n最优|O(1)|O(1)\\n最差|O(n)|O(n)"',
      '- list: 每行以 - 开头，如 "- 原地排序\\n- 稳定排序"',
      '- formula: LaTeX 风格字符串，可含推导过程与符号说明，如 "T(n)=2T(n/2)+O(n)" 或 "T(n) = O(n log n)，n 为数据规模"',
      '- code: 代码或伪代码，data 为代码文本（含注释，逐行换行），另配 lang 字段指定语言（如 "python" / "java" / "c" / "pseudocode"）',
      '- highlight: 一句核心结论，如 "空间复杂度为 O(1)，适合内存受限场景"',
      '- quote: 一句关键提示或面试口诀',
      '- badge: 逗号分隔关键词，如 "原地,稳定,分治,递归"',
      '- line_chart/bar_chart: 用 "x1,y1;x2,y2;x3,y3" 或 "标签1:5|标签2:8|标签3:3"',
      '- complexity_curve: 多组 "O(1)=1,4,16,64,256;O(n)=1,4,16,64,256;O(n²)=1,16,256,1024,4096"，横坐标点为 n=1,4,16,64,256',
      '- scatter_chart: 用 "x,y;x,y;x,y" 表示散点坐标',
      '- donut_chart: 用 "标签:值|标签:值"，如 "合格:85|不合格:15"',
      '- funnel: 用 "阶段:数量|阶段:数量"（逐级递减），如 "曝光:1000|点击:300|转化:60"',
      '- radar_chart: 用 "指标:得分|指标:得分"，如 "性能:90|稳定性:80|成本:60"',
      '- bubble_chart: 用 "名称:x,y,大小;名称:x,y,大小"（大小为正数），无名称也可只写 "x,y,大小"',
      '- waterfall: 用 "阶段:增减值|阶段:增减值"（正为增、负为减），如 "初始:100|成本:-30|收入:50|结果:120"',
      '- gauge: 用 "指标:0-100 数值"，如 "通过率:87"',
      '- heatmap: 数值网格，每行一个用逗号分隔，首行可为列标签（如 "基础,进阶,高级\\n算法:5,8,3\\n网络:4,9,7"）',
      '- array: 数组状态图，如 "5,2,8,1,9|0,2" 表示数组和选中下标',
      '- flow: 流程图，用 -> 连接，如 "输入 -> 分治 -> 合并 -> 输出"',
      '- tree: 树形结构，推荐用每行一条"根->子->孙"路径表示（多条路径自动合并成一棵树，节点名简短）；也可每行一层、逗号分隔节点',
      "- compare: 对比表格，格式同 table",
    ].join("\n"),
  };
}

// ── 校验与归一化 ──
// 返回 { slides, errors }：errors 为精确到字段路径的问题列表（供重试回喂 LLM）。
// 策略：能修就修（枚举非法→回退默认值、类型错→转字符串），不可修复的整页报错。

const asText = (v) => (v == null ? "" : typeof v === "string" ? v : Array.isArray(v) ? v.join("\n") : String(v));

function validateSlide(slide, idx) {
  const errors = [];
  if (!slide || typeof slide !== "object" || Array.isArray(slide)) {
    errors.push(`slides[${idx}] 不是对象`);
    return { slide: null, errors };
  }
  const out = { ...slide };
  out.title = asText(slide.title).trim();
  if (!out.title) {
    errors.push(`slides[${idx}].title 缺失或为空`);
    return { slide: null, errors };
  }
  out.subtitle = asText(slide.subtitle).trim();
  out.text = asText(slide.text).trim();
  if (!out.text) errors.push(`slides[${idx}].text 缺失或为空（保留该页，讲解文字为空）`);
  let layout = asText(slide.layout).trim();
  if (!LAYOUT_POOL.includes(layout)) {
    if (layout) errors.push(`slides[${idx}].layout "${layout}" 非法，回退 two_col`);
    layout = "two_col";
  }
  out.layout = layout;
  out.left = asText(slide.left);
  out.right = asText(slide.right);
  out.bottom = asText(slide.bottom).trim().slice(0, 40);
  if (slide.code != null) out.code = asText(slide.code);

  // visuals：逐项校验，非法项降级（type 未知→highlight；data 缺失→丢弃该项）
  if (slide.visuals != null) {
    if (!Array.isArray(slide.visuals)) {
      errors.push(`slides[${idx}].visuals 不是数组，已移除`);
      delete out.visuals;
    } else {
      const kept = [];
      slide.visuals.forEach((v, vi) => {
        if (!v || typeof v !== "object") {
          errors.push(`slides[${idx}].visuals[${vi}] 不是对象，已移除`);
          return;
        }
        const nv = { ...v };
        let type = asText(v.type).trim();
        if (!VISUAL_TYPES.includes(type)) {
          if (type) errors.push(`slides[${idx}].visuals[${vi}].type "${type}" 非法，降级 highlight`);
          type = "highlight";
        }
        nv.type = type;
        nv.data = asText(v.data);
        if (!nv.data.trim()) {
          errors.push(`slides[${idx}].visuals[${vi}].data 为空，已移除该项`);
          return;
        }
        if (v.caption != null) nv.caption = asText(v.caption).trim();
        if (type === "code" && v.lang != null) nv.lang = asText(v.lang).trim().slice(0, 20);
        kept.push(nv);
      });
      out.visuals = kept;
    }
  }

  // diagram：type 或 data 非法时整块移除（渲染层本就要求两者齐备）
  if (slide.diagram != null && slide.diagram !== "none") {
    const d = slide.diagram;
    if (typeof d !== "object") {
      errors.push(`slides[${idx}].diagram 不是对象，已移除`);
      delete out.diagram;
    } else {
      const dtype = asText(d.type).trim();
      const ddata = asText(d.data).trim();
      if (!dtype || dtype === "none" || !ddata) {
        delete out.diagram;
      } else if (!DIAGRAM_TYPES.includes(dtype)) {
        errors.push(`slides[${idx}].diagram.type "${dtype}" 非法，已移除图表`);
        delete out.diagram;
      } else {
        out.diagram = { type: dtype, data: ddata };
        if (d.caption != null) out.diagram.caption = asText(d.caption).trim();
      }
    }
  } else {
    delete out.diagram;
  }
  return { slide: out, errors };
}

function validateSlides(slides) {
  const errors = [];
  const out = [];
  if (!Array.isArray(slides)) return { slides: [], errors: ["slides 不是数组"] };
  slides.forEach((s, i) => {
    const r = validateSlide(s, i);
    errors.push(...r.errors);
    if (r.slide) out.push(r.slide);
  });
  return { slides: out, errors };
}

// ── RFC 6902 JSON Patch（子集：add/replace/remove）+ 路径白名单校验 ──
// 仅允许对单页 slide 的已知字段做增量修改，防止 AI 越权改结构。

function unescapeToken(t) { return t.replace(/~1/g, "/").replace(/~0/g, "~"); }

function parsePointer(path) {
  if (typeof path !== "string" || (path !== "" && !path.startsWith("/")))
    throw new Error(`非法 JSON Pointer: ${JSON.stringify(path)}`);
  if (path === "") return [];
  return path.slice(1).split("/").map(unescapeToken);
}

// 校验 patch 目标路径是否落在允许范围内（PATCHABLE_FIELDS 顶层字段，或 visuals/diagram 子树）
function assertPathAllowed(tokens) {
  if (!tokens.length) throw new Error("不允许替换整个 slide 根对象");
  const top = tokens[0];
  if (top === "visuals" || top === "diagram") return;
  if (!PATCHABLE_FIELDS.includes(top))
    throw new Error(`路径 /${tokens.join("/")} 不在可编辑字段白名单内`);
  if (tokens.length > 1)
    throw new Error(`字段 ${top} 为纯文本，不支持子路径 /${tokens.join("/")}`);
}

function applyPatch(doc, patch) {
  if (!Array.isArray(patch)) throw new Error("patch 必须是数组");
  const clone = JSON.parse(JSON.stringify(doc));
  for (const op of patch) {
    if (!op || typeof op !== "object") throw new Error("patch 项不是对象");
    if (!["add", "replace", "remove"].includes(op.op))
      throw new Error(`不支持的 patch op: ${op.op}（仅 add/replace/remove）`);
    const tokens = parsePointer(op.path);
    assertPathAllowed(tokens);
    // 定位父容器与键
    let parent = clone;
    for (let i = 0; i < tokens.length - 1; i++) {
      parent = parent[tokens[i]];
      if (parent == null || typeof parent !== "object")
        throw new Error(`路径 ${op.path} 中段不存在`);
    }
    const key = tokens[tokens.length - 1];
    if (op.op === "remove") {
      if (Array.isArray(parent)) {
        const n = Number(key);
        if (!Number.isInteger(n) || n < 0 || n >= parent.length)
          throw new Error(`数组下标越界: ${op.path}`);
        parent.splice(n, 1);
      } else delete parent[key];
    } else {
      if (op.value === undefined) throw new Error(`${op.op} 缺少 value: ${op.path}`);
      if (Array.isArray(parent) && key === "-") parent.push(op.value);
      else if (Array.isArray(parent)) {
        const n = Number(key);
        if (!Number.isInteger(n) || n < 0 || n > parent.length)
          throw new Error(`数组下标越界: ${op.path}`);
        parent.splice(n, op.op === "add" ? 0 : 1, op.value);
      } else parent[key] = op.value;
    }
  }
  return clone;
}

module.exports = {
  LAYOUT_POOL,
  VISUAL_TYPES,
  DIAGRAM_TYPES,
  SLIDE_FIELDS,
  PATCHABLE_FIELDS,
  buildPromptSpec,
  validateSlide,
  validateSlides,
  applyPatch,
};
