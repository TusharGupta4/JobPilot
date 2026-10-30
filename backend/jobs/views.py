from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from django.db.models import Q

from .models import Job, Company
from .serializers import JobSerializer, CompanySerializer, DiscoveryFilterSerializer
from .services.discovery_engine import run_multi_portal_discovery
from .services.contact_enricher import enrich_company_contacts


class JobViewSet(viewsets.ModelViewSet):
    """
    API ViewSet for managing discovered jobs, triggering multi-portal searches,
    enriching contact info, and updating application status.
    """
    queryset = Job.objects.all().order_by("-match_score", "-discovered_at")
    serializer_class = JobSerializer

    def get_queryset(self):
        qs = super().get_queryset()
        priority = self.request.query_params.get("priority")
        status_filter = self.request.query_params.get("status")
        source = self.request.query_params.get("source")
        work_mode = self.request.query_params.get("work_mode")
        search = self.request.query_params.get("search")

        if priority:
            qs = qs.filter(priority_rank=priority.upper())
        if status_filter:
            qs = qs.filter(application_status=status_filter.upper())
        if source:
            qs = qs.filter(portal_source=source.lower())
        if work_mode:
            qs = qs.filter(work_mode=work_mode)
        if search:
            qs = qs.filter(
                Q(title__icontains=search) | Q(company_name__icontains=search) | Q(description__icontains=search)
            )

        return qs

    @action(detail=False, methods=["post"], url_path="discover")
    def discover(self, request):
        """
        Triggers multi-portal live discovery using user filters:
        - time_window (24h, 7d, 14d)
        - keywords / domain
        - location
        - experience (Fresher, Internship, Entry-level)
        - job_type
        - limit
        """
        serializer = DiscoveryFilterSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        filters = serializer.validated_data
        jobs = run_multi_portal_discovery(
            keywords=filters.get("keywords"),
            location=filters.get("location", "India"),
            time_window=filters.get("time_window", "24h"),
            experience=filters.get("experience", "Fresher"),
            job_type=filters.get("job_type", "Full-time"),
            limit=filters.get("limit", 30),
        )

        output_serializer = JobSerializer(jobs, many=True)
        return Response({
            "message": f"Successfully discovered {len(jobs)} jobs matching criteria.",
            "count": len(jobs),
            "jobs": output_serializer.data,
        })

    @action(detail=True, methods=["post"], url_path="enrich-contacts")
    def enrich_contacts(self, request, pk=None):
        """
        Crawls the company website and job description to discover official HR/career
        emails and contact phone numbers.
        """
        job = self.get_object()
        contacts = enrich_company_contacts(
            website_url=job.company_website or job.original_url,
            description=job.description
        )

        existing_emails = set(job.contact_emails or [])
        existing_phones = set(job.contact_phones or [])

        existing_emails.update(contacts["emails"])
        existing_phones.update(contacts["phones"])

        job.contact_emails = list(existing_emails)
        job.contact_phones = list(existing_phones)
        job.save(update_fields=["contact_emails", "contact_phones"])

        return Response({
            "message": "Company contacts enriched successfully.",
            "contact_emails": job.contact_emails,
            "contact_phones": job.contact_phones,
        })

    @action(detail=True, methods=["post"], url_path="update-status")
    def update_status(self, request, pk=None):
        """
        Updates the application status of a job (e.g. APPLIED, MANUAL_APPLY_NEEDED).
        """
        job = self.get_object()
        new_status = request.data.get("status")
        valid_statuses = [choice[0] for choice in Job.STATUS_CHOICES]

        job.application_status = new_status
        job.save(update_fields=["application_status"])
        return Response(JobSerializer(job).data)

    @action(detail=True, methods=["post"], url_path="ai-match")
    def ai_match(self, request, pk=None):
        """
        Runs deep AI matching & explanation using Gemini / heuristic fallback.
        """
        from .services.ai_matcher import analyze_job_match
        result = analyze_job_match(pk)
        return Response(result)

    @action(detail=True, methods=["post"], url_path="auto-apply")
    def auto_apply(self, request, pk=None):
        """
        Triggers stealth browser automation to auto-fill and submit job application.
        """
        from .services.auto_apply_runner import run_stealth_auto_apply
        result = run_stealth_auto_apply(pk)
        return Response(result)


class CompanyViewSet(viewsets.ModelViewSet):
    queryset = Company.objects.all()
    serializer_class = CompanySerializer

