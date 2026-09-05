"""
AI Classroom Backend API — 统一接口层

Endpoints:
  POST /api/search/          搜索输入处理
  POST /api/generate/        启动音视频生成
  GET  /api/tasks/           任务列表
  GET  /api/tasks/<id>/      任务详情 + 状态
  POST /api/tasks/<id>/quiz/generate/   生成题目
  POST /api/tasks/<id>/quiz/submit/    提交答案
  GET  /api/tasks/<id>/quiz/           获取题目
  GET  /api/health/          健康检查
"""

import uuid
import re
import random
import logging
import threading
from datetime import datetime

from django.conf import settings
from django.db import transaction
from rest_framework import status
from rest_framework.decorators import api_view, parser_classes
from rest_framework.parsers import JSONParser, FormParser, MultiPartParser
from rest_framework.response import Response

from .models import Character, VideoGeneration, Scene, Quiz, QuizSubmission, SearchRecord
from .serializers import (
    SearchRequestSerializer, GenerateRequestSerializer, QuizSubmitSerializer,
    VideoGenerationListSerializer, VideoGenerationDetailSerializer,
    QuizSerializer,
)
from generation.pipeline import _run_generation_pipeline
from quiz_module.engine import _generate_quizzes

logger = logging.getLogger(__name__)


# ═══════════════════════════════════════════════
# 1. 搜索输入处理
# ═══════════════════════════════════════════════

@api_view(["POST"])
@parser_classes([JSONParser, FormParser, MultiPartParser])
def search(request):
    """
    接收前端搜索栏文字输入（可附带文件/图片）。

    POST /api/search/
    Body (JSON): { "query": "快速排序原理" }
    或 FormData: query=xxx & file=<upload>

    Returns:
      { success, data: { query, normalized, keywords[], file_url } }
    """
    serializer = SearchRequestSerializer(data=request.data)
    if not serializer.is_valid():
        return Response({"success": False, "error": {"code": 400, "message": str(serializer.errors)}}, status=400)

    query = serializer.validated_data["query"].strip()
    if not query or query.isspace():
        return Response({"success": False, "error": {"code": 400, "message": "搜索内容不能为空"}}, status=400)

    # 附件处理
    file_url = None
    if "file" in request.FILES:
        uploaded = request.FILES["file"]
        ext = uploaded.name.rsplit(".", 1)[-1].lower()
        allowed = settings.GENERATION_SETTINGS["allowed_upload_extensions"]
        if f".{ext}" not in allowed:
            return Response({"success": False, "error": {"code": 400, "message": f"不支持的文件格式: {ext}"}}, status=400)
        # 存储附件
        unique_name = f"{uuid.uuid4().hex}_{uploaded.name}"
        from django.core.files.storage import default_storage
        saved = default_storage.save(f"uploads/{unique_name}", uploaded)
        file_url = default_storage.url(saved)
        query = f"{query} [附件: {uploaded.name}]"

    # 关键词提取
    keywords = _extract_keywords(query)

    # 记录搜索
    SearchRecord.objects.create(
        query=query,
        has_attachment=file_url is not None,
        ip_address=_get_client_ip(request),
        user_agent=request.META.get("HTTP_USER_AGENT", ""),
    )

    logger.info("Search query: '%s' → keywords: %s", query[:80], keywords)

    return Response({
        "success": True,
        "data": {
            "query": query,
            "normalized": _normalize_text(query),
            "keywords": keywords,
            "file_url": file_url,
            "timestamp": datetime.now().isoformat(),
        },
    })


# ═══════════════════════════════════════════════
# 2. 音视频生成
# ═══════════════════════════════════════════════

@api_view(["POST"])
def generate(request):
    """
    启动音视频生成任务。

    POST /api/generate/
    Body: { query, character_id?, scene_count?, quality?, voice_id?, voice_rate? }

    Returns:
      { success, data: { task_id, status } }
    """
    serializer = GenerateRequestSerializer(data=request.data)
    if not serializer.is_valid():
        return Response({"success": False, "error": {"code": 400, "message": str(serializer.errors)}}, status=400)

    data = serializer.validated_data
    query = data["query"].strip()
    scene_count = data["scene_count"]

    # 角色
    character = None
    if data.get("character_id"):
        try:
            character = Character.objects.get(id=data["character_id"], is_active=True)
        except Character.DoesNotExist:
            return Response({"success": False, "error": {"code": 404, "message": "角色不存在"}}, status=404)

    # 创建任务
    task = VideoGeneration.objects.create(
        query=query,
        status=VideoGeneration.Status.PENDING,
        total_scenes=scene_count,
        character=character,
        quality=data["quality"],
        ip_address=_get_client_ip(request),
    )

    # 异步执行生成流水线
    thread = threading.Thread(
        target=_run_generation_pipeline,
        args=(task.id, data["voice_id"], data["voice_rate"]),
        daemon=True,
    )
    thread.start()

    logger.info("Generation task #%d started: '%s'", task.id, query[:80])

    return Response({
        "success": True,
        "data": {
            "task_id": task.id,
            "status": task.status,
            "status_display": task.get_status_display(),
            "message": "任务已提交，正在生成中...",
        },
    }, status=201)


# ═══════════════════════════════════════════════
# 3. 任务管理
# ═══════════════════════════════════════════════

@api_view(["GET"])
def task_list(request):
    """GET /api/tasks/ — 任务列表"""
    tasks = VideoGeneration.objects.all()[:50]
    serializer = VideoGenerationListSerializer(tasks, many=True)
    return Response({"success": True, "data": serializer.data, "count": tasks.count()})


@api_view(["GET"])
def task_detail(request, task_id):
    """GET /api/tasks/<id>/ — 任务详情（含场景和题目）"""
    try:
        task = VideoGeneration.objects.prefetch_related("scenes", "quizzes").get(id=task_id)
    except VideoGeneration.DoesNotExist:
        return Response({"success": False, "error": {"code": 404, "message": "任务不存在"}}, status=404)

    serializer = VideoGenerationDetailSerializer(task)
    return Response({"success": True, "data": serializer.data})


# ═══════════════════════════════════════════════
# 4. 题目生成与评测
# ═══════════════════════════════════════════════

@api_view(["POST"])
def quiz_generate(request, task_id):
    """
    为指定任务生成题目。

    POST /api/tasks/<id>/quiz/generate/
    Body (optional): { difficulty: "medium", count: 5 }

    Returns:
      { success, data: { quizzes: [...] } }
    """
    try:
        task = VideoGeneration.objects.get(id=task_id)
    except VideoGeneration.DoesNotExist:
        return Response({"success": False, "error": {"code": 404, "message": "任务不存在"}}, status=404)

    difficulty = request.data.get("difficulty", "medium")
    question_count = int(request.data.get("count", 5))

    # 生成题目
    quizzes = _generate_quizzes(task, difficulty, question_count)
    serializer = QuizSerializer(quizzes, many=True)

    return Response({
        "success": True,
        "data": {"quizzes": serializer.data, "count": len(quizzes)},
    }, status=201)


@api_view(["GET"])
def quiz_list(request, task_id):
    """GET /api/tasks/<id>/quiz/ — 获取任务关联题目"""
    try:
        task = VideoGeneration.objects.get(id=task_id)
    except VideoGeneration.DoesNotExist:
        return Response({"success": False, "error": {"code": 404, "message": "任务不存在"}}, status=404)

    quizzes = task.quizzes.all()
    serializer = QuizSerializer(quizzes, many=True)
    return Response({"success": True, "data": {"quizzes": serializer.data, "count": quizzes.count()}})


@api_view(["POST"])
def quiz_submit(request, task_id):
    """
    提交答案并自动判分。

    POST /api/tasks/<id>/quiz/submit/
    Body: { answers: [{ quiz_id: 1, answer: "O(n²)" }] }
    """
    try:
        task = VideoGeneration.objects.get(id=task_id)
    except VideoGeneration.DoesNotExist:
        return Response({"success": False, "error": {"code": 404, "message": "任务不存在"}}, status=404)

    serializer = QuizSubmitSerializer(data=request.data)
    if not serializer.is_valid():
        return Response({"success": False, "error": {"code": 400, "message": str(serializer.errors)}}, status=400)

    answers = serializer.validated_data["answers"]
    results = []
    total_score = 0
    total_correct = 0

    for item in answers:
        quiz_id = item.get("quiz_id")
        user_answer = item.get("answer", "")
        try:
            quiz = Quiz.objects.get(id=quiz_id, task=task)
            is_correct = _evaluate_answer(quiz, user_answer)
            earned = quiz.score if is_correct else 0
            total_correct += int(is_correct)
            total_score += earned

            QuizSubmission.objects.create(
                quiz=quiz,
                user_answer=user_answer,
                is_correct=is_correct,
                score_earned=earned,
            )
            results.append({
                "quiz_id": quiz_id,
                "correct": is_correct,
                "score": earned,
                "correct_answer": quiz.correct_answer,
                "explanation": quiz.explanation,
            })
        except Quiz.DoesNotExist:
            results.append({"quiz_id": quiz_id, "error": "题目不存在"})

    return Response({
        "success": True,
        "data": {
            "results": results,
            "total_score": total_score,
            "total_correct": total_correct,
            "total_questions": len(results),
        },
    })


# ═══════════════════════════════════════════════
# 5. 系统
# ═══════════════════════════════════════════════

@api_view(["GET"])
def health_check(request):
    """GET /api/health/"""
    return Response({
        "success": True,
        "data": {
            "status": "healthy",
            "version": "1.0.0",
            "timestamp": datetime.now().isoformat(),
            "db": "connected",
        },
    })


# ═══════════════════════════════════════════════
# 内部辅助函数
# ═══════════════════════════════════════════════

def _get_client_ip(request):
    x_forwarded = request.META.get("HTTP_X_FORWARDED_FOR")
    if x_forwarded:
        return x_forwarded.split(",")[0].strip()
    return request.META.get("REMOTE_ADDR", "127.0.0.1")


def _normalize_text(text: str) -> str:
    """规范化文本：去多余空格、全角转半角、统一换行"""
    text = re.sub(r"\s+", " ", text.strip())
    text = text.translate(str.maketrans(
        "０１２３４５６７８９ＡＢＣＤＥＦＧＨＩＪＫＬＭＮＯＰＱＲＳＴＵＶＷＸＹＺａｂｃｄｅｆｇｈｉｊｋｌｍｎｏｐｑｒｓｔｕｖｗｘｙｚ",
        "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
    ))
    return text


def _extract_keywords(text: str) -> list:
    """从文本中提取关键词（基于规则 + 常见 CS 术语）"""
    cs_terms = {
        "排序", "算法", "复杂度", "搜索", "图", "树", "二叉树", "哈希", "散列", "栈", "队列",
        "链表", "数组", "递归", "迭代", "动态规划", "分治", "贪心", "回溯", "BFS", "DFS",
        "TCP", "UDP", "HTTP", "HTTPS", "IP", "DNS", "握手", "挥手", "协议",
        "进程", "线程", "死锁", "信号量", "调度", "分页", "分段", "虚拟内存", "LRU",
        "SQL", "数据库", "索引", "事务", "ACID", "JOIN", "范式",
        "加密", "RSA", "AES", "SHA", "签名", "证书",
        "编译", "语法分析", "词法分析", "Docker", "Git", "REST", "API",
    }
    normalized = _normalize_text(text).lower()
    found = [t for t in cs_terms if t.lower() in normalized]
    return found[:10]


def _evaluate_answer(quiz: Quiz, user_answer) -> bool:
    """评估用户答案是否正确"""
    if quiz.question_type == Quiz.Type.SINGLE:
        return str(user_answer).strip().upper() == str(quiz.correct_answer).strip().upper()
    elif quiz.question_type == Quiz.Type.MULTIPLE:
        user_set = set(str(user_answer).replace(" ", "").upper())
        correct_set = set(str(c) for c in quiz.correct_answer if str(c).strip())
        return user_set == correct_set
    elif quiz.question_type == Quiz.Type.JUDGE:
        ua = str(user_answer).strip().lower()
        ca = str(quiz.correct_answer).strip().lower()
        return ua == ca or ua == "true" and ca in ("true", "t", "对") or ua == "false" and ca in ("false", "f", "错")
    elif quiz.question_type == Quiz.Type.FILL:
        user_clean = str(user_answer).strip().lower().replace(" ", "")
        correct_clean = str(quiz.correct_answer).strip().lower().replace(" ", "")
        return user_clean == correct_clean
    elif quiz.question_type == Quiz.Type.SHORT:
        return str(user_answer).strip().lower() == str(quiz.correct_answer).strip().lower()
    return False
