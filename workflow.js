/**
 * workflow.js — 零依赖 DAG 工作流引擎
 *
 * 设计目标: 把 server.js 中硬编码的多步异步流水线改造为「数据驱动」的工作流。
 * - 工作流 = JSON 描述的节点(nodes) + 条件边(edges) 构成的有向无环图
 * - 引擎按依赖就绪度调度: 每一轮收集「依赖全部到达终态且至少一条入边被触发」的节点并发执行
 * - 边条件 when: "success"(默认, 上游成功) | "error"(上游失败) | "always"(成功或失败均触发)
 * - 节点状态机: pending → running → success | error;  不可达节点标记 skipped
 * - 执行器(executor)由宿主(server.js)注册, 复用现有业务函数, 引擎不感知业务
 */

"use strict";

const NODE_STATES = ["pending", "running", "success", "error", "skipped"];

class WorkflowError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/** 校验工作流定义: 结构完整性、引用完整性、无环 */
function validateDef(def) {
  if (!def || typeof def !== "object") throw new WorkflowError("INVALID_DEF", "工作流定义必须为对象");
  const nodes = Array.isArray(def.nodes) ? def.nodes : [];
  const edges = Array.isArray(def.edges) ? def.edges : [];
  if (!nodes.length) throw new WorkflowError("INVALID_DEF", "工作流至少需要一个节点");
  const ids = new Set();
  for (const n of nodes) {
    if (!n.id || typeof n.id !== "string") throw new WorkflowError("INVALID_DEF", "节点缺少 id");
    if (ids.has(n.id)) throw new WorkflowError("INVALID_DEF", `节点 id 重复: ${n.id}`);
    ids.add(n.id);
    if (!n.type || typeof n.type !== "string") throw new WorkflowError("INVALID_DEF", `节点 ${n.id} 缺少 type`);
  }
  for (const e of edges) {
    if (!ids.has(e.from) || !ids.has(e.to))
      throw new WorkflowError("INVALID_DEF", `边引用了不存在的节点: ${e.from} → ${e.to}`);
    const w = e.when || "success";
    if (!["success", "error", "always"].includes(w))
      throw new WorkflowError("INVALID_DEF", `边条件非法(${w}), 支持 success/error/always`);
  }
  // Kahn 拓扑检测: 有环则剩余节点 > 0
  const indeg = new Map(nodes.map((n) => [n.id, 0]));
  const out = new Map(nodes.map((n) => [n.id, []]));
  for (const e of edges) {
    indeg.set(e.to, indeg.get(e.to) + 1);
    out.get(e.from).push(e.to);
  }
  const queue = nodes.filter((n) => indeg.get(n.id) === 0).map((n) => n.id);
  let visited = 0;
  while (queue.length) {
    const id = queue.shift();
    visited++;
    for (const next of out.get(id)) {
      indeg.set(next, indeg.get(next) - 1);
      if (indeg.get(next) === 0) queue.push(next);
    }
  }
  if (visited !== nodes.length)
    throw new WorkflowError("CYCLIC_DEF", "工作流存在环, 请检查节点依赖");
  return true;
}

/** 按最长路径分层: 用于前端画布自动布局(layer 越大越靠右) */
function layoutLayers(def) {
  const nodes = def.nodes || [];
  const incoming = new Map(nodes.map((n) => [n.id, []]));
  const outgoing = new Map(nodes.map((n) => [n.id, []]));
  for (const e of def.edges || []) {
    incoming.get(e.to).push(e.from);
    outgoing.get(e.from).push(e.to);
  }
  const layer = new Map(nodes.map((n) => [n.id, 0]));
  // 反复松弛直至稳定(节点数小, O(V·E) 足够)
  for (let i = 0; i < nodes.length; i++) {
    let changed = false;
    for (const n of nodes) {
      for (const src of incoming.get(n.id)) {
        if (layer.get(src) + 1 > layer.get(n.id)) {
          layer.set(n.id, layer.get(src) + 1);
          changed = true;
        }
      }
    }
    if (!changed) break;
  }
  return layer;
}

class WorkflowEngine {
  constructor() {
    this.executors = new Map();
  }

  /** 注册节点执行器: fn(node, ctx) → { summary, output } ; 抛错则节点失败 */
  register(type, fn) {
    this.executors.set(String(type), fn);
    return this;
  }

  has(type) {
    return this.executors.has(String(type));
  }

  /**
   * 执行工作流。
   * @param {object} def   { nodes, edges }
   * @param {object} input 运行输入(透传给执行器 ctx.input)
   * @param {object} hooks { onEvent(evt) } — 事件流供落库/前端轮询
   * @returns {object} 运行结果: { status, outputs, nodes, stats, error }
   */
  async run(def, input = {}, hooks = {}) {
    validateDef(def);
    const nodes = def.nodes;
    const edges = def.edges || [];
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const incoming = new Map(nodes.map((n) => [n.id, []]));
    const outgoing = new Map(nodes.map((n) => [n.id, []]));
    for (const e of edges) {
      incoming.get(e.to).push(e);
      outgoing.get(e.from).push(e);
    }

    // 节点运行时状态与产物
    const state = new Map(nodes.map((n) => [n.id, { state: "pending" }]));
    const outputs = new Map();
    const startedAt = Date.now();
    const evt = (type, extra) => {
      const e = { type, at: new Date().toISOString(), ...extra };
      try {
        hooks.onEvent && hooks.onEvent(e);
      } catch (_) {
        /* 事件回调失败不影响执行 */
      }
      return e;
    };

    const ctx = {
      input,
      outputs,
      getOutput: (id) => outputs.get(id),
      def,
    };

    evt("workflow_start", { nodeCount: nodes.length });

    // 就绪判定: 所有入边源节点均到达终态, 且至少一条入边满足 when 条件(无入边=起点必跑)
    const isReady = (id) => {
      const ins = incoming.get(id);
      if (!ins.length) return true;
      let fired = false;
      for (const e of ins) {
        const s = state.get(e.from).state;
        if (s === "pending" || s === "running") return false; // 依赖未 settle
        const when = e.when || "success";
        if (
          (when === "success" && s === "success") ||
          (when === "error" && s === "error") ||
          (when === "always" && (s === "success" || s === "error"))
        )
          fired = true;
      }
      return fired;
    };

    let workflowError = null;
    const remaining = new Set(nodes.map((n) => n.id));

    while (remaining.size) {
      // 收集本轮就绪节点
      const ready = [...remaining].filter(isReady);
      const unreachable = [...remaining].filter((id) => !ready.includes(id) && isDead(id, state, incoming));
      // 死路判定: 所有入边源已终态且均未触发 → skipped
      for (const id of unreachable) {
        if (!ready.includes(id)) {
          state.set(id, { state: "skipped" });
          remaining.delete(id);
          evt("node_skipped", { nodeId: id, name: byId.get(id).name || id });
        }
      }
      if (!ready.length) {
        // 剩余节点互相等待(理论上已由无环校验排除) → 全部跳过
        for (const id of remaining) {
          state.set(id, { state: "skipped" });
          evt("node_skipped", { nodeId: id, name: byId.get(id).name || id });
        }
        remaining.clear();
        break;
      }
      // 并发执行本轮就绪节点
      await Promise.all(
        ready.map(async (id) => {
          const node = byId.get(id);
          remaining.delete(id);
          if (!this.has(node.type)) {
            state.set(id, { state: "error", error: `未注册的节点类型: ${node.type}`, durationMs: 0 });
            evt("node_error", { nodeId: id, name: node.name || id, error: `未注册的节点类型: ${node.type}` });
            return;
          }
          const t0 = Date.now();
          state.set(id, { state: "running", startedAt: t0 });
          evt("node_start", { nodeId: id, name: node.name || id, type: node.type });
          const retry = Math.max(0, Math.min(Number(node.params && node.params.retry) || 0, 3));
          let attempt = 0;
          for (;;) {
            try {
              const result = await this.executors.get(node.type)(node, ctx);
              const durationMs = Date.now() - t0;
              outputs.set(id, result && result.output !== undefined ? result.output : result);
              state.set(id, { state: "success", durationMs, summary: result && result.summary });
              evt("node_done", {
                nodeId: id,
                name: node.name || id,
                durationMs,
                summary: result && result.summary,
                output: outputs.get(id),
              });
              return;
            } catch (err) {
              attempt++;
              const durationMs = Date.now() - t0;
              if (attempt <= retry) {
                evt("node_retry", {
                  nodeId: id,
                  name: node.name || id,
                  attempt,
                  error: err.message,
                });
                continue;
              }
              state.set(id, { state: "error", error: err.message, durationMs });
              evt("node_error", { nodeId: id, name: node.name || id, error: err.message, durationMs });
              workflowError = workflowError || { nodeId: id, message: err.message };
              return;
            }
          }
        }),
      );
    }

    const stats = {
      total: nodes.length,
      success: [...state.values()].filter((s) => s.state === "success").length,
      error: [...state.values()].filter((s) => s.state === "error").length,
      skipped: [...state.values()].filter((s) => s.state === "skipped").length,
    };
    const status = stats.error > 0 ? "error" : "success";
    evt("workflow_done", { status, stats, durationMs: Date.now() - startedAt });
    return { status, outputs, error: workflowError, stats };
  }
}

/** 死路判定: 入边源节点全部终态, 且没有任何一条边会被触发 */
function isDead(id, state, incoming) {
  const ins = incoming.get(id);
  if (!ins.length) return false;
  for (const e of ins) {
    const s = state.get(e.from).state;
    if (s === "pending" || s === "running") return false;
    const when = e.when || "success";
    if (
      (when === "success" && s === "success") ||
      (when === "error" && s === "error") ||
      (when === "always" && (s === "success" || s === "error"))
    )
      return false;
  }
  return true;
}

module.exports = { WorkflowEngine, WorkflowError, validateDef, layoutLayers, NODE_STATES };
