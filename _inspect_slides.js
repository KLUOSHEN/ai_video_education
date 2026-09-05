const fs = require('fs');
const d = JSON.parse(fs.readFileSync('data/store.json','utf8'));
const list = Array.isArray(d.videoTasks) ? d.videoTasks : [];
// 分析给定 id 的任务 slides 结构与代表性字段
const ids = ['bd3703f7-6c39-46e9-a648-4eff974ab743','797cf7ad-3417-4d43-b6a1-ae20e329eca7','b93e1f8d-cdda-43d6-acb6-a001aa0bc948','15','e7b27129-ad09-4feb-bf15-c92847c037a8'];
for (const id of ids){
  const t = list.find(x=>x.taskId===id||x.id===id);
  if(!t){ console.log(id,'未找到'); continue; }
  const s = Array.isArray(t.slides)?t.slides:(t.data&&t.data.slides);
  if(!Array.isArray(s)){ console.log(id,'无slides'); continue; }
  console.log('\n=== 任务', id, '| 标题:', (t.title||'').toString().slice(0,40), '| slides数:', s.length, '===');
  console.log('任务顶层字段:', Object.keys(t).join(','));
  const s0 = s[0];
  console.log('slides[0]字段:', Object.keys(s0).join(','));
  console.log('slides[0] 窥视:', JSON.stringify(s0).slice(0,600));
  // 统计各种 slide 字段出现次数
  const cnt={};
  s.forEach(x=>Object.keys(x).forEach(k=>cnt[k]=(cnt[k]||0)+1));
  console.log('字段出现频次(共'+s.length+'页):', JSON.stringify(cnt));
}