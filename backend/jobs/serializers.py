from rest_framework import serializers
from .models import Job, Company, BulkApplyRun, BulkApplyItem, DiscoveryRun, DiscoveryResult
from .services.eligibility import is_auto_ready


class CompanySerializer(serializers.ModelSerializer):
    job_count = serializers.SerializerMethodField()
    active_jobs = serializers.SerializerMethodField()

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
            "is_contacted",
            "contacted_at",
            "outreach_notes",
            "job_count",
            "active_jobs",
            "created_at",
            "updated_at",
        ]

    def get_job_count(self, obj):
        return Job.objects.filter(company_name__iexact=obj.name).count()

    def get_active_jobs(self, obj):
        jobs = Job.objects.filter(company_name__iexact=obj.name).values("id", "title", "original_url", "application_status", "is_easy_apply")[:5]
        return list(jobs)


class JobSerializer(serializers.ModelSerializer):
    semantic_domains = serializers.SerializerMethodField()
    is_auto_ready = serializers.SerializerMethodField()
    auto_ready_reasons = serializers.SerializerMethodField()

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
            "min_years_required",
            "required_skills",
            "salary_min",
            "salary_max",
            "currency",
            "posted_at",
            "discovered_at",
            "last_verified_at",
            "is_easy_apply",
            "match_score",
            "priority_rank",
            "application_status",
            "listing_status",
            "apply_mode",
            "eligibility_reasons",
            "is_auto_ready",
            "auto_ready_reasons",
            "contact_emails",
            "contact_phones",
            "notes",
            "semantic_domains",
        ]

    def _experience_filter(self):
        request = self.context.get("request")
        if not request:
            return "Any"
        # Prefer explicit context (discovery run experience), then query/body
        ctx_exp = self.context.get("experience_filter")
        if ctx_exp:
            return ctx_exp
        data = getattr(request, "data", None) or {}
        body_exp = data.get("experience_level") or data.get("experience") if hasattr(data, "get") else None
        return (
            request.query_params.get("experience_level")
            or request.query_params.get("experience")
            or body_exp
            or "Any"
        )

    def get_semantic_domains(self, obj):
        from .services.semantic_domain_matcher import classify_job_domains
        return classify_job_domains(obj.title, obj.description, obj.required_skills)

    def get_is_auto_ready(self, obj):
        ok, _ = is_auto_ready(
            listing_status=obj.listing_status,
            is_easy_apply=obj.is_easy_apply,
            application_status=obj.application_status,
            experience_filter=self._experience_filter(),
            experience_level=obj.experience_level,
            min_years_required=obj.min_years_required,
            title=obj.title,
            description=obj.description,
        )
        return ok

    def get_auto_ready_reasons(self, obj):
        ok, reasons = is_auto_ready(
            listing_status=obj.listing_status,
            is_easy_apply=obj.is_easy_apply,
            application_status=obj.application_status,
            experience_filter=self._experience_filter(),
            experience_level=obj.experience_level,
            min_years_required=obj.min_years_required,
            title=obj.title,
            description=obj.description,
        )
        stored = list(obj.eligibility_reasons or [])
        merged = list(dict.fromkeys(stored + reasons))
        return [] if ok else merged


class DiscoveryRunSerializer(serializers.ModelSerializer):
    class Meta:
        model = DiscoveryRun
        fields = [
            "id",
            "status",
            "keywords",
            "location",
            "time_window",
            "experience",
            "job_type",
            "work_mode",
            "current_page",
            "max_pages",
            "has_more",
            "total_results",
            "created_at",
            "updated_at",
        ]


class BulkApplyItemSerializer(serializers.ModelSerializer):
    class Meta:
        model = BulkApplyItem
        fields = [
            "id",
            "job_id_snapshot",
            "title",
            "company_name",
            "url",
            "position",
            "status",
            "reason",
            "updated_at",
        ]


class BulkApplyRunSerializer(serializers.ModelSerializer):
    items = BulkApplyItemSerializer(many=True, read_only=True)
    completed = serializers.SerializerMethodField()
    current_job = serializers.SerializerMethodField()

    class Meta:
        model = BulkApplyRun
        fields = [
            "id",
            "status",
            "total_jobs",
            "completed",
            "experience_filter",
            "created_at",
            "updated_at",
            "current_job",
            "items",
        ]

    def get_completed(self, obj):
        return obj.completed_count()

    def get_current_job(self, obj):
        running = obj.items.filter(status="running").first()
        if running:
            return {
                "job_id": running.job_id_snapshot,
                "title": running.title,
                "company_name": running.company_name,
                "status": running.status,
            }
        return None


class DiscoveryFilterSerializer(serializers.Serializer):
    keywords = serializers.CharField(required=False, allow_blank=True, default="")
    location = serializers.CharField(required=False, allow_blank=True, default="India")
    time_window = serializers.ChoiceField(
        choices=["24h", "7d", "14d", "all"],
        default="24h"
    )
    experience = serializers.ChoiceField(
        choices=["Fresher", "0-2 Y", "0-3 Y", "1-3 Y", "Junior", "Mid", "Mid-Level", "Senior", "Lead", "Entry-level", "Internship", "Any"],
        default="Any"
    )
    job_type = serializers.ChoiceField(
        choices=["Full-time", "Internship", "Part-time", "Contract", "all"],
        default="all"
    )
    work_mode = serializers.ChoiceField(
        choices=["Remote", "Hybrid", "Onsite", "all"],
        default="all"
    )
    limit = serializers.IntegerField(default=30, min_value=5, max_value=100)
    page = serializers.IntegerField(default=1, min_value=1, required=False)
    selected_domains = serializers.ListField(
        child=serializers.CharField(),
        required=False,
        default=list
    )
