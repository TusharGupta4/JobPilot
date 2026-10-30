from rest_framework import serializers
from .models import Job, Company


class CompanySerializer(serializers.ModelSerializer):
    class Meta:
        model = Company
        fields = [
            "id",
            "name",
            "domain",
            "website",
            "careers_url",
            "contact_emails",
            "contact_phones",
            "ats_provider",
            "ats_slug",
            "created_at",
        ]


class JobSerializer(serializers.ModelSerializer):
    class Meta:
        model = Job
        fields = [
            "id",
            "title",
            "company_name",
            "company_website",
            "portal_source",
            "external_id",
            "original_url",
            "apply_url",
            "description",
            "locations",
            "work_mode",
            "job_type",
            "experience_level",
            "required_skills",
            "salary_min",
            "salary_max",
            "currency",
            "posted_at",
            "discovered_at",
            "is_easy_apply",
            "match_score",
            "priority_rank",
            "application_status",
            "contact_emails",
            "contact_phones",
            "notes",
        ]


class DiscoveryFilterSerializer(serializers.Serializer):
    keywords = serializers.CharField(required=False, allow_blank=True, default="")
    location = serializers.CharField(required=False, allow_blank=True, default="India")
    time_window = serializers.ChoiceField(
        choices=["24h", "7d", "14d", "all"],
        default="24h"
    )
    experience = serializers.ChoiceField(
        choices=["Fresher", "Internship", "Entry-level", "Any"],
        default="Fresher"
    )
    job_type = serializers.ChoiceField(
        choices=["Full-time", "Internship", "Part-time", "Contract"],
        default="Full-time"
    )
    limit = serializers.IntegerField(default=30, min_value=5, max_value=100)
