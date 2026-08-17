const fs = require('fs');
(0, eval)(fs.readFileSync('skilltree-data.js', 'utf8'));
const TREES = globalThis.TREES;

Object.keys(TREES).forEach(key => {
  const t = TREES[key];
  const nodeById = {};
  t.nodes.forEach(n => nodeById[n.id] = n);

  // 1) 倒挂边: source 的 depth_level 大于等于 target(违反由浅入深)
  const reversed = t.edges.filter(e => {
    const s = nodeById[e.source], d = nodeById[e.target];
    return s && d && s.depth_level >= d.depth_level;
  });

  // 2) 每层的节点数
  const levels = {};
  t.nodes.forEach(n => { levels[n.depth_level] = (levels[n.depth_level] || 0) + 1; });
  const levelDesc = Object.keys(levels).map(Number).sort((a,b)=>a-b)
    .map(l => 'L' + l + ':' + levels[l]).join(' ');

  console.log('=== ' + key + ' (' + t.nodes.length + ' 节点) ===');
  console.log('  层级分布: ' + levelDesc);
  console.log('  倒挂边(浅学深): ' + reversed.length + ' 条');
  reversed.forEach(e => {
    const s = nodeById[e.source], d = nodeById[e.target];
    console.log('    ' + s.title + '(L' + s.depth_level + ') → ' + d.title + '(L' + d.depth_level + ')');
  });
});
