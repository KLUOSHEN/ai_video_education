const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const watchPath = path.resolve(__dirname, "..", "watch.html");
const watch = fs.readFileSync(watchPath, "utf8");

function loadTreeRenderer() {
  const start = watch.indexOf("function renderTreeSvg(");
  const end = watch.indexOf("// 根据 diagram 数据生成 SVG 示意图", start);
  assert.ok(start >= 0 && end > start, "应能提取树形图渲染函数");
  const context = {};
  vm.createContext(context);
  vm.runInContext(watch.slice(start, end), context);
  return context.renderTreeSvg;
}

function circlesFrom(svg) {
  return Array.from(
    svg.matchAll(/<circle cx="([\d.]+)" cy="([\d.]+)" r="([\d.]+)"/g),
    (m) => ({ x: Number(m[1]), y: Number(m[2]), r: Number(m[3]) }),
  );
}

test("树形图长标签不越界且节点互不遮挡", () => {
  const renderTreeSvg = loadTreeRenderer();
  const sample = [
    "计算 -> 进程",
    "进程 -> 独立内存",
    "线程 -> 共享内存",
    "协程 -> 用户态切换",
  ].join("\n");
  const circles = circlesFrom(renderTreeSvg(sample, "#7b5ea7", "#e6ddf3", "#221f2a", 600, 200));
  assert.ok(circles.length >= 7);
  for (const circle of circles) {
    assert.ok(circle.x - circle.r >= -0.01 && circle.x + circle.r <= 600.01);
    assert.ok(circle.y - circle.r >= -0.01 && circle.y + circle.r <= 200.01);
  }
  for (let i = 0; i < circles.length; i++) {
    for (let j = i + 1; j < circles.length; j++) {
      const a = circles[i];
      const b = circles[j];
      assert.ok(Math.hypot(a.x - b.x, a.y - b.y) + 0.01 >= a.r + b.r);
    }
  }
});

test("卡片图表具有高度预算并保留最终整页适配", () => {
  assert.match(watch, /slide\[data-layout="cards"\] \.dk-pan-chart svg \{ height:300px/);
  assert.match(watch, /slide\.dk-fit-emergency \.dk-pan-chart svg \{ height:210px/);
  assert.match(watch, /sec\.dataset\.fitScale = scale\.toFixed\(3\)/);
  assert.match(watch, /pad\.style\.width = \(availableW \/ scale\)/);
});
