"use strict";

const fs = require("node:fs");
const path = require("node:path");
const repoRoot = path.resolve(__dirname, "..", "..");
const store = JSON.parse(fs.readFileSync(path.join(repoRoot, "data", "store.json"), "utf8"));
const list = Array.isArray(store.videoTasks) ? store.videoTasks : [];
const ids = [
  "bd3703f7-6c39-46e9-a648-4eff974ab743",
  "797cf7ad-3417-4d43-b6a1-ae20e329eca7",
  "b93e1f8d-cdda-43d6-acb6-a001aa0bc948",
  "15",
  "e7b27129-ad09-4feb-bf15-c92847c037a8",
];

for (const id of ids) {
  const task = list.find((item) => item.taskId === id || item.id === id);
  if (!task) {
    console.log(id, "未找到");
    continue;
  }
  const slides = Array.isArray(task.slides) ? task.slides : (task.data && task.data.slides);
  if (!Array.isArray(slides)) {
    console.log(id, "无slides");
    continue;
  }
  console.log(`\n=== 任务 ${id} | 标题: ${(task.title || "").toString().slice(0, 40)} | slides数: ${slides.length} ===`);
  console.log("任务顶层字段:", Object.keys(task).join(","));
  console.log("slides[0]字段:", Object.keys(slides[0]).join(","));
  console.log("slides[0] 窥视:", JSON.stringify(slides[0]).slice(0, 600));
  const fields = {};
  slides.forEach((slide) => Object.keys(slide).forEach((key) => { fields[key] = (fields[key] || 0) + 1; }));
  console.log(`字段出现频次(共${slides.length}页):`, JSON.stringify(fields));
}
