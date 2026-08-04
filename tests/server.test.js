'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const testRuntime = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-learning-studio-test-'));
process.env.APP_DATA_DIR = path.join(testRuntime, 'data');
process.env.APP_STORAGE_DIR = path.join(testRuntime, 'storage');
const { cleanText, generateQuestions, buildLessonPlan, grade, encryptSensitive, server, store } = require('../server');

let baseUrl;
test.before(async () => {
  await store.init();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}/api/v1`;
});
test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(testRuntime, { recursive: true, force: true });
});

test('规范化文本并拒绝危险内容', () => {
  assert.equal(cleanText('  TCP\r\n  三次\t握手  '), 'TCP\n 三次 握手');
  assert.throws(() => cleanText('<script>alert(1)</script>'), { code: 'UNSAFE_CONTENT' });
  assert.throws(() => cleanText(''), { code: 'EMPTY_TEXT' });
});

test('按题型和难度生成完整教学题目', () => {
  const result = generateQuestions('TCP 三次握手的过程', { types: ['choice', 'true_false', 'fill_blank'], difficulty: 'easy', count: 3 });
  assert.equal(result.topic.subject, '计算机网络');
  assert.deepEqual(result.questions.map((item) => item.type), ['choice', 'true_false', 'fill_blank']);
  for (const question of result.questions) {
    assert.ok(question.id && question.content && question.explanation);
    assert.equal(question.difficulty, 'easy');
  }
});

test('题目讲解视频分镜包含题干、步骤、视觉和同步旁白', () => {
  const plan = buildLessonPlan('二分查找的前提条件是什么？', { title: '二分查找', subject: '算法' });
  assert.match(plan.questionText, /二分查找/);
  assert.ok(plan.solutionSteps.length >= 3);
  assert.ok(plan.scenes.some((scene) => /完整题目/.test(scene.name)));
  assert.ok(plan.scenes.every((scene) => scene.visual && scene.narration));
  assert.match(plan.narration, /第 1 步/);
});

test('评测选择与填空答案', () => {
  assert.equal(grade({ type: 'choice', correctAnswer: 'A' }, 'a'), true);
  assert.equal(grade({ type: 'fill_blank', correctAnswer: '分治', acceptedAnswers: ['divide and conquer'] }, '分治'), true);
  assert.equal(grade({ type: 'fill_blank', correctAnswer: '分治' }, '动态规划'), false);
  const encrypted = encryptSensitive('student@example.com');
  assert.match(encrypted, /^v1\.[^.]+\.[^.]+\.[^.]+$/);
  assert.doesNotMatch(encrypted, /student@example\.com/);
});

test('搜索、异步生成和服务端判题接口可联通', async () => {
  const searchResponse = await fetch(`${baseUrl}/search`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query: '  二分查找 的前提  ' }) });
  assert.equal(searchResponse.status, 201);
  assert.equal((await searchResponse.json()).data.query, '二分查找 的前提');

  const generationResponse = await fetch(`${baseUrl}/generations`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: '二分查找的前提条件', quiz: { types: ['choice', 'fill_blank'], count: 2 } }) });
  assert.equal(generationResponse.status, 202);
  const task = (await generationResponse.json()).data;
  let result;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const status = (await (await fetch(`http://127.0.0.1:${server.address().port}${task.statusUrl}`)).json()).data;
    if (status.status === 'completed') { result = (await (await fetch(`http://127.0.0.1:${server.address().port}${status.resultUrl}`)).json()).data; break; }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.ok(result?.audio?.url && result?.questions?.length === 2);
  const question = result.questions[0];
  const gradeResponse = await fetch(`${baseUrl}/questions/${question.id}/grade`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ answer: question.correctAnswer }) });
  assert.equal((await gradeResponse.json()).data.correct, true);
});
