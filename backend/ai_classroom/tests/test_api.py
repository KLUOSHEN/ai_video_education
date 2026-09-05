"""
单元测试 — API 搜索、生成、题目模块
运行: python manage.py test tests
"""

import json
from django.test import TestCase, Client
from django.urls import reverse

from api.models import Character, VideoGeneration, Quiz, SearchRecord


class SearchAPITests(TestCase):
    """搜索输入处理模块测试"""

    def setUp(self):
        self.client = Client()

    def test_search_valid_query(self):
        """正常搜索请求"""
        resp = self.client.post(
            reverse("api-search"),
            data=json.dumps({"query": "快速排序原理"}),
            content_type="application/json",
        )
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertTrue(data["success"])
        self.assertIn("快速排序", data["data"]["query"])
        self.assertIn("keywords", data["data"])

    def test_search_empty_query(self):
        """空搜索应返回 400"""
        resp = self.client.post(
            reverse("api-search"),
            data=json.dumps({"query": ""}),
            content_type="application/json",
        )
        self.assertEqual(resp.status_code, 400)

    def test_search_keyword_extraction(self):
        """关键词提取正确"""
        resp = self.client.post(
            reverse("api-search"),
            data=json.dumps({"query": "TCP三次握手和四次挥手"}),
            content_type="application/json",
        )
        data = resp.json()
        keywords = data["data"]["keywords"]
        self.assertTrue(any("TCP" in k or "tcp" in k.lower() for k in keywords))

    def test_search_records_saved(self):
        """搜索记录应持久化"""
        resp = self.client.post(
            reverse("api-search"),
            data=json.dumps({"query": "二叉树遍历"}),
            content_type="application/json",
        )
        self.assertEqual(SearchRecord.objects.count(), 1)


class GenerateAPITests(TestCase):
    """生成模块测试"""

    def setUp(self):
        self.client = Client()
        self.character = Character.objects.create(name="Test Teacher")

    def test_generate_creates_task(self):
        """调用生成应创建任务"""
        resp = self.client.post(
            reverse("api-generate"),
            data=json.dumps({
                "query": "快速排序",
                "character_id": self.character.id,
                "scene_count": 3,
                "quality": "1080p",
            }),
            content_type="application/json",
        )
        self.assertEqual(resp.status_code, 201)
        data = resp.json()
        self.assertTrue(data["success"])
        self.assertIn("task_id", data["data"])

        # 验证任务创建
        task = VideoGeneration.objects.get(id=data["data"]["task_id"])
        self.assertEqual(task.query, "快速排序")
        self.assertEqual(task.total_scenes, 3)

    def test_generate_invalid_character(self):
        """无效角色 ID 返回 404"""
        resp = self.client.post(
            reverse("api-generate"),
            data=json.dumps({"query": "test", "character_id": 99999}),
            content_type="application/json",
        )
        self.assertEqual(resp.status_code, 404)


class QuizAPITests(TestCase):
    """题目模块测试"""

    def setUp(self):
        self.client = Client()
        self.task = VideoGeneration.objects.create(
            query="快速排序",
            status=VideoGeneration.Status.COMPLETED,
        )

    def test_generate_quiz(self):
        """为任务生成题目"""
        resp = self.client.post(
            reverse("api-quiz-generate", args=[self.task.id]),
            data=json.dumps({"difficulty": "medium", "count": 3}),
            content_type="application/json",
        )
        self.assertEqual(resp.status_code, 201)
        data = resp.json()
        self.assertTrue(data["success"])
        self.assertEqual(data["data"]["count"], 3)
        self.assertEqual(Quiz.objects.filter(task=self.task).count(), 3)

    def test_quiz_list(self):
        """获取题目列表"""
        Quiz.objects.create(task=self.task, question_type="single", content="Test Q",
                           correct_answer="B", order=1)
        resp = self.client.get(reverse("api-quiz-list", args=[self.task.id]))
        data = resp.json()
        self.assertTrue(data["success"])
        self.assertEqual(data["data"]["count"], 1)

    def test_submit_quiz_evaluation(self):
        """提交答案 — 自动判分"""
        quiz = Quiz.objects.create(
            task=self.task, question_type="single", content="Test?",
            options=["A", "B", "C", "D"], correct_answer="B", score=10, order=1,
        )
        resp = self.client.post(
            reverse("api-quiz-submit", args=[self.task.id]),
            data=json.dumps({
                "answers": [{"quiz_id": quiz.id, "answer": "B"}],
            }),
            content_type="application/json",
        )
        data = resp.json()
        self.assertTrue(data["success"])
        results = data["data"]["results"]
        self.assertEqual(len(results), 1)
        self.assertTrue(results[0]["correct"])

    def test_submit_wrong_answer(self):
        """提交错误答案"""
        quiz = Quiz.objects.create(
            task=self.task, question_type="single", content="Test?",
            options=["A", "B", "C", "D"], correct_answer="B", score=10, order=1,
        )
        resp = self.client.post(
            reverse("api-quiz-submit", args=[self.task.id]),
            data=json.dumps({
                "answers": [{"quiz_id": quiz.id, "answer": "C"}],
            }),
            content_type="application/json",
        )
        data = resp.json()
        self.assertFalse(data["data"]["results"][0]["correct"])
        self.assertEqual(data["data"]["total_score"], 0)


class HealthCheckTests(TestCase):
    """健康检查"""

    def test_health(self):
        resp = self.client.get(reverse("api-health"))
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data["data"]["status"], "healthy")


class RateLimitTests(TestCase):
    """限流测试"""

    def test_rate_limit(self):
        client = Client()
        for _ in range(65):
            client.post(
                reverse("api-search"),
                data=json.dumps({"query": "test"}),
                content_type="application/json",
            )
        resp = client.post(
            reverse("api-search"),
            data=json.dumps({"query": "test"}),
            content_type="application/json",
        )
        self.assertEqual(resp.status_code, 429)
