const fs = require('fs');
const d = JSON.parse(fs.readFileSync('data/store.json','utf8'));
const vt = d.videoTasks || (Array.isArray(d) ? d : []);
// 尝试多种结构
const arr = Array.isArray(vt) ? vt : (vt && vt.tasks ? vt.tasks : (Array.isArray(d.tasks) ? d.tasks : []));
console.log('videoTasks 记录数:', Array.isArray(vt) ? vt.length : '非数组:'+typeof vt);
const list = Array.isArray(vt) ? vt : (Array.isArray(d.tasks) ? d.tasks : []);
console.log('--- 各记录概要 ---');
list.forEach((t,i)=>{
  const slides = t && (t.slides||t.slide_data||(t.data&&t.data.slides));
  const n = Array.isArray(slides)?slides.length:0;
  console.log(i, '| id=', t.taskId||t.id||t.task_id||'?', '| status=', t.status||t.state||'?', '| title=', (t.title||t.topic||(slides&&slides[0]&&slides[0].title)||'?').toString().slice(0,30), '| slides=', n);
});