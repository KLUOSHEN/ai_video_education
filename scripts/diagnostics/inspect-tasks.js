"use strict";

const fs = require("node:fs");
const path = require("node:path");
const repoRoot = path.resolve(__dirname, "..", "..");
const store = JSON.parse(fs.readFileSync(path.join(repoRoot, "data", "store.json"), "utf8"));
const videoTasks = store.videoTasks || (Array.isArray(store) ? store : []);
const list = Array.isArray(videoTasks) ? videoTasks : (Array.isArray(store.tasks) ? store.tasks : []);

console.log("videoTasks 记录数:", Array.isArray(videoTasks) ? videoTasks.length : `非数组:${typeof videoTasks}`);
console.log("--- 各记录概要 ---");
list.forEach((task, index) => {
  const slides = task && (task.slides || task.slide_data || (task.data && task.data.slides));
  const count = Array.isArray(slides) ? slides.length : 0;
  console.log(index, "| id=", task.taskId || task.id || task.task_id || "?", "| status=", task.status || task.state || "?", "| title=", (task.title || task.topic || (slides && slides[0] && slides[0].title) || "?").toString().slice(0, 30), "| slides=", count);
});
