"use strict";

/**
 * Zero-dependency backend for the static learning pages.
 * API prefix: /api/v1. Static files are served from this directory.
 */
const http = require("node:http");
const fs = require("node:fs/promises");
const fssync = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { URL } = require("node:url");
const { buildPptx, buildZip } = require("./pptx");
const PPT_SCHEMA = require("./ppt-schema");
const COURSEWARE_SCHEMA = require("./courseware-schema");
const { spawn } = require("node:child_process");
const { slidesToSvgs, parseChart } = require("./pptx-svg");
loadEnv(path.join(__dirname, ".env"));
// 检索增强生成(RAG)模块——文档切片/向量化/检索/持久化, 见 rag.js
const rag = require("./rag");
function dataRoot() {
  return process.env.APP_DATA_DIR || path.join(__dirname, "data");
}
const RAG_INDEX = new rag.RagIndex(
  process.env.RAG_INDEX_FILE || path.join(dataRoot(), "rag-index.json"),
);
const PORT = Number(process.env.PORT || 3000);
// Django 后端代理: /ai-api/* → AI_CLASSROOM_BASE/api/*
const AI_CLASSROOM_BASE = (
  process.env.AI_CLASSROOM_BASE || "http://localhost:8000"
).replace(/\/$/, "");
const AI_PROXY_PREFIX = "/ai-api";
const ROOT = __dirname;
// Next.js 静态导出产物（Hero 落地页及其资源），作为静态托管的第二根目录
const OUT_DIR = path.join(ROOT, "out");
const DATA_DIR = path.resolve(
  process.env.APP_DATA_DIR || path.join(ROOT, "data"),
);
const STORAGE_DIR = path.resolve(
  process.env.APP_STORAGE_DIR || path.join(ROOT, "storage"),
);
const STORE_FILE = path.join(DATA_DIR, "store.json");
const API_PREFIX = "/api/v1";
const MAX_BODY_BYTES = 8 * 1024 * 1024;
const encryptionKey = crypto
  .createHash("sha256")
  .update(process.env.DATA_ENCRYPTION_KEY || "development-only-key-change-me")
  .digest();
const rateBuckets = new Map();
const stats = {
  startedAt: new Date().toISOString(),
  requests: 0,
  errors: 0,
  generated: 0,
};

function loadEnv(file) {
  if (!fssync.existsSync(file)) return;
  for (const line of fssync.readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (match && !process.env[match[1]])
      process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
  }
}

class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

class JsonStore {
  constructor(file) {
    this.file = file;
    this.data = {
      searches: [],
      tasks: [],
      videoTasks: [],
      coursewareTasks: [],
      questions: [],
      attempts: [],
      mistakes: [],
      diagnostics: [],
      notes: [],
      workflowTasks: [],
    };
    this.writeQueue = Promise.resolve();
  }
  async init() {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    await fs.mkdir(path.join(STORAGE_DIR, "audio"), { recursive: true });
    await fs.mkdir(path.join(STORAGE_DIR, "video"), { recursive: true });
    await fs.mkdir(path.join(STORAGE_DIR, "poster"), { recursive: true });
    try {
      this.data = {
        ...this.data,
        ...JSON.parse(await fs.readFile(this.file, "utf8")),
      };
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      await this.persist();
    }
  }
  persist() {
    this.writeQueue = this.writeQueue.then(() =>
      fs.writeFile(this.file, JSON.stringify(this.data, null, 2), "utf8"),
    );
    return this.writeQueue;
  }
  async add(collection, record) {
    this.data[collection].push(record);
    await this.persist();
    return record;
  }
  find(collection, id) {
    return this.data[collection].find((entry) => entry.id === id);
  }
  async update(collection, id, update) {
    const item = this.find(collection, id);
    if (!item) return null;
    Object.assign(item, update, { updatedAt: new Date().toISOString() });
    await this.persist();
    return item;
  }
}
const store = new JsonStore(STORE_FILE);

function requestId() {
  return crypto.randomUUID();
}
function now() {
  return new Date().toISOString();
}
function cleanText(value, name = "text") {
  if (typeof value !== "string")
    throw new ApiError(400, "INVALID_INPUT", `${name} 必须是字符串`);
  const normalized = value
    .normalize("NFC")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/[\t ]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!normalized) throw new ApiError(400, "EMPTY_TEXT", `${name} 不能为空`);
  if (normalized.length > 4000)
    throw new ApiError(413, "TEXT_TOO_LONG", `${name} 最多 4000 个字符`);
  if (
    /(<script\b|javascript:|data:text\/html|ignore\s+(all|previous)\s+instructions)/i.test(
      normalized,
    )
  )
    throw new ApiError(
      422,
      "UNSAFE_CONTENT",
      "输入包含不支持的可执行或提示注入内容",
    );
  return normalized;
}
// 解析 LLM 返回的 JSON：剥离 Markdown 代码围栏；若因裸反斜杠（LaTeX 如 \log、\sqrt、\frac、\Theta）
// 导致 JSON.parse 抛 "Bad escaped character in JSON"，则把"反斜杠后跟不视为 JSON 转义的字符"的
// 裸反斜杠加倍后重试。视为合法转义、原样保留的只有：\\、\"、\/、\n、\r、\uXXXX（b/f/t 也当作
// LaTeX 加倍，因为该场景下几乎不可能是有意的退格/换页/制表转义），已格式良好的 JSON 直接返回。
const JSON_ESCAPE = /["\\/nru]/;
// 把 JSON 字符串【内部】的原始控制字符（<0x20）转义为 \uXXXX。
// LLM 常在多行 text 里直接输出换行/制表等原始控制符，导致 JSON.parse 抛
// "Bad control character in string literal"。此函数只改字符串内、不影响
// JSON 结构空白（结构空白在字符串外，原样保留）。
function sanitizeControlChars(json) {
  let out = '', inStr = false, esc = false;
  for (let i = 0; i < json.length; i++) {
    const ch = json[i];
    if (inStr) {
      if (esc) { out += ch; esc = false; }
      else if (ch === '\\') { out += ch; esc = true; }
      else if (ch === '"') { inStr = false; out += ch; }
      else {
        const code = ch.charCodeAt(0);
        out += code < 0x20 ? '\\u' + ('000' + code.toString(16)).slice(-4) : ch;
      }
    } else {
      if (ch === '"') inStr = true;
      out += ch;
    }
  }
  return out;
}
function parseLLMJson(raw) {
  const cleaned = sanitizeControlChars(
    String(raw || "")
      .replace(/```json\n?|\n?```/g, "")
      .trim()
  );
  try {
    return JSON.parse(cleaned);
  } catch (error) {
    /* 回退：修复裸反斜杠后重试 */
  }
  const repaired = cleaned.replace(/\\+/g, (run, offset, str) => {
    const next = str[offset + run.length];
    return next && JSON_ESCAPE.test(next)
      ? run
      : run.length % 2
        ? run + "\\"
        : run;
  });
  return JSON.parse(repaired);
}
function enumValue(value, allowed, fallback, name) {
  if (value === undefined || value === null) return fallback;
  if (!allowed.includes(value))
    throw new ApiError(
      400,
      "INVALID_INPUT",
      `${name} 必须为 ${allowed.join("、")} 之一`,
    );
  return value;
}
// 把 LLM 返回的任意嵌套 JSON 渲染成可读 Markdown（AI 笔记兜底）
function jsonToMarkdown(obj, depth) {
  depth = depth || 0;
  if (obj === null || obj === undefined) return "";
  if (typeof obj !== "object") return String(obj);
  if (Array.isArray(obj))
    return obj.map((v) => "- " + jsonToMarkdown(v, depth + 1).replace(/\n/g, "\n  ")).join("\n");
  const lines = [];
  for (const [k, v] of Object.entries(obj)) {
    if (v && typeof v === "object") {
      lines.push((depth > 0 ? "#".repeat(Math.min(6, depth + 2)) : "##") + " " + k);
      lines.push(jsonToMarkdown(v, depth + 1));
    } else {
      lines.push("**" + k + "**：" + String(v));
    }
  }
  return lines.join("\n");
}
function safeFileName(prefix, ext) {
  return `${prefix}-${Date.now()}-${crypto.randomUUID()}${ext}`;
}
function publicAsset(file) {
  return `/storage/${file.replaceAll(path.sep, "/")}`;
}
// AES-256-GCM: optional user references are never written to the JSON store in plaintext.
function encryptSensitive(value) {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || value.length > 256)
    throw new ApiError(
      400,
      "INVALID_INPUT",
      "userRef 必须是不超过 256 字符的字符串",
    );
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey, iv);
  const data = Buffer.concat([
    cipher.update(value.normalize("NFC"), "utf8"),
    cipher.final(),
  ]);
  return `v1.${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${data.toString("base64url")}`;
}
function errorPayload(error, id) {
  return {
    error: {
      code: error.code || "INTERNAL_ERROR",
      message: error.expose
        ? error.message
        : error.status
          ? error.message
          : "服务器内部错误",
      details: error.details,
    },
    requestId: id,
  };
}
function send(res, status, payload, requestIdValue) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "x-request-id": requestIdValue,
    "cache-control": "no-store",
  });
  res.end(JSON.stringify(payload));
}
async function body(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES)
      throw new ApiError(
        413,
        "PAYLOAD_TOO_LARGE",
        `请求体不能超过 ${Math.round(MAX_BODY_BYTES / 1024 / 1024)}MB`,
      );
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new ApiError(400, "INVALID_JSON", "请求体必须是有效 JSON");
  }
}
function getClientIp(req) {
  return (
    req.headers["x-forwarded-for"] ||
    req.socket.remoteAddress ||
    "unknown"
  )
    .toString()
    .split(",")[0]
    .trim();
}
function allowRequest(req) {
  const ip = getClientIp(req);
  const stamp = Date.now();
  const bucket = rateBuckets.get(ip) || [];
  const recent = bucket.filter((time) => time > stamp - 60_000);
  if (recent.length >= 60) return false;
  recent.push(stamp);
  rateBuckets.set(ip, recent);
  return true;
}
function auth(req) {
  if (!process.env.API_KEY) return;
  const token =
    req.headers.authorization?.replace(/^Bearer\s+/i, "") ||
    req.headers["x-api-key"];
  const expected = Buffer.from(process.env.API_KEY);
  const actual = Buffer.from(token || "");
  if (
    expected.length !== actual.length ||
    !crypto.timingSafeEqual(expected, actual)
  )
    throw new ApiError(401, "UNAUTHORIZED", "缺少或无效的 API 凭证");
}
function log(event, fields = {}) {
  console.log(JSON.stringify({ time: now(), event, ...fields }));
}
function mime(file) {
  return (
    {
      ".html": "text/html; charset=utf-8",
      ".js": "text/javascript; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".json": "application/json; charset=utf-8",
      ".svg": "image/svg+xml",
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".webp": "image/webp",
      ".gif": "image/gif",
      ".ico": "image/x-icon",
      ".wav": "audio/wav",
      ".mp3": "audio/mpeg",
      ".m4a": "audio/mp4",
      ".ogg": "audio/ogg",
      ".webm": "video/webm",
      ".mp4": "video/mp4",
      ".woff": "font/woff",
      ".woff2": "font/woff2",
      ".ttf": "font/ttf",
      ".eot": "application/vnd.ms-fontobject",
      ".pptx":
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      ".zip": "application/zip",
    }[path.extname(file).toLowerCase()] || "application/octet-stream"
  );
}

function getTopic(text) {
  const entries = [
    [/快速排序|排序|sort/i, ["快速排序", "算法"]],
    [/TCP|握手|网络|HTTP|HTTPS/i, ["TCP 协议基础", "计算机网络"]],
    [/进程|线程|死锁|操作系统/i, ["进程与线程", "操作系统"]],
    [/二叉树|树|遍历/i, ["二叉树遍历", "数据结构"]],
    [/数据库|SQL|事务/i, ["数据库事务", "数据库"]],
    [/二分|查找|search/i, ["二分查找", "算法"]],
  ];
  const match = entries.find(([pattern]) => pattern.test(text));
  return match
    ? { title: match[1][0], subject: match[1][1] }
    : { title: text.slice(0, 40), subject: "综合学习" };
}
function buildLessonPlan(questionText, topic) {
  const stepLibrary = {
    快速排序: [
      "确定基准值 pivot，并说明它用于划分待排序区间。",
      "从两端扫描，把小于基准值的元素移到左侧、大于基准值的元素移到右侧。",
      "基准值归位后，对左右两个子区间递归执行相同过程。",
    ],
    "TCP 协议基础": [
      "先明确通信双方：客户端与服务器，以及建立可靠连接的目标。",
      "按时间顺序标出 SYN、SYN+ACK、ACK 三次报文，并说明每一次确认的作用。",
      "结合时序图核对连接建立后双方均具备收发能力。",
    ],
    进程与线程: [
      "先区分资源拥有者与执行单位，建立进程、线程两个概念框。",
      "从地址空间、调度开销、通信方式三个维度逐项比较。",
      "结合并发程序场景总结何时选择进程或线程。",
    ],
    二叉树遍历: [
      "标出根节点、左子树和右子树，建立树形结构图。",
      "按题目要求确定访问顺序，并在每次访问节点时做编号标记。",
      "将访问序列逐项写出，再检查每个节点是否恰好访问一次。",
    ],
    数据库事务: [
      "识别操作是否需要作为一个整体完成，确定事务边界。",
      "用 ACID 四个维度分析原子性、一致性、隔离性和持久性。",
      "结合提交、回滚与并发访问验证最终结果。",
    ],
    二分查找: [
      "确认待查数据已经有序，标出左右边界和中间位置。",
      "比较目标值与中间值，排除不可能的一半区间。",
      "重复更新边界，直到找到目标或区间为空。",
    ],
  };
  const steps = stepLibrary[topic.title] || [
    "完整阅读题干，圈出已知条件、求解目标与限制条件。",
    "将题干转化为相关概念、公式或结构图，明确可使用的方法。",
    "按由已知到结论的顺序逐步推导，每一步都说明依据。",
  ];
  const scenes = [
    {
      index: 1,
      name: "完整题目展示与目标定位",
      visual: "全屏展示完整题干；高亮已知条件、问题和关键词",
      narration: `现在来看完整题目：${questionText}。先不要急于计算，先圈出题目给出的条件，并明确本题最终需要求什么。`,
    },
    {
      index: 2,
      name: "解题思路与核心知识点",
      visual: `知识点卡片：${topic.title}；用关系图连接条件与目标`,
      narration: `这道题考查的是${topic.title}。我们的总体思路是先建立正确的分析框架，再按步骤逐一推导。`,
    },
    ...steps.map((step, index) => ({
      index: index + 3,
      name: `关键步骤 ${index + 1}`,
      visual:
        index === 1
          ? "逐步标注、箭头与关系/流程图分析"
          : "公式、表格或结构图上的动态高亮",
      narration: `第 ${index + 1} 步，${step}`,
    })),
    {
      index: steps.length + 3,
      name: "结论检验与方法总结",
      visual: "高亮最终结论；用检查清单回顾关键步骤",
      narration: `最后回顾：先读懂题意，再抓住${topic.title}的核心方法，按照刚才的步骤完成推导，并用题目条件检查结论是否合理。`,
    },
  ];
  return {
    questionText,
    topic: topic.title,
    learningGoal: `理解“${topic.title}”题目的分析路径并能独立完成同类题。`,
    solutionSteps: steps,
    solutionOverview: `题目完整呈现后，依次完成条件提取、核心方法匹配、分步推导和结论检验。`,
    scenes,
    narration: scenes.map((scene) => scene.narration).join("\n"),
  };
}
function generateQuestions(text, config = {}) {
  const difficulty = enumValue(
    config.difficulty,
    ["easy", "medium", "hard"],
    "medium",
    "difficulty",
  );
  const requested =
    Array.isArray(config.types) && config.types.length
      ? config.types
      : ["choice", "true_false", "fill_blank"];
  const types = requested.map((type) =>
    enumValue(type, ["choice", "true_false", "fill_blank"], null, "题型"),
  );
  const count = Math.min(Math.max(Number(config.count || 3), 1), 10);
  const topic = getTopic(text);
  const idBase = crypto.randomUUID();
  const facts = {
    快速排序: ["分治", "基准值 pivot", "O(n log n)"],
    "TCP 协议基础": ["可靠传输", "三次握手", "确认机制"],
    进程与线程: ["资源分配", "CPU 调度", "并发执行"],
    二叉树遍历: ["前序遍历", "中序遍历", "后序遍历"],
    数据库事务: ["原子性", "一致性", "隔离性"],
    二分查找: ["有序", "中间元素", "O(log n)"],
  };
  const terms = facts[topic.title] || [topic.title, "核心概念", "实践应用"];
  const questions = [];
  for (let index = 0; index < count; index += 1) {
    const type = types[index % types.length];
    const key = terms[index % terms.length];
    const id = `${idBase}-${index}`;
    if (type === "choice")
      questions.push({
        id,
        type,
        difficulty,
        content: `关于“${topic.title}”，下列哪一项最符合本节的核心关键词？`,
        options: [key, "随机猜测", "与主题无关的结论", "跳过学习"],
        correctAnswer: key,
        explanation: `“${key}”是“${topic.title}”的重要学习要点。`,
      });
    if (type === "true_false")
      questions.push({
        id,
        type,
        difficulty,
        content: `判断题：学习“${topic.title}”时，理解“${key}”有助于掌握主题。`,
        options: ["正确", "错误"],
        correctAnswer: "正确",
        explanation: `“${key}”与“${topic.title}”直接相关。`,
      });
    if (type === "fill_blank")
      questions.push({
        id,
        type,
        difficulty,
        content: `填空题：“${topic.title}”的一个核心关键词是 ______。`,
        options: [],
        correctAnswer: key,
        acceptedAnswers: [key.toLowerCase()],
        explanation: `参考答案为“${key}”。`,
      });
  }
  return { topic, questions };
}
function grade(question, answer) {
  const submitted = cleanText(answer, "answer");
  const norm = (value) => String(value).normalize("NFC").trim().toLowerCase();
  const candidates = [
    question.correctAnswer,
    ...(question.acceptedAnswers || []),
  ].map(norm);
  if (candidates.includes(norm(submitted))) return true;
  if (question.type === "choice") {
    const opts = Array.isArray(question.options) ? question.options : [];
    const correct = String(question.correctAnswer ?? "").trim();
    // 提交形式可能是字母 A-D，也可能是选项文本；correctAnswer 也兼容字母或文本两种编码。
    const letterIdx = ["A", "B", "C", "D"].indexOf(submitted.toUpperCase());
    if (
      letterIdx >= 0 &&
      opts[letterIdx] != null &&
      norm(opts[letterIdx]) === norm(correct)
    )
      return true;
    if (
      /^[A-D]$/i.test(correct) &&
      submitted.toUpperCase() === correct.toUpperCase()
    )
      return true;
  }
  return false;
}

// ── 学情采集：客户端标识 / 知识点 / 归因 / 诊断聚合 ──
function getClientId(req) {
  const provided = (req.headers["x-client-id"] || "").toString().trim();
  if (/^[A-Za-z0-9-]{8,64}$/.test(provided)) return provided;
  return "ip:" + getClientIp(req).replace(/[^A-Za-z0-9.:]/g, "_");
}
function normalizeTopic(raw, fallbackText) {
  if (raw && typeof raw === "object" && raw.title)
    return {
      title: String(raw.title).slice(0, 60),
      subject: String(raw.subject || "综合学习").slice(0, 40),
    };
  const parsed = getTopic(String(raw || fallbackText || "综合学习"));
  return { title: parsed.title, subject: parsed.subject };
}
const MISTAKE_CAUSES = [
  "concept",
  "confusion",
  "method",
  "misread",
  "careless",
  "calc",
  "unknown",
];
function mistakeCauseLabel(cause) {
  return (
    {
      concept: "概念不清",
      confusion: "概念混淆",
      careless: "粗心失误",
      method: "方法不当",
      misread: "审题失误",
      calc: "计算失误",
      unknown: "暂无法判断",
    }[cause] || "暂无法判断"
  );
}
function masteryLevel(attempts, correct) {
  if (!attempts) return "未接触";
  const rate = correct / attempts;
  if (attempts >= 3 && rate >= 0.8) return "掌握";
  if (rate >= 0.6) return "一般";
  return "薄弱";
}
// 错题归因（Qwen，失败回退 unknown + 通用建议）
async function analyzeMistakeWithLLM(record) {
  const apiKey = process.env.QWEN_API_KEY;
  if (!apiKey)
    return {
      cause: "unknown",
      causeText: "未配置 QWEN_API_KEY，无法进行 AI 归因",
      suggestion: `建议重新学习「${record.topic.title}」相关知识点后重做本题。`,
    };
  const model = process.env.QWEN_CHAT_MODEL || "qwen-max";
  const system = "你是资深学科教师，擅长诊断学生错题根因。只输出合法 JSON。";
  const prompt = `学生答错了一道题，请像老师一样诊断真正的错误原因，并给出针对性学习建议。
题目：${record.question}
正确答案：${record.correctAnswer}
学生答案：${record.userAnswer}
选项：${Array.isArray(record.options) && record.options.length ? record.options.join("、") : "（无选项信息）"}
知识点：${record.topic.title}（${record.topic.subject}）
题型：${record.type}

请先对比"学生答案"与"正确答案"，判断差异属于哪一类，再选最贴切的一个类别：
- concept(概念不清)：完全没掌握相关概念或知识点本身
- confusion(概念混淆)：混淆了两个相近概念或相近选项（例如把 A 概念当成 B 概念、选错相似项）
- method(方法不当)：概念基本懂，但解题思路、步骤或方法选错了
- misread(审题失误)：看错题意、漏看或误解题目条件
- careless(粗心失误)：本会做，因笔误、漏项、抄错、看错序号等低级失误
- calc(计算失误)：计算或推导过程中数值、符号、运算出错
- unknown(信息不足)：从现有信息无法判断具体原因

要求：必须根据学生答案与正确答案的具体差异推断，能明确就明确，不要一律选概念不清；只有确实看不出差别时再选 unknown。
严格按如下 JSON 输出（不要任何其他内容）：
{"cause":"concept|confusion|method|misread|careless|calc|unknown","causeText":"一句话点明具体错误原因（不超过 30 字）","suggestion":"具体可操作的学习建议，引用对应知识点或学习资源"}`;
  const startedAt = Date.now();
  log("mistake.analyze.request", {
    mistakeId: record.id,
    topic: record.topic.title,
  });
  try {
    const res = await fetch(
      "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: system },
            { role: "user", content: prompt },
          ],
          max_tokens: 512,
        }),
        signal: AbortSignal.timeout(60_000),
      },
    );
    if (!res.ok)
      throw new ApiError(502, "PROVIDER_ERROR", `Qwen 返回 ${res.status}`);
    const data = await res.json();
    const raw = data.choices?.[0]?.message?.content?.trim() || "";
    let json;
    try {
      json = parseLLMJson(raw);
    } catch (e) {
      json = null;
    }
    if (!json) throw new Error("归因返回无法解析");
    const cause = MISTAKE_CAUSES.includes(String(json.cause).toLowerCase())
      ? String(json.cause).toLowerCase()
      : "unknown";
    const result = {
      cause,
      causeText: String(json.causeText || "").slice(0, 200),
      suggestion: String(json.suggestion || "").slice(0, 300),
    };
    log("mistake.analyze.success", {
      mistakeId: record.id,
      cause,
      ms: Date.now() - startedAt,
    });
    return result;
  } catch (e) {
    log("mistake.analyze.failed", {
      mistakeId: record.id,
      code: e.code || "UNKNOWN",
      message: e.message,
      ms: Date.now() - startedAt,
    });
    return {
      cause: "unknown",
      causeText: "AI 归因暂时不可用",
      suggestion: `建议先复习「${record.topic.title}」相关知识点，再重做本题。`,
    };
  }
}
// 学情诊断聚合（本地统计 + 掌握度分级）
function buildDiagnostics(clientId, from, to) {
  const inRange = (ts) => {
    const t = new Date(ts || 0).getTime();
    return Number.isFinite(t) && (!from || t >= from) && (!to || t <= to);
  };
  const list = store.data.attempts.filter(
    (a) => a.clientId === clientId && inRange(a.createdAt),
  );
  const total = list.length;
  const correct = list.filter((a) => a.correct).length;
  const byTopic = new Map();
  for (const a of list) {
    const key = a.topic?.title || "未分类";
    const entry = byTopic.get(key) || {
      topic: key,
      subject: a.topic?.subject || "综合学习",
      attempts: 0,
      correct: 0,
    };
    entry.attempts++;
    if (a.correct) entry.correct++;
    byTopic.set(key, entry);
  }
  const topics = [...byTopic.values()]
    .map((t) => ({
      ...t,
      correctRate: t.attempts ? t.correct / t.attempts : 0,
      masteryLevel: masteryLevel(t.attempts, t.correct),
    }))
    .sort((x, y) => x.correctRate - y.correctRate);
  const mistakes = store.data.mistakes.filter(
    (m) => m.clientId === clientId && inRange(m.createdAt),
  );
  const reviewed = mistakes.filter((m) => m.reviewed).length;
  const trendMap = new Map();
  for (const a of list) {
    const day = String(a.createdAt || "").slice(0, 10);
    if (!day) continue;
    const entry = trendMap.get(day) || { date: day, attempts: 0, correct: 0 };
    entry.attempts++;
    if (a.correct) entry.correct++;
    trendMap.set(day, entry);
  }
  const trend = [...trendMap.values()]
    .map((t) => ({ ...t, accuracy: t.attempts ? t.correct / t.attempts : 0 }))
    .sort((x, y) => x.date.localeCompare(y.date));
  return {
    summary: {
      totalAttempts: total,
      correctCount: correct,
      accuracy: total ? Math.round((correct / total) * 100) / 100 : 0,
      topics,
      weakTopics: topics.filter((t) => t.masteryLevel === "薄弱"),
      mistakeCount: mistakes.length,
      reviewedCount: reviewed,
      reviewRate: mistakes.length
        ? Math.round((reviewed / mistakes.length) * 100) / 100
        : 0,
      trend,
    },
  };
}

async function callProvider(url, apiKey, payload) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(90_000),
  });
  if (!response.ok)
    throw new ApiError(
      502,
      "PROVIDER_ERROR",
      `第三方生成服务返回 ${response.status}`,
    );
  const result = await response.json();
  const assetUrl = result.url || result.data?.url || result.output?.url;
  if (!assetUrl || typeof assetUrl !== "string")
    throw new ApiError(
      502,
      "PROVIDER_INVALID_RESPONSE",
      "第三方服务未返回媒体 URL",
    );
  return assetUrl;
}
async function writeSilentWav(text, speed) {
  const seconds = Math.max(
    1,
    Math.min(10, Math.ceil(text.length / (15 * speed))),
  );
  const rate = 8000;
  const bytes = seconds * rate * 2;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + bytes, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(bytes, 40);
  const file = path.join("audio", safeFileName("tts", ".wav"));
  await fs.writeFile(
    path.join(STORAGE_DIR, file),
    Buffer.concat([header, Buffer.alloc(bytes)]),
  );
  return {
    url: publicAsset(file),
    mimeType: "audio/wav",
    provider: "local-development",
    durationSeconds: seconds,
  };
}
// ── 豆包 Seedance 视频生成 ──
async function createDoubaoTask(query) {
  if (!process.env.ARK_API_KEY)
    throw new ApiError(
      503,
      "SERVICE_UNAVAILABLE",
      "未配置 ARK_API_KEY，请在 .env 中设置",
    );
  const model = process.env.ARK_VIDEO_MODEL || "doubao-seedance-1-0-pro-250528";
  const prompt = `专业的教学内容可视化动画，关于：${query}。深色背景上，使用清晰的大号中文字体逐步展示该知识点的核心概念、定义、公式、流程图、代码示例和关键步骤，配合手绘风格的箭头、高亮框和动态标注来强调重点，文字始终清晰可读，镜头平滑移动聚焦不同内容区域，纯图形化表达，无人物、无水印 --resolution 480p --ratio 16:9 --duration 12 --camera_fixed false --watermark false`;
  const res = await fetch(
    "https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.ARK_API_KEY}`,
      },
      body: JSON.stringify({
        model,
        content: [{ type: "text", text: prompt }],
      }),
      signal: AbortSignal.timeout(30_000),
    },
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new ApiError(
      502,
      "PROVIDER_ERROR",
      `豆包返回 ${res.status}: ${err.error?.message || "未知错误"}`,
    );
  }
  const data = await res.json();
  if (!data.id) throw new ApiError(502, "PROVIDER_ERROR", "豆包未返回任务 ID");
  return data.id;
}

async function getDoubaoTaskStatus(taskId) {
  if (!process.env.ARK_API_KEY)
    throw new ApiError(
      503,
      "SERVICE_UNAVAILABLE",
      "未配置 ARK_API_KEY，请在 .env 中设置",
    );
  const res = await fetch(
    `https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks/${taskId}`,
    {
      headers: { Authorization: `Bearer ${process.env.ARK_API_KEY}` },
      signal: AbortSignal.timeout(15_000),
    },
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new ApiError(
      502,
      "PROVIDER_ERROR",
      `豆包返回 ${res.status}: ${err.error?.message || "未知错误"}`,
    );
  }
  const data = await res.json();
  if (data.status === "failed" && data.extra?.error) {
    log("video.failed", { taskId, error: data.extra.error });
  }
  return {
    status: data.status,
    video_url: data.status === "succeeded" ? data.content?.video_url : null,
    error: data.extra?.error,
    updated_at: data.updated_at,
  };
}

// ── 豆包 LLM 生成讲稿幻灯片 ──
// 视觉风格规则：生成 PPT 时按所选风格注入 prompt（A+B：参数化风格）
const PPT_STYLES = {
  教学清新: "整体背景浅灰/白柔和，主体为圆角白卡片+细微阴影；标题深蓝 #1e3a8a 粗体、副标题灰 #64748b；图表用专业色系 蓝#4a8eff/绿#22c55e/橙#f59e0b/红#ef4444。",
  极简白: "纯白背景、大量留白；黑白灰为主（标题 #111827、正文 #4b5563、弱化 #9ca3af），仅用单一强调色 #2563eb；细分割线、无阴影、字号更大更疏朗，避免多余装饰。",
  深色科技: "深色背景 #0b1220 或 #111b2f；霓虹强调色 #22d3ee/#a78bfa/#34d399；卡片为半透明深色+细描边，标题用高亮色，可用发光感图表；适合 AI/算法/科技类。",
  商务蓝: "稳重商务蓝灰：背景 #f5f7fa、标题 #1e3a5f、正文 #334155，强调色 #2563eb；卡片白底+轻阴影，图表配色沉稳（蓝/灰/深青）；适合汇报、面试、职场。",
  活泼多彩: "明亮多彩：彩色底色或大面积色块（#f472b6/#f59e0b/#22c55e/#6366f1），圆角更大更卡通，标题活泼可配 emoji 风格图标；适合入门科普、学生向。",
  // —— frontend-slides 预置风格（浅色阅读友好为主，深浅均衡）——
  电子演播室: "白底深黑高对比的演播室分栏感，主色电蓝 #4361ee；上半白/下半深色或蓝条强调，标题用加粗现代无衬线（Manrope 系）偏大，正文深色 #0a0a0a、次要 #555；图表用蓝/白/黑三色，色块与细线干脆利落。",
  复古编辑: "奶油米底 #f5f3ee，正文墨黑 #1a1a1a、次要 #555；标题用有气质的衬线字（Fraunces 系）偏大有力，暖杏色 #e8d4c0 做强调块与几何圆+线的点缀；整体偏杂志报刊、克制成巧，克制留白。",
  分栏粉彩: "双拼底色分栏（蜜桃 #f5e6dc 与薰衣草 #e4dff0）；正文深色 #1a1a1a，标题用圆润无衬线（Outfit 系）加粗偏大；徽章/标签用薄荷 #c8f0d8、鹅黄 #f0f0c8、樱粉 #f0d4e0 等粉彩，圆角大、活泼亲和。",
  粉彩几何: "浅粉彩背景 #c8d9e6，米白卡片 #faf9f7；标题用圆润加粗无衬线（Plus Jakarta Sans 系）偏大，主强调深紫 #7c6aad；辅助色薄荷 #a8d4c4、樱粉 #f0b4d4、鼠尾草绿 #5a7c6a、薰衣草 #9b8dc4；可在边缘用竖色条/色柱作点缀。",
  笔记本标签: "深灰外底 #2d2d2d + 米色纸张卡片 #f8f6f1，正文字色 #1a1a1a；标题用古典衬线（Bodoni Moda 系）偏大；右侧缘用彩色标签（薄荷 #98d4bb/薰衣草 #c7b8ea/樱粉 #f4b8c5/天蓝 #a8d8ea/奶油 #ffe6a7）作栏目分隔，像手账/笔记本分区。",
  创意电压: "电蓝 #0066ff 主色与深蓝紫 #1a1a2e 搭配，霓虹黄 #d4ff00 高亮强调；标题用现代有力的无衬线（Syne 系）偏大，正文白色/浅色；用荧光黄高亮框/徽章强调关键公式、名词与数字，科技感强，适合 AI/算法/编程类。",
};

// —— 布局去重：保证每一页版式互不相同（LLM 提示词约束不可靠，此处程序化兜底）——
// 布局池等格式约定统一来自 ppt-schema.js（单一事实来源）
const LAYOUT_POOL = PPT_SCHEMA.LAYOUT_POOL;

function enforceDistinctLayouts(slides) {
  const n = slides.length;
  const count = new Map();
  slides.forEach((s) => {
    const l = LAYOUT_POOL.includes(String(s.layout || "").trim()) ? String(s.layout).trim() : "two_col";
    s.layout = l;
    count.set(l, (count.get(l) || 0) + 1);
  });
  slides.forEach((s, i) => {
    if ((count.get(s.layout) || 0) <= 1) return;
    const hasDia = !!(s.diagram && s.diagram.type && s.diagram.type !== "none" && s.diagram.data);
    const rank = (l) => {
      let r = 0;
      if (l === "two_col" || l === "split") r += 60; // 尽量少用两栏版式，避免页面雷同
      if (l === "default") r += i === 0 ? -100 : 20;
      if (l === "focus" || l === "bottom_bar") r += i === n - 1 ? -60 : 3;
      if (hasDia && (l === "chart_top" || l === "chart_left" || l === "left_text" || l === "cards" || l === "timeline")) r -= 10;
      if (!hasDia && (l === "cards" || l === "timeline" || l === "triple")) r -= 4;
      return r;
    };
    let best = null, bestRank = Infinity;
    LAYOUT_POOL.forEach((l) => {
      const cur = count.get(l) || 0;
      const r = rank(l) + (cur === 0 ? -50 : cur * 15);
      if (r < bestRank) { bestRank = r; best = l; }
    });
    if (!best) return;
    count.set(s.layout, (count.get(s.layout) || 0) - 1);
    s.layout = best;
    count.set(best, (count.get(best) || 0) + 1);
  });
  return slides;
}

async function generateSlides(query, persona, style) {
  const useQwen = !!process.env.QWEN_API_KEY;
  // 先试 Qwen，失败回退豆包
  const tryProvider = async (provider) => {
    const isQwen = provider === "qwen";
    const apiKey = isQwen ? process.env.QWEN_API_KEY : process.env.ARK_API_KEY;
    if (!apiKey)
      throw new ApiError(
        503,
        "SERVICE_UNAVAILABLE",
        `未配置 ${isQwen ? "QWEN" : "ARK"}_API_KEY`,
      );
    const model = isQwen
      ? process.env.QWEN_CHAT_MODEL || "qwen-max"
      : process.env.ARK_CHAT_MODEL || "doubao-1-5-pro-32k-250115";
    const endpoint = isQwen
      ? "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions"
      : "https://ark.cn-beijing.volces.com/api/v3/chat/completions";
    const styleRules = PPT_STYLES[style] || PPT_STYLES["教学清新"];
    const spec = PPT_SCHEMA.buildPromptSpec();
    const prompt = `你是一名资深计算机科学教育专家，也是顶尖的教学 PPT 视觉设计师。请为知识点"${query}"生成一份教学幻灯片（页数 3-12 页，由你按知识点复杂度自行决定，不要套固定模板）。

视觉风格（本次采用，务必遵循）：
${styleRules}

字体：中文用微软雅黑/思源黑体；标题偏大、正文适中、小标签更小；关键术语高亮、重要数字加粗或彩色，结论用卡片/强调框突出。

输出格式（必须是合法 JSON，不要任何 JSON 之外的内容）：
${spec.outputFormat}

页面规划（由你自行决定，不要套固定模板）：
- 页数按知识点复杂度 3-12 页，由浅入深自然组织；简单知识点页数少、复杂知识点页数多。
- 算法/编程类知识点：务必覆盖「核心思想 → 算法/公式推导（含伪代码与符号解释）→ 实例数字演算 → 复杂度分析」。
- 理论/概念类知识点：务必覆盖「定义与重要性 → 核心机制/工作流程（配流程图/状态图）→ 实例 → 对比辨析/易错点」。
- 开头一页引入、结尾一页总结（含要点与面试考点），中间章节顺序由你按认知逻辑安排。

内容丰富度（硬性要求：每页必须信息密度高、画面饱满，禁止大面积留白）：
- left 必须给出 4-6 个具体要点（含数字/公式/术语/步骤），每行一个，不能只写 2-3 条就停。
- 每页必须有一个 diagram（line_chart/bar_chart/pie_chart/area_chart/scatter_chart/donut_chart/funnel/radar_chart/bubble_chart/waterfall/gauge/heatmap/flow/tree/array/compare/complexity_curve 任选其一，给出具体 data），让右侧有可视化。
- 图表类型务必多样化：整份 PPT 尽量轮换使用多种不同图表，相邻页不要重复用同一种图表，同一图表在一份 PPT 中最多出现 2 次；尤其鼓励使用 scatter_chart 散点图、donut_chart 环形图、funnel 漏斗图、radar_chart 雷达图、bubble_chart 气泡图、waterfall 瀑布图、gauge 仪表盘、heatmap 热力图 这类相对新颖的图表，让每页可视化都有新鲜感。
- 每页必须写 3-5 个 visuals；有对比/数据/步骤的页面必须含至少 1 个 table（3 行以上），其余用 list/formula/highlight/quote 填充。
- 有对比/数据/步骤的页面，优先用 visuals 里的 table（用 | 分隔列、\\n 分隔行）表达；每页写 3-5 个 visuals（table/list/formula/highlight 等，不要只写 caption 没数据）。
- text 讲解要长且具体：把思路、关键公式、数字实例逐步讲透，简单页 ≥120 字、复杂页 250-400 字。
- 【重要】禁止生成或引用任何图片、插画、图标与大面积纯装饰背景；所有空间一律用文字、要点、表格、图表、公式填满。每页必须由「标题 + 副标题 + 左右要点/正文 + 图表或表格 + 底部强调条」构成，画面饱满、无空洞、无大面积留白。
- right 在有 diagram 时给图表数据；无 diagram 时给与 left 互补的要点或表格说明，避免留空。

布局使用规则（硬性要求：整份 PPT 每一页版式都必须不同，禁止任何两页用同一种布局）：
${spec.layoutRules}
- 轮换要求：每一页布局都不同，优先让全部页面布局互不重复（页数 ≤ 11 时每页用一种新布局，全篇无重复）；仅当页数超过布局数时才允许少量复用，且复用间隔尽量远。开篇用 default、结尾总结用 focus 或 bottom_bar。中间页优先使用 chart_top / chart_left / cards / timeline / triple / left_text / bottom_bar / focus 等布局；**尽量少用 two_col 与 split（两栏版式极易让页面观感雷同，整份 PPT 中至多各出现 1 次，且仅当确实需要左文右图对比、其它布局都不合适时才用）**。

数据格式约定：
${spec.dataFormats}

硬性要求：
1. 优先用图表/表格/公式等可视化表达，仅在有助于理解时使用，允许要点式文字页
2. 优先用图表、表格、数组状态图表达，避免大段纯文字
3. 配色严格参考样例：深蓝 #1e3a8a 标题、浅蓝 #dbeafe 背景点缀、深灰 #334155 正文、彩色图表
4. 每页内容密度要高，但排版清晰、留白合理，适合 PPT 演示
5. 文字简洁有力，避免口语化废话，标题和要点使用术语化表达
6. 涉及算法/公式/复杂度的页面，公式必须具体完整（如 T(n)=2T(n/2)+O(n)），并逐项解释每个符号的含义；禁止只写"时间复杂度为 O(n)"这类笼统表述。纯理论/概念类知识点（如 TCP 握手、进程与线程、数据库事务等）不得生硬套用时间复杂度公式，改用流程图、状态图、对比表、FAQ 表达
7. 实例演示必须用具体数字逐步演算（如对数组 [5,2,8,1,9] 的每一轮操作都给出中间结果和计算结果）；禁止泛泛描述流程
8. text 字段必须充实具体，长度按内容需要（简单页可短、复杂页可长），把公式读出来、把演算过程讲出来，涵盖定义、关键公式、数字实例，使讲解像真实课堂一样有内容
9. 算法/公式、实例演示、复杂度分析页（第 4/5/6 页）必须各包含至少 1 个 formula 类型的 visual 或 diagram（仅当知识点涉及算法/公式/复杂度时；纯理论/概念类页面改用流程/状态/对比图，不强求 formula）；公式用 KaTeX 可渲染的 LaTeX 书写（下标用 _、上标用 ^、分数用 \\frac、根号用 \\sqrt，如 T(n)=2T(n/2)+O(n)、O(n\\log n)、\\frac{n(n-1)}{2}）
10. 涉及公式的页面，text 讲解中必须把公式完整读一遍（如"由递推式 T(n)=2T(n/2)+O(n) 解得 T(n)=O(n log n)"），并在 visuals 中用公式卡片呈现推导过程
11. 代码是否生成取决于知识点本身的性质：若知识点与编程实现相关（算法、数据结构、编程语言、代码语法、排序、查找、遍历等），则算法/公式页与实例演示页应包含带注释的 code 代码块（配 lang 字段），并与公式、实例一一对应；若知识点是纯理论或概念类（如 TCP 三次握手、进程与线程、数据库事务、网络协议等），则不强求代码，改用流程图、对比表、状态图表达核心逻辑
12. 图表类型尽量多样化不重复：整份 PPT 中优先轮换使用 line_chart、bar_chart、pie_chart、area_chart、scatter_chart、donut_chart、funnel、radar_chart、bubble_chart、waterfall、gauge、heatmap、complexity_curve、flow、tree、array、compare 等不同图表，相邻页避免用同一种图表，让每页可视化都有新鲜感`;
    const personaNote = persona
      ? `\n\n【个性化教学要求】学员背景：${persona}。请据此调整讲解的用词深浅、案例选择与节奏：面向初学者用词通俗、多举生活化例子；已有基础者可适当提升深度、减少铺垫。只调整表达方式，不要改变知识的正确性与结构。`
      : "";
    const userPrompt = `${prompt}${personaNote}`;

    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "system",
            content:
              "你是计算机科学教育专家与专业 PPT 视觉设计师。严格按参考样例输出 HTML 教学幻灯片 JSON，输出必须是合法 JSON，不要任何 Markdown 或解释。",
          },
          { role: "user", content: userPrompt },
        ],
        max_tokens: 8192,
        temperature: 0.4,
      }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new ApiError(
        502,
        "PROVIDER_ERROR",
        `${provider} 返回 ${res.status}: ${err.error?.message || "未知错误"}`,
      );
    }
    const data = await res.json();
    const raw = data.choices?.[0]?.message?.content?.trim();
    if (!raw) throw new Error("LLM 未返回讲稿");
    const json = parseLLMJson(raw);
    if (!json.slides?.length) throw new Error("slides empty");
    // schema 校验+归一化（非法枚举回退、类型纠正、非法 visuals/diagram 降级），再程序化布局去重
    const validated = PPT_SCHEMA.validateSlides(json.slides);
    if (validated.errors.length)
      log("slides.schema_fixed", { provider, count: validated.errors.length, sample: validated.errors.slice(0, 5) });
    if (!validated.slides.length) throw new Error("slides 校验后为空");
    // 生成结果不再保留底部强调条（bottom）字段，防止横幅出现
    validated.slides.forEach((s) => delete s.bottom);
    return enforceDistinctLayouts(validated.slides);
  };

  try {
    if (useQwen) return await tryProvider("qwen");
    return await tryProvider("ark");
  } catch (e) {
    if (useQwen) {
      log("qwen.failed.fallback", { message: e.message });
      try {
        return await tryProvider("ark");
      } catch (e2) {
        throw new ApiError(
          502,
          "PROVIDER_ERROR",
          `所有 LLM 调用失败: ${e2.message}${e.message ? `（Qwen: ${e.message}）` : ""}`,
        );
      }
    }
    throw e;
  }
}

async function generateScript(query, persona, style) {
  const slides = await generateSlides(query, persona, style);
  return {
    slides,
    fullText: slides.map((s) => `${s.title}。${s.text}`).join(""),
  };
}

// ══════════════ 分阶段生成流水线（大纲 → 逐页 → 收尾）══════════════
// 与单次大调用（generateSlides）并存：每阶段可路由不同模型，单页失败只重试该页。

// provider 配置集中：qwen（默认）/ ark（豆包回退）
function llmProviderConfig(provider) {
  const isQwen = provider !== "ark";
  const apiKey = isQwen ? process.env.QWEN_API_KEY : process.env.ARK_API_KEY;
  if (!apiKey)
    throw new ApiError(503, "SERVICE_UNAVAILABLE", `未配置 ${isQwen ? "QWEN" : "ARK"}_API_KEY`);
  return {
    apiKey,
    model: isQwen
      ? process.env.QWEN_CHAT_MODEL || "qwen-max"
      : process.env.ARK_CHAT_MODEL || "doubao-1-5-pro-32k-250115",
    endpoint: isQwen
      ? "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions"
      : "https://ark.cn-beijing.volces.com/api/v3/chat/completions",
  };
}

// 一次 chat 调用，返回解析后的 JSON（自动走 parseLLMJson 容错）
async function llmJson({ provider = "qwen", model, system, user, maxTokens = 4096, temperature = 0.4, timeoutMs = 120_000, label = "" }) {
  const cfg = llmProviderConfig(provider);
  const res = await fetch(cfg.endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.apiKey}` },
    body: JSON.stringify({
      model: model || cfg.model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      max_tokens: maxTokens,
      temperature,
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new ApiError(502, "PROVIDER_ERROR", `${provider} 返回 ${res.status}: ${err.error?.message || "未知错误"}`);
  }
  const data = await res.json();
  const raw = data.choices?.[0]?.message?.content?.trim();
  if (!raw) throw new Error(`LLM 未返回内容${label ? `（${label}）` : ""}`);
  return parseLLMJson(raw);
}

// Stage A：课程大纲（页数、每页目标与布局/图表提示）
async function generateOutline(query, persona, style) {
  const spec = PPT_SCHEMA.buildPromptSpec();
  const system = "你是计算机科学教育课程设计师。输出必须是合法 JSON，不要任何解释。";
  const user = `请为知识点"${query}"规划一份教学 PPT 大纲。
页数按知识点复杂度自行决定（3-12 页），由浅入深组织：开头引入、中间展开、结尾总结（含要点与面试考点）。
算法/编程类务必覆盖「核心思想 → 算法/公式推导 → 实例数字演算 → 复杂度分析」；理论/概念类务必覆盖「定义与重要性 → 核心机制/工作流程 → 实例 → 对比辨析/易错点」。
${persona ? `\n【个性化教学要求】学员背景：${persona}。据此决定深浅与顺序。` : ""}

严格按如下 JSON 输出（不要任何 JSON 之外的内容）：
{"pages":[{"title":"页面标题","goal":"这一页要讲透什么（1-2 句，含关键公式/数字/术语）","layout":"${LAYOUT_POOL.join(" / ")}","diagram_hint":"建议图表类型：${PPT_SCHEMA.DIAGRAM_TYPES.join(" / ")}"}]}

要求：
1. 每一页 layout 互不相同（页数 ≤ 11 时全篇不重复）；尽量少用 two_col 与 split；开篇用 default，结尾用 focus 或 bottom_bar
2. 相邻页 diagram_hint 不要用同一种图表
3. 各页 layout 的语义：
${spec.layoutRules}`;
  const json = await llmJson({
    provider: "qwen",
    model: process.env.STAGE_OUTLINE_MODEL || process.env.QWEN_OUTLINE_MODEL || undefined,
    system,
    user,
    maxTokens: 2048,
    temperature: 0.5,
    timeoutMs: 60_000,
    label: "大纲",
  });
  const pages = Array.isArray(json.pages) ? json.pages : Array.isArray(json.slides) ? json.slides : [];
  if (!pages.length) throw new Error("大纲生成失败：未返回 pages");
  return pages.slice(0, 12).map((p, i) => ({
    title: String(p.title || `第 ${i + 1} 页`).slice(0, 60),
    goal: String(p.goal || p.text || "").slice(0, 500),
    layout: PPT_SCHEMA.LAYOUT_POOL.includes(String(p.layout || "").trim()) ? String(p.layout).trim() : "",
    diagram_hint: String(p.diagram_hint || p.diagram || "").trim().slice(0, 40),
  }));
}

// Stage B：按大纲单页生成（校验失败带错误信息重试一次）
async function generateOneSlide(page, idx, ctx) {
  const spec = PPT_SCHEMA.buildPromptSpec();
  const system = "你是计算机科学教育专家与专业 PPT 视觉设计师。输出单页幻灯片 JSON 对象，必须是合法 JSON，不要任何 Markdown 或解释。";
  const buildUser = (note) => `知识点：${ctx.query}
整份 PPT 共 ${ctx.total} 页，你正在写第 ${idx + 1} 页（${idx === 0 ? "开篇引入页" : idx === ctx.total - 1 ? "结尾总结页" : "中间展开页"}）。
本页标题：${page.title}
本页目标：${page.goal || "按标题展开讲解"}
指定版式 layout：${page.layout || "（未指定，按内容自行从下列布局中选一种，且不要用 two_col）"}
${page.diagram_hint ? `建议图表类型：${page.diagram_hint}` : ""}
${ctx.usedLayouts?.length ? `前面各页已用过的布局：${ctx.usedLayouts.join("、")}（本页必须避开这些）` : ""}
${ctx.usedDiagrams?.length ? `前面各页已用过的图表类型：${ctx.usedDiagrams.join("、")}（本页尽量换一种，让每页可视化都有新鲜感）` : ""}
${ctx.persona ? `\n【个性化教学要求】学员背景：${ctx.persona}。据此调整用词深浅与案例，但不要改变知识正确性。` : ""}

视觉风格（务必遵循）：
${ctx.styleRules}

只输出这一个页面对象（不要外层数组、不要 slides 包裹）：
${spec.outputFormat.replace('{"slides":[', "").replace("]}", "")}

内容硬性要求：
1. left 给出 4-6 个具体要点（含数字/公式/术语/步骤），每行一个
2. 除开篇/结尾页外必须有一个 diagram，data 按下面格式约定填写具体数值
3. 写 3-5 个 visuals（table 用 | 分隔列、\\n 分隔行，须 3 行以上；其余 list/formula/highlight/quote/badge/code）
4. text 讲解要长且具体：把思路、关键公式、数字实例逐步讲透，简单页 ≥120 字、复杂页 250-400 字
5. bottom 是底部强调条文字（15 字以内）
6. 禁止生成任何图片/插画/图标；所有空间用文字、要点、表格、图表、公式填满
7. 涉及公式的页面，公式必须完整（如 T(n)=2T(n/2)+O(n)）并逐项解释符号；纯理论概念类改用流程图/状态图/对比表，不强求公式与代码
8. 实例演示必须用具体数字逐步演算

数据格式约定：
${spec.dataFormats}
${note ? `\n【上一次输出未通过校验，请修正后重新输出】\n- ${note}` : ""}`;
  let lastNote = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const json = await llmJson({
      provider: "qwen",
      model: process.env.STAGE_PAGE_MODEL || process.env.QWEN_CHAT_MODEL || undefined,
      system,
      user: buildUser(lastNote),
      maxTokens: 3000,
      temperature: 0.45,
      timeoutMs: 90_000,
      label: `第${idx + 1}页`,
    });
    const one = Array.isArray(json?.slides) ? json.slides[0] : json;
    const { slide, errors } = PPT_SCHEMA.validateSlide(one, idx);
    if (slide && !errors.some((e) => /缺失或为空|不是对象/.test(e))) return slide;
    lastNote = errors.join("\n- ") || "输出结构无法解析";
    log("stage.page.invalid", { idx, attempt, errors });
  }
  throw new ApiError(502, "STAGE_PAGE_FAILED", `第 ${idx + 1} 页（${page.title}）多次生成均未通过校验`);
}

// 流水线编排：Stage A → Stage B（并发受限）→ Stage C（去重收尾）
async function generateSlidesStaged(query, persona, style, onProgress) {
  const styleRules = PPT_STYLES[style] || PPT_STYLES["教学清新"];
  const report = (patch) => {
    try { onProgress && onProgress(patch); } catch (e) { /* 进度上报失败不影响生成 */ }
  };

  report({ status: "generating_outline", progress: 8 });
  let outline;
  try {
    outline = await generateOutline(query, persona, style);
  } catch (e) {
    log("stage.outline.failed", { message: e.message });
    report({ status: "generating", progress: 20, fallback: "single_shot" });
    const slides = await generateSlides(query, persona, style); // 大纲失败：回退单次调用
    return { slides, mode: "single_shot_fallback" };
  }
  const total = outline.length;
  report({ status: "generating_pages", progress: 15, total, done: 0 });

  const results = new Array(total).fill(null);
  let cursor = 0;
  let done = 0;
  const worker = async () => {
    while (cursor < total) {
      const i = cursor++;
      const prior = results.slice(0, i).filter(Boolean);
      try {
        results[i] = await generateOneSlide(outline[i], i, {
          query, persona, styleRules, total,
          usedLayouts: prior.map((s) => s.layout),
          usedDiagrams: prior.map((s) => s.diagram?.type).filter(Boolean),
        });
      } catch (e) {
        log("stage.page.failed", { idx: i, message: e.message });
        // 单页兜底：用大纲信息拼一页最小可用内容，保证整份不中断
        results[i] = {
          title: outline[i].title,
          subtitle: "",
          text: outline[i].goal || outline[i].title,
          layout: outline[i].layout || "left_text",
          left: outline[i].goal || "",
          right: "",
          bottom: "",
          visuals: [],
        };
      }
      done++;
      report({ status: "generating_pages", progress: 15 + Math.round((done / total) * 30), total, done });
    }
  };
  await Promise.all(Array.from({ length: Math.min(3, total) }, worker));

  const slides = results.filter(Boolean);
  const { slides: validated, errors } = PPT_SCHEMA.validateSlides(slides);
  if (errors.length) log("stage.schema_fixed", { count: errors.length, sample: errors.slice(0, 5) });
  const final = enforceDistinctLayouts(validated.length ? validated : slides);
  // 生成结果不再保留底部强调条（bottom）字段，防止横幅出现
  final.forEach((s) => delete s.bottom);
  report({ status: "generating_pages", progress: 48, total, done: total });
  return { slides: final, mode: "staged" };
}

// ════════════ 真课件 v2：大纲(scene_hint) → 逐页(scene) → 逐页讲稿(narration) → 逐句 edge-tts ════════════

// Stage A2：课程大纲（在 v1 大纲基础上增补 scene_hint：约 1/3 动态过程类页面给交互场景）
async function generateCoursewareOutline(query, persona) {
  const spec = PPT_SCHEMA.buildPromptSpec();
  const cw = COURSEWARE_SCHEMA.buildCoursewarePromptSpec();
  const system = "你是计算机科学教育课程设计师。输出必须是合法 JSON，不要任何解释。";
  const user = `请为知识点"${query}"规划一份互动教学课件大纲（讲解同步配音 + 可交互场景）。
页数按知识点复杂度自行决定（3-10 页），由浅入深：开头引入、中间展开、结尾总结。
算法/编程类务必覆盖「核心思想 → 算法推导 → 实例演算 → 复杂度分析」；理论概念类覆盖「定义 → 机制 → 实例 → 辨析」。
${persona ? `\n【个性化教学要求】学员背景：${persona}。据此决定深浅与顺序。` : ""}

严格按如下 JSON 输出（不要任何 JSON 之外的内容）：
{"pages":[{"title":"页面标题","goal":"这一页要讲透什么（1-2 句，含关键公式/数字/术语）","layout":"${LAYOUT_POOL.join(" / ")}","diagram_hint":"建议图表类型：${PPT_SCHEMA.DIAGRAM_TYPES.join(" / ")}","scene_hint":"交互场景模板 id 或空字符串"}]}

要求：
1. 每一页 layout 互不相同（页数 ≤ 11 时全篇不重复）；尽量少用 two_col 与 split；开篇用 default，结尾用 focus 或 bottom_bar
2. 相邻页 diagram_hint 不要用同一种图表
3. scene_hint：挑约 1/3 最适合"动态演示"的页（排序过程、查找区间收缩、数学曲面/波形等）填模板 id，其余页留空字符串。可选模板：
${cw.sceneLines}
4. 各页 layout 的语义：
${spec.layoutRules}`;
  const json = await llmJson({
    provider: "qwen",
    model: process.env.STAGE_OUTLINE_MODEL || process.env.QWEN_OUTLINE_MODEL || undefined,
    system,
    user,
    maxTokens: 2048,
    temperature: 0.5,
    timeoutMs: 60_000,
    label: "课件大纲",
  });
  const pages = Array.isArray(json.pages) ? json.pages : Array.isArray(json.slides) ? json.slides : [];
  if (!pages.length) throw new Error("大纲生成失败：未返回 pages");
  return pages.slice(0, 10).map((p, i) => ({
    title: String(p.title || `第 ${i + 1} 页`).slice(0, 60),
    goal: String(p.goal || p.text || "").slice(0, 500),
    layout: PPT_SCHEMA.LAYOUT_POOL.includes(String(p.layout || "").trim()) ? String(p.layout).trim() : "",
    diagram_hint: String(p.diagram_hint || p.diagram || "").trim().slice(0, 40),
    scene_hint: COURSEWARE_SCHEMA.SCENE_REGISTRY[String(p.scene_hint || "").trim()]
      ? String(p.scene_hint).trim()
      : "",
  }));
}

// Stage B2：单页生成（v1 prompt + scene 输出要求）
async function generateOneCoursewarePage(page, idx, ctx) {
  const spec = PPT_SCHEMA.buildPromptSpec();
  const cw = COURSEWARE_SCHEMA.buildCoursewarePromptSpec();
  const system = "你是计算机科学教育专家与专业课件视觉设计师。输出单页 JSON 对象，必须是合法 JSON，不要任何 Markdown 或解释。";
  const sceneSection = page.scene_hint
    ? `\n【本页必须包含交互场景】scene = {"template":"${page.scene_hint}","params":{...},"caption":"一句话场景说明"}。有 scene 时 diagram 置 null、visuals 至多 1 个，版面留给场景。`
    : `\nscene：本页不适合动态演示时输出 null。${page.diagram_hint ? `建议图表类型：${page.diagram_hint}` : ""}`;
  const buildUser = (note) => `知识点：${ctx.query}
整份课件共 ${ctx.total} 页，你正在写第 ${idx + 1} 页（${idx === 0 ? "开篇引入页" : idx === ctx.total - 1 ? "结尾总结页" : "中间展开页"}）。
本页标题：${page.title}
本页目标：${page.goal || "按标题展开讲解"}
指定版式 layout：${page.layout || "（未指定，按内容自行从下列布局中选一种，且不要用 two_col）"}
${ctx.usedLayouts?.length ? `前面各页已用过的布局：${ctx.usedLayouts.join("、")}（本页必须避开这些）` : ""}
${ctx.usedDiagrams?.length ? `前面各页已用过的图表类型：${ctx.usedDiagrams.join("、")}（本页尽量换一种）` : ""}
${ctx.persona ? `\n【个性化教学要求】学员背景：${ctx.persona}。据此调整用词深浅与案例，但不要改变知识正确性。` : ""}
视觉风格（务必遵循）：
${ctx.styleRules}

${cw.sceneRules}
${sceneSection}

只输出这一个页面对象（不要外层数组、不要 slides 包裹），在 v1 字段之外必须含 scene 字段：
{"title":"…","subtitle":"…","text":"…","layout":"…","left":"…","right":"…","visuals":[…],"diagram":{…}或null,"scene":{…}或null}

内容硬性要求：
1. left 给出 4-6 个具体要点（含数字/公式/术语/步骤），每行一个
2. 除开篇/结尾页与 scene 页外必须有一个 diagram
3. 写 3-5 个 visuals（table 用 | 分隔列、\\n 分隔行；其余 list/formula/highlight/quote/badge/code）
4. text 讲解要长且具体：思路、关键公式、数字实例逐步讲透，简单页 ≥120 字、复杂页 250-400 字
5. 禁止输出 bottom 字段（底部强调条已废弃，不要再生成任何底部横条/横幅）
6. 禁止生成任何图片/插画/图标；所有空间用文字、要点、表格、图表、公式填满
7. 实例演示必须用具体数字逐步演算

数据格式约定：
${spec.dataFormats}
${note ? `\n【上一次输出未通过校验，请修正后重新输出】\n- ${note}` : ""}`;
  let lastNote = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const json = await llmJson({
      provider: "qwen",
      model: process.env.STAGE_PAGE_MODEL || process.env.QWEN_CHAT_MODEL || undefined,
      system,
      user: buildUser(lastNote),
      maxTokens: 3000,
      temperature: 0.45,
      timeoutMs: 90_000,
      label: `课件第${idx + 1}页`,
    });
    const one = Array.isArray(json?.slides) ? json.slides[0] : json;
    const { slide, errors } = PPT_SCHEMA.validateSlide(one, idx);
    if (slide && !errors.some((e) => /缺失或为空|不是对象/.test(e))) {
      const scene = COURSEWARE_SCHEMA.validateScene(one.scene);
      if (page.scene_hint && !scene) errors.push("scene 校验失败");
      if (page.scene_hint && !scene && attempt === 0) {
        lastNote = `scene 字段非法或缺失：必须输出 {"template":"${page.scene_hint}","params":{…},"caption":"…"}`;
        continue;
      }
      if (scene) {
        slide.scene = scene;
        slide.diagram = null;
        if (Array.isArray(slide.visuals) && slide.visuals.length > 1) slide.visuals = slide.visuals.slice(0, 1);
      }
      delete slide.bottom; // 底部强调条已废弃，生成端彻底移除
      return slide;
    }
    lastNote = errors.join("\n- ") || "输出结构无法解析";
    log("courseware.page.invalid", { idx, attempt, errors });
  }
  // 单页兜底：大纲信息拼最小可用页，保证整份不中断
  return {
    title: page.title,
    subtitle: "",
    text: page.goal || page.title,
    layout: page.layout || "left_text",
    left: page.goal || "",
    right: "",
    bottom: "",
    visuals: [],
    diagram: null,
    scene: page.scene_hint
      ? COURSEWARE_SCHEMA.validateScene({ template: page.scene_hint })
      : null,
  };
}

// Stage C2：逐页分句讲稿（narration）：注入本页内容 + 合法锚点清单，输出 [{text,target,fx}]
async function generateNarration(slide, idx, ctx) {
  const cw = COURSEWARE_SCHEMA.buildCoursewarePromptSpec();
  const elements = COURSEWARE_SCHEMA.deriveElements(slide);
  const system = "你是授课风格生动的计算机老师，为课件单页编写分句讲解脚本。输出必须是合法 JSON，不要任何解释。";
  const contentDigest = [
    `标题：${slide.title}`,
    slide.subtitle ? `副标题：${slide.subtitle}` : "",
    slide.left ? `要点：\n${String(slide.left).slice(0, 600)}` : "",
    slide.text ? `正文：${String(slide.text).slice(0, 700)}` : "",
    slide.diagram?.type ? `图表：${slide.diagram.type}（${String(slide.diagram.caption || "").slice(0, 80)}）` : "",
    Array.isArray(slide.visuals) && slide.visuals.length
      ? `可视化卡片（按顺序编号 vis-0 起）：${slide.visuals.map((v) => `${v.type}:${String(v.data || "").slice(0, 40)}`).join("；").slice(0, 400)}`
      : "",
    slide.scene ? `交互场景：${slide.scene.template}（${slide.scene.caption || ""}）` : "",
    slide.bottom ? `底部强调：${slide.bottom}` : "",
  ].filter(Boolean).join("\n");
  const buildUser = (note) => `本页（第 ${idx + 1} 页，主题：${ctx.query}）内容：
${contentDigest}

本页可高亮的元素清单（target 只能取这些 id 或 null）：
${elements.map((e) => `- ${e.id}：${e.label}`).join("\n")}

${cw.narrationRules}
${ctx.persona ? `\n【个性化】学员背景：${ctx.persona}。用词深浅与之匹配。` : ""}

只输出 JSON：{"narration":[{"text":"…","target":"…","fx":"…"}]}
${note ? `\n【上一次输出未通过校验，请修正】\n- ${note}` : ""}`;
  let lastNote = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const json = await llmJson({
      provider: "qwen",
      model: process.env.STAGE_NARRATION_MODEL || process.env.QWEN_CHAT_MODEL || undefined,
      system,
      user: buildUser(lastNote),
      maxTokens: 1500,
      temperature: 0.6,
      timeoutMs: 60_000,
      label: `第${idx + 1}页讲稿`,
    });
    const { narration, errors } = COURSEWARE_SCHEMA.validateNarration(
      Array.isArray(json?.narration) ? json.narration : Array.isArray(json) ? json : [],
      elements,
    );
    if (narration.length >= 2) return narration;
    lastNote = (errors.length ? errors.join("\n- ") : "有效句子不足 2 句") + "\nnarration 必须是 3-8 句的对象数组。";
    log("courseware.narration.invalid", { idx, attempt, errors });
  }
  // 降级：整页正文前 80 字做单句，无高亮
  const fallbackText = String(slide.text || slide.title).replace(/\s+/g, " ").trim().slice(0, 80);
  return fallbackText ? [{ text: fallbackText, target: null, fx: "none" }] : [];
}

// 真课件流水线编排
async function generateCoursewareStaged(query, persona, style, onProgress) {
  const styleRules = PPT_STYLES[style] || PPT_STYLES["教学清新"];
  const report = (patch) => {
    try { onProgress && onProgress(patch); } catch (e) { /* 进度上报失败不影响生成 */ }
  };

  report({ status: "generating_outline", progress: 6 });
  const outline = await generateCoursewareOutline(query, persona);
  const total = outline.length;
  report({ status: "generating_pages", progress: 12, total, done: 0 });

  const results = new Array(total).fill(null);
  let cursor = 0;
  let done = 0;
  const worker = async () => {
    while (cursor < total) {
      const i = cursor++;
      const prior = results.slice(0, i).filter(Boolean);
      try {
        results[i] = await generateOneCoursewarePage(outline[i], i, {
          query, persona, styleRules, total,
          usedLayouts: prior.map((s) => s.layout),
          usedDiagrams: prior.map((s) => s.diagram?.type).filter(Boolean),
        });
      } catch (e) {
        log("courseware.page.failed", { idx: i, message: e.message });
        results[i] = {
          title: outline[i].title, subtitle: "", text: outline[i].goal || outline[i].title,
          layout: outline[i].layout || "left_text", left: outline[i].goal || "",
          right: "", bottom: "", visuals: [], diagram: null,
          scene: outline[i].scene_hint ? COURSEWARE_SCHEMA.validateScene({ template: outline[i].scene_hint }) : null,
        };
      }
      done++;
      report({ status: "generating_pages", progress: 12 + Math.round((done / total) * 28), total, done });
    }
  };
  await Promise.all(Array.from({ length: Math.min(3, total) }, worker));
  const pages = results.filter(Boolean);
  const { slides: validated } = PPT_SCHEMA.validateSlides(pages.map(({ scene, narration, ...v1 }) => v1));
  validated.forEach((v1, i) => {
    if (pages[i].scene) v1.scene = pages[i].scene;
  });
  const final = enforceDistinctLayouts(validated.length ? validated : pages);

  // 逐页讲稿（并发 3）
  report({ status: "generating_narration", progress: 42, total, done: 0 });
  let nCursor = 0;
  const narrWorker = async () => {
    while (nCursor < final.length) {
      const i = nCursor++;
      try {
        final[i].narration = await generateNarration(final[i], i, { query, persona });
      } catch (e) {
        log("courseware.narration.failed", { idx: i, message: e.message });
        final[i].narration = [{ text: String(final[i].text || final[i].title).slice(0, 80), target: null, fx: "none" }];
      }
      report({ status: "generating_narration", progress: 42 + Math.round((nCursor / final.length) * 18), total, done: nCursor });
    }
  };
  await Promise.all(Array.from({ length: Math.min(3, final.length) }, narrWorker));
  return { pages: final };
}

// 逐句 edge-tts 合成：按页聚合回填 audio，每页一次 store.update（避免单文件 JSON 写放大）
async function createCoursewareTTS(taskId, pages, voice, onProgress) {
  const jobs = [];
  pages.forEach((p, i) => {
    (p.narration || []).forEach((s, j) => jobs.push({ i, j, text: s.text }));
  });
  const results = {}; // "i-j" → url|null
  let done = 0;
  const MAX_CONCURRENCY = 1; // edge-tts 并发子进程易触发限流，串行最稳
  let cursor = 0;
  const worker = async () => {
    while (cursor < jobs.length) {
      const k = cursor++;
      const job = jobs[k];
      try {
        const buf = await edgeTtsBuffer(job.text, { voice });
        if (buf && buf.length) {
          const file = path.join("audio", `cw-${String(taskId).slice(0, 8)}-p${job.i}-s${job.j}.mp3`);
          await fs.writeFile(path.join(STORAGE_DIR, file), buf);
          results[`${job.i}-${job.j}`] = publicAsset(file);
        } else {
          results[`${job.i}-${job.j}`] = null;
        }
      } catch (e) {
        log("courseware.tts.sentence_failed", { i: job.i, j: job.j, message: e.message });
        results[`${job.i}-${job.j}`] = null;
      }
      done++;
      try { onProgress && onProgress({ done, total: jobs.length }); } catch (e) {}
      // 句间间隔：缓解微软限流（连续请求会被强制断开连接）
      await new Promise((r) => setTimeout(r, 300));
    }
  };
  await Promise.all(Array.from({ length: Math.min(MAX_CONCURRENCY, Math.max(jobs.length, 1)) }, worker));
  // 回填 + 按页写回
  for (let i = 0; i < pages.length; i++) {
    (pages[i].narration || []).forEach((s, j) => {
      s.audio = results[`${i}-${j}`] || null;
    });
    await store.update("coursewareTasks", taskId, { pages });
  }
}

// ── Edit with AI：对单页做增量 JSON Patch（RFC 6902 子集），带 schema 校验与一次重试 ──
// 输入当前页 slide + 自然语言指令，输出校验过的 patch 与新 slide。
async function patchSlideViaLLM(slide, instruction, ctx = {}) {
  const apiKey = process.env.QWEN_API_KEY;
  if (!apiKey) throw new ApiError(503, "SERVICE_UNAVAILABLE", "未配置 QWEN_API_KEY");
  const model = process.env.PPT_EDIT_MODEL || process.env.QWEN_CHAT_MODEL || "qwen-max";
  const endpoint = "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions";
  const spec = PPT_SCHEMA.buildPromptSpec();
  const system =
    "你是 PPT 内容编辑助手。你只能对给定的一页幻灯片做最小增量修改，" +
    "输出一组 RFC 6902 JSON Patch 操作（op 仅限 add/replace/remove）。" +
    "禁止改动 layout 字段；只允许改这些顶层字段：title、subtitle、text、left、right、bottom、code，" +
    "以及 visuals 数组与 diagram 对象。不要输出 patch 之外的任何内容。";
  const userPrompt = `当前页幻灯片（JSON）：
${JSON.stringify(slide)}

可编辑字段与数据格式约定（务必符合，否则会被判为非法）：
${spec.dataFormats}

布局语义（仅供理解，layout 字段本身不可改）：
${spec.layoutRules}

${ctx.query ? `整份 PPT 主题：${ctx.query}\n` : ""}编辑指令：${instruction}

请只输出一个 JSON 对象，形如 {"patch":[{"op":"replace","path":"/text","value":"新讲解文字"}]}。
要求：
1. path 用 JSON Pointer，指向当前页对象内部（如 /title、/left、/visuals/0/data、/diagram/data）
2. 只改指令涉及的字段，其余保持不动；文字类字段值为字符串
3. 若改 diagram，须同时保证 type 合法（${PPT_SCHEMA.DIAGRAM_TYPES.join("/")}）且 data 非空、符合上面格式
4. 若改 visuals 项，type 须为 ${PPT_SCHEMA.VISUAL_TYPES.join("/")} 之一且 data 非空`;

  const callOnce = async (extraNote) => {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: userPrompt + (extraNote ? `\n\n${extraNote}` : "") },
        ],
        max_tokens: 2048,
        temperature: 0.3,
      }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new ApiError(502, "PROVIDER_ERROR", `Qwen 返回 ${res.status}: ${err.error?.message || "未知错误"}`);
    }
    const data = await res.json();
    const raw = data.choices?.[0]?.message?.content?.trim();
    if (!raw) throw new Error("LLM 未返回编辑结果");
    const json = parseLLMJson(raw);
    const patch = Array.isArray(json) ? json : json.patch;
    if (!Array.isArray(patch)) throw new Error("LLM 未返回 patch 数组");
    return patch;
  };

  let lastErrors = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    let patch;
    try {
      patch = await callOnce(
        attempt === 1 && lastErrors.length
          ? `上一次生成的 patch 校验未通过，请修正后重试。问题：\n- ${lastErrors.join("\n- ")}`
          : "",
      );
    } catch (e) {
      if (attempt === 1) throw e;
      lastErrors = [e.message];
      continue;
    }
    let patched;
    try {
      patched = PPT_SCHEMA.applyPatch(slide, patch);
    } catch (e) {
      lastErrors = [`patch 应用失败：${e.message}`];
      if (attempt === 0) continue;
      throw new ApiError(400, "INVALID_PATCH", lastErrors[0]);
    }
    const { slide: validated, errors } = PPT_SCHEMA.validateSlide(patched, 0);
    if (!validated) {
      lastErrors = errors.length ? errors : ["校验后该页为空"];
      if (attempt === 0) continue;
      throw new ApiError(400, "INVALID_PATCH", lastErrors.join("；"));
    }
    // layout 防篡改：强制回退原 layout（即便 LLM 违规改了也还原）
    validated.layout = slide.layout || validated.layout || "two_col";
    return { patch, slide: validated, errors };
  }
  throw new ApiError(400, "INVALID_PATCH", "多次尝试后 patch 仍不合法");
}

// ── AI 生成选择题（Qwen LLM，失败由调用方回退本地规则） ──
async function generateQuizViaLLM(query, variantsOf) {
  const apiKey = process.env.QWEN_API_KEY;
  if (!apiKey) {
    log("quiz.llm.config_error", { query, message: "未配置 QWEN_API_KEY" });
    throw new ApiError(503, "SERVICE_UNAVAILABLE", "未配置 QWEN_API_KEY");
  }
  const model = process.env.QWEN_CHAT_MODEL || "qwen-max";
  // 举一反三模式：有 variantsOf 时基于原题生成变式题（默认 2 道），否则按知识点生成 3 道
  const isVariant = Boolean(
    variantsOf && (variantsOf.question || variantsOf.topic),
  );
  const count = isVariant ? 2 : 3;
  const system = isVariant
    ? "你是计算机科学教育出题专家，擅长基于已有题目生成同知识点的变式题。输出必须是合法JSON。"
    : "你是计算机科学教育出题专家，擅长根据知识点生成高质量的单项选择题。输出必须是合法JSON。";
  const prompt = isVariant
    ? `请基于下面这道原题，生成 ${count} 道同知识点的变式题（更换具体数值、场景或设问角度，难度与原题相当或略深，${count} 道题不要重复考查同一细节）。
原题知识点：${variantsOf.topic || query}
原题题干：${variantsOf.question}
原题选项：${Array.isArray(variantsOf.options) && variantsOf.options.length ? variantsOf.options.join(" | ") : "无"}
原题答案：${typeof variantsOf.answer === "number" && Array.isArray(variantsOf.options) && variantsOf.options[variantsOf.answer] ? variantsOf.options[variantsOf.answer] : variantsOf.answer}
原题解析：${variantsOf.explanation || "无"}
严格按如下 JSON 格式输出（不要任何 JSON 之外的内容）：
{"questions":[{"q":"题干","options":["选项A","选项B","选项C","选项D"],"answer":0,"explanation":"解析：先说明正确答案为何正确，再指出其他选项的典型错误原因"}]}
要求：
1. 每题恰好 4 个选项，answer 是正确选项在 options 中的索引（0-3 的数字）
2. 变式题不能与原题或彼此重复，必须更换数值/场景/设问角度
3. 正确选项的位置要随机，不要固定在某一位
4. explanation 60-120 字，先讲正确原因，再讲错误选项错在哪里，并点明变式题与原题考查的知识点联系`
    : `请根据知识点"${query}"生成 ${count} 道单项选择题，难度适中，覆盖核心概念、易错点与应用，${count} 道题不要重复考查同一细节。
严格按如下 JSON 格式输出（不要任何 JSON 之外的内容）：
{"questions":[{"q":"题干","options":["选项A","选项B","选项C","选项D"],"answer":0,"explanation":"解析：先说明正确答案为何正确，再指出其他选项的典型错误原因"}]}
要求：
1. 每题恰好 4 个选项，answer 是正确选项在 options 中的索引（0-3 的数字）
2. 正确选项的位置要随机，不要固定在某一位
3. explanation 60-120 字，先讲正确原因，再讲错误选项错在哪里
4. 题干表述严谨、无歧义，适合教学测评`;
  const startedAt = Date.now();
  log("quiz.llm.request", { query, model, max_tokens: 2048 });
  const res = await fetch(
    "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: prompt },
        ],
        max_tokens: 2048,
      }),
      signal: AbortSignal.timeout(90_000),
    },
  );
  const httpMs = Date.now() - startedAt;
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    log("quiz.llm.http_error", {
      query,
      status: res.status,
      ms: httpMs,
      message: err.error?.message || "未知错误",
    });
    throw new ApiError(
      502,
      "PROVIDER_ERROR",
      `Qwen 返回 ${res.status}: ${err.error?.message || "未知错误"}`,
    );
  }
  const data = await res.json();
  const raw = data.choices?.[0]?.message?.content?.trim();
  const usage = data.usage || null;
  if (!raw) {
    log("quiz.llm.empty_content", {
      query,
      ms: Date.now() - startedAt,
      finishReason: data.choices?.[0]?.finish_reason,
      usage,
    });
    throw new Error("LLM 未返回题目");
  }
  let json;
  try {
    json = parseLLMJson(raw);
  } catch (e) {
    log("quiz.llm.parse_error", {
      query,
      ms: Date.now() - startedAt,
      message: e.message,
      contentLength: raw.length,
      contentPreview: raw.slice(0, 200),
    });
    throw e;
  }
  if (!Array.isArray(json.questions) || !json.questions.length) {
    log("quiz.llm.invalid_structure", {
      query,
      ms: Date.now() - startedAt,
      type: Array.isArray(json) ? "array" : typeof json,
      keys:
        json && typeof json === "object"
          ? Object.keys(json).slice(0, 10)
          : null,
    });
    throw new Error("题目内容为空");
  }
  const questions = json.questions.slice(0, count).map((item) => {
    const opts =
      Array.isArray(item.options) && item.options.length >= 2
        ? item.options.slice(0, 4)
        : ["A", "B", "C", "D"];
    let ans = Number(item.answer);
    if (!Number.isInteger(ans) || ans < 0 || ans >= opts.length) ans = 0;
    return {
      q: String(item.q || ""),
      opts,
      ans,
      exp: String(item.explanation || "暂无解析"),
    };
  });
  log("quiz.llm.success", {
    query,
    ms: Date.now() - startedAt,
    rawLength: raw.length,
    questions: questions.length,
    answers: questions.map((q) => q.ans),
    usage,
  });
  return questions;
}

// ── 变式题本地回退：LLM 失败时基于原题做数值扰动与选项重排 ──
function generateVariantsFallback(original) {
  const opts =
    Array.isArray(original.options) && original.options.length
      ? original.options
      : ["A", "B", "C", "D"];
  const ansText =
    typeof original.answer === "number" && opts[original.answer]
      ? opts[original.answer]
      : "";
  const questions = [];
  for (let k = 0; k < 2; k++) {
    let q = String(original.question || "变式题");
    // 数值扰动：题干中的每个数字 +（k+1）
    q = q.replace(/\d+/g, (m) => String(parseInt(m, 10) + k + 1));
    // 选项重排（内容不变，答案位置随机）
    const idxs = opts.map((_, i) => i);
    for (let i = idxs.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [idxs[i], idxs[j]] = [idxs[j], idxs[i]];
    }
    const shuffled = idxs.map((i) => opts[i]);
    let ans = 0;
    if (ansText && shuffled.includes(ansText)) ans = shuffled.indexOf(ansText);
    questions.push({
      q: `（变式 ${k + 1}）${q}`,
      opts: shuffled,
      ans,
      exp: `${original.explanation || "暂无解析"}（变式题，更换数值与选项顺序，考查同一知识点）`,
    });
  }
  return questions;
}

// ── 幻灯片转 Markdown 学习笔记 ──
function slidesToMarkdown(slides, fullText, query) {
  const diagramNames = {
    line_chart: "折线图",
    bar_chart: "柱状图",
    pie_chart: "饼图",
    area_chart: "面积图",
    complexity_curve: "复杂度曲线",
    scatter_chart: "散点图",
    donut_chart: "环形图",
    funnel: "漏斗图",
    radar_chart: "雷达图",
    array: "数组状态图",
    flow: "流程图",
    tree: "树形结构",
    compare: "对比表",
  };
  const tableToMd = (data) => {
    const rows = String(data)
      .split("\n")
      .map((r) => r.split("|").map((c) => c.trim()));
    if (!rows.length) return "";
    const out = [
      `| ${rows[0].join(" | ")} |`,
      `| ${rows[0].map(() => "---").join(" | ")} |`,
    ];
    rows.slice(1).forEach((r) => out.push(`| ${r.join(" | ")} |`));
    return out.join("\n");
  };
  const lines = [
    `# ${query} 学习笔记`,
    "",
    `> 生成时间：${now()}`,
    "",
    "---",
    "",
  ];
  slides.forEach((s, i) => {
    lines.push(`## ${i + 1}. ${s.title}`, "");
    if (s.subtitle) lines.push(`> ${s.subtitle}`, "");
    if (s.text) lines.push(s.text, "");
    if (s.left) {
      String(s.left)
        .split("\n")
        .filter(Boolean)
        .forEach((it) => lines.push(`- ${it.replace(/^[-•]\s*/, "")}`));
      lines.push("");
    }
    (s.visuals || []).forEach((v) => {
      const d = String(v.data || "");
      if (v.type === "formula") {
        lines.push("$$", d, "$$", "");
      } else if (v.type === "code") {
        lines.push("```" + (v.lang || ""), d, "```", "");
      } else if (v.type === "table" || v.type === "compare") {
        lines.push(tableToMd(d), "");
      } else if (v.type === "list") {
        d.split("\n")
          .filter(Boolean)
          .forEach((it) => lines.push(`- ${it.replace(/^[-•]\s*/, "")}`));
        lines.push("");
      } else if (v.type === "highlight" || v.type === "quote") {
        lines.push(
          `> **${v.type === "highlight" ? "要点" : "提示"}：** ${d}`,
          "",
        );
      } else if (v.type === "badge") {
        lines.push(`**关键词：** ${d}`, "");
      } else {
        lines.push(`- ${d}`, "");
      }
      if (v.caption) lines.push(`  *${v.caption}*`, "");
    });
    if (s.diagram) {
      const label = diagramNames[s.diagram.type] || s.diagram.type;
      lines.push(`**图示（${label}）：** ${s.diagram.data}`);
      if (s.diagram.caption) lines.push(`> ${s.diagram.caption}`);
      lines.push("");
    }
    if (s.bottom) lines.push(`> ⭐ **结论：** ${s.bottom}`, "");
    lines.push("---", "");
  });
  if (fullText) lines.push("# 完整讲稿", "", fullText, "");
  return lines.join("\n");
}

// ── AI 解题对话（Qwen 流式；失败由路由层回退本地分步讲解） ──
async function chatSolveLLM(query, history) {
  const apiKey = process.env.QWEN_API_KEY;
  if (!apiKey)
    throw new ApiError(503, "SERVICE_UNAVAILABLE", "未配置 QWEN_API_KEY");
  const model = process.env.QWEN_CHAT_MODEL || "qwen-max";
  const system =
    '你是"栈知映"的 AI 解题导师，一名资深计算机科学教育专家，擅长把题目拆解成清晰、循序渐进的小步骤讲解。\n' +
    "输出规范：\n" +
    "1. 使用 Markdown：代码块用 ``` 包裹并标注语言（如 ```python）；数学公式用 $...$（行内）或 $$...$$（独立成行）；\n" +
    '2. 讲解结构：先一句话复述题目要点，再给出整体思路，然后分步骤推导（每一步说明"为什么这么做"），最后给出结论与检验方法；\n' +
    '3. 若用户追问（如"为什么""再讲细一点""换个思路"），只针对追问深入，不要重复已讲内容；\n' +
    "4. 适度使用 ### 小标题、列表与表格，避免大段堆砌文字；\n" +
    "5. 全程使用中文，语气耐心、鼓励，鼓励用户继续提问。";
  const safeHistory = (Array.isArray(history) ? history : [])
    .slice(-8)
    .map((h) => {
      const role = String(h.role) === "assistant" ? "assistant" : "user";
      let content;
      try {
        content = cleanText(String(h.content ?? ""), "history");
      } catch {
        content = String(h.content ?? "").slice(0, 4000);
      }
      return { role, content };
    })
    .filter((h) => h.content);
  // RAG 检索注入：命中知识库片段时，追加为模型作答依据；未命中则跳过原流程
  const kbContext = await retrieveKnowledge(query, 3);
  const sysFinal = kbContext
    ? system +
      "\n\n以下是题库/讲义中与本问题最相关的「参考知识片段」，请优先依据它们作答（若片段与题目冲突以题目为准）：\n" +
      kbContext
    : system;
  const messages = [
    { role: "system", content: sysFinal },
    ...safeHistory,
    { role: "user", content: query },
  ];
  log("chat.llm.request", {
    query,
    turns: safeHistory.length,
    model,
    max_tokens: 2048,
  });
  const res = await fetch(
    "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model, messages, stream: true, max_tokens: 2048 }),
      signal: AbortSignal.timeout(120_000),
    },
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    log("chat.llm.http_error", {
      status: res.status,
      message: err.error?.message || "未知错误",
    });
    throw new ApiError(
      502,
      "PROVIDER_ERROR",
      `Qwen 返回 ${res.status}: ${err.error?.message || "未知错误"}`,
    );
  }
  return res;
}

// 本地分步讲解（在线 AI 不可用时的备选回复）
function buildFallbackChatReply(query, history) {
  const topic = getTopic(query);
  const plan = buildLessonPlan(query, topic);
  const lines = [`### ${topic.title} 分步讲解`, ""];
  if (Array.isArray(history) && history.length) {
    lines.push("> 在线 AI 暂时不可用，已切换到本地讲解。", "");
  }
  plan.solutionSteps.forEach((step, index) => {
    lines.push(`${index + 1}. ${step}`);
  });
  lines.push("", `**学习目标**：${plan.learningGoal}`);
  lines.push("", '> 提示：追问"为什么"或"再讲细一点"，可继续深入讲解。');
  return lines.join("\n");
}

// ── Qwen CosyVoice TTS（单段合成，返回音频 Buffer） ──
async function qwenTtsBuffer(text) {
  const apiKey = process.env.QWEN_API_KEY;
  if (!apiKey) {
    throw new ApiError(503, "SERVICE_UNAVAILABLE", "未配置 QWEN_API_KEY");
  }
  const voice = process.env.QWEN_TTS_VOICE || "longanyang";
  const model = process.env.QWEN_TTS_MODEL || "cosyvoice-v3-flash";
  const body = {
    model,
    input: { text, voice },
    parameters: { format: "mp3", sample_rate: 24000 },
  };
  const res = await fetch(
    "https://dashscope.aliyuncs.com/api/v1/services/audio/tts/SpeechSynthesizer",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    },
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new ApiError(
      502,
      "PROVIDER_ERROR",
      `Qwen TTS 返回 ${res.status}: ${err.message || err.error?.message || JSON.stringify(err).slice(0, 200)}`,
    );
  }
  const data = await res.json();
  // 非流式输出：{ output: { audio: { url: '...', id: '...', expires_at: ... } } }
  const audioUrl =
    data.output?.audio?.url ||
    data.output?.url ||
    data.url ||
    data.data?.url ||
    data.output?.audio_url;
  if (!audioUrl || typeof audioUrl !== "string") {
    throw new ApiError(
      502,
      "PROVIDER_ERROR",
      `Qwen TTS 未返回音频 URL: ${JSON.stringify(data).slice(0, 300)}`,
    );
  }
  const audio = await fetch(audioUrl, { signal: AbortSignal.timeout(60_000) });
  if (!audio.ok)
    throw new ApiError(
      502,
      "PROVIDER_ERROR",
      `下载 Qwen TTS 音频失败: ${audio.status}`,
    );
  return Buffer.from(await audio.arrayBuffer());
}

// 讲稿分块：按标点切分，每段 ≤ 130 字符（单次合成约 20 秒，安全低于超时）；
// 总长上限 400 字符（约 1 分钟语音），控制语音时长与生成耗时
function splitScript(script, maxTotal = 400) {
  const CHUNK_MAX = 130;
  const MAX_TOTAL = maxTotal;
  const sentences = script.split(/(?<=[。！？；;!?\n])/);
  const chunks = [];
  let current = "";
  for (const sentence of sentences) {
    if ((current + sentence).length <= CHUNK_MAX) {
      current += sentence;
    } else {
      if (current.trim()) chunks.push(current.trim());
      current = sentence;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  const out = [];
  let total = 0;
  for (const chunk of chunks) {
    if (total >= MAX_TOTAL) break;
    if (chunk.length > CHUNK_MAX) {
      for (let i = 0; i < chunk.length && total < MAX_TOTAL; i += CHUNK_MAX) {
        out.push(chunk.slice(i, Math.min(i + CHUNK_MAX, chunk.length)));
        total += CHUNK_MAX;
      }
    } else {
      out.push(chunk);
      total += chunk.length;
    }
  }
  return out.filter((c) => c.trim().length > 0);
}

// ── 统一 TTS：仅 Qwen，分块合成后合并为单个 mp3 ──
async function createTTS(script) {
  const chunks = splitScript(script);
  const buffers = [];
  for (const chunk of chunks) {
    try {
      buffers.push(await qwenTtsBuffer(chunk));
    } catch (e) {
      log("qwen.tts.chunk_failed", {
        chunkLength: chunk.length,
        message: e.message,
      });
      // 单块失败不影响已完成块，继续合成剩余旁白
    }
  }
  if (!buffers.length) {
    throw new ApiError(
      502,
      "PROVIDER_ERROR",
      "TTS 合成失败，请检查 QWEN_API_KEY 配置",
    );
  }
  const file = path.join("audio", safeFileName("qwen-tts", ".mp3"));
  await fs.writeFile(path.join(STORAGE_DIR, file), Buffer.concat(buffers));
  return publicAsset(file);
}

// 逐页合成语音：每页「标题+正文」独立生成一段 mp3，语音与 PPT 文字严格一致；
// 并发合成（3 路）缩短总等待时间，避免前端轮询超时
async function createSlideTTS(slides) {
  const out = new Array(slides.length);
  const MAX_CONCURRENCY = 3;
  let cursor = 0;
  async function worker() {
    while (true) {
      const i = cursor++;
      if (i >= slides.length) break;
      const s = slides[i] || {};
      const pageText = `${s.title || ""}。${s.text || ""}`.trim();
      if (!pageText || pageText === "。") {
        out[i] = { index: i, url: null };
        continue;
      }
      try {
        // 单页文字一般 ≤ 210 字，放宽总长限制保证整页完整朗读
        const file = path.join("audio", safeFileName(`qwen-tts-slide-${i}`, ".mp3"));
        const chunks = splitScript(pageText, 1200);
        const buffers = [];
        for (const chunk of chunks) {
          buffers.push(await qwenTtsBuffer(chunk));
        }
        if (!buffers.length) {
          out[i] = { index: i, url: null };
          continue;
        }
        await fs.writeFile(path.join(STORAGE_DIR, file), Buffer.concat(buffers));
        out[i] = { index: i, url: publicAsset(file) };
      } catch (e) {
        log("qwen.tts.slide_failed", { index: i, message: e.message });
        out[i] = { index: i, url: null };
      }
    }
  }
  const workers = Array.from(
    { length: Math.min(MAX_CONCURRENCY, Math.max(slides.length, 1)) },
    () => worker(),
  );
  await Promise.all(workers);
  return out.filter(Boolean);
}

// ── Edge-TTS（python -m edge_tts，免费神经网络语音）──
// 探测用真实短句合成：--list-voices 在 Windows/Python3.13 会抛 asyncio 错误，不可用作探测
let EDGE_TTS_OK = null; // null=未探测 true/false
async function probeEdgeTts() {
  if (EDGE_TTS_OK !== null) return EDGE_TTS_OK;
  const tmp = path.join(STORAGE_DIR, "audio", safeFileName("edge-tts-probe", ".mp3"));
  EDGE_TTS_OK = await new Promise((resolve) => {
    const child = spawn(
      "python",
      ["-m", "edge_tts", "--voice", "zh-CN-XiaoxiaoNeural", "--text", "测试语音", "--write-media", tmp],
      { stdio: ["ignore", "ignore", "pipe"] },
    );
    const timer = setTimeout(() => {
      child.kill();
      resolve(false);
    }, 20_000);
    child.on("error", () => {
      clearTimeout(timer);
      resolve(false);
    });
    child.on("close", async (code) => {
      clearTimeout(timer);
      if (code !== 0) return resolve(false);
      try {
        const buf = await fs.readFile(tmp);
        await fs.unlink(tmp).catch(() => {});
        resolve(buf.length > 0);
      } catch {
        resolve(false);
      }
    });
  });
  log("edge_tts.probe", { ok: EDGE_TTS_OK });
  return EDGE_TTS_OK;
}

// 单句合成 → mp3 Buffer；失败重试 3 次（0.5s/1.7s/3.4s 退避），仍失败返回 null（该句静音）。
// 绝不跨引擎回退到 qwenTtsBuffer：真课件必须全篇同一种音色，混音听感就是"两个语音重叠"。
async function edgeTtsBuffer(text, opts = {}) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  if (!clean) throw new ApiError(400, "EMPTY_TEXT", "TTS 文本为空");
  const voice = opts.voice || process.env.EDGE_TTS_VOICE || "zh-CN-XiaoxiaoNeural";
  const rate = opts.rate || process.env.EDGE_TTS_RATE || "+8%";
  // probe 仅作健康提示，不作硬门槛：启动瞬间网络抖动会让 EDGE_TTS_OK 缓存为 false，
  // 若在此直接 503 则整个进程生命周期内 TTS 全废；改为直接尝试合成（自带重试）更鲁棒。
  probeEdgeTts().catch(() => {});
  const tmp = path.join(STORAGE_DIR, "audio", safeFileName("edge-tts", ".mp3"));
  const wrap = path.join(__dirname, "edge_tts_wrap.py");
  const runOnce = () =>
    new Promise((resolve, reject) => {
      const child = spawn(
        "python",
        [wrap, "--voice", voice, "--rate", rate, "--text", clean, "--write-media", tmp],
        { stdio: ["ignore", "ignore", "pipe"] },
      );
      let stderr = "";
      child.stderr.on("data", (d) => {
        stderr += String(d);
      });
      const timer = setTimeout(() => {
        child.kill();
        reject(new Error("edge-tts 合成超时"));
      }, 60_000);
      child.on("error", (e) => {
        clearTimeout(timer);
        reject(e);
      });
      child.on("close", async (code) => {
        clearTimeout(timer);
        if (code !== 0)
          return reject(
            new Error(
              "edge-tts 退出码 " + code + (stderr ? "：" + stderr.trim().slice(0, 200) : ""),
            ),
          );
        try {
          const buf = await fs.readFile(tmp);
          await fs.unlink(tmp).catch(() => {});
          if (!buf.length) return reject(new Error("edge-tts 输出为空"));
          resolve(buf);
        } catch (e) {
          reject(e);
        }
      });
    });
  // 微软对连续高频请求限流（远程主机强制关闭连接），串行 + 指数退避重试 4 次
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      return await runOnce();
    } catch (e) {
      log("edge_tts.retry", { attempt, message: e.message });
      await new Promise((r) => setTimeout(r, 500 + 1200 * (attempt - 1)));
    }
  }
  log("edge_tts.failed", { text: clean.slice(0, 40) });
  return null;
}

async function createPoster(text, topic, lessonPlan) {
  const escape = (value) =>
    value.replace(
      /[&<>"']/g,
      (char) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&apos;",
        })[char],
    );
  const file = path.join("poster", safeFileName("lesson", ".svg"));
  const title = escape(topic.title);
  const summary = escape(text.slice(0, 48));
  const step = escape(lessonPlan.solutionSteps[0]);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720"><defs><linearGradient id="g"><stop stop-color="#152a52"/><stop offset="1" stop-color="#4a8eff"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/><circle cx="1050" cy="120" r="210" fill="#ffffff" opacity=".08"/><text x="90" y="120" fill="#9bc5ff" font-size="28" font-family="Arial">栈知映 · 题目精讲 · ${escape(topic.subject)}</text><text x="90" y="220" fill="white" font-size="56" font-weight="bold" font-family="Arial">${title}</text><text x="90" y="300" fill="#d7e7ff" font-size="28" font-family="Arial">题目：${summary}</text><rect x="90" y="365" width="1040" height="120" rx="18" fill="#ffffff" opacity=".12"/><text x="125" y="420" fill="white" font-size="25" font-family="Arial">解题步骤 1：${step}</text><text x="90" y="610" fill="white" font-size="27" font-family="Arial">题干呈现 · 关键步骤标注 · 图表分析 · 同步语音讲解</text></svg>`;
  await fs.writeFile(path.join(STORAGE_DIR, file), svg, "utf8");
  return {
    url: publicAsset(file),
    mimeType: "image/svg+xml",
    provider: "local-development",
  };
}
async function makeAudio(text, voice) {
  if (process.env.TTS_PROVIDER_URL)
    return {
      url: await callProvider(
        process.env.TTS_PROVIDER_URL,
        process.env.TTS_API_KEY,
        { text, voice },
      ),
      mimeType: "audio/mpeg",
      provider: "third-party",
    };
  return writeSilentWav(text, voice.speed);
}
async function makeVideo(text, topic, lessonPlan, audio) {
  if (process.env.VIDEO_PROVIDER_URL) {
    const videoBrief = {
      taskType: "educational-problem-explanation",
      aspectRatio: "16:9",
      language: "zh-CN",
      requirements: [
        "完整展示题目内容",
        "逐步讲解解题思路与依据",
        "为题干、关键步骤和图表使用同步视觉标注",
        "音频旁白与每个分镜严格同步",
        "结尾给出结论与方法总结",
      ],
      question: text,
      lessonPlan,
      voiceover: {
        audioUrl: audio.url,
        voiceType: audio.voiceType,
        syncInstruction:
          "将每个 scene.narration 与对应 scene.visual 同步；旁白开始时展示该分镜，旁白结束后再进入下一分镜。",
      },
    };
    return {
      url: await callProvider(
        process.env.VIDEO_PROVIDER_URL,
        process.env.VIDEO_API_KEY,
        videoBrief,
      ),
      mimeType: "video/mp4",
      provider: "third-party",
    };
  }
  return createPoster(text, topic, lessonPlan);
}

async function runTask(taskId) {
  const task = store.find("tasks", taskId);
  if (!task) return;
  try {
    await store.update("tasks", taskId, { status: "processing", progress: 15 });
    const { text, voice, quiz } = task.request;
    const generated = generateQuestions(text, quiz);
    const lessonPlan = buildLessonPlan(text, generated.topic);
    for (const question of generated.questions)
      await store.add("questions", { ...question, taskId, createdAt: now() });
    await store.update("tasks", taskId, { progress: 45 });
    // 先取得完整旁白，再把音频地址和逐镜旁白一起交给视频提供方，确保音画可同步。
    const audio = await makeAudio(lessonPlan.narration, voice);
    audio.voiceType = voice.type;
    const video = await makeVideo(text, generated.topic, lessonPlan, audio);
    const scenes = lessonPlan.scenes.map((scene) => ({
      ...scene,
      durationSeconds: 14,
    }));
    const result = {
      topic: generated.topic,
      lessonPlan,
      audio,
      video,
      poster: video.mimeType === "image/svg+xml" ? video : undefined,
      scenes,
      questions: generated.questions,
    };
    await store.update("tasks", taskId, {
      status: "completed",
      progress: 100,
      result,
    });
    stats.generated += 1;
    log("task.completed", { taskId });
  } catch (error) {
    stats.errors += 1;
    await store.update("tasks", taskId, {
      status: "failed",
      progress: 100,
      error: {
        code: error.code || "GENERATION_FAILED",
        message: error.message,
      },
    });
    log("task.failed", { taskId, code: error.code || "GENERATION_FAILED" });
  }
}
function publicTask(task) {
  return {
    id: task.id,
    status: task.status,
    progress: task.progress,
    statusUrl: `${API_PREFIX}/tasks/${task.id}`,
    resultUrl: `${API_PREFIX}/tasks/${task.id}/result`,
    ...(task.error ? { error: task.error } : {}),
  };
}
async function createGeneration(payload) {
  const text = cleanText(payload.text ?? payload.query);
  const voiceInput = payload.voice || {};
  const voice = {
    type: enumValue(
      voiceInput.type,
      ["female", "male", "child", "neutral"],
      "neutral",
      "voice.type",
    ),
    speed: Number(voiceInput.speed ?? 1),
  };
  if (!Number.isFinite(voice.speed) || voice.speed < 0.5 || voice.speed > 2)
    throw new ApiError(
      400,
      "INVALID_INPUT",
      "voice.speed 必须在 0.5 到 2 之间",
    );
  const quiz = payload.quiz || {};
  const generated = generateQuestions(text, quiz); // validate quiz before queuing
  const search = await store.add("searches", {
    id: requestId(),
    text,
    source: String(payload.source || "api").slice(0, 32),
    encryptedUserRef: encryptSensitive(payload.userRef),
    createdAt: now(),
  });
  const task = await store.add("tasks", {
    id: requestId(),
    searchId: search.id,
    status: "queued",
    progress: 0,
    request: {
      text,
      voice,
      quiz: { ...quiz, types: generated.questions.map((item) => item.type) },
    },
    createdAt: now(),
    updatedAt: now(),
  });
  setImmediate(() => runTask(task.id));
  return { search, task };
}

// ── AI 生成技能树(DeepSeek) ──
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || '';
const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash';
const DEEPSEEK_ENDPOINT = (process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com').replace(/\/$/, '') + '/chat/completions';

function buildTreeSystemPrompt() {
  return [
    '你是一个专业的「学习技能树生成器」。用户给出一个学习方向或目标，你需要生成一棵完整、高质量、由浅入深的学习技能树，输出严格符合规范的 JSON 对象。',
    '',
    '只输出 JSON 对象本身，不要包裹 markdown 代码块，不要输出任何解释文字。',
    '',
    '【顶层结构】必须包含:',
    '{ "tree": {...}, "nodes": [...], "edges": [...], "current_node_id": null, "progress": [...] }',
    '',
    '【tree 字段】id(UUID)、topic(主题简写)、title(展示标题)、description(一句话范围)、difficulty_level(beginner|intermediate|advanced)、total_nodes(节点数)',
    '',
    '【节点字段】每个节点必须包含全部 17 个字段:',
    'id(UUID)、tree_id(与 tree.id 相同)、title(以动词开头)、description、icon(约定值)、category(主干模块名)、difficulty(1-5)、estimated_minutes(分钟数)、depth_level(从1开始)、position_x(填0)、position_y(填0)、order_in_level(同层序号从0)、learning_objectives、key_concepts、recommended_depth、depth_rationale、observable_evidence',
    '',
    '【icon 约定值】只能从这 36 个中选: activity, book, brain, bug, cloud, compass, code, cube, database, edit, gauge, history, layers, lightbulb, link, map, message, network, output, pause, puzzle, radio, refresh, rocket, scissors, server, settings, shield, sort, sync, template, tool, trending, trophy, workflow, wrench',
    '',
    '【recommended_depth 五级】Recognize(认识) / Understand(理解) / Use(应用) / Transfer(迁移) / DeepMastery(精通)',
    '',
    '【三个数组字段】learning_objectives、key_concepts、observable_evidence 这三个字段的值都是「字符串」类型(不是原生数组)，内容是 JSON 数组的字符串表示(等价于对该数组调用 JSON.stringify 的结果)。observable_evidence 不可为 null。',
    '',
    '【质量标准】',
    '1. 节点总数 20~30 个，主干模块(category)5~10 个',
    '2. depth_level 严格由浅入深:depth_level=1 是根节点(零基础入门)，数字越大越深；依赖边只能从浅层指向深层，且不得成环',
    '3. title 以动词开头(如「掌握…」「实现…」「理解…」)，不要用裸名词',
    '4. learning_objectives 每条以「能…」开头，是可观察、可验证的行为描述，禁止「了解」「掌握」「熟悉」「知道」这类不可验证词',
    '5. depth_rationale 必须贴合该节点具体内容(标题/关键概念),写 20~40 字一句,直接说清「学到这个深度就够」的具体边界,禁止「很重要」「需要掌握」「属于XX模块」这类空话',
    '6. observable_evidence 每条描述具体产物(如运行结果、代码、测试、文档、演示)，禁止「看完教程」「理解了」',
    '7. key_concepts 填 2~5 个该节点独有的技术词',
    '',
    '【edges 字段】{ "id":"UUID", "source_node_id":"前置节点id", "target_node_id":"后继节点id", "edge_type":"prerequisite", "label":null }，语义是「先学 source 再学 target」',
    '',
    '【progress 字段】为每个节点生成一条 { "node_id":"节点id", "status":"not_started", "evidence":"" }',
  ].join('\n');
}

function buildTreeUserPrompt(topic, goal) {
  let p = '请为以下学习方向生成一棵完整的技能树:\n\n学习方向/主题:' + topic;
  if (goal) p += '\n学习目标(职业/项目/兴趣):' + goal;
  p += '\n\n要求:节点 20~30 个，严格由浅入深，每个节点 17 个字段完整、质量合格，直接输出 JSON。';
  return p;
}

async function callDeepSeek(messages) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 300000);
  try {
    const response = await fetch(DEEPSEEK_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + DEEPSEEK_API_KEY,
      },
      body: JSON.stringify({ model: DEEPSEEK_MODEL, messages: messages, temperature: 0.7, stream: false }),
      signal: controller.signal,
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error('DeepSeek API HTTP ' + response.status + ': ' + text.slice(0, 600));
    }
    const data = await response.json();
    const content = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    if (!content) throw new Error('DeepSeek API 未返回内容');
    return content;
  } finally {
    clearTimeout(timer);
  }
}

function parseTreeJson(text) {
  const s = String(text).trim();
  try { return JSON.parse(s); } catch (e) { /* 尝试提取 */ }
  const m = s.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('AI 返回内容中未找到 JSON 对象');
  return JSON.parse(m[0]);
}

// ── 用 ppt-master（Python + python-pptx）生成富 PPTX：原生图表/样式/切换 ──
// ── AI 配图：封面 + 空白页，用 Qwen 图片生成（CN 端点） ──
const IMG_STYLE_HINT = {
  教学清新: "浅色蓝白清新的扁平教育插画，柔和色块",
  极简白: "极简黑白灰插画，少量蓝色点缀，大量留白",
  深色科技: "深色科技感插画，深蓝黑底、青紫霓虹点缀，扁平矢量",
  商务蓝: "稳重商务风格扁平插画，蓝灰色调，简洁几何",
  活泼多彩: "明亮多彩卡通插画，圆润活泼形状",
};
function runPy(args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn("python", args, { stdio: "ignore", env });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error("python 退出码 " + code + ": " + args[0]));
    });
  });
}
async function ensureSlideImages(slides, style, taskId) {
  const key = process.env.QWEN_IMAGE_API_KEY || process.env.QWEN_API_KEY;
  const images = {};
  if (!key || !slides.length) return images;
  const env = { ...process.env, QWEN_API_KEY: key, QWEN_BASE_URL: "https://dashscope.aliyuncs.com" };
  const gen = path.join(ROOT, ".trae", "skills", "ppt-master", "scripts", "image_gen.py");
  const cacheDir = path.join(STORAGE_DIR, "imgcache");
  await fs.mkdir(cacheDir, { recursive: true });
  const pages = [0]; // 封面
  for (let i = 1; i < slides.length && pages.length < 3; i++) {
    if (!parseChart(slides[i] && slides[i].diagram)) pages.push(i); // 无图表的空白页
  }
  const hint = IMG_STYLE_HINT[style] || IMG_STYLE_HINT["教学清新"];
  const jobs = [];
  for (const idx of pages) {
    const base = String(taskId || "x").slice(0, 12) + "-" + idx + "-" + (style || "default");
    if (await fs.stat(path.join(cacheDir, base + ".png")).catch(() => null)) {
      images[idx] = "/storage/imgcache/" + base + ".png"; // 已有缓存
    } else {
      const slide = slides[idx] || {};
      const prompt = "为教学幻灯片生成一页" + hint + "，主题：" + String(slide.title || "编程与算法学习").slice(0, 40) + "。只画插画，不写任何文字，构图简洁、四周留白。";
      jobs.push({ idx: idx, base: base, prompt: prompt });
    }
  }
  // 并行生成缺失图片
  await Promise.all(jobs.map((jb) => runPy([gen, jb.prompt, "--backend", "qwen", "--aspect_ratio", "4:3", "--image_size", "512px", "-o", cacheDir, "--filename", jb.base], env).catch((e) => log("img.gen_failed", { index: jb.idx, message: e.message }))));
  for (const jb of jobs) {
    if (await fs.stat(path.join(cacheDir, jb.base + ".png")).catch(() => null)) images[jb.idx] = "/storage/imgcache/" + jb.base + ".png";
  }
  return images;
}
async function buildPptxViaPython(slides, query, style, taskId, cachedImages) {
  const python = process.env.PYTHON || "python";
  const skillDir = path.join(ROOT, ".trae", "skills", "ppt-master");
  const taskDir = path.join(STORAGE_DIR, "pptx-build", crypto.randomUUID());
  const svgDir = path.join(taskDir, "svg_output");
  const imgDir = path.join(taskDir, "images");
  await fs.mkdir(svgDir, { recursive: true });
  await fs.mkdir(imgDir, { recursive: true });
  // 取图：优先任务缓存 URL，缺则现生成（生成到缓存）
  const imageUrls = cachedImages && Object.keys(cachedImages).length
    ? cachedImages
    : await ensureSlideImages(slides, style, taskId).catch((e) => { log("img.pre_fail", { message: e.message }); return {}; });
  const images = {};
  for (const idxStr of Object.keys(imageUrls)) {
    const url = imageUrls[idxStr];
    const rel = String(url).replace(/^\/storage\//, "");
    const src = path.resolve(STORAGE_DIR, rel);
    if (!src.startsWith(path.resolve(STORAGE_DIR))) continue;
    const ext = path.extname(src) || ".png";
    const dest = path.join(imgDir, "img-" + idxStr + ext);
    try { await fs.copyFile(src, dest); images[idxStr] = "img-" + idxStr + ext; } catch (e) {}
  }
  const svgs = slidesToSvgs(slides, { style: style, images: images });
  for (let i = 0; i < svgs.length; i++) {
    await fs.writeFile(
      path.join(svgDir, String(i + 1).padStart(2, "0") + "_slide.svg"),
      svgs[i],
      "utf8",
    );
  }
  const run = (args) =>
    new Promise((resolve, reject) => {
      const child = spawn(python, args, { stdio: "ignore" });
      child.on("error", reject);
      child.on("close", (code) => {
        if (code === 0) resolve();
        else reject(new Error("python 退出码 " + code + ": " + args[0]));
      });
    });
  const s = path.join(skillDir, "scripts");
  await run([path.join(s, "stamp_native_fallbacks.py"), svgDir, "--write"]);
  await run([
    path.join(s, "svg_quality_checker.py"),
    taskDir,
    "--quick-generate",
    "--canonical-authoring",
    "--stage",
    "final",
    "--json",
  ]);
  const outPath = path.join(taskDir, "slides.pptx");
  await run([
    path.join(s, "svg_to_pptx.py"),
    taskDir,
    "--quick-generate",
    "--no-notes",
    "--native-charts-and-tables",
    "-t",
    "fade",
    "-a",
    "entrance_fade",
    "-o",
    outPath,
  ]);
  const buf = await fs.readFile(outPath);
  await fs.rm(taskDir, { recursive: true, force: true }).catch(() => {});
  return buf;
}

/**
 * 代理转发到 Django 后端(ai_classroom, 端口 8000)。
 * 前端页面请求 /ai-api/* → 后端 /api/*。
 */
async function proxyAiClassroom(req, res, url, id) {
  if (req.method !== "GET" && req.method !== "POST")
    throw new ApiError(405, "METHOD_NOT_ALLOWED", "代理仅支持 GET 和 POST");
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES)
      throw new ApiError(
        413,
        "PAYLOAD_TOO_LARGE",
        `请求体不能超过 ${Math.round(MAX_BODY_BYTES / 1024 / 1024)}MB`,
      );
    chunks.push(chunk);
  }
  const targetPath =
    "/api" + url.pathname.slice(AI_PROXY_PREFIX.length) + url.search;
  const target = AI_CLASSROOM_BASE + targetPath;
  const headers = { "content-type": "application/json" };
  if (req.headers["x-api-key"]) headers["x-api-key"] = req.headers["x-api-key"];
  let upstream;
  try {
    upstream = await fetch(target, {
      method: req.method,
      headers,
      body: chunks.length ? Buffer.concat(chunks) : undefined,
    });
  } catch (e) {
    throw new ApiError(
      502,
      "AI_BACKEND_UNREACHABLE",
      `无法连接 Django 后端(${AI_CLASSROOM_BASE}): ${e.message}`,
    );
  }
  const raw = Buffer.from(await upstream.arrayBuffer());
  res.writeHead(upstream.status, {
    "content-type": upstream.headers.get("content-type") || "application/json",
    "content-length": raw.length,
  });
  res.end(raw);
}

async function api(req, res, url, id) {
  const route = url.pathname.slice(API_PREFIX.length);
  if (!allowRequest(req))
    throw new ApiError(429, "RATE_LIMITED", "请求过于频繁，请稍后再试");
  auth(req);
  if (route === "/health" && req.method === "GET")
    return send(
      res,
      200,
      { status: "ok", service: "ai-learning-studio", time: now() },
      id,
    );
  if (route === "/metrics" && req.method === "GET")
    return send(
      res,
      200,
      {
        ...stats,
        uptimeSeconds: Math.floor(process.uptime()),
        tasks: {
          queued: store.data.tasks.filter((t) => t.status === "queued").length,
          processing: store.data.tasks.filter((t) => t.status === "processing")
            .length,
          failed: store.data.tasks.filter((t) => t.status === "failed").length,
        },
      },
      id,
    );
  if (route === "/search" && req.method === "POST") {
    const input = await body(req);
    const text = cleanText(input.query ?? input.text, "query");
    const search = await store.add("searches", {
      id: requestId(),
      text,
      source: String(input.source || "search-page").slice(0, 32),
      encryptedUserRef: encryptSensitive(input.userRef),
      createdAt: now(),
    });
    return send(
      res,
      201,
      {
        data: {
          id: search.id,
          query: text,
          normalized: true,
          createdAt: search.createdAt,
        },
        requestId: id,
      },
      id,
    );
  }
  // ── 幻灯片视频生成（异步） ──
  if (route === "/video/generate" && req.method === "POST") {
    const input = await body(req);
    const text = cleanText(input.query ?? input.text, "query");
    // 个性化教学上下文（学生昵称/年级/已掌握/目标/性格 + 音色/角色/交互），用于定制讲稿；
    // 与 query 一样经 cleanText 防护（含提示注入检测），空值视为未提供
    const persona =
      typeof input.persona === "string" && input.persona.trim()
        ? cleanText(input.persona, "persona").slice(0, 500)
        : "";
    const style =
      typeof input.style === "string" && input.style.trim()
        ? input.style.trim().slice(0, 32)
        : "";
    // mode=staged：分阶段流水线（大纲→逐页→收尾），单页失败可局部重试；默认仍为单次大调用
    const staged = String(input.mode || "") === "staged";
    const taskId = requestId();
    await store.add("videoTasks", {
      id: taskId,
      query: text,
      style: style || "",
      slides: [],
      audioUrl: null,
      status: "queued",
      progress: 0,
      pagesTotal: 0,
      pagesDone: 0,
      createdAt: now(),
      updatedAt: now(),
    });
    await store.add("searches", {
      id: requestId(),
      text,
      source: String(input.source || "search-page").slice(0, 32),
      createdAt: now(),
    });
    // 异步后台生成，避免请求超时
    setImmediate(async () => {
      let audioUrl = null;
      let slides = [];
      let fullText = "";
      try {
        let result;
        if (staged) {
          // 进度回写：status 轮询时透出 pagesTotal/pagesDone
          result = await generateSlidesStaged(text, persona, style, (p) => {
            store
              .update("videoTasks", taskId, {
                status: p.status,
                progress: p.progress,
                ...(p.total ? { pagesTotal: p.total, pagesDone: p.done ?? 0 } : {}),
              })
              .catch(() => {});
          });
          slides = result.slides;
        } else {
          await store.update("videoTasks", taskId, {
            status: "generating",
            progress: 20,
          });
          result = await generateScript(text, persona, style);
          slides = result.slides;
        }
        fullText = slides.map((s) => `${s.title}。${s.text}`).join("");
        await store.update("videoTasks", taskId, {
          slides,
          fullText,
          progress: 50,
          status: "generating_tts",
        });
        // 第1步：合成语音（已移除 AI 配图生成阶段，slides_ready 直接收尾）
        const slideAudio = await createSlideTTS(slides);
        await store.update("videoTasks", taskId, {
          slideAudio,
          audioUrl: null,
          images: {},
          progress: 100,
          status: "slides_ready",
        });
      } catch (e) {
        log("video.generate.failed", { taskId, message: e.message });
        if (slides.length) {
          // 讲稿已生成但语音合成失败：仍可播放无声幻灯片
          await store.update("videoTasks", taskId, {
            status: "slides_ready",
            slides,
            fullText,
            audioUrl,
            progress: 100,
          });
        } else {
          // 讲稿生成失败：标记失败并保留错误信息，供前端展示
          await store.update("videoTasks", taskId, {
            status: "failed",
            slides,
            fullText,
            audioUrl,
            progress: 100,
            error: { code: e.code || "GENERATION_FAILED", message: e.message },
          });
        }
      }
    });
    return send(
      res,
      201,
      { data: { task_id: taskId, audio_ready: false }, requestId: id },
      id,
    );
  }
  const videoStatusMatch = route.match(/^\/video\/status$/);
  if (videoStatusMatch && req.method === "GET") {
    const taskId = url.searchParams.get("task_id");
    if (!taskId) throw new ApiError(400, "MISSING_PARAM", "缺少 task_id 参数");
    // 双读：先查 v1 videoTasks，未命中回退 v2 coursewareTasks（真课件，format:2）
    const cwTask = store.find("coursewareTasks", taskId);
    if (cwTask) {
      return send(
        res,
        200,
        {
          data: {
            format: 2,
            status: cwTask.status,
            pages: cwTask.pages || [],
            voice: cwTask.voice || "",
            style: cwTask.style || "",
            query: cwTask.query,
            progress: cwTask.progress || 0,
            pages_total: cwTask.pagesTotal || 0,
            pages_done: cwTask.pagesDone || 0,
            tts_total: cwTask.ttsTotal || 0,
            tts_done: cwTask.ttsDone || 0,
            ...(cwTask.error ? { error: cwTask.error } : {}),
          },
          requestId: id,
        },
        id,
      );
    }
    const videoTask = store.find("videoTasks", taskId);
    if (!videoTask) throw new ApiError(404, "TASK_NOT_FOUND", "未找到该任务");
    return send(
      res,
      200,
      {
        data: {
          status: videoTask.status,
          audio_url: videoTask.audioUrl,
          slide_audio: videoTask.slideAudio || [],
          images: videoTask.images || {},
          style: videoTask.style || "",
          slides: videoTask.slides,
          query: videoTask.query,
          progress: videoTask.progress || 0,
          pages_total: videoTask.pagesTotal || 0,
          pages_done: videoTask.pagesDone || 0,
          ...(videoTask.error ? { error: videoTask.error } : {}),
        },
        requestId: id,
      },
      id,
    );
  }
  // ── 真课件 v2：生成（异步 job）──
  if (route === "/courseware/generate" && req.method === "POST") {
    const input = await body(req);
    const text = cleanText(input.query ?? input.text, "query");
    const persona =
      typeof input.persona === "string" && input.persona.trim()
        ? cleanText(input.persona, "persona").slice(0, 500)
        : "";
    const style =
      typeof input.style === "string" && input.style.trim()
        ? input.style.trim().slice(0, 32)
        : "";
    const VOICES = ["zh-CN-XiaoxiaoNeural", "zh-CN-YunxiNeural", "zh-CN-YunjianNeural", "zh-CN-XiaoyiNeural"];
    const voice = VOICES.includes(input.voice) ? input.voice : (process.env.EDGE_TTS_VOICE || "zh-CN-XiaoxiaoNeural");
    const taskId = requestId();
    await store.add("coursewareTasks", {
      id: taskId,
      query: text,
      style: style || "",
      voice,
      pages: [],
      status: "queued",
      progress: 0,
      pagesTotal: 0,
      pagesDone: 0,
      ttsTotal: 0,
      ttsDone: 0,
      createdAt: now(),
      updatedAt: now(),
    });
    setImmediate(async () => {
      try {
        const { pages } = await generateCoursewareStaged(text, persona, style, (p) => {
          store
            .update("coursewareTasks", taskId, {
              status: p.status,
              progress: p.progress,
              ...(p.total ? { pagesTotal: p.total, pagesDone: p.done ?? 0 } : {}),
            })
            .catch(() => {});
        });
        await store.update("coursewareTasks", taskId, {
          pages,
          progress: 62,
          status: "generating_tts",
        });
        await createCoursewareTTS(taskId, pages, voice, (t) => {
          store
            .update("coursewareTasks", taskId, {
              ttsTotal: t.total,
              ttsDone: t.done,
              progress: 62 + Math.round((t.done / Math.max(t.total, 1)) * 38),
            })
            .catch(() => {});
        });
        await store.update("coursewareTasks", taskId, { status: "slides_ready", progress: 100 });
      } catch (e) {
        log("courseware.generate.failed", { taskId, message: e.message });
        await store.update("coursewareTasks", taskId, {
          status: "failed",
          error: { code: e.code || "GENERATION_FAILED", message: e.message },
        });
      }
    });
    return send(
      res,
      201,
      { data: { task_id: taskId }, requestId: id },
      id,
    );
  }
  // ── 真课件 v2：换音色重新合成配音（仅重跑 TTS 阶段）──
  if (route === "/courseware/resynth" && req.method === "POST") {
    const input = await body(req);
    const taskId = String(input.task_id || "");
    const cwTask = store.find("coursewareTasks", taskId);
    if (!cwTask) throw new ApiError(404, "TASK_NOT_FOUND", "未找到该课件任务");
    const VOICES = ["zh-CN-XiaoxiaoNeural", "zh-CN-YunxiNeural", "zh-CN-YunjianNeural", "zh-CN-XiaoyiNeural"];
    if (!VOICES.includes(input.voice))
      throw new ApiError(400, "INVALID_INPUT", "voice 必须为 " + VOICES.join("、"));
    if (cwTask.status === "generating_tts")
      throw new ApiError(409, "BUSY", "该任务正在合成配音，请稍候");
    if (!cwTask.pages?.length)
      throw new ApiError(404, "NO_CONTENT", "该任务暂无课件内容");
    await store.update("coursewareTasks", taskId, {
      voice: input.voice,
      status: "generating_tts",
      progress: 62,
      ttsDone: 0,
    });
    setImmediate(async () => {
      try {
        await createCoursewareTTS(taskId, cwTask.pages, input.voice, (t) => {
          store
            .update("coursewareTasks", taskId, {
              ttsTotal: t.total,
              ttsDone: t.done,
              progress: 62 + Math.round((t.done / Math.max(t.total, 1)) * 38),
            })
            .catch(() => {});
        });
        await store.update("coursewareTasks", taskId, { status: "slides_ready", progress: 100 });
      } catch (e) {
        log("courseware.resynth.failed", { taskId, message: e.message });
        await store.update("coursewareTasks", taskId, {
          status: "slides_ready",
          error: { code: "RESYNTH_FAILED", message: e.message },
        });
      }
    });
    return send(res, 202, { data: { task_id: taskId, status: "generating_tts" }, requestId: id }, id);
  }
  // 按知识点查最近一次生成的视频任务（供搜索历史点击时定位已生成视频，latest wins）
  const videoTasksMatch = route.match(/^\/video\/tasks$/);
  if (videoTasksMatch && req.method === "GET") {
    const query = url.searchParams.get("query");
    if (!query || !query.trim())
      throw new ApiError(400, "MISSING_PARAM", "缺少 query 参数");
    const normalized = cleanText(String(query).slice(0, 4000), "query");
    const matches = store.data.videoTasks
      .filter((t) => t.query === normalized)
      .sort((a, b) =>
        String(b.createdAt || "").localeCompare(String(a.createdAt || "")),
      );
    const task = matches.find((t) => t.status === "slides_ready") || matches[0];
    if (!task)
      throw new ApiError(404, "TASK_NOT_FOUND", "未找到该知识点的已生成视频");
    return send(
      res,
      200,
      {
        data: {
          task_id: task.id,
          status: task.status,
          audio_url: task.audioUrl,
          slides: task.slides,
          query: task.query,
          progress: task.progress || 0,
          ...(task.error ? { error: task.error } : {}),
        },
        requestId: id,
      },
      id,
    );
  }
  // ── 导出学习笔记（Markdown / 打印版） ──
  if (route === "/video/export" && req.method === "GET") {
    const taskId = url.searchParams.get("task_id");
    if (!taskId) throw new ApiError(400, "MISSING_PARAM", "缺少 task_id 参数");
    const videoTask = store.find("videoTasks", taskId);
    if (!videoTask) throw new ApiError(404, "TASK_NOT_FOUND", "未找到该任务");
    if (!videoTask.slides?.length)
      throw new ApiError(404, "NO_CONTENT", "该任务暂无讲解内容");
    const query = videoTask.query || "学习笔记";
    const markdown = slidesToMarkdown(
      videoTask.slides,
      videoTask.fullText || "",
      query,
    );
    return send(
      res,
      200,
      {
        data: {
          filename: `学习笔记-${String(query).slice(0, 30)}.md`,
          query,
          markdown,
        },
        requestId: id,
      },
      id,
    );
  }
  // ── 单页 SVG 缩略图（与 .pptx 同一套渲染，不含 AI 配图） ──
  if (route === "/video/slide-svg" && req.method === "GET") {
    const taskId = url.searchParams.get("task_id");
    const index = Number(url.searchParams.get("index") || "0");
    if (!taskId) throw new ApiError(400, "MISSING_PARAM", "缺少 task_id 参数");
    const videoTask = store.find("videoTasks", taskId) || store.find("coursewareTasks", taskId);
    if (!videoTask) throw new ApiError(404, "TASK_NOT_FOUND", "未找到该任务");
    const slides = videoTask.slides || videoTask.pages;
    if (!slides || !slides.length)
      throw new ApiError(404, "NO_CONTENT", "该任务暂无幻灯片");
    const slide = slides[index];
    if (!slide) throw new ApiError(404, "NOT_FOUND", "页码不存在");
    const svg = slidesToSvgs([slide], { style: videoTask.style || "" })[0];
    res.writeHead(200, {
      "content-type": "image/svg+xml; charset=utf-8",
      "cache-control": "no-cache",
      "x-request-id": id,
    });
    return res.end(svg);
  }
  // ── 导出真实 PPT（.pptx，PowerPoint/WPS 可直接打开） ──
  if (route === "/video/pptx" && req.method === "GET") {
    const taskId = url.searchParams.get("task_id");
    if (!taskId) throw new ApiError(400, "MISSING_PARAM", "缺少 task_id 参数");
    const videoTask = store.find("videoTasks", taskId);
    if (!videoTask) throw new ApiError(404, "TASK_NOT_FOUND", "未找到该任务");
    if (!videoTask.slides || !videoTask.slides.length)
      throw new ApiError(404, "NO_CONTENT", "该任务暂无幻灯片内容");
    const slides = videoTask.slides;
    const query = videoTask.query || "AI 教学幻灯片";
    let pptx;
    try {
      pptx = await buildPptxViaPython(slides, query, videoTask.style || "", videoTask.id, videoTask.images);
    } catch (e) {
      log("pptx.python.fallback", { message: e.message });
      pptx = buildPptx(slides, query); // Node 零依赖兜底
    }
    await fs.mkdir(path.join(STORAGE_DIR, "pptx"), { recursive: true });
    const file = path.join("pptx", safeFileName("slides", ".pptx"));
    await fs.writeFile(path.join(STORAGE_DIR, file), pptx);
    const filename =
      "教学幻灯片-" + String(videoTask.query || "slides").slice(0, 30) + ".pptx";
    return send(
      res,
      200,
      { data: { url: publicAsset(file), filename }, requestId: id },
      id,
    );
  }
  // ── 导出逐页朗读音频（每页一段 mp3，打包 zip 下载） ──
  if (route === "/video/audio" && req.method === "GET") {
    const taskId = url.searchParams.get("task_id");
    if (!taskId) throw new ApiError(400, "MISSING_PARAM", "缺少 task_id 参数");
    const videoTask = store.find("videoTasks", taskId);
    if (!videoTask) throw new ApiError(404, "TASK_NOT_FOUND", "未找到该任务");
    const slideAudio = videoTask.slideAudio || [];
    const audios = slideAudio
      .filter((a) => a && a.url)
      .sort((a, b) => a.index - b.index);
    if (!audios.length)
      throw new ApiError(404, "NO_CONTENT", "该任务暂无朗读音频");
    const entries = [];
    for (const a of audios) {
      const rel = String(a.url).replace(/^\/storage\//, "");
      const abs = path.resolve(STORAGE_DIR, rel);
      if (!abs.startsWith(path.resolve(STORAGE_DIR))) continue;
      try {
        const data = await fs.readFile(abs);
        entries.push({
          name: "slide-" + String(a.index + 1).padStart(2, "0") + ".mp3",
          data,
        });
      } catch (e) {
        /* 单个音频缺失则跳过 */
      }
    }
    if (!entries.length)
      throw new ApiError(404, "NO_CONTENT", "朗读音频文件缺失");
    const zip = buildZip(entries);
    const file = path.join("audio", safeFileName("narration", ".zip"));
    await fs.writeFile(path.join(STORAGE_DIR, file), zip);
    const filename =
      "朗读音频-" + String(videoTask.query || "slides").slice(0, 30) + ".zip";
    return send(
      res,
      200,
      { data: { url: publicAsset(file), filename }, requestId: id },
      id,
    );
  }
  // ── PPT Schema（只读）：枚举与字段规格，前端渲染兜底可对齐 ──
  if (route === "/ppt/schema" && req.method === "GET") {
    return send(
      res,
      200,
      {
        data: {
          layouts: PPT_SCHEMA.LAYOUT_POOL,
          visualTypes: PPT_SCHEMA.VISUAL_TYPES,
          diagramTypes: PPT_SCHEMA.DIAGRAM_TYPES,
          fields: PPT_SCHEMA.SLIDE_FIELDS,
          patchableFields: PPT_SCHEMA.PATCHABLE_FIELDS,
        },
        requestId: id,
      },
      id,
    );
  }
  // ── Edit with AI：对任务中某一页做增量 JSON Patch（校验通过才返回） ──
  if (route === "/ppt/patch" && req.method === "POST") {
    const input = await body(req);
    const taskId = String(input.task_id || "").slice(0, 64);
    const idx = Number(input.slide_index);
    const instruction =
      typeof input.instruction === "string" ? input.instruction.trim() : "";
    if (!taskId) throw new ApiError(400, "MISSING_PARAM", "缺少 task_id 参数");
    if (!Number.isInteger(idx) || idx < 0)
      throw new ApiError(400, "INVALID_INPUT", "slide_index 必须为非负整数");
    if (!instruction)
      throw new ApiError(400, "MISSING_PARAM", "缺少 instruction 编辑指令");
    const videoTask = store.find("videoTasks", taskId);
    if (!videoTask) throw new ApiError(404, "TASK_NOT_FOUND", "未找到该任务");
    const slides = Array.isArray(videoTask.slides) ? videoTask.slides : [];
    if (!slides.length)
      throw new ApiError(404, "NO_CONTENT", "该任务暂无幻灯片内容");
    if (idx >= slides.length)
      throw new ApiError(400, "INVALID_INPUT", `slide_index 超出范围（共 ${slides.length} 页）`);
    const safeInstruction = cleanText(instruction.slice(0, 500), "instruction");
    const startedAt = Date.now();
    const { patch, slide, errors } = await patchSlideViaLLM(slides[idx], safeInstruction, {
      query: videoTask.query,
    });
    log("ppt.patch.done", {
      taskId,
      slideIndex: idx,
      ops: patch.length,
      fixes: errors.length,
      ms: Date.now() - startedAt,
    });
    return send(
      res,
      200,
      { data: { patch, slide, slide_index: idx, warnings: errors }, requestId: id },
      id,
    );
  }
  // ── 保存编辑后的幻灯片（watch.html 编辑落库；服务端重校验后写入任务） ──
  if (route === "/video/save" && req.method === "POST") {
    const input = await body(req);
    const taskId = String(input.task_id || "").slice(0, 64);
    if (!taskId) throw new ApiError(400, "MISSING_PARAM", "缺少 task_id 参数");
    if (!Array.isArray(input.slides) || !input.slides.length)
      throw new ApiError(400, "INVALID_INPUT", "slides 必须为非空数组");
    if (input.slides.length > 30)
      throw new ApiError(400, "INVALID_INPUT", "slides 页数过多（上限 30）");
    const videoTask = store.find("videoTasks", taskId);
    if (!videoTask) throw new ApiError(404, "TASK_NOT_FOUND", "未找到该任务");
    const { slides: validated, errors } = PPT_SCHEMA.validateSlides(input.slides);
    if (!validated.length)
      throw new ApiError(400, "INVALID_INPUT", "slides 校验后为空：" + (errors[0] || ""));
    await store.update("videoTasks", taskId, {
      slides: validated,
      fullText: validated.map((s) => `${s.title}。${s.text}`).join(""),
      editedAt: now(),
    });
    log("video.saved", { taskId, pages: validated.length, fixes: errors.length });
    return send(
      res,
      200,
      { data: { saved: validated.length, warnings: errors }, requestId: id },
      id,
    );
  }
  // ── AI 生成相关题目（根据知识点，Qwen LLM 生成，失败回退本地规则题库） ──
  if (route === "/video/quiz" && req.method === "POST") {
    const input = await body(req);
    const startedAt = Date.now();
    let text;
    try {
      text = cleanText(input.query ?? input.text, "query");
    } catch (e) {
      log("quiz.request_invalid", {
        requestId: id,
        code: e.code,
        message: e.message,
      });
      throw e;
    }
    log("quiz.request", {
      requestId: id,
      query: text,
      bodyKeys: Object.keys(input),
    });
    // 举一反三：可选参数 variants_of，存在时基于原题生成变式题
    const variantsOf =
      input.variants_of && typeof input.variants_of === "object"
        ? {
            topic: String(input.variants_of.topic || "").slice(0, 60),
            question: String(input.variants_of.question || "").slice(0, 500),
            options: Array.isArray(input.variants_of.options)
              ? input.variants_of.options.map((o) => String(o).slice(0, 200))
              : [],
            answer: input.variants_of.answer,
            explanation: String(input.variants_of.explanation || "").slice(
              0,
              1000,
            ),
          }
        : null;
    let questions,
      source = "llm";
    try {
      questions = await generateQuizViaLLM(text, variantsOf);
    } catch (e) {
      source = "fallback_rules";
      log("quiz.llm.failed", {
        requestId: id,
        query: text,
        variants: Boolean(variantsOf),
        code: e.code || "UNKNOWN",
        message: e.message,
        ms: Date.now() - startedAt,
      });
      try {
        if (variantsOf) {
          questions = generateVariantsFallback(variantsOf);
        } else {
          const generated = generateQuestions(text, {
            types: ["choice"],
            difficulty: "medium",
            count: 3,
          });
          questions = generated.questions.map((item) => {
            const ansIdx = Math.max(
              0,
              item.options.indexOf(item.correctAnswer),
            );
            return {
              q: item.content,
              opts: item.options,
              ans: ansIdx,
              exp: item.explanation,
            };
          });
        }
      } catch (e2) {
        log("quiz.fallback_failed", {
          requestId: id,
          query: text,
          message: e2.message,
          ms: Date.now() - startedAt,
        });
        throw e2;
      }
    }
    log("quiz.done", {
      requestId: id,
      query: text,
      source,
      questions: questions.length,
      answers: questions.map((q) => q.ans),
      ms: Date.now() - startedAt,
    });
    return send(res, 200, { data: { questions, source }, requestId: id }, id);
  }
  // ── AI 解题对话（Qwen 流式 SSE；失败回退本地分步讲解） ──
  if (route === "/chat" && req.method === "POST") {
    const input = await body(req);
    const question = cleanText(input.query ?? input.text, "query");
    const history = Array.isArray(input.history) ? input.history : [];
    log("chat.request", {
      requestId: id,
      query: question,
      turns: history.length,
    });
    res.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store",
      connection: "keep-alive",
      "x-request-id": id,
    });
    const emit = (payload) => {
      try {
        res.write(`data: ${JSON.stringify(payload)}\n\n`);
      } catch (e) {
        /* 客户端已断开 */
      }
    };
    emit({ type: "start", requestId: id });
    const startedAt = Date.now();
    try {
      const upstream = await chatSolveLLM(question, history);
      let content = "";
      let usage = null;
      try {
        for await (const chunk of upstream.body) {
          const text = Buffer.from(chunk).toString("utf8");
          const lines = text.split("\n");
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith("data:")) continue;
            const data = trimmed.slice(5).trim();
            if (data === "[DONE]") continue;
            try {
              const json = JSON.parse(data);
              const delta = json.choices?.[0]?.delta?.content;
              usage = json.usage || usage;
              if (typeof delta === "string" && delta) {
                content += delta;
                emit({ type: "delta", delta });
              }
            } catch (e) {
              /* 忽略无法解析的行 */
            }
          }
        }
      } catch (e) {
        log("chat.stream.read_error", { requestId: id, message: e.message });
      }
      if (!content) throw new Error("Qwen 未返回任何内容");
      log("chat.llm.success", {
        requestId: id,
        query: question,
        ms: Date.now() - startedAt,
        chars: content.length,
        usage,
      });
      emit({ type: "done", content, source: "llm" });
    } catch (e) {
      log("chat.llm.failed", {
        requestId: id,
        query: question,
        code: e.code || "UNKNOWN",
        message: e.message,
        ms: Date.now() - startedAt,
      });
      emit({
        type: "done",
        content: buildFallbackChatReply(question, history),
        source: "fallback_rules",
      });
    }
    try {
      res.end();
    } catch (e) {
      /* 忽略 */
    }
    return;
  }
  // ── 学情采集：统一答题记录（替代前端直接调用 grade） ──
  if (route === "/attempts" && req.method === "POST") {
    const input = await body(req);
    const clientId = getClientId(req);
    const answer = cleanText(input.answer, "answer");
    const topic = normalizeTopic(input.topic, input.query || input.text);
    const type = enumValue(
      input.type,
      ["choice", "true_false", "fill_blank"],
      "choice",
      "type",
    );
    const questionId =
      typeof input.questionId === "string"
        ? input.questionId.slice(0, 64)
        : null;
    const question = questionId ? store.find("questions", questionId) : null;
    let correct;
    if (question) correct = grade(question, answer);
    else if (typeof input.correct === "boolean") correct = input.correct;
    else
      throw new ApiError(
        422,
        "CANNOT_GRADE",
        "无法判分：缺少有效的 questionId 或 correct 字段",
      );
    const attempt = await store.add("attempts", {
      id: requestId(),
      clientId,
      questionId,
      taskId:
        typeof input.taskId === "string" ? input.taskId.slice(0, 64) : null,
      topic,
      type,
      answer,
      correct,
      createdAt: now(),
    });
    let mistake = null;
    if (!correct) {
      const correctAnswer = question
        ? String(question.correctAnswer || "")
        : String(input.correctAnswer ?? "");
      const questionText = question
        ? String(question.content || "")
        : String(input.question ?? "");
      mistake = await store.add("mistakes", {
        id: requestId(),
        attemptId: attempt.id,
        clientId,
        questionId,
        taskId: attempt.taskId,
        topic,
        type,
        question: questionText,
        userAnswer: answer,
        correctAnswer,
        options: Array.isArray(input.options)
          ? input.options.slice(0, 8).map((o) => String(o).slice(0, 200))
          : question && Array.isArray(question.options)
            ? question.options
            : [],
        cause: null,
        causeText: null,
        suggestion: null,
        reviewed: false,
        reviewedAt: null,
        reviewCorrect: null,
        createdAt: now(),
      });
    }
    log("attempt.recorded", {
      requestId: id,
      clientId,
      topic: topic.title,
      type,
      correct,
      mistake: mistake ? mistake.id : null,
    });
    return send(
      res,
      200,
      {
        data: {
          attemptId: attempt.id,
          correct,
          mistakeId: mistake ? mistake.id : null,
        },
        requestId: id,
      },
      id,
    );
  }
  // ── 学习笔记（参考 OpenMAIC 内置笔记系统：随学随记 + 锚点跳转 + AI 生成 + Markdown 导出）──
  if (route === "/notes" && req.method === "GET") {
    const clientId = getClientId(req);
    const taskId = cleanText(url.searchParams.get("task_id") || "", "task_id").slice(0, 64);
    if (!taskId) throw new ApiError(400, "INVALID_INPUT", "缺少 task_id");
    const notes = store.data.notes
      .filter((n) => n.clientId === clientId && n.taskId === taskId)
      .sort((a, b) => (a.createdAt > b.createdAt ? -1 : 1));
    return send(res, 200, { data: notes }, id);
  }
  if (route === "/notes" && req.method === "POST") {
    const input = await body(req);
    const clientId = getClientId(req);
    const taskId = cleanText(input.task_id || input.taskId || "", "task_id").slice(0, 64);
    const page = Number.isInteger(input.page) ? Math.max(0, input.page) : null;
    const title = cleanText(input.title || "", "title").slice(0, 200);
    const text = cleanText(input.text || "", "text").slice(0, 4000);
    if (!taskId || !text) throw new ApiError(422, "INVALID_INPUT", "缺少 task_id 或 text");
    const note = await store.add("notes", {
      id: requestId(),
      clientId,
      taskId,
      page,
      title,
      text,
      auto: !!input.auto,
      createdAt: now(),
    });
    return send(res, 201, { data: note }, id);
  }
  if (route === "/notes" && req.method === "PUT") {
    const input = await body(req);
    const clientId = getClientId(req);
    const note = store.data.notes.find((n) => n.id === cleanText(input.id || "", "id"));
    if (!note || note.clientId !== clientId)
      throw new ApiError(404, "NOT_FOUND", "笔记不存在");
    if (typeof input.text === "string") note.text = cleanText(input.text, "text").slice(0, 4000);
    if (typeof input.title === "string") note.title = cleanText(input.title, "title").slice(0, 200);
    if (Number.isInteger(input.page)) note.page = Math.max(0, input.page);
    note.updatedAt = now();
    await store.persist();
    return send(res, 200, { data: note }, id);
  }
  if (route === "/notes" && req.method === "DELETE") {
    const input = await body(req);
    const clientId = getClientId(req);
    const idx = store.data.notes.findIndex((n) => n.id === cleanText(input.id || "", "id"));
    if (idx < 0 || store.data.notes[idx].clientId !== clientId)
      throw new ApiError(404, "NOT_FOUND", "笔记不存在");
    const [removed] = store.data.notes.splice(idx, 1);
    await store.persist();
    return send(res, 200, { data: { deleted: removed.id } }, id);
  }
  // AI 生成结构化笔记：基于课件内容由 LLM 归纳，结果同时入库
  if (route === "/notes/ai" && req.method === "POST") {
    const input = await body(req);
    const clientId = getClientId(req);
    const taskId = cleanText(input.task_id || input.taskId || "", "task_id").slice(0, 64);
    const task = store.find("coursewareTasks", taskId) || store.find("videoTasks", taskId) || store.find("tasks", taskId);
    const pages = task && Array.isArray(task.pages) ? task.pages : [];
    if (!taskId || !pages.length)
      throw new ApiError(422, "INVALID_INPUT", "未找到该课件的页面内容");
    const digest = pages
      .slice(0, 14)
      .map((p, i) => `【第${i + 1}页】${String(p.title || "").slice(0, 60)}：${String(p.text || p.left || "").replace(/\s+/g, " ").slice(0, 220)}`)
      .join("\n");
    const resJson = await llmJson({
      system: "你是资深学习笔记整理助手，输出必须仅为一个 JSON 对象，不要 Markdown 代码块。",
      user: `根据以下课件每页内容，生成一份结构化学习笔记（Markdown 格式），要求：1) 以 # 标题开头；2) 按「核心概念 → 关键步骤/机制 → 易错点 → 速记口诀」组织，只写干货；3) 结尾给出 3 个自测问题。\n\n课件内容：\n${digest}`,
      maxTokens: 1600,
      temperature: 0.4,
    });
    const md = String(
      resJson.markdown || resJson.content || resJson.notes || resJson.note ||
      resJson.result || resJson.text || resJson.outline || resJson.answer || ""
    ).trim();
    // 兜底：LLM 返回了其它结构时直接序列化，避免内容丢失
    const fallbackMd = !md && resJson && typeof resJson === "object"
      ? jsonToMarkdown(resJson).trim()
      : "";
    const noteMd = md || fallbackMd;
    if (!noteMd) throw new ApiError(502, "EMPTY_AI_OUTPUT", "AI 未生成笔记");
    const note = await store.add("notes", {
      id: requestId(),
      clientId,
      taskId,
      page: null,
      title: "AI 结构化笔记",
      text: noteMd.slice(0, 8000),
      auto: true,
      createdAt: now(),
    });
    return send(res, 201, { data: { note, markdown: noteMd } }, id);
  }
  // ── 学情：错题本列表 ──
  if (route === "/mistakes" && req.method === "GET") {
    const clientId = getClientId(req);
    const subject = url.searchParams.get("subject");
    const topicFilter = url.searchParams.get("topic");
    const reviewed = url.searchParams.get("reviewed");
    if (reviewed !== null && !["true", "false", "all"].includes(reviewed))
      throw new ApiError(
        400,
        "INVALID_INPUT",
        "reviewed 必须为 true、false 或 all",
      );
    let list = store.data.mistakes.filter((m) => m.clientId === clientId);
    if (subject) list = list.filter((m) => m.topic?.subject === subject);
    if (topicFilter) list = list.filter((m) => m.topic?.title === topicFilter);
    if (reviewed === "true") list = list.filter((m) => m.reviewed);
    else if (reviewed === "false") list = list.filter((m) => !m.reviewed);
    // 'all' 或未传 → 返回全部
    list = [...list].sort((a, b) =>
      String(b.createdAt || "").localeCompare(String(a.createdAt || "")),
    );
    const items = list.map((m) => {
      // 兼容历史数据：questionId 能查到题库时自动补全选项
      let options = m.options;
      if ((!Array.isArray(options) || !options.length) && m.questionId) {
        const q = store.find("questions", m.questionId);
        if (q && Array.isArray(q.options) && q.options.length)
          options = q.options;
      }
      return {
        ...m,
        options: Array.isArray(options) ? options : [],
        causeLabel: mistakeCauseLabel(m.cause),
        pending: !m.cause,
      };
    });
    return send(
      res,
      200,
      { data: { total: items.length, items }, requestId: id },
      id,
    );
  }
  // ── 学情：错题 AI 归因 ──
  const mistakeAnalyzeMatch = route.match(/^\/mistakes\/([\w-]+)\/analyze$/);
  if (mistakeAnalyzeMatch && req.method === "POST") {
    const mistake = store.find("mistakes", mistakeAnalyzeMatch[1]);
    if (!mistake || mistake.clientId !== getClientId(req))
      throw new ApiError(404, "MISTAKE_NOT_FOUND", "未找到该错题记录");
    const input = await body(req).catch(() => ({}));
    let result;
    if (mistake.cause && !input.force)
      result = {
        cause: mistake.cause,
        causeText: mistake.causeText,
        suggestion: mistake.suggestion,
      };
    else result = await analyzeMistakeWithLLM(mistake);
    await store.update("mistakes", mistake.id, result);
    return send(
      res,
      200,
      {
        data: {
          id: mistake.id,
          ...result,
          causeLabel: mistakeCauseLabel(result.cause),
        },
        requestId: id,
      },
      id,
    );
  }
  // ── 学情：错题复习标记 ──
  const mistakeReviewMatch = route.match(/^\/mistakes\/([\w-]+)\/review$/);
  if (mistakeReviewMatch && req.method === "POST") {
    const mistake = store.find("mistakes", mistakeReviewMatch[1]);
    if (!mistake || mistake.clientId !== getClientId(req))
      throw new ApiError(404, "MISTAKE_NOT_FOUND", "未找到该错题记录");
    const input = await body(req);
    const reviewCorrect =
      typeof input.reviewCorrect === "boolean" ? input.reviewCorrect : null;
    const updated = await store.update("mistakes", mistake.id, {
      reviewed: true,
      reviewedAt: now(),
      reviewCorrect,
    });
    return send(
      res,
      200,
      {
        data: {
          id: updated.id,
          reviewed: true,
          reviewCorrect: updated.reviewCorrect,
        },
        requestId: id,
      },
      id,
    );
  }
  // ── 学情：学情诊断报告 ──
  if (route === "/diagnostics" && req.method === "GET") {
    const clientId = getClientId(req);
    const fromRaw = url.searchParams.get("from");
    const toRaw = url.searchParams.get("to");
    const from = fromRaw ? new Date(fromRaw).getTime() : null;
    const to = toRaw ? new Date(toRaw).getTime() : null;
    const startedAt = Date.now();
    const report = buildDiagnostics(clientId, from, to);
    // AI 归纳薄弱点（有薄弱点且已配置 Key 时调用，失败不阻断）
    try {
      const weak = report.summary.weakTopics;
      if (weak.length && process.env.QWEN_API_KEY) {
        const system =
          "你是学情分析专家，请基于学生的薄弱知识点列表给出分析与建议。只输出合法 JSON。";
        const prompt = `学生目前掌握薄弱的知识点：${weak.map((t) => `${t.topic}(${t.subject})，正确率${Math.round(t.correctRate * 100)}%，答题${t.attempts}次`).join("；")}。请为每个薄弱点给出原因与针对性学习建议。严格按 JSON 输出：{"weakTopics":[{"topic":"知识点名","reason":"薄弱原因","suggestion":"学习建议"}]}`;
        const res = await fetch(
          "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${process.env.QWEN_API_KEY}`,
            },
            body: JSON.stringify({
              model: process.env.QWEN_CHAT_MODEL || "qwen-max",
              messages: [
                { role: "system", content: system },
                { role: "user", content: prompt },
              ],
              max_tokens: 1024,
            }),
            signal: AbortSignal.timeout(60_000),
          },
        );
        if (res.ok) {
          const data = await res.json();
          const raw = data.choices?.[0]?.message?.content?.trim() || "";
          let json;
          try {
            json = parseLLMJson(raw);
          } catch (e) {
            json = null;
          }
          if (Array.isArray(json?.weakTopics)) {
            report.summary.weakTopics = weak.map((w) => {
              const found = json.weakTopics.find(
                (x) =>
                  String(x.topic).includes(w.topic) ||
                  w.topic.includes(String(x.topic)),
              );
              return found
                ? {
                    ...w,
                    reason: String(found.reason || "").slice(0, 200),
                    suggestion: String(found.suggestion || "").slice(0, 300),
                  }
                : w;
            });
          }
        }
      }
    } catch (e) {
      log("diagnostics.ai.failed", { requestId: id, message: e.message });
    }
    await store.add("diagnostics", {
      id: requestId(),
      clientId,
      ...report,
      createdAt: now(),
    });
    log("diagnostics.generated", {
      requestId: id,
      clientId,
      totalAttempts: report.summary.totalAttempts,
      weak: report.summary.weakTopics.length,
      ms: Date.now() - startedAt,
    });
    return send(res, 200, { data: report, requestId: id }, id);
  }
  if (route === "/generations" && req.method === "POST") {
    const created = await createGeneration(await body(req));
    return send(
      res,
      202,
      { data: publicTask(created.task), requestId: id },
      id,
    );
  }
  const taskMatch = route.match(/^\/tasks\/([\w-]+)(\/result)?$/);
  if (taskMatch && req.method === "GET") {
    const task = store.find("tasks", taskMatch[1]);
    if (!task) throw new ApiError(404, "TASK_NOT_FOUND", "未找到该任务");
    if (taskMatch[2]) {
      if (task.status !== "completed")
        throw new ApiError(409, "TASK_NOT_READY", "任务尚未完成");
      return send(res, 200, { data: task.result, requestId: id }, id);
    }
    return send(res, 200, { data: publicTask(task), requestId: id }, id);
  }
  // ── Bilibili 封面代理（避免前端跨域） ──
  if (route === "/bilibili/cover" && req.method === "GET") {
    const bvid = url.searchParams.get("bvid");
    if (!bvid) throw new ApiError(400, "MISSING_PARAM", "缺少 bvid 参数");
    const apiUrl = `https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(bvid)}`;
    try {
      const remote = await fetch(apiUrl, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Referer: "https://www.bilibili.com/",
        },
        signal: AbortSignal.timeout(10_000),
      });
      if (!remote.ok)
        throw new ApiError(
          502,
          "PROVIDER_ERROR",
          `Bilibili 返回 ${remote.status}`,
        );
      const data = await remote.json();
      const cover = data.data?.pic;
      const title = data.data?.title;
      if (!title) throw new ApiError(502, "PROVIDER_ERROR", "未获取到视频标题");
      return send(
        res,
        200,
        { data: { bvid, title, cover: cover || "" }, requestId: id },
        id,
      );
    } catch (e) {
      if (e instanceof ApiError) throw e;
      throw new ApiError(
        502,
        "PROVIDER_ERROR",
        `获取视频信息失败: ${e.message}`,
      );
    }
  }
  if (route === "/questions/generate" && req.method === "POST") {
    const input = await body(req);
    const generated = generateQuestions(cleanText(input.text), input);
    for (const question of generated.questions)
      await store.add("questions", { ...question, createdAt: now() });
    return send(res, 201, { data: generated, requestId: id }, id);
  }
  const gradeMatch = route.match(/^\/questions\/([\w-]+)\/grade$/);
  if (gradeMatch && req.method === "POST") {
    const question = store.find("questions", gradeMatch[1]);
    if (!question)
      throw new ApiError(404, "QUESTION_NOT_FOUND", "未找到该题目");
    const input = await body(req);
    const correct = grade(question, input.answer);
    await store.add("attempts", {
      id: requestId(),
      questionId: question.id,
      answer: String(input.answer),
      correct,
      createdAt: now(),
    });
    return send(
      res,
      200,
      {
        data: {
          questionId: question.id,
          correct,
          explanation: question.explanation,
          correctAnswer: question.correctAnswer,
        },
        requestId: id,
      },
      id,
    );
  }
  if (route === "/skill/explain" && req.method === "POST") {
    const input = await body(req);
    const topic = cleanText(input.topic ?? input.query, "query");
    if (!topic) throw new ApiError(400, "INVALID_INPUT", "请提供知识点");
    const context = String(input.context || "").slice(0, 1200);
    const text = await callDeepSeek([
      { role: "system", content: "你是计算机科学教学专家，用简洁清晰的中文讲解知识点。" },
      { role: "user", content: `请为知识点「${topic}」生成一段中文讲解，要求：\n1) 先用一句话给出精确定义；\n2) 再列 3-5 条核心要点或原理；\n3) 给一个简单易懂的例子；\n4) 最后一句学习建议。\n用 Markdown（小标题/列表/加粗），总长 200-350 字。${context ? "\n\n补充背景：" + context : ""}` },
    ]);
    return send(res, 200, { data: { topic, text }, requestId: id }, id);
  }
  if (route === "/generate-tree" && req.method === "POST") {
    const input = await body(req);
    const topic = cleanText(input.topic ?? "", "query");
    if (!topic) throw new ApiError(400, "INVALID_INPUT", "请提供学习方向(topic)");
    const goal = String(input.goal || "").trim().slice(0, 500);
    const content = await callDeepSeek([
      { role: "system", content: buildTreeSystemPrompt() },
      { role: "user", content: buildTreeUserPrompt(topic, goal) },
    ]);
    const tree = parseTreeJson(content);
    return send(res, 200, tree, id);
  }
  // ── RAG 知识库: 列表 / 导入 / 删除 / 问答 ──
  if (route === "/knowledge" && req.method === "GET") {
    return send(
      res,
      200,
      {
        data: {
          documents: RAG_INDEX.data.documents.map((d) => ({
            id: d.id,
            title: d.title,
            category: d.category || "",
            sourceType: d.sourceType || "",
            sourceLoc: d.sourceLoc || "",
            chunkCount: d.chunkCount,
            charCount: d.charCount,
            createdAt: d.createdAt,
          })),
          chunkCount: RAG_INDEX.data.chunks.length,
          embedding: process.env.QWEN_API_KEY
            ? "dashscope-text-embedding"
            : "local-fallback",
        },
        requestId: id,
      },
      id,
    );
  }
  if (route === "/knowledge/ingest" && req.method === "POST") {
    const input = await body(req);
    const title = cleanText(String(input.title ?? ""), "title");
    const text = String(input.text ?? "");
    if (!text.trim()) throw new ApiError(422, "INVALID_INPUT", "文档内容为空");
    const category = String(input.category ?? "").trim().slice(0, 32);
    const sourceType = String(input.sourceType ?? "").trim().slice(0, 32);
    const sourceLoc = String(input.sourceLoc ?? "").trim().slice(0, 64);
    const doc = await rag.ingest(RAG_INDEX, title, text, { category, sourceType, sourceLoc });
    return send(res, 201, { data: doc, requestId: id }, id);
  }
  if (route === "/knowledge/delete" && req.method === "POST") {
    const input = await body(req);
    const docId = String(input.id ?? "");
    const removed = await rag.removeDoc(RAG_INDEX, docId);
    if (!removed) throw new ApiError(404, "NOT_FOUND", "文档不存在");
    return send(res, 200, { data: { removed: true }, requestId: id }, id);
  }
  if (route.startsWith("/knowledge/doc/") && req.method === "GET") {
    const docId = decodeURIComponent(route.slice("/knowledge/doc/".length));
    const doc = RAG_INDEX.data.documents.find((d) => d.id === docId);
    if (!doc) throw new ApiError(404, "NOT_FOUND", "文档不存在");
    const chunks = RAG_INDEX.data.chunks
      .filter((c) => c.docId === docId)
      .sort((a, b) => a.index - b.index)
      .map((c) => c.text);
    return send(
      res,
      200,
      {
        data: {
          id: doc.id,
          title: doc.title,
          category: doc.category || "",
          sourceType: doc.sourceType || "",
          sourceLoc: doc.sourceLoc || "",
          charCount: doc.charCount,
          createdAt: doc.createdAt,
          chunkCount: chunks.length,
          text: chunks.join("\n\n"),
        },
        requestId: id,
      },
      id,
    );
  }
  if (route === "/knowledge/ask" && req.method === "POST") {
    const input = await body(req);
    const query = cleanText(String(input.query ?? ""), "query");
    if (!query) throw new ApiError(400, "INVALID_INPUT", "请提供问题");
    if (RAG_INDEX.data.chunks.length === 0)
      throw new ApiError(422, "EMPTY_KB", "知识库为空，请先导入文档");
    const topK = Math.min(Math.max(Number(input.topK) || 4, 1), 8);
    const history = Array.isArray(input.history) ? input.history : [];
    const hits = await rag.retrieveAsync(RAG_INDEX, query, topK);
    const sources = hits.map((h, i) => ({
      rank: i + 1,
      docTitle: h.chunk.docTitle,
      category: h.chunk.category || "",
      sourceType: h.chunk.sourceType || "",
      sourceLoc: h.chunk.sourceLoc || "",
      score: +h.score.toFixed(4),
      text: h.chunk.text.slice(0, 260),
    }));
    const context = hits
      .map(
        (h, i) =>
          `[片段${i + 1}] (来源: ${h.chunk.docTitle} · ${h.chunk.sourceType || "未标注"}${h.chunk.sourceLoc ? " · " + h.chunk.sourceLoc : ""})\n${h.chunk.text}`,
      )
      .join("\n\n");
    let answer;
    try {
      answer = await ragAskLLM(context, query, history);
    } catch (err) {
      if (!process.env.QWEN_API_KEY) {
        // 未配置 Key 时无在线作答, 返回本地检索结果与说明
        answer =
          "> 当前未配置 QWEN_API_KEY，已切换到本地检索模式（仅返回知识片段，不做大模型生成）。\n\n" +
          sources.map((s) => `**${s.docTitle}**（相关度 ${s.score}·${s.sourceType || "未标注"}${s.sourceLoc ? "·" + s.sourceLoc : ""}）\n${s.text}`).join("\n\n");
      } else {
        log("rag.ask.llm_error", { query, message: err.message });
        answer =
          "> 检索已命中知识片段，但大模型生成失败，以下为命中的参考片段：\n\n" +
          sources.map((s) => `**${s.docTitle}**（相关度 ${s.score}·${s.sourceType || "未标注"}${s.sourceLoc ? "·" + s.sourceLoc : ""}）\n${s.text}`).join("\n\n");
      }
    }
    return send(res, 200, { data: { answer, sources }, requestId: id }, id);
  }

  // ── 智能工作流编排 ──
  // 模板列表(含 DAG 定义, 前端画布直接渲染)
  if (route === "/workflows" && req.method === "GET") {
    return send(res, 200, { data: { templates: WORKFLOW_TEMPLATES }, requestId: id }, id);
  }

  // 启动工作流: template=内置模板 或 def=自定义 DAG(JSON 模式)
  if (route === "/workflow/run" && req.method === "POST") {
    const input = await body(req);
    let def;
    let templateId = "";
    let name = "自定义工作流";
    if (input.def && typeof input.def === "object") {
      def = input.def;
      try {
        validateWorkflowDef(def);
      } catch (err) {
        throw new ApiError(422, "INVALID_DEF", `工作流定义非法: ${err.message}`);
      }
      name = String(input.name || name).slice(0, 64);
    } else {
      const tpl = WORKFLOW_TEMPLATES.find((t) => t.id === String(input.template || ""));
      if (!tpl) throw new ApiError(404, "NOT_FOUND", "工作流模板不存在");
      def = tpl.def;
      templateId = tpl.id;
      name = tpl.name;
    }
    const raw = input.input && typeof input.input === "object" ? input.input : {};
    const runInput = {
      query: cleanText(String(raw.query ?? ""), "query"),
      persona:
        typeof raw.persona === "string" && raw.persona.trim()
          ? cleanText(raw.persona, "persona").slice(0, 500)
          : "",
      style: typeof raw.style === "string" ? raw.style.trim().slice(0, 32) : "",
    };
    if (!runInput.query) throw new ApiError(422, "INVALID_INPUT", "请提供教学主题(query)");
    const taskId = requestId();
    const snapshot = {
      id: taskId,
      templateId,
      name,
      status: "running",
      input: runInput,
      def,
      nodes: {},
      resultUrl: null,
      stats: null,
      durationMs: null,
      createdAt: now(),
      updatedAt: now(),
    };
    WORKFLOW_TASKS.set(taskId, snapshot);
    await store.add("workflowTasks", { ...snapshotForStore(snapshot), id: taskId, name, templateId, input: runInput, def, createdAt: now() });
    // 异步执行, 事件回写快照(轮询可见节点级状态)
    setImmediate(async () => {
      try {
        await WORKFLOW_ENGINE.run(def, runInput, { onEvent: workflowEventSink(taskId) });
      } catch (e) {
        const snap = WORKFLOW_TASKS.get(taskId);
        if (snap) {
          snap.status = "error";
          snap.error = e.message;
          store.update("workflowTasks", taskId, snapshotForStore(snap)).catch(() => {});
        }
        log("workflow.failed", { taskId, message: e.message });
      }
    });
    log("workflow.started", { taskId, templateId: templateId || "custom", query: runInput.query });
    return send(res, 202, { data: { taskId, name } }, id);
  }

  // 工作流任务状态(内存优先; 未命中再查库, 服务重启后仍可看历史)
  if (route === "/workflow/tasks" && req.method === "GET") {
    const taskId = (url.searchParams.get("id") || "").trim().slice(0, 64);
    if (taskId) {
      const snap = WORKFLOW_TASKS.get(taskId);
      if (snap) return send(res, 200, { data: snap, requestId: id }, id);
      const rec = store.find("workflowTasks", taskId);
      if (rec) return send(res, 200, { data: rec, requestId: id }, id);
      throw new ApiError(404, "NOT_FOUND", "工作流任务不存在");
    }
    const recent = [...store.data.workflowTasks]
      .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")))
      .slice(0, 20)
      .map((t) => ({
        id: t.id,
        name: t.name,
        status: t.status,
        query: t.input && t.input.query,
        stats: t.stats,
        durationMs: t.durationMs,
        createdAt: t.createdAt,
      }));
    return send(res, 200, { data: { tasks: recent }, requestId: id }, id);
  }

  throw new ApiError(404, "NOT_FOUND", "接口不存在");
}
async function staticFile(req, res, url, id) {
  let requestPath;
  try {
    requestPath = decodeURIComponent(url.pathname);
  } catch {
    throw new ApiError(400, "INVALID_INPUT", "无效的路径编码");
  }
  if (requestPath === "/") requestPath = "/index.html";
  if (requestPath.includes(".."))
    throw new ApiError(403, "FORBIDDEN", "禁止访问该资源");
  const isStorage = requestPath.startsWith("/storage/");
  const relative = isStorage
    ? requestPath.slice("/storage/".length)
    : requestPath.slice(1);
  // 静态资源解析顺序：storage 只查存储目录；其余先查项目根目录，再回退到 Next.js 导出产物 out/
  const bases = isStorage ? [STORAGE_DIR] : [ROOT, OUT_DIR];
  let target = null;
  let stat = null;
  for (const base of bases) {
    const candidate = path.resolve(base, relative);
    if (!candidate.startsWith(path.resolve(base))) continue;
    try {
      const s = await fs.stat(candidate);
      if (s.isFile()) {
        target = candidate;
        stat = s;
        break;
      }
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  if (!target || !stat)
    throw new ApiError(404, "NOT_FOUND", "文件不存在");
  const contentType = mime(target);
  const headers = {
    "content-type": contentType,
    "x-request-id": id,
    "x-content-type-options": "nosniff",
    "accept-ranges": "bytes",
  };
  // 开发期：HTML/JS/CSS/JSON 走 no-cache，浏览器每次回源，避免编辑页面后还在用旧版本；
  // 媒体文件用时间戳+UUID 命名（URL 不可变），保持默认启发式缓存以利 seek 复用。
  if (/text\/|application\/javascript|application\/json/.test(contentType))
    headers["cache-control"] = "no-cache";
  const rangeHeader = req.headers.range;
  // 支持 Range 请求（媒体 seek 必需），返回 206 Partial Content
  if (rangeHeader && stat.isFile()) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(String(rangeHeader));
    let start = null;
    let end = null;
    if (match) {
      start = match[1] === "" ? null : Number(match[1]);
      end = match[2] === "" ? null : Number(match[2]);
    }
    if (match && !(start === null && end === null)) {
      if (start === null) {
        start = Math.max(0, stat.size - end);
        end = stat.size - 1;
      } else {
        if (start >= stat.size) {
          res.writeHead(416, {
            "content-range": `bytes */${stat.size}`,
            ...headers,
          });
          return res.end();
        }
        if (end === null || end >= stat.size) end = stat.size - 1;
      }
      if (start > end) {
        res.writeHead(416, {
          "content-range": `bytes */${stat.size}`,
          ...headers,
        });
        return res.end();
      }
      const fd = await fs.open(target, "r");
      const buffer = Buffer.alloc(end - start + 1);
      await fd.read(buffer, 0, buffer.length, start);
      await fd.close();
      res.writeHead(206, {
        "content-range": `bytes ${start}-${end}/${stat.size}`,
        "content-length": buffer.length,
        ...headers,
      });
      return res.end(buffer);
    }
  }
  headers["content-length"] = stat.size;
  res.writeHead(200, headers);
  res.end(await fs.readFile(target));
}
const server = http.createServer(async (req, res) => {
  const id = requestId();
  stats.requests += 1;
  const started = Date.now();
  res.setHeader("access-control-allow-origin", process.env.CORS_ORIGIN || "*");
  res.setHeader("access-control-allow-methods", "GET,POST,OPTIONS");
  res.setHeader(
    "access-control-allow-headers",
    "Content-Type, Authorization, X-API-Key",
  );
  res.setHeader("x-content-type-options", "nosniff");
  res.setHeader("x-frame-options", "SAMEORIGIN");
  res.setHeader("referrer-policy", "strict-origin-when-cross-origin");
  try {
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      return res.end();
    }
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    if (url.pathname.startsWith(AI_PROXY_PREFIX))
      await proxyAiClassroom(req, res, url, id);
    else if (url.pathname.startsWith(API_PREFIX)) await api(req, res, url, id);
    else if (req.method === "GET") await staticFile(req, res, url, id);
    else
      throw new ApiError(
        405,
        "METHOD_NOT_ALLOWED",
        "仅支持 GET、POST 和 OPTIONS",
      );
    log("request", {
      id,
      method: req.method,
      path: url.pathname,
      ms: Date.now() - started,
    });
  } catch (error) {
    stats.errors += !error.status ? 1 : 0;
    if (!error.status) console.error(JSON.stringify({ time: now(), event: "unhandled", message: error.message, stack: error.stack }));
    send(res, error.status || 500, errorPayload(error, id), id);
    log("request.error", {
      id,
      method: req.method,
      status: error.status || 500,
      code: error.code || "INTERNAL_ERROR",
    });
  }
});
if (require.main === module)
  store
    .init()
    .then(() => initRag())
    .then(() =>
      server.listen(PORT, () =>
        log("server.started", { port: PORT, url: `http://localhost:${PORT}` }),
      ),
    )
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
// ── 内置种子知识库(首次启动无任何文档时自动导入, 便于开箱演示) ──
const RAG_SEED_DOCS = [
  {
    title: "Python 列表与切片的常见误区",
    category: "Python 基础",
    sourceType: "教材讲义",
    sourceLoc: "《Python 编程：从入门到实践》第 3 章",
    text: [
      "切片 Python list 的误区: 1. list[a:b] 是左闭右开, 不包含下标 b, 新手常以为包含 b。2. 负数下标从末尾数起, list[-1] 是最后一个元素。3. 切片返回的是新列表, 不是视图, 对结果排序不会影响原列表。",
      "往列表追加 vs 拼接: append 原地修改并返回 None, + 生成新列表, 若把 append 的返回值当列表用会得到 None。extend 接受可迭代对象并逐个追加。",
      "遍历时删除元素是常见陷阱: 用 for x in lst: lst.remove(x) 会跳过元素, 因为删除改变了索引。推荐用列表推导式或构造新列表, 如 [x for x in lst if x % 2 == 0]。",
    ].join("\n"),
  },
  {
    title: "二叉树遍历与递归深度",
    category: "数据结构",
    sourceType: "教材讲义",
    sourceLoc: "《算法导论》第 10 章·二叉树",
    text: [
      "二叉树三种深度优先遍历: 前序(根-左-右), 中序(左-根-右), 后序(左-右-根)。递归实现只需调整访问节点的时机即可互相转换。",
      "递归的出口与栈深度: 每次递归调用都会占用调用栈; 对极度不平衡的树(如退化成链表), 递归深度可等于节点数, 易导致栈溢出; 可用显式栈实现非递归遍历规避。",
      "求高度(深度): max(左子树高度, 右子树高度) + 1; 空节点高度为 0。判断是否平衡只需比较左右子树高度差不超过 1, 并递归检查每棵子树。",
    ].join("\n"),
  },
  {
    title: "大模型幻觉与检索增强(RAG)入门",
    category: "大模型应用",
    sourceType: "学术论文",
    sourceLoc: "Lewis et al. 2020, arXiv:2005.11401",
    text: [
      "大模型幻觉指模型生成看似合理但事实错误或凭空捏造的内容, 根源在于仅根据训练时学到的统计规律作答, 无法保证实时与领域准确性。",
      "检索增强生成(RAG): 先对用户提问做向量化, 从知识库中检索最相关的文档片段, 再把片段作为上下文拼接进提示词, 让模型基于证据作答, 从而显著降低幻觉。",
      "实现 RAG 的三要素: 文档切片, 向量化(Embedding), 相似度检索。切片避免整篇文档超出上下文; Embedding 把文本映射为向量; 检索按余弦相似度取 Top-K 片段。",
    ].join("\n"),
  },
];

async function initRag() {
  await RAG_INDEX.init();
  if (RAG_INDEX.data.documents.length === 0) {
    for (const doc of RAG_SEED_DOCS) {
      await rag.ingest(RAG_INDEX, doc.title, doc.text, doc);
      log("rag.seed_imported", { title: doc.title, category: doc.category, source: doc.sourceType });
    }
  }
  log("rag.ready", {
    documents: RAG_INDEX.data.documents.length,
    chunks: RAG_INDEX.data.chunks.length,
    embedding: process.env.QWEN_API_KEY ? "dashscope-text-embedding" : "local-fallback",
  });
}

// RAG 检索注入：命中知识库片段时返回拼接好的引用上下文(含来源)；否则返回 null
async function retrieveKnowledge(query, topK = 3) {
  try {
    if (RAG_INDEX.data.chunks.length === 0) return null;
    const hits = await rag.retrieveAsync(RAG_INDEX, query, topK);
    const relevant = hits.filter((h) => h.score > 0.001);
    if (!relevant.length) return null;
    return relevant
      .map(
        (h, i) =>
          `[片段${i + 1}] (来源: ${h.chunk.docTitle} · ${h.chunk.sourceType || "未标注"}${h.chunk.sourceLoc ? " · " + h.chunk.sourceLoc : ""})\n${h.chunk.text}`,
      )
      .join("\n\n");
  } catch (e) {
    log("rag.inject_error", { query, message: e.message });
    return null; // 检索失败不影响正常生成
  }
}

// ══════════════ 智能工作流编排(DAG 引擎) ══════════════
// 流程以 JSON 数据描述(节点+条件边), 引擎按依赖就绪度并发调度;
// 执行器包装既有业务函数(generateScript/createSlideTTS/retrieveKnowledge…), 零重复实现。
const { WorkflowEngine, validateDef: validateWorkflowDef } = require("./workflow");
const WORKFLOW_ENGINE = new WorkflowEngine();
const WORKFLOW_TASKS = new Map(); // taskId → 运行快照(内存优先, 终态同步落库)

// 执行器: 知识库检索(RAG)
WORKFLOW_ENGINE.register("rag_search", async (node, ctx) => {
  const topK = Math.min(Math.max(Number(node.params && node.params.topK) || 3, 1), 8);
  const context = await retrieveKnowledge(ctx.input.query, topK);
  return {
    summary: context ? "命中知识片段, 已注入讲稿生成" : "未命中, 空手生成",
    output: { context: context || "" },
  };
});

// 执行器: 生成讲稿幻灯片(复用 generateScript; 支持拼接上游 RAG 上下文)
WORKFLOW_ENGINE.register("llm_script", async (node, ctx) => {
  const ragFrom = node.params && node.params.ragFrom;
  const ragOut = ragFrom ? ctx.getOutput(ragFrom) : null;
  const ragCtx = ragOut && typeof ragOut.context === "string" ? ragOut.context : "";
  let persona = String(ctx.input.persona || "");
  if (ragCtx)
    persona = (persona ? persona + "\n\n" : "") + "教学参考知识片段(优先依据其事实讲解):\n" + ragCtx;
  const result = await generateScript(ctx.input.query, persona, ctx.input.style || "");
  return {
    summary: `${result.slides.length} 页幻灯片 · ${result.fullText.length} 字讲稿`,
    output: { slides: result.slides, fullText: result.fullText },
  };
});

// 执行器: 逐页语音合成(复用 createSlideTTS)
WORKFLOW_ENGINE.register("slide_tts", async (node, ctx) => {
  const slidesFrom = node.params && node.params.slidesFrom;
  const src = (slidesFrom ? ctx.getOutput(slidesFrom) : null) || {};
  const slides = src.slides || [];
  if (!slides.length) throw Object.assign(new Error("上游未产出幻灯片"), { status: 422 });
  const slideAudio = await createSlideTTS(slides);
  const voiced = slideAudio.filter((a) => a && a.url).length;
  return { summary: `${voiced}/${slides.length} 页完成配音`, output: { slideAudio } };
});

// 执行器: 发布课件任务(与 /video/generate 产物同构, watch.html 可直接播放)
WORKFLOW_ENGINE.register("publish_video", async (node, ctx) => {
  const p = node.params || {};
  const src = (p.from ? ctx.getOutput(p.from) : null) || {};
  const ttsOut = (p.ttsFrom ? ctx.getOutput(p.ttsFrom) : null) || {};
  const slides = src.slides || [];
  const slideAudio = ttsOut.slideAudio || [];
  const taskId = requestId();
  await store.add("videoTasks", {
    id: taskId,
    query: ctx.input.query,
    style: ctx.input.style || "",
    slides,
    slideAudio,
    audioUrl: null,
    images: {},
    fullText: src.fullText || "",
    status: "slides_ready",
    progress: 100,
    pagesTotal: slides.length,
    pagesDone: slideAudio.filter((a) => a && a.url).length,
    source: "workflow",
    createdAt: now(),
    updatedAt: now(),
  });
  return {
    summary: `课件任务 ${taskId} 已发布`,
    output: { taskId, url: `/watch.html?task_id=${taskId}&q=${encodeURIComponent(ctx.input.query)}` },
  };
});

// 执行器: 失败降级分支(占位通知, 便于演示条件边)
WORKFLOW_ENGINE.register("error_notice", async (node) => ({
  summary: (node.params && node.params.message) || "已进入降级分支",
  output: { degraded: true },
}));

// 内置工作流模板: 课件视频生成(检索→讲稿→配音→发布, 含失败降级条件边)
const WORKFLOW_TEMPLATES = [
  {
    id: "course-video",
    name: "AI 课件视频生成",
    description: "知识库检索(RAG) → 生成讲稿幻灯片 → 逐页语音合成 → 发布课件",
    icon: "🎬",
    fields: [
      { key: "query", label: "教学主题", placeholder: "如: 二叉树的遍历", required: true },
      { key: "persona", label: "个性化人设", placeholder: "学生昵称/年级/目标(可选)" },
      { key: "style", label: "视觉风格", placeholder: "如: 简约蓝(可选)" },
    ],
    def: {
      nodes: [
        { id: "rag_search", type: "rag_search", name: "知识库检索" },
        {
          id: "script",
          type: "llm_script",
          name: "生成讲稿幻灯片",
          params: { ragFrom: "rag_search", retry: 1 },
        },
        { id: "tts", type: "slide_tts", name: "逐页语音合成", params: { slidesFrom: "script" } },
        {
          id: "publish",
          type: "publish_video",
          name: "发布课件任务",
          params: { from: "script", ttsFrom: "tts" },
        },
        { id: "fallback", type: "error_notice", name: "失败降级", params: { message: "生成失败, 已记录错误日志" } },
      ],
      edges: [
        { from: "rag_search", to: "script", when: "always" },
        { from: "script", to: "tts", when: "success" },
        { from: "tts", to: "publish", when: "success" },
        { from: "script", to: "fallback", when: "error" },
        { from: "tts", to: "fallback", when: "error" },
      ],
    },
  },
];

// 事件回写: 更新内存快照, 终态节点同步持久化(轮询接口读内存, 重启后可读库)
function workflowEventSink(taskId) {
  return (e) => {
    const snap = WORKFLOW_TASKS.get(taskId);
    if (!snap) return;
    if (e.nodeId) {
      const prev = snap.nodes[e.nodeId] || {};
      snap.nodes[e.nodeId] = { ...prev, name: e.name || prev.name, state: prevState(e), durationMs: e.durationMs ?? prev.durationMs, summary: e.summary ?? prev.summary, error: e.error ?? prev.error, output: e.output ?? prev.output };
      if (e.type === "node_done" && e.output && e.output.url) snap.resultUrl = e.output.url;
    }
    if (e.type === "workflow_done") {
      snap.status = e.status;
      snap.stats = e.stats;
      snap.durationMs = e.durationMs;
      WORKFLOW_TASKS.set(taskId, snap);
      store.update("workflowTasks", taskId, snapshotForStore(snap)).catch(() => {});
      log("workflow.done", { taskId, status: e.status, stats: e.stats });
      return;
    }
    WORKFLOW_TASKS.set(taskId, snap);
    store.update("workflowTasks", taskId, snapshotForStore(snap)).catch(() => {});
  };
}

function prevState(e) {
  return {
    node_start: "running",
    node_done: "success",
    node_error: "error",
    node_skipped: "skipped",
    node_retry: "running",
  }[e.type] || "pending";
}

// 落库裁剪: 保留状态/摘要, 去掉大体量输出(slides 全文不入 workflowTasks, 产物已存 videoTasks)
function snapshotForStore(snap) {
  const nodes = {};
  for (const [nid, n] of Object.entries(snap.nodes)) {
    const output =
      n.output && typeof n.output === "object" && Array.isArray(n.output.slides)
        ? { slidesCount: n.output.slides.length }
        : n.output;
    nodes[nid] = { ...n, output };
  }
  return { status: snap.status, stats: snap.stats, durationMs: snap.durationMs, resultUrl: snap.resultUrl, nodes, updatedAt: now() };
}

// 非流式调用 Qwen 生成「基于检索上下文的回答」(零依赖, DashScope 兼容端点)
async function ragAskLLM(context, query, history = []) {
  const apiKey = process.env.QWEN_API_KEY;
  const model = process.env.QWEN_CHAT_MODEL || "qwen-max";
  const system =
    "你是「栈知映」助教的学科知识问答助手。请严格基于给定的「参考知识片段」作答, 用中文、结构清晰;\n" +
    "1. 尽量引用参考片段中的事实, 不要脱离片段臆造;\n" +
    "2. 若片段不足以回答, 明确说明「知识库中没有相关内容」, 再给出通用性建议;\n" +
    "3. 用 Markdown: 公式用 $$/$ , 代码块标注语言, 适度使用列表与表格;\n" +
    "4. 多轮对话时, 追问只针对最新问题深入, 不要重复已讲内容;\n" +
    "5. 结尾不要添加「以上内容仅供参考」之外的多余免责声明。";
  const safeHistory = (Array.isArray(history) ? history : [])
    .slice(-6)
    .map((h) => ({
      role: String(h.role) === "assistant" ? "assistant" : "user",
      content: String(h.content ?? "").slice(0, 2000),
    }))
    .filter((h) => h.content);
  const user =
    "参考知识片段:\n\"\"\"\n" + context + "\n\"\"\"\n\n用户提问:\n" + query;
  const messages = [
    { role: "system", content: system },
    ...safeHistory,
    { role: "user", content: user },
  ];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120000);
  try {
    const res = await fetch(
      "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages,
          max_tokens: 2048,
          temperature: 0.3,
          stream: false,
        }),
        signal: controller.signal,
      },
    );
    if (!res.ok) {
      const txt = await res.text();
      throw new ApiError(502, "PROVIDER_ERROR", `Qwen ${res.status}: ${txt.slice(0, 300)}`);
    }
    const data = await res.json();
    const content =
      data?.choices?.[0]?.message?.content ||
      (() => {
        throw new Error("Qwen 未返回内容");
      })();
    return content;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = {
  server,
  store,
  cleanText,
  generateQuestions,
  buildLessonPlan,
  grade,
  encryptSensitive,
  parseLLMJson,
};
