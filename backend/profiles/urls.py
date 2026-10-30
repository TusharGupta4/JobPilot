from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import ProfileMeView, CandidateProfileViewSet, ResumeViewSet

router = DefaultRouter()
router.register(r"profiles", CandidateProfileViewSet, basename="profile-crud")
router.register(r"resumes", ResumeViewSet, basename="resume")

urlpatterns = [
    path("profile/me/", ProfileMeView.as_view(), name="profile-me"),
    path("", include(router.urls)),
]
