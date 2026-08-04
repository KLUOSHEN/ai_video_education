# AI 白板小课堂 API

服务启动后访问 `http://localhost:3000`，静态的 `search.html` 和 `watch.html` 会由同一服务提供；所有接口前缀为 `/api/v1`。请求与响应均为 UTF-8 JSON。每个响应带有 `X-Request-Id`，便于排查日志。

## 通用约定

- 支持 `GET`、`POST` 和 CORS 预检 `OPTIONS`。
- 输入会转换为 Unicode NFC、统一换行及空白符，最大长度为 4000 字符。
- 错误格式：`{ "error": { "code": "INVALID_INPUT", "message": "..." }, "requestId": "..." }`。
- 若配置 `API_KEY`，所有 API 调用须传递 `Authorization: Bearer <key>` 或 `X-API-Key: <key>`。

## 接口

### `POST /search`

接收 search 页的搜索文字并返回规范化结果。

```json
{ "query": "  TCP 三次握手\n", "source": "search-page", "userRef": "optional-user-reference" }
```

```json
{ "data": { "id": "uuid", "query": "TCP 三次握手", "normalized": true, "createdAt": "2026-07-22T...Z" }, "requestId": "uuid" }
```

### `POST /generations`

创建异步课程生成任务，返回 `202 Accepted`。`voice.type` 可为 `female`、`male`、`child`、`neutral`；`voice.speed` 范围为 0.5–2。题型支持 `choice`、`true_false`、`fill_blank`，难度为 `easy`、`medium`、`hard`。

```json
{
  "text": "快速排序算法详解",
  "voice": { "type": "neutral", "speed": 1.1 },
  "quiz": { "types": ["choice", "true_false", "fill_blank"], "difficulty": "medium", "count": 3 }
}
```

响应的 `data` 包含任务 `id`、`status`、`progress`、`statusUrl` 和 `resultUrl`。轮询 `GET /tasks/{id}`；状态变为 `completed` 后请求 `GET /tasks/{id}/result`，将取得主题、场景、音频 URL、视频 URL/课程封面和完整题目。任务状态为 `queued`、`processing`、`completed` 或 `failed`。

生成结果额外包含 `lessonPlan`：含完整题干、解题概述、逐步推导、每个分镜的视觉要求和对应旁白。视频提供方接收的是结构化题目精讲任务：16:9 中文画面、题干完整呈现、关键步骤高亮、图表/流程分析、同步配音，以及结论复盘。

### `POST /questions/generate`

同步生成题目：请求体使用 `text` 及与 `quiz` 相同的 `types`、`difficulty`、`count` 字段。返回包含题干、选项、正确答案、解析的题目数组。

### `POST /questions/{questionId}/grade`

提交答案并由服务端判定。选择题提交 `A`–`D`，判断题提交 `正确` / `错误`，填空题直接提交文本。

```json
{ "answer": "A" }
```

```json
{ "data": { "questionId": "uuid", "correct": true, "explanation": "…", "correctAnswer": "A" }, "requestId": "uuid" }
```

### 运维接口

- `GET /health`：存活探针。
- `GET /metrics`：请求、错误、任务及运行时指标，可交给监控采集器轮询。

## 媒体提供方集成

在 `.env` 中填写 `TTS_PROVIDER_URL` / `VIDEO_PROVIDER_URL` 及相应 API Key，即启用第三方适配器。服务向 TTS 提供方发送 `{ text, voice }`；视频提供方会收到题干、`lessonPlan`、分镜视觉/旁白和 `voiceover.audioUrl`，并被要求按分镜同步音画。提供方应返回 `{ "url": "https://..." }`、`{ "data": { "url": "..." } }` 或 `{ "output": { "url": "..." } }`。

未配置时，开发模式会生成可访问的 WAV 音频与 SVG 课程封面，以便完整验证任务、存储、状态轮询和页面接入流程；生产环境必须配置真实音视频提供方。

可选的 `userRef` 使用服务端 `DATA_ENCRYPTION_KEY` 通过 AES-256-GCM 加密后再落盘，响应和日志均不会返回其明文。
