from rest_framework import serializers
from .models import Character, VideoGeneration, Scene, Quiz, QuizSubmission, SearchRecord


class CharacterSerializer(serializers.ModelSerializer):
    class Meta:
        model = Character
        fields = "__all__"


class SceneSerializer(serializers.ModelSerializer):
    class Meta:
        model = Scene
        fields = "__all__"


class QuizSerializer(serializers.ModelSerializer):
    class Meta:
        model = Quiz
        fields = "__all__"


class QuizSubmissionSerializer(serializers.ModelSerializer):
    class Meta:
        model = QuizSubmission
        fields = "__all__"
        read_only_fields = ["is_correct", "score_earned"]


class VideoGenerationListSerializer(serializers.ModelSerializer):
    character_name = serializers.CharField(source="character.name", read_only=True)
    status_display = serializers.CharField(source="get_status_display", read_only=True)

    class Meta:
        model = VideoGeneration
        fields = [
            "id", "query", "status", "status_display", "progress",
            "total_scenes", "completed_scenes", "character_name",
            "output_video", "quality", "duration_seconds",
            "started_at", "completed_at",
        ]


class VideoGenerationDetailSerializer(serializers.ModelSerializer):
    status_display = serializers.CharField(source="get_status_display", read_only=True)
    scenes = SceneSerializer(many=True, read_only=True)
    quizzes = QuizSerializer(many=True, read_only=True)

    class Meta:
        model = VideoGeneration
        fields = "__all__"


class SearchRecordSerializer(serializers.ModelSerializer):
    class Meta:
        model = SearchRecord
        fields = "__all__"


# ── Request serializers ──

class SearchRequestSerializer(serializers.Serializer):
    query = serializers.CharField(max_length=2000, required=True, min_length=1)
    file = serializers.FileField(required=False)


class GenerateRequestSerializer(serializers.Serializer):
    query = serializers.CharField(max_length=2000)
    character_id = serializers.IntegerField(required=False)
    scene_count = serializers.IntegerField(default=5, min_value=1, max_value=20)
    quality = serializers.ChoiceField(choices=["720p", "1080p"], default="1080p")
    voice_id = serializers.CharField(required=False, default="zh-CN-XiaoxiaoNeural")
    voice_rate = serializers.CharField(required=False, default="+0%")


class QuizSubmitSerializer(serializers.Serializer):
    answers = serializers.ListField(
        child=serializers.DictField(child=serializers.CharField()),
        min_length=1,
        max_length=50,
    )
