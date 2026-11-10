import os
os.environ["DJANGO_ALLOW_ASYNC_UNSAFE"] = "true"
from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from django.db.models import Q

from .models import Job, Company, BulkApplyRun, BulkApplyItem, DiscoveryRun, DiscoveryResult
from .serializers import (
    JobSerializer,
    CompanySerializer,
    DiscoveryFilterSerializer,
    BulkApplyRunSerializer,
    DiscoveryRunSerializer,
)
from .services.discovery_engine import run_multi_portal_discovery
from .services.contact_enricher import enrich_company_contacts
from .services.eligibility import candidate_max_years_for_filter, is_auto_ready
from .services.job_validator import check_job_liveness, is_patterned_hex_id, is_valid_job_url, extract_indeed_jk


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
        portal = self.request.query_params.get("portal")
        source = self.request.query_params.get("source") or portal
        domain = self.request.query_params.get("domain")
        work_mode = self.request.query_params.get("work_mode")
        job_type = self.request.query_params.get("job_type")
        search = self.request.query_params.get("search")
        listing = self.request.query_params.get("listing_status")

        if priority and priority.upper() != "ALL":
            qs = qs.filter(priority_rank=priority.upper())
        if status_filter and status_filter.upper() != "ALL":
            qs = qs.filter(application_status=status_filter.upper())
        if source and source.lower() not in ("all", "any"):
            qs = qs.filter(portal_source=source.lower())
        if work_mode and work_mode.lower() not in ("all", "any"):
            qs = qs.filter(work_mode=work_mode)
        if job_type and job_type.lower() not in ("all", "any"):
            qs = qs.filter(job_type__iexact=job_type)
        if search:
            qs = qs.filter(
                Q(title__icontains=search) | Q(company_name__icontains=search) | Q(description__icontains=search)
            )
        if listing and listing.lower() not in ("all", "any"):
            qs = qs.filter(listing_status=listing.lower())
        else:
            # Hide confirmed dead/fake jobs from default listing
            qs = qs.exclude(listing_status="expired")

        # Optional: scope to a discovery run (scan feed)
        run_id = self.request.query_params.get("discovery_run_id") or self.request.query_params.get("run_id")
        if run_id:
            qs = qs.filter(discovery_results__run_id=run_id).distinct()

        # Semantic Multi-Domain Filter
        domain_param = self.request.query_params.get("domain") or self.request.query_params.get("domains")
        if domain_param and domain_param.lower() not in ("all", "any"):
            from .services.semantic_domain_matcher import is_job_in_domains
            target_domains = [d.strip().lower() for d in domain_param.split(",") if d.strip() and d.strip().lower() not in ("all", "any")]
            if target_domains:
                matching_ids = [
                    j.id for j in qs
                    if is_job_in_domains(j.title, j.description, j.required_skills, target_domains)
                ]
                qs = qs.filter(id__in=matching_ids)

        # Timeline / Freshness Filter — require real posted_at
        time_window = self.request.query_params.get("time_window") or self.request.query_params.get("posted_within")
        if time_window and time_window.lower() not in ("all", "any"):
            from datetime import timedelta
            from django.utils import timezone
            now = timezone.now()
            if time_window == "24h":
                qs = qs.filter(posted_at__isnull=False, posted_at__gte=now - timedelta(hours=24))
            elif time_window == "7d":
                qs = qs.filter(posted_at__isnull=False, posted_at__gte=now - timedelta(days=7))
            elif time_window == "14d":
                qs = qs.filter(posted_at__isnull=False, posted_at__gte=now - timedelta(days=14))

        # Experience Level Filter — list/search only (detail retrieve must still resolve the row
        # so serializer can expose is_auto_ready=false + reasons)
        exp_level = self.request.query_params.get("experience_level") or self.request.query_params.get("experience")
        apply_exp = exp_level and exp_level.lower() not in ("all", "any")
        if apply_exp and getattr(self, "action", None) in (None, "list"):
            target_exp = exp_level.lower()
            max_y = candidate_max_years_for_filter(target_exp)

            if target_exp == "fresher":
                qs = qs.filter(Q(experience_level="Fresher") | Q(experience_level="Entry-level"))
            elif target_exp in ("0-2 y", "0-2", "0-2 years"):
                qs = qs.filter(Q(experience_level="Fresher") | Q(experience_level="Junior") | Q(experience_level="Entry-level"))
            elif target_exp in ("0-3 y", "0-3", "0-3 years"):
                # Mid only if min_years_required is null or <= 3 (exclude 4+ Mid roles)
                qs = qs.filter(
                    Q(experience_level="Fresher")
                    | Q(experience_level="Junior")
                    | Q(experience_level="Entry-level")
                    | (Q(experience_level__icontains="Mid") & (Q(min_years_required__isnull=True) | Q(min_years_required__lte=3)))
                )
            elif target_exp in ("1-3 y", "1-3", "1-3 years"):
                qs = qs.filter(
                    Q(experience_level="Junior")
                    | Q(experience_level="Entry-level")
                    | (Q(experience_level__icontains="Mid") & (Q(min_years_required__isnull=True) | Q(min_years_required__lte=3)))
                )
            elif target_exp in ("junior", "entry-level"):
                qs = qs.filter(Q(experience_level__iexact="Junior") | Q(experience_level__iexact="Entry-level") | Q(experience_level__iexact="Fresher"))
            elif target_exp in ("mid", "mid-level"):
                qs = qs.filter(Q(experience_level__iexact="Mid") | Q(experience_level__icontains="Mid"))
            elif target_exp == "senior":
                qs = qs.filter(Q(experience_level__iexact="Senior") | Q(experience_level__icontains="Senior"))
            elif target_exp == "lead":
                qs = qs.filter(Q(experience_level__iexact="Lead") | Q(experience_level__icontains="Lead"))
            else:
                qs = qs.filter(experience_level__icontains=exp_level)

            if max_y is not None:
                qs = qs.exclude(min_years_required__gt=max_y)

        return qs

    def list(self, request, *args, **kwargs):
        # Trigger automatic background contact enrichment for jobs with missing contacts
        import threading
        def _bg_enrich():
            try:
                jobs_without_contacts = Job.objects.filter(contact_emails__len=0)[:10]
                portal_domains = ["indeed.com", "wellfound.com", "cutshort.io", "naukri.com", "linkedin.com"]
                for j in jobs_without_contacts:
                    if j.company_website or j.company_name:
                        contacts = enrich_company_contacts(
                            website_url=j.company_website,
                            description=j.description,
                            company_name=j.company_name,
                        )
                        if contacts.get("emails") or contacts.get("phones") or contacts.get("website"):
                            j.contact_emails = contacts.get("emails", [])
                            j.contact_phones = contacts.get("phones", [])
                            is_portal = any(p in (j.company_website or "").lower() for p in portal_domains)
                            if contacts.get("website") and (not j.company_website or is_portal):
                                j.company_website = contacts["website"]
                            j.save(update_fields=["contact_emails", "contact_phones", "company_website"])
                            if j.company:
                                j.company.contact_emails = sorted(list(set((j.company.contact_emails or []) + contacts.get("emails", []))))
                                j.company.contact_phones = sorted(list(set((j.company.contact_phones or []) + contacts.get("phones", []))))
                                is_comp_portal = any(p in (j.company.website or "").lower() for p in portal_domains)
                                if contacts.get("website") and (not j.company.website or is_comp_portal):
                                    j.company.website = contacts["website"]
                                j.company.save()
            except Exception:
                pass

        threading.Thread(target=_bg_enrich, daemon=True).start()
        return super().list(request, *args, **kwargs)

    @action(detail=False, methods=["post"], url_path="bulk-contacts")
    def bulk_contacts(self, request):
        """
        Returns aggregated, deduplicated company and recruiter contact information
        for the specified list of job IDs.
        """
        job_ids = request.data.get("job_ids", [])
        if not job_ids:
            return Response({"error": "No job_ids provided"}, status=400)

        jobs = Job.objects.filter(id__in=job_ids).select_related("company")

        company_map = {}
        for j in jobs:
            c_name = j.company_name.strip()
            if c_name not in company_map:
                company_map[c_name] = {
                    "company_name": c_name,
                    "company_website": j.company_website or (j.company.website if j.company else ""),
                    "portal_source": j.portal_source,
                    "emails": set(j.contact_emails or []),
                    "phones": set(j.contact_phones or []),
                    "jobs": [],
                }
            if j.company and j.company.contact_emails:
                company_map[c_name]["emails"].update(j.company.contact_emails)
            if j.company and j.company.contact_phones:
                company_map[c_name]["phones"].update(j.company.contact_phones)

            company_map[c_name]["jobs"].append({
                "id": j.id,
                "title": j.title,
                "application_status": j.application_status,
                "is_easy_apply": j.is_easy_apply,
                "apply_url": j.apply_url or j.original_url
            })

        results = []
        all_emails = set()
        for c_name, data in company_map.items():
            emails_list = sorted(list(data["emails"]))
            phones_list = sorted(list(data["phones"]))
            all_emails.update(emails_list)
            results.append({
                "company_name": c_name,
                "company_website": data["company_website"],
                "portal_source": data["portal_source"],
                "contact_emails": emails_list,
                "contact_phones": phones_list,
                "job_count": len(data["jobs"]),
                "jobs": data["jobs"]
            })

        return Response({
            "total_companies": len(results),
            "total_unique_emails": len(all_emails),
            "all_emails": sorted(list(all_emails)),
            "companies": results
        })

    @action(detail=False, methods=["get"], url_path="domain-stats")
    def domain_stats(self, request):
        """
        Returns rich portal counts and semantic domain distribution metrics.
        """
        from .services.semantic_domain_matcher import DOMAINS_METADATA, classify_job_domains
        all_jobs = list(Job.objects.all())

        # Portal counts
        portal_counts = {
            "all": len(all_jobs),
            "indeed": sum(1 for j in all_jobs if j.portal_source == "indeed"),
            "wellfound": sum(1 for j in all_jobs if j.portal_source == "wellfound"),
            "cutshort": sum(1 for j in all_jobs if j.portal_source == "cutshort"),
            "ats_direct": sum(1 for j in all_jobs if j.portal_source == "ats_direct"),
        }

        # Domain counts
        domain_counts = {}
        for d_key in DOMAINS_METADATA.keys():
            if d_key == "all":
                domain_counts["all"] = len(all_jobs)
            else:
                domain_counts[d_key] = sum(
                    1 for j in all_jobs
                    if d_key in classify_job_domains(j.title, j.description, j.required_skills)
                )

        domains_payload = []
        for d_key, meta in DOMAINS_METADATA.items():
            item = dict(meta)
            item["job_count"] = domain_counts.get(d_key, 0)
            domains_payload.append(item)

        return Response({
            "total_jobs": len(all_jobs),
            "portals": portal_counts,
            "domains": domains_payload,
        })

    @action(detail=False, methods=["post"], url_path="discover")
    def discover(self, request):
        """
        Scan & Discover: crawl live portals into a DiscoveryRun (scan session).
        Page 1 creates a new run (replaces previous feed). Later pages continue the same run.
        """
        serializer = DiscoveryFilterSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        filters = serializer.validated_data
        page_num = filters.get("page", 1)
        run_id = request.data.get("discovery_run_id") or request.data.get("run_id")
        max_pages = int(request.data.get("max_pages") or 10)

        if page_num <= 1 or not run_id:
            # New scan — mark prior running scans completed
            DiscoveryRun.objects.filter(status="running").update(status="completed")
            run = DiscoveryRun.objects.create(
                keywords=filters.get("keywords") or "",
                location=filters.get("location", "India"),
                time_window=filters.get("time_window", "24h"),
                experience=filters.get("experience", "Any"),
                job_type=filters.get("job_type", "all"),
                work_mode=filters.get("work_mode", "all"),
                current_page=1,
                max_pages=max_pages,
                status="running",
            )
        else:
            run = DiscoveryRun.objects.filter(id=run_id).first()
            if not run:
                return Response({"error": "Discovery run not found"}, status=404)

        discovery_res = run_multi_portal_discovery(
            keywords=filters.get("keywords"),
            location=filters.get("location", "India"),
            time_window=filters.get("time_window", "24h"),
            experience=filters.get("experience", "Any"),
            job_type=filters.get("job_type", "all"),
            work_mode=filters.get("work_mode", "all"),
            page=page_num,
            limit=filters.get("limit", 30),
            discovery_run=run,
            selected_domains=filters.get("selected_domains") or request.data.get("selected_domains") or [],
        )

        if isinstance(discovery_res, tuple):
            jobs, has_more = discovery_res
        else:
            jobs, has_more = discovery_res, False

        # Cap: if we've hit max_pages, stop advertising more
        if page_num >= run.max_pages:
            has_more = False
            run.has_more = False
            run.status = "completed"
            run.save(update_fields=["has_more", "status", "updated_at"])

        # Full feed for this run (not just this page) — discovery page source of truth
        run_jobs = (
            Job.objects.filter(discovery_results__run=run)
            .distinct()
            .order_by("-match_score", "-discovered_at")
        )
        # Applied overlay already preserved on Job.application_status during upsert
        output_serializer = JobSerializer(
            run_jobs,
            many=True,
            context={"request": request, "experience_filter": run.experience or filters.get("experience", "Any")},
        )
        run.refresh_from_db()
        return Response({
            "message": f"Page {page_num}: Found {len(jobs)} jobs this page; {run.total_results} in this scan.",
            "count": run.total_results,
            "page_count": len(jobs),
            "page": page_num,
            "has_more": has_more and page_num < run.max_pages,
            "discovery_run_id": run.id,
            "run": DiscoveryRunSerializer(run).data,
            "jobs": output_serializer.data,
        })

    @action(detail=False, methods=["get"], url_path="discovery/latest")
    def discovery_latest(self, request):
        """Jobs & Discovery feed: latest DiscoveryRun results only (not full Job warehouse)."""
        run = DiscoveryRun.objects.order_by("-created_at").first()
        if not run:
            return Response({
                "run": None,
                "jobs": [],
                "count": 0,
                "message": "No discovery scan yet. Click Scan & Discover Now.",
            })
        jobs = (
            Job.objects.filter(discovery_results__run=run)
            .exclude(listing_status="expired")
            .distinct()
            .order_by("-match_score", "-discovered_at")
        )
        exp = request.query_params.get("experience") or run.experience or "Any"
        ser = JobSerializer(
            jobs,
            many=True,
            context={"request": request, "experience_filter": exp},
        )
        data = ser.data
        return Response({
            "run": DiscoveryRunSerializer(run).data,
            "jobs": data,
            "count": len(data),
            "experience_filter": exp,
        })

    @action(detail=False, methods=["post"], url_path="discovery/heal-statuses")
    def heal_discovery_statuses(self, request):
        """
        One-shot fix for rows stuck as unverified after migration:
        trust portal-sourced easy-apply jobs as active for One-Click.
        """
        qs = Job.objects.exclude(listing_status="expired")
        updated = qs.filter(listing_status="unverified").update(listing_status="active")
        easy_fixed = 0
        mode_fixed = 0
        for j in Job.objects.filter(application_status="AUTO_APPLY_ELIGIBLE", is_easy_apply=False):
            j.is_easy_apply = True
            j.apply_mode = "one_click"
            j.save(update_fields=["is_easy_apply", "apply_mode"])
            easy_fixed += 1
        for j in Job.objects.filter(is_easy_apply=True).exclude(
            application_status__in=["APPLIED", "AUTO_APPLIED", "REJECTED"]
        ):
            fields = []
            if j.apply_mode != "one_click":
                j.apply_mode = "one_click"
                fields.append("apply_mode")
            # Only promote MANUAL_APPLY_NEEDED if there are no eligibility reasons (e.g. legacy unverified rows)
            if j.application_status == "MANUAL_APPLY_NEEDED" and not (j.eligibility_reasons and len(j.eligibility_reasons) > 0):
                j.application_status = "AUTO_APPLY_ELIGIBLE"
                fields.append("application_status")
            if fields:
                j.save(update_fields=fields)
                mode_fixed += 1
        return Response({
            "listing_status_healed": updated,
            "easy_apply_restored": easy_fixed,
            "apply_mode_healed": mode_fixed,
            "active_easy_apply": Job.objects.filter(is_easy_apply=True, listing_status="active").exclude(
                application_status__in=["APPLIED", "AUTO_APPLIED", "REJECTED"]
            ).count(),
        })

    @action(detail=True, methods=["post"], url_path="enrich-contacts")
    def enrich_contacts(self, request, pk=None):
        """
        Crawls the company website and job description to discover official HR/career
        emails and contact phone numbers.
        """
        job = self.get_object()
        contacts = enrich_company_contacts(
            website_url=job.company_website,
            description=job.description,
            company_name=job.company_name,
        )

        existing_emails = set(job.contact_emails or [])
        existing_phones = set(job.contact_phones or [])

        existing_emails.update(contacts["emails"])
        existing_phones.update(contacts["phones"])

        job.contact_emails = list(existing_emails)
        job.contact_phones = list(existing_phones)
        update_fields = ["contact_emails", "contact_phones"]

        portal_domains = ["indeed.com", "wellfound.com", "cutshort.io", "naukri.com", "linkedin.com"]
        is_portal = any(p in (job.company_website or "").lower() for p in portal_domains)
        if contacts.get("website") and (not job.company_website or is_portal):
            job.company_website = contacts["website"]
            update_fields.append("company_website")

        job.save(update_fields=update_fields)

        # IMMEDIATELY SYNC TO LINKED COMPANY RECORD
        if job.company:
            comp_e = set(job.company.contact_emails or [])
            comp_p = set(job.company.contact_phones or [])
            comp_e.update(contacts["emails"])
            comp_p.update(contacts["phones"])
            job.company.contact_emails = sorted(list(comp_e))
            job.company.contact_phones = sorted(list(comp_p))
            if contacts.get("website") and (not job.company.website or is_portal):
                job.company.website = contacts["website"]
            job.company.save()

        if contacts["emails"] or contacts["phones"]:
            msg = f"Discovered {len(contacts['emails'])} email(s) and {len(contacts['phones'])} phone(s) on official company pages."
        else:
            msg = "Scanned company website & description. No public email or phone published on their pages (site uses online web form)."

        return Response({
            "message": msg,
            "company_website": job.company_website,
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

    @action(detail=False, methods=["post"], url_path="record-application")
    def record_application(self, request):
        """
        Callback endpoint used by the JobPilot Chrome Extension when a candidate
        submits an application on external portals (Indeed, Wellfound, LinkedIn, etc.).
        Automatically marks or records the job as APPLIED in PostgreSQL.
        Never creates fake jobs from invalid / placeholder URLs.
        """
        from django.utils import timezone as dj_tz

        url = request.data.get("url", "")
        job_id = request.data.get("job_id")
        title = request.data.get("title", "")
        company = request.data.get("company", "")
        status_val = request.data.get("status", "APPLIED")
        bulk_status = request.data.get("bulk_status")  # queued|running|applied|skipped_*|...
        bulk_reason = request.data.get("reason") or request.data.get("notes") or ""
        run_id = request.data.get("run_id")

        job = None
        if job_id:
            job = Job.objects.filter(id=job_id).first()

        if not job and url:
            jk_val = extract_indeed_jk(url)
            if jk_val:
                if is_patterned_hex_id(jk_val):
                    return Response({
                        "success": False,
                        "message": "Rejected placeholder Indeed job key; not recording.",
                    }, status=400)
                job = Job.objects.filter(
                    Q(external_id=jk_val) | Q(original_url__icontains=jk_val) | Q(apply_url__icontains=jk_val)
                ).first()

            if not job:
                job = Job.objects.filter(Q(original_url=url) | Q(apply_url=url)).first()
            if not job and len(url) > 25:
                clean_url = url.split("?")[0]
                job = Job.objects.filter(Q(original_url__icontains=clean_url) | Q(apply_url__icontains=clean_url)).first()

        if not job and company:
            matching_company_jobs = Job.objects.filter(company_name__icontains=company)
            for cand in matching_company_jobs:
                if not title:
                    job = cand
                    break
                c_title = cand.title.lower().strip()
                t_lower = title.lower().strip()
                if c_title in t_lower or t_lower in c_title:
                    job = cand
                    break
            if not job and matching_company_jobs.count() == 1:
                job = matching_company_jobs.first()

        # Map extension bulk outcome → job application_status / listing_status
        TERMINAL_APPLIED = {"APPLIED", "AUTO_APPLIED", "applied"}
        SKIP_EXPIRED = {"skipped_expired", "SKIPPED_EXPIRED"}
        SKIP_INELIGIBLE = {"skipped_ineligible", "SKIPPED_INELIGIBLE"}
        BLOCKED = {"blocked_challenge", "BLOCKED_CHALLENGE"}

        if job:
            update_fields = []
            # Only mark APPLIED after confirmed success (never on AUTO_APPLY_ELIGIBLE sync)
            if status_val in TERMINAL_APPLIED or bulk_status == "applied":
                job.application_status = "APPLIED"
                job.is_easy_apply = False
                job.apply_mode = "already_applied"
                update_fields.extend(["application_status", "is_easy_apply", "apply_mode"])
            elif status_val == "MANUAL_APPLY_NEEDED" or bulk_status in SKIP_INELIGIBLE:
                job.application_status = "MANUAL_APPLY_NEEDED"
                job.is_easy_apply = False
                job.apply_mode = "ineligible"
                update_fields.extend(["application_status", "is_easy_apply", "apply_mode"])
                if bulk_reason:
                    reasons = list(job.eligibility_reasons or [])
                    if bulk_reason not in reasons:
                        reasons.append(bulk_reason)
                    job.eligibility_reasons = reasons
                    update_fields.append("eligibility_reasons")
            elif bulk_status in SKIP_EXPIRED or status_val == "REJECTED":
                job.listing_status = "expired"
                job.is_easy_apply = False
                job.application_status = "REJECTED"
                job.apply_mode = "ineligible"
                update_fields.extend(["listing_status", "is_easy_apply", "application_status", "apply_mode"])
            elif bulk_status == "failed":
                job.application_status = "MANUAL_APPLY_NEEDED"
                job.is_easy_apply = False
                job.apply_mode = "manual_external"
                update_fields.extend(["application_status", "is_easy_apply", "apply_mode"])
                if bulk_reason:
                    reasons = list(job.eligibility_reasons or [])
                    if bulk_reason not in reasons:
                        reasons.append(bulk_reason)
                    job.eligibility_reasons = reasons
                    update_fields.append("eligibility_reasons")
            elif bulk_status in BLOCKED:
                # Keep listing; pause for manual — do not mark applied
                if bulk_reason:
                    job.notes = (job.notes or "") + f"\n[blocked_challenge] {bulk_reason}"
                    update_fields.append("notes")
            elif status_val == "AUTO_APPLY_ELIGIBLE":
                # Pre-apply sync only — do not overwrite applied/rejected
                if job.application_status not in ("APPLIED", "AUTO_APPLIED", "REJECTED"):
                    job.application_status = "AUTO_APPLY_ELIGIBLE"
                    update_fields.append("application_status")

            if "is_easy_apply" in request.data and status_val not in TERMINAL_APPLIED:
                job.is_easy_apply = bool(request.data["is_easy_apply"])
                if "is_easy_apply" not in update_fields:
                    update_fields.append("is_easy_apply")

            if update_fields:
                job.save(update_fields=list(dict.fromkeys(update_fields)))

            # Propagate into BulkApplyItem if run_id / job present
            if run_id and bulk_status:
                item = BulkApplyItem.objects.filter(run_id=run_id, job_id_snapshot=job.id).first()
                if item and item.status not in ("applied",):
                    item.status = bulk_status
                    item.reason = bulk_reason or item.reason
                    item.save(update_fields=["status", "reason", "updated_at"])
                    run = item.run
                    if bulk_status == "blocked_challenge":
                        run.status = "paused"
                        run.save(update_fields=["status", "updated_at"])
                    else:
                        terminal = {"applied", "skipped_expired", "skipped_ineligible", "failed"}
                        if run.items.filter(status__in=terminal).count() >= run.total_jobs:
                            run.status = "completed"
                            run.save(update_fields=["status", "updated_at"])
                        elif run.status == "paused" and bulk_status in ("running", "applied"):
                            run.status = "running"
                            run.save(update_fields=["status", "updated_at"])

            return Response({
                "success": True,
                "message": f"Successfully updated '{job.title}' at '{job.company_name}'.",
                "job_id": job.id,
                "title": job.title,
                "company_name": job.company_name,
                "status": job.application_status,
                "listing_status": job.listing_status,
                "is_easy_apply": job.is_easy_apply,
            })

        # Strictly ignore tracker / application hub URLs from creating bogus jobs
        url_lower = (url or "").lower()
        title_lower = (title or "").lower()
        if (
            any(ignored in url_lower for ignored in ("/jobs/applications", "/applications", "/applied", "/saved", "/messages", "/preferences", "/track")) or
            "job applications" in title_lower
        ):
            return Response({
                "success": True,
                "message": "Ignored application hub/tracker URL from creating job record."
            })

        # Do NOT create jobs from invalid / placeholder URLs (root cause of fake Indeed rows)
        portal_source = (
            "cutshort" if "cutshort" in url_lower else
            "indeed" if "indeed" in url_lower else
            "wellfound" if "wellfound" in url_lower else
            "linkedin" if "linkedin" in url_lower else
            "manual"
        )
        if not url or not is_valid_job_url(url, portal_source):
            return Response({
                "success": False,
                "message": "Refused to create job from invalid or placeholder URL.",
            }, status=400)

        listing_status, live_reason = check_job_liveness(url, timeout=3.0)
        if listing_status == "expired":
            return Response({
                "success": False,
                "message": f"Refused to create expired job: {live_reason}",
            }, status=400)

        new_job = Job.objects.create(
            title=title or "Applied Position",
            company_name=company or "Unknown Company",
            original_url=url,
            apply_url=url,
            portal_source=portal_source if portal_source != "manual" else "manual",
            application_status="APPLIED" if status_val in TERMINAL_APPLIED else status_val,
            listing_status=listing_status,
            last_verified_at=dj_tz.now(),
            match_score=85,
            priority_rank="MEDIUM",
            is_easy_apply=False,
        )
        return Response({
            "success": True,
            "message": f"Recorded new application for '{new_job.title}' at '{new_job.company_name}'.",
            "job_id": new_job.id,
            "title": new_job.title,
            "company_name": new_job.company_name,
            "status": new_job.application_status,
        })

    @action(detail=False, methods=["post"], url_path="bulk-apply/start")
    def bulk_apply_start(self, request):
        """
        Create a BulkApplyRun with per-job queued items. Extension posts transitions;
        dashboard polls GET bulk-apply/<id>/.
        """
        jobs_payload = request.data.get("jobs") or []
        experience_filter = request.data.get("experience_filter") or "Any"
        if not jobs_payload:
            return Response({"error": "jobs required"}, status=400)

        run = BulkApplyRun.objects.create(
            total_jobs=len(jobs_payload),
            experience_filter=experience_filter,
            status="running",
        )
        for idx, j in enumerate(jobs_payload):
            jid = j.get("id") or j.get("job_id")
            job = Job.objects.filter(id=jid).first() if jid else None
            # Pre-flight eligibility — mark skipped_ineligible immediately when not auto-ready
            status_val = "queued"
            reason = ""
            if job:
                ok, reasons = is_auto_ready(
                    listing_status=job.listing_status,
                    is_easy_apply=job.is_easy_apply,
                    application_status=job.application_status,
                    experience_filter=experience_filter,
                    experience_level=job.experience_level,
                    min_years_required=job.min_years_required,
                    title=job.title,
                    description=job.description,
                )
                if not ok:
                    status_val = "skipped_ineligible"
                    reason = "; ".join(reasons) or "Ineligible for bulk apply"
                elif job.listing_status == "expired":
                    status_val = "skipped_expired"
                    reason = "Listing expired"
            BulkApplyItem.objects.create(
                run=run,
                job=job,
                job_id_snapshot=int(jid or 0),
                title=(job.title if job else j.get("title", "")),
                company_name=(job.company_name if job else j.get("company", "")),
                url=(job.apply_url or job.original_url) if job else j.get("url", ""),
                position=idx,
                status=status_val,
                reason=reason,
            )

        return Response(BulkApplyRunSerializer(run).data, status=201)

    @action(detail=False, methods=["get"], url_path=r"bulk-apply/(?P<run_id>[0-9]+)")
    def bulk_apply_status(self, request, run_id=None):
        run = BulkApplyRun.objects.filter(id=run_id).prefetch_related("items").first()
        if not run:
            return Response({"error": "Run not found"}, status=404)
        return Response(BulkApplyRunSerializer(run).data)

    @action(detail=False, methods=["post"], url_path=r"bulk-apply/(?P<run_id>[0-9]+)/item")
    def bulk_apply_item_update(self, request, run_id=None):
        """POST every per-job transition: queued→running→applied|skipped_*|blocked_challenge|failed."""
        run = BulkApplyRun.objects.filter(id=run_id).first()
        if not run:
            return Response({"error": "Run not found"}, status=404)

        job_id = request.data.get("job_id")
        new_status = request.data.get("status")
        reason = request.data.get("reason", "")
        valid = {c[0] for c in BulkApplyItem.STATUS_CHOICES}
        if new_status not in valid:
            return Response({"error": f"Invalid status. Use one of {sorted(valid)}"}, status=400)

        item = BulkApplyItem.objects.filter(run=run, job_id_snapshot=job_id).first()
        if not item:
            return Response({"error": "Item not found"}, status=404)

        item.status = new_status
        item.reason = reason or item.reason
        item.save(update_fields=["status", "reason", "updated_at"])

        # Mirror onto Job row for dashboard badges
        job = item.job or Job.objects.filter(id=job_id).first()
        if job:
            if new_status == "applied":
                job.application_status = "APPLIED"
                job.is_easy_apply = False
                job.apply_mode = "already_applied"
                job.save(update_fields=["application_status", "is_easy_apply", "apply_mode"])
            elif new_status == "skipped_expired":
                job.listing_status = "expired"
                job.is_easy_apply = False
                job.application_status = "REJECTED"
                job.apply_mode = "ineligible"
                job.save(update_fields=["listing_status", "is_easy_apply", "application_status", "apply_mode"])
            elif new_status == "skipped_ineligible":
                job.is_easy_apply = False
                job.application_status = "MANUAL_APPLY_NEEDED"
                job.apply_mode = "ineligible"
                reasons = list(job.eligibility_reasons or [])
                if reason and reason not in reasons:
                    reasons.append(reason)
                job.eligibility_reasons = reasons
                job.save(update_fields=["is_easy_apply", "application_status", "apply_mode", "eligibility_reasons"])
            elif new_status == "failed":
                job.is_easy_apply = False
                job.application_status = "MANUAL_APPLY_NEEDED"
                job.apply_mode = "manual_external"
                reasons = list(job.eligibility_reasons or [])
                if reason and reason not in reasons:
                    reasons.append(reason)
                job.eligibility_reasons = reasons
                job.save(update_fields=["is_easy_apply", "application_status", "apply_mode", "eligibility_reasons"])

        terminal = {"applied", "skipped_expired", "skipped_ineligible", "failed"}
        if new_status == "blocked_challenge":
            run.status = "paused"
            run.save(update_fields=["status", "updated_at"])
        elif run.items.exclude(status__in=terminal | {"queued"}).count() >= 0:
            done = run.items.filter(status__in=terminal).count()
            if done >= run.total_jobs:
                run.status = "completed"
                run.save(update_fields=["status", "updated_at"])
            elif run.status == "paused" and new_status not in ("blocked_challenge", "paused"):
                run.status = "running"
                run.save(update_fields=["status", "updated_at"])

        return Response(BulkApplyRunSerializer(run).data)

    @action(detail=False, methods=["post"], url_path=r"bulk-apply/(?P<run_id>[0-9]+)/cancel")
    def bulk_apply_cancel(self, request, run_id=None):
        run = BulkApplyRun.objects.filter(id=run_id).first()
        if not run:
            return Response({"error": "Run not found"}, status=404)
        run.status = "cancelled"
        run.save(update_fields=["status", "updated_at"])
        run.items.filter(status__in=("queued", "running")).update(status="failed", reason="Cancelled by user")
        return Response(BulkApplyRunSerializer(run).data)

    @action(detail=True, methods=["post"], url_path="verify-liveness")
    def verify_liveness(self, request, pk=None):
        """Re-check job URL shortly before apply; updates listing_status."""
        from django.utils import timezone as dj_tz
        job = self.get_object()
        listing_status, reason = check_job_liveness(job.apply_url or job.original_url, timeout=4.0)
        job.listing_status = listing_status
        job.last_verified_at = dj_tz.now()
        update_fields = ["listing_status", "last_verified_at"]
        if listing_status == "expired":
            job.is_easy_apply = False
            job.application_status = "REJECTED"
            update_fields.extend(["is_easy_apply", "application_status"])
        job.save(update_fields=update_fields)
        return Response({
            "job_id": job.id,
            "listing_status": listing_status,
            "reason": reason,
            "is_auto_ready": is_auto_ready(
                listing_status=job.listing_status,
                is_easy_apply=job.is_easy_apply,
                application_status=job.application_status,
                experience_level=job.experience_level,
                min_years_required=job.min_years_required,
                title=job.title,
                description=job.description,
            )[0],
        })

    @action(detail=False, methods=["post"], url_path="purge-fake-jobs")
    def purge_fake_jobs(self, request):
        """Flag/delete patterned Indeed placeholder IDs and invalid company rows."""
        from django.utils import timezone as dj_tz
        dry_run = bool(request.data.get("dry_run", False))
        flagged = []
        for job in Job.objects.filter(portal_source="indeed"):
            jk = (job.external_id or extract_indeed_jk(job.original_url) or "").lower()
            bad = False
            reason = ""
            if jk and is_patterned_hex_id(jk):
                bad = True
                reason = f"patterned jk={jk}"
            elif not is_valid_job_url(job.original_url, "indeed"):
                bad = True
                reason = "invalid indeed url"
            if bad:
                flagged.append({"id": job.id, "title": job.title, "url": job.original_url, "reason": reason})
                if not dry_run:
                    job.listing_status = "expired"
                    job.is_easy_apply = False
                    job.application_status = "REJECTED"
                    job.eligibility_reasons = list(job.eligibility_reasons or []) + [f"Purged fake/dead: {reason}"]
                    job.last_verified_at = dj_tz.now()
                    job.save(update_fields=[
                        "listing_status", "is_easy_apply", "application_status",
                        "eligibility_reasons", "last_verified_at",
                    ])
        return Response({"flagged": len(flagged), "jobs": flagged, "dry_run": dry_run})



class CompanyViewSet(viewsets.ModelViewSet):
    queryset = Company.objects.all().order_by("name")
    serializer_class = CompanySerializer

    def get_queryset(self):
        qs = super().get_queryset()
        search = self.request.query_params.get("search")
        contacted = self.request.query_params.get("contacted")
        has_contacts = self.request.query_params.get("has_contacts")

        if search:
            qs = qs.filter(
                Q(name__icontains=search) |
                Q(domain__icontains=search) |
                Q(website__icontains=search)
            )
        if contacted is not None and contacted != "":
            if contacted.lower() in ("true", "1", "yes"):
                qs = qs.filter(is_contacted=True)
            elif contacted.lower() in ("false", "0", "no"):
                qs = qs.filter(is_contacted=False)

        # Filter: only companies with verified contacts
        if has_contacts and has_contacts.lower() in ("true", "1", "yes"):
            qs = qs.exclude(contact_emails__len=0, contact_phones__len=0)

        return qs

    def list(self, request, *args, **kwargs):
        # Auto-sync contacts from existing jobs to their companies if missing
        companies_without_contacts = Company.objects.filter(contact_emails__len=0)
        for c in companies_without_contacts:
            related_jobs = Job.objects.filter(company=c).exclude(contact_emails__len=0)
            if not related_jobs.exists():
                related_jobs = Job.objects.filter(company_name__iexact=c.name).exclude(contact_emails__len=0)
            all_e = set()
            all_p = set()
            for rj in related_jobs:
                all_e.update(rj.contact_emails or [])
                all_p.update(rj.contact_phones or [])
            if all_e or all_p:
                c.contact_emails = sorted(list(all_e))
                c.contact_phones = sorted(list(all_p))
                c.save(update_fields=["contact_emails", "contact_phones"])
        return super().list(request, *args, **kwargs)

    @action(detail=True, methods=["post"], url_path="toggle-contacted")
    def toggle_contacted(self, request, pk=None):
        company = self.get_object()
        company.is_contacted = not company.is_contacted
        from django.utils import timezone
        company.contacted_at = timezone.now() if company.is_contacted else None
        company.save(update_fields=["is_contacted", "contacted_at", "updated_at"])
        return Response(CompanySerializer(company).data)

    @action(detail=True, methods=["post"], url_path="enrich")
    def enrich(self, request, pk=None):
        company = self.get_object()
        res = enrich_company_contacts(website_url=company.website, company_name=company.name)
        if res.get("emails"):
            existing = set(company.contact_emails or [])
            existing.update(res["emails"])
            company.contact_emails = sorted(list(existing))
        if res.get("phones"):
            existing_p = set(company.contact_phones or [])
            existing_p.update(res["phones"])
            company.contact_phones = sorted(list(existing_p))
        if res.get("website") and not company.website:
            company.website = res["website"]
        company.save()
        return Response(CompanySerializer(company).data)

    @action(detail=False, methods=["get", "post"], url_path="export")
    def export_csv(self, request):
        import csv
        from django.http import HttpResponse

        company_ids = request.data.get("company_ids") if request.method == "POST" else None
        if not company_ids:
            ids_param = request.query_params.get("ids")
            if ids_param:
                company_ids = [int(i.strip()) for i in ids_param.split(",") if i.strip().isdigit()]

        if company_ids:
            companies = Company.objects.filter(id__in=company_ids).order_by("name")
        else:
            companies = self.get_queryset()

        response = HttpResponse(content_type="text/csv; charset=utf-8")
        response["Content-Disposition"] = 'attachment; filename="JobPilot_Companies_Directory.csv"'

        writer = csv.writer(response)
        writer.writerow([
            "Company Name",
            "Website",
            "Primary Email",
            "All Discovered Emails",
            "Contact Phone Numbers",
            "Contacted Status",
            "Contacted Date",
            "Active Job Roles",
            "Outreach Notes"
        ])

        for c in companies:
            emails = c.contact_emails or []
            phones = c.contact_phones or []
            primary_email = emails[0] if emails else ""
            all_emails_str = "; ".join(emails)
            phones_str = "; ".join(phones)
            contacted_str = "Contacted" if c.is_contacted else "Not Contacted"
            date_str = c.contacted_at.strftime("%Y-%m-%d %H:%M") if c.contacted_at else ""
            
            jobs = Job.objects.filter(company_name__iexact=c.name).values_list("title", flat=True)
            jobs_str = "; ".join(list(jobs)[:5])

            writer.writerow([
                c.name,
                c.website or "",
                primary_email,
                all_emails_str,
                phones_str,
                contacted_str,
                date_str,
                jobs_str,
                c.outreach_notes or ""
            ])

        return response

    @action(detail=False, methods=["get", "post"], url_path="outreach-settings")
    def outreach_settings(self, request):
        from .services.email_outreach_service import get_outreach_credentials, save_outreach_credentials
        if request.method == "POST":
            sender_email = request.data.get("sender_email", "")
            sender_password = request.data.get("sender_password", "")
            sender_name = request.data.get("sender_name", "")
            if not sender_email or not sender_password:
                return Response({"error": "sender_email and sender_password are required"}, status=status.HTTP_400_BAD_REQUEST)
            res = save_outreach_credentials(sender_email, sender_password, sender_name)
            return Response(res, status=status.HTTP_200_OK)
        else:
            creds = get_outreach_credentials()
            return Response({
                "sender_email": creds["sender_email"],
                "sender_name": creds["sender_name"],
                "has_password": bool(creds["sender_password"]),
                "smtp_server": creds["smtp_server"],
                "smtp_port": creds["smtp_port"]
            })

    @action(detail=False, methods=["post"], url_path="test-smtp")
    def test_smtp(self, request):
        from .services.email_outreach_service import test_smtp_connection, get_outreach_credentials
        creds = get_outreach_credentials()
        sender_email = request.data.get("sender_email") or creds["sender_email"]
        sender_password = request.data.get("sender_password") or creds["sender_password"]
        res = test_smtp_connection(sender_email, sender_password)
        return Response(res, status=status.HTTP_200_OK if res["success"] else status.HTTP_400_BAD_REQUEST)

    @action(detail=True, methods=["post"], url_path="generate-draft")
    def generate_draft(self, request, pk=None):
        company = self.get_object()
        from .services.email_outreach_service import generate_tailored_email_draft
        draft = generate_tailored_email_draft(company.id)
        return Response(draft, status=status.HTTP_200_OK if draft.get("success") else status.HTTP_400_BAD_REQUEST)

    @action(detail=True, methods=["post"], url_path="send-email")
    def send_email(self, request, pk=None):
        company = self.get_object()
        to_email = request.data.get("to_email", "").strip()
        subject = request.data.get("subject", "").strip()
        body = request.data.get("body", "").strip()

        if not to_email:
            return Response({"error": "to_email is required"}, status=status.HTTP_400_BAD_REQUEST)
        if not subject or not body:
            return Response({"error": "subject and body are required"}, status=status.HTTP_400_BAD_REQUEST)

        from .services.email_outreach_service import send_tailored_outreach_email
        res = send_tailored_outreach_email(
            company_id=company.id,
            to_email=to_email,
            subject=subject,
            body=body
        )
        return Response(res, status=status.HTTP_200_OK if res.get("success") else status.HTTP_400_BAD_REQUEST)

    @action(detail=False, methods=["post"], url_path="bulk-send-emails")
    def bulk_send_emails(self, request):
        company_ids = request.data.get("company_ids", [])
        if not company_ids:
            return Response({"error": "company_ids list is required"}, status=status.HTTP_400_BAD_REQUEST)

        from .services.email_outreach_service import generate_tailored_email_draft, send_tailored_outreach_email
        results = []
        sent_count = 0
        failed_count = 0

        companies = Company.objects.filter(id__in=company_ids)
        for c in companies:
            if not c.contact_emails or len(c.contact_emails) == 0:
                results.append({
                    "company_id": c.id,
                    "company_name": c.name,
                    "success": False,
                    "error": "No verified contact email found for this company."
                })
                failed_count += 1
                continue

            target_email = c.contact_emails[0]
            draft = generate_tailored_email_draft(c.id)
            if not draft.get("success"):
                results.append({
                    "company_id": c.id,
                    "company_name": c.name,
                    "success": False,
                    "error": draft.get("error", "Failed to generate customized email.")
                })
                failed_count += 1
                continue

            send_res = send_tailored_outreach_email(
                company_id=c.id,
                to_email=target_email,
                subject=draft["subject"],
                body=draft["body"]
            )
            if send_res.get("success"):
                sent_count += 1
                results.append({
                    "company_id": c.id,
                    "company_name": c.name,
                    "to_email": target_email,
                    "success": True,
                    "message": "Sent tailored cold email with CV attached."
                })
            else:
                failed_count += 1
                results.append({
                    "company_id": c.id,
                    "company_name": c.name,
                    "to_email": target_email,
                    "success": False,
                    "error": send_res.get("error", "Failed to send.")
                })

        return Response({
            "success": True,
            "total_requested": len(company_ids),
            "sent_count": sent_count,
            "failed_count": failed_count,
            "results": results
        })


