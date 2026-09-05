from django.db import models


class Character(models.Model):
    """角色/人设模型"""
    name = models.CharField(max_length=100, verbose_name="角色名称")
    avatar_url = models.URLField(blank=True, verbose_name="头像URL")
    voice_id = models.CharField(max_length=50, default="zh-CN-XiaoxiaoNeural", verbose_name="TTS语音ID")
    voice_rate = models.CharField(max_length=10, default="+0%", verbose_name="语速")
    style = models.CharField(max_length=100, default="teacher", verbose_name="风格")
    description = models.TextField(blank=True, verbose_name="角色描述")
    is_active = models.BooleanField(default=True, verbose_name="是否启用")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "character"
        ordering = ["-created_at"]

    def __str__(self):
        return self.name


class VideoGeneration(models.Model):
    """视频生成任务追踪"""

    class Status(models.TextChoices):
        PENDING = "pending", "等待中"
        ANALYZING = "analyzing", "正在分析"
        SCRIPTING = "scripting", "编写剧本"
        RENDERING = "rendering", "生成场景"
        SYNTHESIZING = "synthesizing", "合成视频"
        COMPLETED = "completed", "已完成"
        FAILED = "failed", "失败"

    class Quality(models.TextChoices):
        SD = "720p", "标清 720p"
        HD = "1080p", "高清 1080p"

    query = models.TextField(verbose_name="搜索输入")
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.PENDING, db_index=True)
    progress = models.PositiveSmallIntegerField(default=0, verbose_name="进度百分比")
    total_scenes = models.PositiveSmallIntegerField(default=5, verbose_name="总场景数")
    completed_scenes = models.PositiveSmallIntegerField(default=0, verbose_name="已完成场景数")
    output_video = models.FileField(upload_to="videos/", blank=True, verbose_name="输出视频")
    character = models.ForeignKey(Character, on_delete=models.SET_NULL, null=True, blank=True)
    quality = models.CharField(max_length=10, choices=Quality.choices, default=Quality.HD)
    error_message = models.TextField(blank=True, verbose_name="错误信息")
    duration_seconds = models.PositiveIntegerField(default=0, verbose_name="视频时长(秒)")
    ip_address = models.GenericIPAddressField(blank=True, null=True)
    started_at = models.DateTimeField(auto_now_add=True)
    completed_at = models.DateTimeField(blank=True, null=True)

    class Meta:
        db_table = "video_generation"
        ordering = ["-started_at"]

    def __str__(self):
        return f"Task #{self.id}: {self.query[:50]}"


class Scene(models.Model):
    """逐场景资产"""
    task = models.ForeignKey(VideoGeneration, on_delete=models.CASCADE, related_name="scenes")
    scene_index = models.PositiveSmallIntegerField(verbose_name="场景序号")
    scene_description = models.TextField(verbose_name="场景描述")
    script_text = models.TextField(verbose_name="台词/字幕")
    image = models.ImageField(upload_to="images/", blank=True, verbose_name="场景图")
    audio = models.FileField(upload_to="audio/", blank=True, verbose_name="配音音频")
    duration = models.FloatField(default=5.0, verbose_name="时长(秒)")
    status = models.CharField(max_length=20, default="pending")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "scene"
        ordering = ["task", "scene_index"]
        unique_together = [["task", "scene_index"]]

    def __str__(self):
        return f"Scene {self.scene_index}: {self.scene_description[:40]}"


class Quiz(models.Model):
    """题目模型"""

    class Type(models.TextChoices):
        SINGLE = "single", "单选题"
        MULTIPLE = "multiple", "多选题"
        JUDGE = "judge", "判断题"
        FILL = "fill", "填空题"
        SHORT = "short", "简答题"

    class Difficulty(models.TextChoices):
        EASY = "easy", "简单"
        MEDIUM = "medium", "中等"
        HARD = "hard", "困难"

    task = models.ForeignKey(VideoGeneration, on_delete=models.CASCADE, related_name="quizzes")
    question_type = models.CharField(max_length=10, choices=Type.choices, default=Type.SINGLE)
    difficulty = models.CharField(max_length=10, choices=Difficulty.choices, default=Difficulty.MEDIUM)
    content = models.TextField(verbose_name="题目内容")
    options = models.JSONField(default=list, blank=True, verbose_name="选项列表")
    correct_answer = models.JSONField(verbose_name="正确答案")
    explanation = models.TextField(blank=True, verbose_name="解析")
    score = models.PositiveSmallIntegerField(default=10, verbose_name="分值")
    order = models.PositiveSmallIntegerField(default=1, verbose_name="排序")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "quiz"
        ordering = ["task", "order"]

    def __str__(self):
        return f"Quiz #{self.id}: {self.content[:50]}"


class QuizSubmission(models.Model):
    """答题记录"""
    quiz = models.ForeignKey(Quiz, on_delete=models.CASCADE, related_name="submissions")
    user_answer = models.JSONField(verbose_name="用户答案")
    is_correct = models.BooleanField(verbose_name="是否正确")
    score_earned = models.PositiveSmallIntegerField(default=0, verbose_name="得分")
    submitted_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "quiz_submission"

    def __str__(self):
        return f"Submission for Quiz #{self.quiz_id}: {'V' if self.is_correct else 'X'}"


class SearchRecord(models.Model):
    """搜索记录"""
    query = models.TextField(verbose_name="搜索内容")
    result_count = models.PositiveIntegerField(default=0, verbose_name="结果数")
    has_attachment = models.BooleanField(default=False, verbose_name="是否含附件")
    ip_address = models.GenericIPAddressField(blank=True, null=True)
    user_agent = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "search_record"
        ordering = ["-created_at"]


class SystemConfig(models.Model):
    """系统配置（键值对）"""
    key = models.CharField(max_length=100, unique=True)
    value = models.TextField()
    description = models.CharField(max_length=255, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "system_config"

    def __str__(self):
        return self.key
