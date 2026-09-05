# AI 白板小课堂 — 后端系统

## 项目结构

```
ai_classroom/
├── manage.py                    # Django 管理入口
├── requirements.txt             # Python 依赖
├── ai_classroom/                # 项目配置
│   ├── settings.py              # 配置（DB/AI服务/日志/CORS/限流）
│   ├── urls.py                  # 根路由
│   └── wsgi.py                  # WSGI 入口
├── api/                         # API 应用
│   ├── models.py                # 8 张数据模型（Character/VideoGeneration/Scene/Quiz 等）
│   ├── serializers.py           # 请求/响应序列化器
│   ├── views.py                 # 8 个 API 端点
│   ├── urls.py                  # API 路由
│   ├── middleware.py            # 限流 + 日志中间件
│   └── exceptions.py            # 统一异常处理
├── generation/                  # 音视频生成模块
│   └── pipeline.py              # 5 阶段生成流水线
├── quiz_module/                 # 题目引擎
│   └── engine.py                # 多题型智能生成 + 难度控制
├── tests/                       # 测试
│   └── test_api.py              # 单元/集成测试（70+ 用例覆盖）
├── media/                       # 产物存储
│   ├── videos/
│   ├── audio/
│   └── images/
└── logs/                        # 运行日志
```

## 快速启动

```bash
# 1. 安装依赖
pip install -r requirements.txt

# 2. 数据库迁移
python manage.py migrate

# 3. 创建管理员（可选）
python manage.py createsuperuser

# 4. 启动开发服务器
python manage.py runserver 0.0.0.0:8000

# 5. 运行测试
python manage.py test tests
```

## 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `DEBUG` | 调试模式 | `True` |
| `ALLOWED_HOSTS` | 允许域名（逗号分隔） | `*` |
| `DEEPSEEK_API_KEY` | DeepSeek API 密钥 | — |
| `DEEPSEEK_BASE_URL` | DeepSeek API 地址 | `https://api.deepseek.com` |
| `DOUBAO_API_KEY` | Doubao 图像生成密钥 | — |
| `DOUBAO_BASE_URL` | Doubao API 地址 | — |

---

## API 接口文档

基础 URL: `http://localhost:8000/api`

### 1. 搜索输入 `POST /api/search/`

```json
// Request (JSON)
{ "query": "快速排序时间复杂度" }

// Request (FormData — 含附件)
query: "分析这道题"
file: <upload>

// Response 200
{
  "success": true,
  "data": {
    "query": "快速排序时间复杂度",
    "normalized": "快速排序时间复杂度",
    "keywords": ["排序", "复杂度"],
    "file_url": null,
    "timestamp": "2026-07-22T16:00:00"
  }
}
```

### 2. 启动生成 `POST /api/generate/`

```json
// Request
{
  "query": "快速排序",
  "character_id": 1,        // 可选
  "scene_count": 5,          // 1-20
  "quality": "1080p",        // "720p" | "1080p"
  "voice_id": "zh-CN-XiaoxiaoNeural",
  "voice_rate": "+0%"
}

// Response 201
{
  "success": true,
  "data": {
    "task_id": 42,
    "status": "pending",
    "status_display": "等待中",
    "message": "任务已提交，正在生成中..."
  }
}
```

### 3. 任务列表 `GET /api/tasks/`

```json
// Response 200
{
  "success": true,
  "data": [
    {
      "id": 42,
      "query": "快速排序",
      "status": "completed",
      "status_display": "已完成",
      "progress": 100,
      "total_scenes": 5,
      "completed_scenes": 5,
      "output_video": "/media/videos/output_42.mp4",
      "quality": "1080p",
      "started_at": "2026-07-22T15:58:00Z",
      "completed_at": "2026-07-22T16:02:00Z"
    }
  ],
  "count": 1
}
```

### 4. 任务详情 `GET /api/tasks/:id/`

```json
// Response 200
{
  "success": true,
  "data": {
    "id": 42,
    "query": "快速排序",
    "status": "completed",
    "status_display": "已完成",
    "progress": 100,
    "scenes": [
      {
        "scene_index": 1,
        "script_text": "第一步：选择pivot",
        "image": "images/task1_scene1.png",
        "audio": "audio/task1_scene1.mp3",
        "duration": 5.0
      }
    ],
    "quizzes": [...],
    "output_video": "videos/output_42.mp4"
  }
}
```

### 5. 生成题目 `POST /api/tasks/:id/quiz/generate/`

```json
// Request
{ "difficulty": "medium", "count": 5 }    // difficulty: easy|medium|hard

// Response 201
{
  "success": true,
  "data": {
    "quizzes": [
      {
        "id": 1,
        "question_type": "single",
        "difficulty": "medium",
        "content": "快速排序最坏时间复杂度？",
        "options": ["O(n log n)", "O(n²)", "O(n)", "O(log n)"],
        "correct_answer": "B",
        "explanation": "最坏情况每次pivot都是最值...",
        "score": 10,
        "order": 1
      }
    ],
    "count": 5
  }
}
```

### 6. 获取题目 `GET /api/tasks/:id/quiz/`

返回该任务关联的所有题目列表。

### 7. 提交答案 `POST /api/tasks/:id/quiz/submit/`

```json
// Request
{
  "answers": [
    { "quiz_id": 1, "answer": "B" },
    { "quiz_id": 2, "answer": "true" }
  ]
}

// Response 200
{
  "success": true,
  "data": {
    "results": [
      { "quiz_id": 1, "correct": true, "score": 10, "explanation": "..." },
      { "quiz_id": 2, "correct": false, "score": 0, "explanation": "..." }
    ],
    "total_score": 10,
    "total_correct": 1,
    "total_questions": 2
  }
}
```

### 8. 健康检查 `GET /api/health/`

```json
{ "success": true, "data": { "status": "healthy", "version": "1.0.0" } }
```

---

## 模块说明

### 生成流水线（5 阶段）

```
搜索输入 → [1. 分析] → [2. 剧本] → [3. 绘图+TTS] → [4. 合成] → MP4
          DeepSeek   DeepSeek   Doubao+edge-tts  moviepy   输出
```

| 阶段 | 状态 | 操作 | 容错 |
|------|------|------|------|
| 1. 分析 | `analyzing` | DeepSeek 求解题目、提取要点 | Fallback: 默认 JSON |
| 2. 剧本 | `scripting` | DeepSeek 生成逐场景脚本 | Fallback: 编号占位 |
| 3. 渲染 | `rendering` | 逐场景：Doubao 绘图 + edge-tts 配音 | Fallback: 纯色占位图 |
| 4. 合成 | `synthesizing` | moviepy 合成 MP4 + 中文字幕 | Fallback: 空视频 |
| 5. 完成 | `completed` | 标记完成时间 | — |

### 题目引擎

| 题型 | 支持 | 判分逻辑 |
|------|------|---------|
| 单选 | `single` | 严格匹配 A/B/C/D |
| 多选 | `multiple` | 集合比较（顺序无关） |
| 判断 | `judge` | true/false/对/错 |
| 填空 | `fill` | 去空格后严格匹配 |

- 难度控制：`easy` 偏判断题/简单单选；`hard` 偏填空/综合题
- 题库主题：排序、TCP、进程、二叉树、数据库、HTTP（共 6 类 50+ 模板）

---

## 安全措施

| 层级 | 机制 |
|------|------|
| 网络层 | Rate limit: 60 req/min (匿名 30/min) |
| 应用层 | 统一异常 JSON 响应；CORS 白名单 |
| 输入层 | 查询文本规范化、文件类型白名单 |
| 存储层 | Media 文件通过 Django 路由访问；日志只记录非敏感信息 |

## 部署

```bash
# 生产环境 (gunicorn)
pip install gunicorn
gunicorn ai_classroom.wsgi:application --bind 0.0.0.0:8000 --workers 4 --timeout 120

# Docker 部署（推荐）
# FROM python:3.11-slim
# COPY . /app
# WORKDIR /app
# RUN pip install -r requirements.txt
# CMD ["gunicorn", "ai_classroom.wsgi:application", "--bind", "0.0.0.0:8000", "--workers", "4"]
```
