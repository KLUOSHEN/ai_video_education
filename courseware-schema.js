// courseware-schema.js — 「真课件」v2 格式单一事实来源
// 每页 = v1 slide 全字段（title/layout/left/right/text/bottom/visuals/diagram）
//        + scene（交互场景，可选）+ narration（分句讲稿，每句绑定 spotlight 锚点）
// server.js（生成校验、prompt 注入）与 watch.html 渲染层共用本模块约定。

// ── spotlight 效果枚举 ──
const FX_ENUM = ["spot", "pulse", "underline", "zoom", "none"];

// ── 交互场景注册表 ──
// LLM 只能从 template id 中选择并填参数；参数按 schema 钳制（枚举白名单 / 数值 range），
// 绝不接受 LLM 生成的代码或表达式。前端 scene-templates.js 为真正实现，此处为校验镜像。
const SCENE_REGISTRY = {
  "sort-sim": {
    label: "排序算法仿真",
    kind: "sim",
    params: {
      algorithm: { type: "enum", allowed: ["bubble", "insertion", "quick", "merge"], default: "bubble" },
      size: { type: "int", min: 8, max: 32, default: 16 },
    },
  },
  "binary-search-sim": {
    label: "二分查找仿真",
    kind: "sim",
    params: {
      size: { type: "int", min: 8, max: 32, default: 16 },
    },
  },
  "surface-3d": {
    label: "3D 函数曲面",
    kind: "three",
    params: {
      // 函数表达式只允许枚举，服务端映射到预置实现，绝不 eval
      fnExpr: {
        type: "enum",
        allowed: ["sin(x)*cos(y)", "x*x-y*y", "sin(sqrt(x*x+y*y))", "cos(x)*sin(y)*exp(-0.1*(x*x+y*y))"],
        default: "sin(x)*cos(y)",
      },
      gridN: { type: "int", min: 20, max: 80, default: 48 },
    },
  },
};

// ── 从 v1 slide 派生本页合法的 spotlight 锚点 ──
// id 与 watch.html renderDeckSlideInto 渲染时注入的 data-el 属性一一对应
function deriveElements(slide) {
  const els = [{ id: "title", label: "页面标题" }];
  if (slide.subtitle) els.push({ id: "subtitle", label: "副标题" });
  if (String(slide.left || "").trim()) els.push({ id: "pts", label: "核心要点" });
  if (String(slide.text || "").trim()) els.push({ id: "txt", label: "讲解正文" });
  if (slide.diagram && slide.diagram.type && slide.diagram.type !== "none" && slide.diagram.data)
    els.push({ id: "diagram", label: "图表" });
  if (Array.isArray(slide.visuals)) {
    slide.visuals.forEach((v, i) => {
      if (v && v.data) els.push({ id: "vis-" + i, label: "可视化卡片 " + (i + 1) });
    });
  }
  if (String(slide.bottom || "").trim()) els.push({ id: "bottom", label: "底部强调条" });
  if (slide.scene && slide.scene.template) els.push({ id: "scene", label: "交互场景" });
  return els;
}

// ── 校验/归一化 narration ──
// 返回 { narration, errors }；narration 为归一化后的句子数组（至少 1 句，全非法则空数组由调用方兜底）
// 开场问候/寒暄/开篇套话正则：命中即剔除（LLM 偶发仍会产出『今天让我们…』，此处兜底，保证配音干净）
const GREETING_RE = /^(今天(?:我们|大家)?(?:来|一起|就)?(?:学习|了解|认识|走进|探讨|聊|讲|看|开启|开始)|(?:同学们好|大家好|各位(?:同学|观众|朋友|老师)|欢迎(?:大家)?(?:来到|收看|观看|走进|收听)|(?:让我们|让我们一起)(?:来)?(?:学习|了解|认识|走进|开始|进入|探讨)|(?:我们|现在)?开始(?:上课|今天的课|吧)?|(?:这节|本节|本节课|今天的课)(?:我们|大家)?(?:要)?(?:学习|讲|了解|来|进入)|上节课|上一节课|上一节|上次课)[，,。!！:：\s]|^[，,。!！]\s*)/i;
function validateNarration(arr, elements) {
  const errors = [];
  if (!Array.isArray(arr)) {
    errors.push("narration 不是数组");
    return { narration: [], errors };
  }
  const validTargets = new Set(elements.map((e) => e.id));
  const out = [];
  let firstRaw = null; // 兜底句：全部被过滤时保留首句，避免该页无声
  arr.forEach((item, i) => {
    if (!item || typeof item !== "object") {
      errors.push(`narration[${i}] 不是对象，已丢弃`);
      return;
    }
    const text = String(item.text == null ? "" : item.text).replace(/\s+/g, " ").trim().slice(0, 80);
    if (!text) {
      errors.push(`narration[${i}].text 为空，已丢弃`);
      return;
    }
    if (GREETING_RE.test(text)) {
      errors.push(`narration[${i}] 命中开场问候/套话，已剔除`);
      if (!firstRaw) firstRaw = text;
      return;
    }
    let target = item.target == null ? null : String(item.target).trim();
    if (target && !validTargets.has(target)) {
      errors.push(`narration[${i}].target "${target}" 不在本页元素清单中，已置空`);
      target = null;
    }
    if (target === "title") {
      errors.push(`narration[${i}].target 为 title，标题不参与聚光，已置空`);
      target = null;
    }
    let fx = String(item.fx || "spot").trim();
    if (!FX_ENUM.includes(fx)) fx = target ? "spot" : "none";
    if (!target) fx = "none";
    if (!firstRaw) firstRaw = text;
    out.push({ text, target, fx });
  });
  if (out.length === 0 && firstRaw) out.push({ text: firstRaw, target: null, fx: "none" });
  if (out.length > 8) {
    errors.push(`narration 共 ${out.length} 句，超出 8 句上限，已截断`);
    out.length = 8;
  }
  return { narration: out, errors };
}

// ── 校验/归一化 scene ──
// template 不在注册表 → 返回 null（该页无场景）；参数逐项钳制
function validateScene(scene) {
  if (!scene || typeof scene !== "object") return null;
  const template = String(scene.template || "").trim();
  const def = SCENE_REGISTRY[template];
  if (!def) return null;
  const params = {};
  const raw = scene.params && typeof scene.params === "object" ? scene.params : {};
  for (const key of Object.keys(def.params)) {
    const spec = def.params[key];
    const v = raw[key];
    if (spec.type === "enum") {
      params[key] = spec.allowed.includes(v) ? v : spec.default;
    } else if (spec.type === "int") {
      const n = Math.round(Number(v));
      params[key] = Number.isFinite(n) ? Math.min(spec.max, Math.max(spec.min, n)) : spec.default;
    } else if (spec.type === "range") {
      const n = Number(v);
      params[key] = Number.isFinite(n) ? Math.min(spec.max, Math.max(spec.min, n)) : spec.default;
    } else if (spec.type === "bool") {
      params[key] = v === undefined ? !!spec.default : !!v;
    }
  }
  const caption = String(scene.caption == null ? "" : scene.caption).replace(/\s+/g, " ").trim().slice(0, 40);
  return { template, params, caption };
}

// ── prompt 注入段 ──
function buildCoursewarePromptSpec() {
  const sceneLines = Object.keys(SCENE_REGISTRY)
    .map((id) => {
      const def = SCENE_REGISTRY[id];
      const ps = Object.keys(def.params)
        .map((k) => {
          const s = def.params[k];
          if (s.type === "enum") return `${k}∈[${s.allowed.join("|")}]（默认 ${s.default}）`;
          if (s.type === "int") return `${k}：整数 ${s.min}-${s.max}（默认 ${s.default}）`;
          return `${k}：数值（默认 ${s.default}）`;
        })
        .join("，");
      return `- "${id}"（${def.label}）：${ps}`;
    })
    .join("\n");
  return {
    sceneLines,
    sceneTemplateIds: Object.keys(SCENE_REGISTRY),
    narrationRules: [
      "narration 是本页的分句讲解脚本（3-8 句），TTS 逐句朗读、讲到哪句屏幕上对应区域就高亮。内容规范参考 AI 互动课堂讲稿标准（OpenMAIC）：",
      "1. 【单一声线·老师独白】全部句子都是老师一人连续讲述。严禁模拟对话（如『小明问：』）、严禁给角色加标签（如『（学生）：』『（AI助教）：』）、严禁括号舞台提示（如『（疑惑）』『（画外音）』）",
      "2. 【语音承载全部讲解】页面上只放简洁要点和关键词，所有展开、解释、例子、过渡语、鼓励语都必须写进 narration——听众只听语音也能完整听懂，不看屏幕也不丢内容",
      "3. 【同一节课连续感·禁套话】全部页面属于同一节课。严禁任何问候、寒暄、开篇套话——如『今天让我们来学习』『同学们大家好』『欢迎大家来到』『我们开始上课吧』『这节课我们来讲』『上节课我们学了』：第 1 页也禁止问候，直接用一句话点明本节课主题切入正题；中间页可用『接下来』『刚才讲到』做轻过渡，但不得重复开篇套话；最后一页总结收尾，同样不说『谢谢大家』之类的客套话，直接给出总结性收束",
      "4. 每句 12-60 字，口语化，像老师现场讲课：先说看哪里、再讲为什么；禁止书面腔堆砌",
      "5. 每句 target 必须从本页元素清单中选一个 id（subtitle/pts/txt/diagram/vis-N/bottom/scene），或 null（泛指全页时用 null）。标题(title)不参与聚光：严禁把 target 设为 title——标题在页面上常驻，不需要也不应该高亮",
      "6. 严禁逐字朗读或复述页面标题/副标题：标题已显示在屏幕上，听众自己会看。禁止『我们来看一下标题』『这个标题是』『本页讲的是』之类的套话，任何句子的文本不得与标题重复",
      "7. 首句直接切入本页核心内容讲（可口头带出关键词，但不要整句照抄标题），随后按视觉动线：要点 → 图表/场景 → 结论",
      "8. 【先指后讲】聚光句的台词内容必须与该 target 元素展示的内容对应（指哪里讲哪里），讲图表就报出图表里的具体数值/趋势，讲场景就描述正在发生的动态；fx 从 spot（遮罩聚光）/ pulse（呼吸描边）/ underline（底部色带）/ zoom（轻微放大提亮）中选；target 为 null 时 fx 必须为 none",
      "9. 最后一句总结本页要点并给出 target（通常是 pts 或 txt）",
    ].join("\n"),
    sceneRules: [
      "scene（可选）：本页适合用可交互仿真/3D 场景演示动态过程时输出，否则为 null。",
      "只能从以下模板中选（template 必须逐字一致），params 按说明给值：",
      sceneLines,
      "有 scene 的页面：diagram 置 null、visuals 至多 1 个，把版面留给交互场景；caption 是一句话场景说明（20 字内）。",
    ].join("\n"),
  };
}

module.exports = {
  FX_ENUM,
  SCENE_REGISTRY,
  deriveElements,
  validateNarration,
  validateScene,
  buildCoursewarePromptSpec,
};
