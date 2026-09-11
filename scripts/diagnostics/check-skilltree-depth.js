"use strict";

const fs = require("node:fs");
const path = require("node:path");
const repoRoot = path.resolve(__dirname, "..", "..");

(0, eval)(fs.readFileSync(path.join(repoRoot, "skilltree-data.js"), "utf8"));
const TREES = globalThis.TREES;

Object.keys(TREES).forEach((key) => {
  const tree = TREES[key];
  const nodeById = {};
  tree.nodes.forEach((node) => { nodeById[node.id] = node; });

  const reversed = tree.edges.filter((edge) => {
    const source = nodeById[edge.source];
    const target = nodeById[edge.target];
    return source && target && source.depth_level >= target.depth_level;
  });

  const levels = {};
  tree.nodes.forEach((node) => { levels[node.depth_level] = (levels[node.depth_level] || 0) + 1; });
  const levelDescription = Object.keys(levels)
    .map(Number)
    .sort((a, b) => a - b)
    .map((level) => `L${level}:${levels[level]}`)
    .join(" ");

  console.log(`=== ${key} (${tree.nodes.length} 节点) ===`);
  console.log(`  层级分布: ${levelDescription}`);
  console.log(`  倒挂边(浅学深): ${reversed.length} 条`);
  reversed.forEach((edge) => {
    const source = nodeById[edge.source];
    const target = nodeById[edge.target];
    console.log(`    ${source.title}(L${source.depth_level}) → ${target.title}(L${target.depth_level})`);
  });
});
