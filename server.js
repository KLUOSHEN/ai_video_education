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

loadEnv(path.join(__dirname, ".env"));
const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const DATA_DIR = path.resolve(
  process.env.APP_DATA_DIR || path.join(ROOT, "data"),
);
const STORAGE_DIR = path.resolve(
  process.env.APP_STORAGE_DIR || path.join(ROOT, "storage"),
);
const STORE_FILE = path.join(DATA_DIR, "store.json");
const API_PREFIX = "/api/v1";
const MAX_BODY_BYTES = 64 * 1024;
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
      questions: [],
      attempts: [],
      mistakes: [],
      diagnostics: [],
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
function parseLLMJson(raw) {
  const cleaned = String(raw || "")
    .replace(/```json\n?|\n?```/g, "")
    .trim();
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
      throw new ApiError(413, "PAYLOAD_TOO_LARGE", "请求体不能超过 64KB");
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
async function generateSlides(query, persona) {
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
    const prompt = `你是一名资深计算机科学教育专家，也是顶尖的教学 PPT 视觉设计师。请严格参考下列视觉样例，为知识点"${query}"生成 6-8 页 HTML 教学幻灯片，整体风格必须与参考样例保持高度一致。

参考样例风格（必须遵循）：
- 整体背景：浅灰/白色柔和背景，幻灯片主体为圆角白色卡片，带有细微阴影
- 页面标题：居中或顶部，使用深蓝色（#1e3a8a）粗体大字，简洁有力
- 副标题：标题下方，使用灰色（#64748b）中等字号，补充说明本页核心问题
- 主体布局：优先采用【左侧文字说明 + 右侧可视化图表】的 two_col 结构；也可用 split 做左右对比、bottom_bar 在底部加蓝色强调条
- 左侧文字：用小标题（深蓝粗体）+ 1-3 行说明文字（深灰 #334155），信息密度高但不拥挤
- 右侧图表：必须出现 line_chart（折线图）、bar_chart（柱状图）、table（表格）、complexity_curve（复杂度曲线）、array（数组状态图）等可视化，配色为蓝(#4a8eff)、绿(#22c55e)、橙(#f59e0b)、红(#ef4444) 等专业色系
- 底部：若使用 bottom_bar 布局，底部必须是蓝色渐变强调条，内含一句关键结论（15 字以内），左侧可配小圆点或图标
- 视觉元素：每页至少 3 个 visual，必须包含 1 个主 diagram + 2 个辅助 visuals（如 highlight/list/table/formula/quote/badge），避免页面空旷
- 字体：中文使用微软雅黑/思源黑体，标题 28-32px，正文 14-16px，小标签 12px
- 强调：关键术语用蓝色高亮，重要数字用加粗或彩色，结论用卡片/阴影框突出

输出格式（必须是合法 JSON，不要任何 JSON 之外的内容）：
{"slides":[{"title":"深蓝大标题","subtitle":"灰色副标题","text":"120-180 字中文讲解，口语化但信息密集，必须具体到公式、数字和关键步骤，像老师授课一样把公式读出来","layout":"two_col / split / bottom_bar / triple / left_text / default","left":"左侧内容：3-5 个要点或定义，每行一个，要点必须具体（含公式/数字/术语）","right":"右侧内容：图表数据或表格，data 格式见下","bottom":"底部蓝色强调条文字（15 字以内）","visuals":[{"type":"list/table/formula/highlight/quote/badge/code","data":"对应数据，code 类型时 data 为代码文本并配 lang 字段指定语言","caption":"说明文字"}],"diagram":{"type":"line_chart / bar_chart / complexity_curve / array / flow / tree / compare","data":"对应数据","caption":"图表下方说明"}}]}

页面规划（共 6-8 页；第 4、6 页由知识点性质决定，其余各页按顺序覆盖）：
1. 概述引入：明确定义（含严谨表述）+ 为什么重要（2-3 个理由）+ 2-3 个具体应用场景
2. 核心概念：关键术语逐一解释 + 通俗类比 + 结构图
3. 原理推导：深入逻辑链 + 步骤流程图，每一步配一句"为什么这么做"的说明
4. 【算法/编程类知识点】算法/公式：给出完整伪代码（含注释）+ 核心公式（明确每个符号的含义与推导来源）+ 逐行解释；【理论/概念类知识点】核心机制详解：逐步拆解工作流程/协议步骤/状态转换，配流程图、状态图或时序图
5. 实例演示：用具体数值或真实场景示例分步演算，每一步展示状态变化，务必给出数字和计算结果
6. 【算法/编程类知识点】复杂度分析：时间/空间复杂度，写明每个复杂度的含义、适用场景与推导过程 + 复杂度曲线图；【理论/概念类知识点】常见问题与易错点：高频疑问、易混淆概念辨析、典型踩坑案例（用对比表、状态图、FAQ 列表表达，不得生硬套用时间复杂度公式）
7. 对比辨析：与其他方案/方案的横向对比表，每行注明关键差异
8. 总结回顾：要点清单（含核心公式与关键数字，如涉及）+ 面试考点 + 底部蓝色结论条

布局使用规则：
- two_col：左文字要点 + 右 diagram 图表（最常用）
- split：左右两栏对比，每栏都有小标题和要点
- bottom_bar：在页面底部增加蓝色渐变强调条，用于结论页或重点页
- triple：顶部标题 + 下方左中右三卡片，每张卡片含小标题、图标、要点
- left_text：左侧文字 + 右侧多个小 visuals 组合
- default：单栏居中，仅用于开篇或结尾封面

数据格式约定：
- table: 用 | 分隔列，\\n 分隔行，如 "维度|时间|空间\\n最优|O(1)|O(1)\\n最差|O(n)|O(n)"
- list: 每行以 - 开头，如 "- 原地排序\\n- 稳定排序"
- formula: LaTeX 风格字符串，可含推导过程与符号说明，如 "T(n)=2T(n/2)+O(n)" 或 "T(n) = O(n log n)，n 为数据规模"
- code: 代码或伪代码，data 为代码文本（含注释，逐行换行），另配 lang 字段指定语言（如 "python" / "java" / "c" / "pseudocode"）
- highlight: 一句核心结论，如 "空间复杂度为 O(1)，适合内存受限场景"
- quote: 一句关键提示或面试口诀
- badge: 逗号分隔关键词，如 "原地,稳定,分治,递归"
- line_chart/bar_chart: 用 "x1,y1;x2,y2;x3,y3" 或 "标签1:5|标签2:8|标签3:3"
- complexity_curve: 多组 "O(1)=1,4,16,64,256;O(n)=1,4,16,64,256;O(n²)=1,16,256,1024,4096"，横坐标点为 n=1,4,16,64,256
- array: 数组状态图，如 "5,2,8,1,9|0,2" 表示数组和选中下标
- flow: 流程图，用 -> 连接，如 "输入 -> 分治 -> 合并 -> 输出"
- tree: 树形结构，用缩进 / 或 -> 表示层级
- compare: 对比表格，格式同 table

硬性要求：
1. 每页必须包含主 diagram + 至少 2 个辅助 visuals，保证画面充实饱满
2. 优先用图表、表格、数组状态图表达，避免大段纯文字
3. 配色严格参考样例：深蓝 #1e3a8a 标题、浅蓝 #dbeafe 背景点缀、深灰 #334155 正文、彩色图表
4. 每页内容密度要高，但排版清晰、留白合理，适合 PPT 演示
5. 文字简洁有力，避免口语化废话，标题和要点使用术语化表达
6. 涉及算法/公式/复杂度的页面，公式必须具体完整（如 T(n)=2T(n/2)+O(n)），并逐项解释每个符号的含义；禁止只写"时间复杂度为 O(n)"这类笼统表述。纯理论/概念类知识点（如 TCP 握手、进程与线程、数据库事务等）不得生硬套用时间复杂度公式，改用流程图、状态图、对比表、FAQ 表达
7. 实例演示必须用具体数字逐步演算（如对数组 [5,2,8,1,9] 的每一轮操作都给出中间结果和计算结果）；禁止泛泛描述流程
8. text 字段必须充实具体（120-180 字），把公式读出来、把演算过程讲出来，涵盖定义、关键公式、数字实例，使讲解像真实课堂一样有内容
9. 算法/公式、实例演示、复杂度分析页（第 4/5/6 页）必须各包含至少 1 个 formula 类型的 visual 或 diagram（仅当知识点涉及算法/公式/复杂度时；纯理论/概念类页面改用流程/状态/对比图，不强求 formula）；公式用 KaTeX 可渲染的 LaTeX 书写（下标用 _、上标用 ^、分数用 \\frac、根号用 \\sqrt，如 T(n)=2T(n/2)+O(n)、O(n\\log n)、\\frac{n(n-1)}{2}）
10. 涉及公式的页面，text 讲解中必须把公式完整读一遍（如"由递推式 T(n)=2T(n/2)+O(n) 解得 T(n)=O(n log n)"），并在 visuals 中用公式卡片呈现推导过程
11. 代码是否生成取决于知识点本身的性质：若知识点与编程实现相关（算法、数据结构、编程语言、代码语法、排序、查找、遍历等），则算法/公式页与实例演示页应包含带注释的 code 代码块（配 lang 字段），并与公式、实例一一对应；若知识点是纯理论或概念类（如 TCP 三次握手、进程与线程、数据库事务、网络协议等），则不强求代码，改用流程图、对比表、状态图表达核心逻辑`;
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
    return json.slides;
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

async function generateScript(query, persona) {
  const slides = await generateSlides(query, persona);
  return {
    slides,
    fullText: slides.map((s) => `${s.title}。${s.text}`).join(""),
  };
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
    complexity_curve: "复杂度曲线",
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
  const messages = [
    { role: "system", content: system },
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
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || 'sk-1f66972771c14d0f82a9a7507f62e190';
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
    const taskId = requestId();
    await store.add("videoTasks", {
      id: taskId,
      query: text,
      slides: [],
      audioUrl: null,
      status: "queued",
      progress: 0,
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
        await store.update("videoTasks", taskId, {
          status: "generating",
          progress: 20,
        });
        const result = await generateScript(text, persona);
        slides = result.slides;
        fullText = result.fullText || "";
        await store.update("videoTasks", taskId, {
          slides,
          fullText,
          progress: 50,
          status: "generating_tts",
        });
        // 逐页合成语音：每页一段音频，语音与 PPT 文字逐页严格一致
        const slideAudio = await createSlideTTS(slides);
        await store.update("videoTasks", taskId, {
          slideAudio,
          audioUrl: null,
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
          slides: videoTask.slides,
          query: videoTask.query,
          progress: videoTask.progress || 0,
          ...(videoTask.error ? { error: videoTask.error } : {}),
        },
        requestId: id,
      },
      id,
    );
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
  throw new ApiError(404, "NOT_FOUND", "接口不存在");
}
async function staticFile(req, res, url, id) {
  let requestPath;
  try {
    requestPath = decodeURIComponent(url.pathname);
  } catch {
    throw new ApiError(400, "INVALID_INPUT", "无效的路径编码");
  }
  if (requestPath === "/") requestPath = "/search.html";
  if (requestPath.includes(".."))
    throw new ApiError(403, "FORBIDDEN", "禁止访问该资源");
  const base = requestPath.startsWith("/storage/") ? STORAGE_DIR : ROOT;
  const relative = requestPath.startsWith("/storage/")
    ? requestPath.slice("/storage/".length)
    : requestPath.slice(1);
  const target = path.resolve(base, relative);
  if (!target.startsWith(path.resolve(base)))
    throw new ApiError(403, "FORBIDDEN", "禁止访问该资源");
  let stat;
  try {
    stat = await fs.stat(target);
  } catch (error) {
    if (error.code === "ENOENT")
      throw new ApiError(404, "NOT_FOUND", "文件不存在");
    throw error;
  }
  if (stat.isDirectory()) throw new ApiError(404, "NOT_FOUND", "目录不可访问");
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
    if (url.pathname.startsWith(API_PREFIX)) await api(req, res, url, id);
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
    .then(() =>
      server.listen(PORT, () =>
        log("server.started", { port: PORT, url: `http://localhost:${PORT}` }),
      ),
    )
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
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
