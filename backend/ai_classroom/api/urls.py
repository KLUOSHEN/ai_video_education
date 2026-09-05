from django.urls import path
from . import views

urlpatterns = [
    path("search/", views.search, name="api-search"),
    path("generate/", views.generate, name="api-generate"),
    path("tasks/", views.task_list, name="api-task-list"),
    path("tasks/<int:task_id>/", views.task_detail, name="api-task-detail"),
    path("tasks/<int:task_id>/quiz/generate/", views.quiz_generate, name="api-quiz-generate"),
    path("tasks/<int:task_id>/quiz/", views.quiz_list, name="api-quiz-list"),
    path("tasks/<int:task_id>/quiz/submit/", views.quiz_submit, name="api-quiz-submit"),
    path("health/", views.health_check, name="api-health"),
]
