'use strict';
/**
 * rag.js — 检索增强生成(RAG)模块(零第三方 npm 依赖)
 *
 * 职责:
 *   1. 文档切片: 将讲义/教材等长文本按段落切分为定长、带重叠的 chunk
 *   2. 向量化:    调用阿里云百炼 DashScope text-embedding 生成 chunk 向量;
 *                未配置 QWEN_API_KEY 时降级为本地字符 n-gram 哈希向量(演示/离线可用)
 *   3. 检索:      对用户提问做相同向量化, 余弦相似度取 Top-K 片段
 *   4. 持久化:    文档与向量索引落盘到 data/rag-index.json(与 store.json 分离, 避免膨胀)
 *
 * 端点配套见 server.js 中 /knowledge/* 路由。
 */
const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || 'text-embedding-v4';
const EMBEDDING_ENDPOINT =
  'https://dashscope.aliyuncs.com/compatible-mode/v1/embeddings';

// 本地降级向量维度(仅无 Key 时使用); 真实 embedding 维度由模型决定
const LOCAL_DIM = 256;
const CHUNK_SIZE = 400; // 目标每个 chunk 字符数
const CHUNK_OVERLAP = 40; // chunk 之间重叠字符数

/* ───────────────────────── 持久化 ───────────────────────── */

/**
 * 向量二进制格式(rag-index.vectors.bin):
 *   [u32 向量数量 N]
 *   重复 N 次: [u32 dim][float32 * dim]
 */
function serializeVectors(vectors) {
  let size = 4;
  for (const v of vectors) size += 4 + v.length * 4;
  const buf = Buffer.alloc(size);
  buf.writeUInt32LE(vectors.length, 0);
  let off = 4;
  for (const v of vectors) {
    buf.writeUInt32LE(v.length, off);
    off += 4;
    for (let i = 0; i < v.length; i++) {
      buf.writeFloatLE(v[i], off);
      off += 4;
    }
  }
  return buf;
}

function parseVectors(buf) {
  if (buf.length < 4) return [];
  const n = buf.readUInt32LE(0);
  const vectors = new Array(n);
  let off = 4;
  for (let i = 0; i < n; i++) {
    const dim = buf.readUInt32LE(off);
    off += 4;
    const v = new Float32Array(dim);
    for (let j = 0; j < dim; j++) {
      v[j] = buf.readFloatLE(off);
      off += 4;
    }
    vectors[i] = v;
  }
  return vectors;
}

class RagIndex {
  constructor(file) {
    this.file = file;
    this.vecFile = file.replace(/\.json$/, '.vectors.bin');
    this.data = { documents: [], chunks: [] };
    this.vectors = []; // Float32Array[]，与 chunks 顺序一一对应(vIndex)
    this.writeQueue = Promise.resolve();
  }
  async init() {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    try {
      const raw = await fs.readFile(this.file, 'utf8');
      const parsed = JSON.parse(raw);
      this.data = {
        documents: Array.isArray(parsed.documents) ? parsed.documents : [],
        chunks: Array.isArray(parsed.chunks) ? parsed.chunks : [],
      };
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
      await this.persist();
      return;
    }
    // 加载向量
    try {
      const vbuf = await fs.readFile(this.vecFile);
      this.vectors = parseVectors(vbuf);
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
      // 无向量文件: 用旧的稀疏 embedding 重建二进制, 并补齐/重排 vIndex
      this.vectors = this.data.chunks.map((c) =>
        c.embedding
          ? Float32Array.from(toDense(c.embedding, c.embedding.dim))
          : null,
      );
      if (this.vectors.every((v) => v)) {
        this.data.chunks.forEach((c, i) => {
          c.vIndex = i;
          delete c.embedding;
        });
        await this.persist();
      } else {
        // 极旧格式无任何向量: 置空
        this.vectors = [];
      }
    }
  }
  persist() {
    this.writeQueue = this.writeQueue.then(() =>
      Promise.all([
        fs.writeFile(this.file, JSON.stringify(this.data), 'utf8'),
        fs.writeFile(this.vecFile, serializeVectors(this.vectors)),
      ]),
    );
    return this.writeQueue;
  }
}

/* ───────────────────────── 切片 ───────────────────────── */

/**
 * 将长文本切分为带重叠的片段。
 * 优先按换行/句号/逗号等自然边界切，避免切开句子。
 */
function chunkText(text) {
  const clean = String(text || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!clean) return [];
  // 先按句读边界(。！？；!?;\n)粗分，再按 CHUNK_SIZE 合并
  const sentences = clean
    .split(/(?<=[。！？；!?;])|(?<=\n)/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const chunks = [];
  let buf = '';
  for (const s of sentences) {
    // 单句过长时内部再硬切
    if (s.length > CHUNK_SIZE) {
      if (buf) { chunks.push(buf); buf = ''; }
      for (let i = 0; i < s.length; i += CHUNK_SIZE - CHUNK_OVERLAP) {
        chunks.push(s.slice(i, i + CHUNK_SIZE));
      }
      continue;
    }
    if ((buf + s).length > CHUNK_SIZE) {
      chunks.push(buf);
      buf = s;
    } else {
      buf += s;
    }
  }
  if (buf) chunks.push(buf);
  return chunks;
}

/* ───────────────────────── 向量化 ───────────────────────── */

/** 本地降级向量: 字符二元组哈希 → 归一化向量(固定维度, 无需 Key 也能跑通) */
function localEmbed(text) {
  const vec = new Array(LOCAL_DIM).fill(0);
  const s = String(text || '').toLowerCase();
  const grams = [];
  for (let i = 0; i < s.length; i++) grams.push(s[i]);
  for (let i = 0; i + 1 < s.length; i++) grams.push(s.slice(i, i + 2));
  for (const g of grams) {
    const h = crypto.createHash('sha1').update(g).digest()[0] % LOCAL_DIM;
    vec[h] += 1;
  }
  // 归一化(余弦要求单位向量)
  let norm = 0;
  for (let i = 0; i < LOCAL_DIM; i++) norm += vec[i] * vec[i];
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < LOCAL_DIM; i++) vec[i] /= norm;
  return vec;
}

/** 真实 embedding: 调用 DashScope text-embedding(批量)。失败抛错。 */
async function remoteEmbed(batch) {
  const apiKey = process.env.QWEN_API_KEY;
  if (!apiKey) throw new Error('未配置 QWEN_API_KEY，无法调用真实 embedding');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 90000);
  try {
    const res = await fetch(EMBEDDING_ENDPOINT, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: EMBEDDING_MODEL,
        input: batch,
        encoding_format: 'float',
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`embedding ${res.status}: ${text.slice(0, 400)}`);
    }
    const data = await res.json();
    const embeds = Array.isArray(data.data) ? data.data : [];
    const byIndex = new Map(embeds.map((e) => [e.index, e.embedding]));
    return batch.map((_, i) => byIndex.get(i) || null);
  } finally {
    clearTimeout(timer);
  }
}

/** 向量化一组文本: 有 Key 走真实 embedding(分小批并行), 否则降级本地向量。 */
async function embedTexts(texts) {
  const useRemote = !!process.env.QWEN_API_KEY;
  if (!useRemote) return texts.map(localEmbed);
  const BATCH = 10; // DashScope text-embedding 单次批量上限
  const CONCURRENCY = 4; // 并行批次数(避免限流又显著提速)
  // 先按批次切分, 保留顺序
  const slices = [];
  for (let i = 0; i < texts.length; i += BATCH) slices.push(texts.slice(i, i + BATCH));
  const result = new Array(texts.length);
  let next = 0;
  async function worker() {
    while (next < slices.length) {
      const idx = next++;
      const vecs = await remoteEmbed(slices[idx]);
      for (const v of vecs) if (!v) throw new Error('embedding 返回不完整，请检查模型支持 text-embedding');
      // 按原文本下标回填
      const start = idx * BATCH;
      for (let k = 0; k < vecs.length; k++) result[start + k] = vecs[k];
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, slices.length) }, () => worker()),
  );
  return result;
}

/* ───────────────────────── 检索 ───────────────────────── */

/** 计算两个向量的余弦相似度(支持 Float32Array / Array)。 */
function cosine(a, b) {
  const len = Math.max(a.length, b.length);
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < len; i++) {
    const av = i < a.length ? a[i] : 0;
    const bv = i < b.length ? b[i] : 0;
    dot += av * bv;
    na += av * av;
    nb += bv * bv;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

/** 旧格式迁移用: 稀疏 → 稠密数组(仅读取旧索引时调用)。 */
function toDense(sparse, dim) {
  const d = dim || 0;
  const arr = new Array(d).fill(0);
  const vals = (sparse && sparse.values) || {};
  Object.keys(vals).forEach((k) => {
    const idx = Math.min(Number(k), d - 1);
    if (idx >= 0) arr[idx] = vals[k];
  });
  return arr;
}

/* ───────────────────────── 文档管理 ───────────────────────── */

/** 入库：切片 + 向量化 + 持久化。meta 可含 category / sourceType / sourceLoc 等结构化信息。 */
async function ingest(index, title, text, meta = {}) {
  const chunks = chunkText(text);
  if (!chunks.length)
    throw Object.assign(new Error('文档内容为空，无法入库'), { status: 422 });
  const vectors = await embedTexts(chunks);
  const doc = {
    id: crypto.randomUUID(),
    title: String(title || '未命名知识').slice(0, 128),
    category: String(meta.category || '').slice(0, 32),
    sourceType: String(meta.sourceType || '').slice(0, 32),
    sourceLoc: String(meta.sourceLoc || '').slice(0, 64),
    chunkCount: chunks.length,
    charCount: String(text).length,
    createdAt: new Date().toISOString(),
  };
  const newChunks = [];
  for (let i = 0; i < chunks.length; i++) {
    const vec = Float32Array.from(vectors[i]);
    const vIndex = index.vectors.length;
    index.vectors.push(vec);
    newChunks.push({
      id: crypto.randomUUID(),
      docId: doc.id,
      docTitle: doc.title,
      category: doc.category,
      sourceType: doc.sourceType,
      sourceLoc: doc.sourceLoc,
      index: i,
      text: chunks[i],
      vIndex,
    });
  }
  index.data.documents.push(doc);
  index.data.chunks.push(...newChunks);
  await index.persist();
  return doc;
}

async function removeDoc(index, id) {
  const before = index.data.documents.length;
  index.data.documents = index.data.documents.filter((d) => d.id !== id);
  // 重建 chunks 与 vectors 的一一对应(删除目标文档的所有向量并重排 vIndex)
  const kept = index.data.chunks.filter((c) => c.docId !== id);
  const keptVectors = kept.map((c) => index.vectors[c.vIndex]);
  kept.forEach((c, i) => { c.vIndex = i; });
  index.data.chunks = kept;
  index.vectors = keptVectors;
  if (index.data.documents.length === before) return false;
  await index.persist();
  return true;
}

/* ───────────────────────── 异步检索(供路由用) ───────────────────────── */

/** 异步向量化提问并检索(真实/本地 embedding 二选一并保持一致)。入口统一走这里。 */
async function retrieveAsync(index, query, topK = 4) {
  // 与入库一致的 embedding 通道
  const vec = (await embedTexts([String(query || '')]))[0];
  const qvec = Float32Array.from(vec);
  const scored = index.data.chunks.map((c) => {
    const cvec = index.vectors[c.vIndex];
    return {
      chunk: c,
      score: cvec ? cosine(qvec, cvec) : 0,
    };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK);
}

module.exports = {
  RagIndex,
  chunkText,
  embedTexts,
  localEmbed,
  retrieveAsync,
  ingest,
  removeDoc,
};