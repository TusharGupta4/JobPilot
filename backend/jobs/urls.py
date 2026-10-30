from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import JobViewSet, CompanyViewSet

router = DefaultRouter()
router.register(r"jobs", JobViewSet, basename="job")
router.register(r"companies", CompanyViewSet, basename="company")

urlpatterns = [
    path("", include(router.urls)),
]
