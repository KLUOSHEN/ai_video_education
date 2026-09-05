'use strict';
/**
 * 栈知映 · 技能树 —— 精简静态服务器(零第三方依赖)
 * 运行: node server.js  或  npm start
 * 页面: http://localhost:3000/skilltree.html
 * 生成: http://localhost:3000/generate.html (调用 AI 生成技能树)
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT) || 3000;
const ROOT = __dirname;

// DeepSeek API 配置(可用环境变量覆盖)
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || '';
const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash';
const DEEPSEEK_BASE = (process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com').replace(/\/$/, '');
const DEEPSEEK_ENDPOINT = DEEPSEEK_BASE + '/chat/completions';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 1e6) { reject(new Error('请求体过大')); req.destroy(); }
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

// 生成技能树的 system prompt(依据 skill-tree-generator 字段规范)
function buildSystemPrompt() {
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

function buildUserPrompt(topic, goal) {
  let p = '请为以下学习方向生成一棵完整的技能树:\n\n学习方向/主题:' + topic;
  if (goal) p += '\n学习目标(职业/项目/兴趣):' + goal;
  p += '\n\n要求:节点 20~30 个，严格由浅入深，每个节点 17 个字段完整、质量合格，直接输出 JSON。';
  return p;
}

// 调用 DeepSeek API
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
      body: JSON.stringify({
        model: DEEPSEEK_MODEL,
        messages: messages,
        temperature: 0.7,
        stream: false,
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error('DeepSeek API HTTP ' + response.status + ': ' + text.slice(0, 600));
    }
    const data = await response.json();
    const content = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    if (!content) throw new Error('DeepSeek API 未返回内容: ' + JSON.stringify(data).slice(0, 400));
    return content;
  } finally {
    clearTimeout(timer);
  }
}

// 从 AI 返回文本中解析出 JSON 对象
function parseTreeJson(text) {
  const s = String(text).trim();
  try { return JSON.parse(s); } catch (e) { /* 尝试提取 */ }
  const m = s.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('AI 返回内容中未找到 JSON 对象');
  return JSON.parse(m[0]);
}

// 生成技能树端点
async function handleGenerateTree(req, res) {
  try {
    const raw = await readBody(req);
    let input = {};
    try { input = JSON.parse(raw || '{}'); } catch (e) { /* 忽略空 body */ }
    const topic = String(input.topic || '').trim();
    if (!topic) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ error: '请提供学习方向(topic)' }));
    }
    const goal = String(input.goal || '').trim();
    console.log('[generate] 主题:', topic, '| 目标:', goal || '(无)');
    const content = await callDeepSeek([
      { role: 'system', content: buildSystemPrompt() },
      { role: 'user', content: buildUserPrompt(topic, goal) },
    ]);
    const tree = parseTreeJson(content);
    const nodeCount = (tree.nodes && tree.nodes.length) || 0;
    console.log('[generate] 完成，节点数:', nodeCount);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(tree));
  } catch (err) {
    console.error('[generate] 失败:', err.message || err);
    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: err.message || String(err) }));
  }
}

// 静态文件服务
function serveStatic(req, res, pathname) {
  if (pathname === '/') pathname = '/skilltree.html';
  if (pathname.includes('..')) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Forbidden');
  }
  const filePath = path.resolve(ROOT, '.' + pathname);
  if (filePath !== ROOT && !filePath.startsWith(ROOT + path.sep)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Forbidden');
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('404 文件不存在: ' + pathname);
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    let pathname;
    try { pathname = decodeURIComponent(url.pathname); }
    catch (e) {
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Bad Request');
    }
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      return res.end();
    }
    if (pathname === '/api/v1/generate-tree' && req.method === 'POST') {
      return handleGenerateTree(req, res);
    }
    if (req.method === 'GET') {
      return serveStatic(req, res, pathname);
    }
    res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Method Not Allowed');
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Internal Server Error');
  }
});

server.listen(PORT, () => {
  console.log('技能树服务已启动');
  console.log('  浏览: http://localhost:' + PORT + '/skilltree.html');
  console.log('  生成: http://localhost:' + PORT + '/generate.html');
  console.log('  按 Ctrl+C 停止');
});
