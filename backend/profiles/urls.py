from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import ProfileMeView, CandidateProfileViewSet, ResumeViewSet, AnswerQuestionView, ResolveFormFieldView

router = DefaultRouter()
router.register(r"profiles", CandidateProfileViewSet, basename="profile-crud")
router.register(r"resumes", ResumeViewSet, basename="resume")

urlpatterns = [
    path("profile/me/", ProfileMeView.as_view(), name="profile-me"),
    path("profile/answer-question/", AnswerQuestionView.as_view(), name="answer-question"),
    path("profile/resolve-form-field/", ResolveFormFieldView.as_view(), name="resolve-form-field"),
    path("", include(router.urls)),
]

