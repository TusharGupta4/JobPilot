from django.db import models
from django.utils import timezone


class Company(models.Model):
    """
    Company record storing official domain, careers page, and verified contact details.
    """
    name = models.CharField(max_length=255, db_index=True)
    domain = models.CharField(max_length=255, blank=True, default="", db_index=True)
    website = models.URLField(max_length=500, blank=True, default="")
    careers_url = models.URLField(max_length=500, blank=True, default="")
    
    # Contact Information
    contact_emails = models.JSONField(default=list, blank=True)
    contact_phones = models.JSONField(default=list, blank=True)
    
    # Detected ATS if company uses one for career postings
    ats_provider = models.CharField(max_length=100, blank=True, default="")  # greenhouse, lever, ashby, etc.
    # Outreach Tracking
    is_contacted = models.BooleanField(default=False, db_index=True)
    contacted_at = models.DateTimeField(null=True, blank=True)
    outreach_notes = models.TextField(blank=True, default="")
    
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name_plural = "Companies"
        ordering = ["name"]

    def __str__(self):
        return self.name


class Job(models.Model):
    """
    Normalized job opportunity harvested from multi-portal discovery,
    direct ATS feeds, or manual input.
    """
    PORTAL_CHOICES = [
        ("indeed", "Indeed India"),
        ("wellfound", "Wellfound (AngelList)"),
        ("naukri", "Naukri.com"),
        ("linkedin", "LinkedIn Jobs"),
        ("cutshort", "Cutshort"),
        ("ats_direct", "Direct ATS (Greenhouse/Lever)"),
        ("manual", "Manual / Pasted URL"),
    ]

    WORK_MODE_CHOICES = [
        ("Remote", "Remote"),
        ("Hybrid", "Hybrid"),
        ("Onsite", "Onsite"),
        ("Unknown", "Unknown"),
    ]

    JOB_TYPE_CHOICES = [
        ("Full-time", "Full-time"),
        ("Internship", "Internship"),
        ("Part-time", "Part-time"),
        ("Contract", "Contract"),
    ]

    EXPERIENCE_CHOICES = [
        ("Fresher", "Fresher (0 Years)"),
        ("Junior", "Junior / Entry-Level (1-2 Years)"),
        ("Mid", "Mid-Level (3-5 Years)"),
        ("Senior", "Senior (5-8 Years)"),
        ("Lead", "Lead / Principal / Architect (8+ Years)"),
        ("Entry-level", "Entry-level (Legacy)"),
        ("Any", "Any Experience"),
    ]

    PRIORITY_CHOICES = [
        ("HIGH", "High Priority"),
        ("MEDIUM", "Medium Priority"),
        ("LOW", "Low Priority"),
    ]

    STATUS_CHOICES = [
        ("SAVED", "Saved"),
        ("AUTO_APPLY_ELIGIBLE", "Auto-Apply Eligible"),
        ("AUTO_APPLIED", "Auto-Applied (Completed)"),
        ("MANUAL_APPLY_NEEDED", "Manual Apply Required"),
        ("APPLIED", "Applied (Confirmed)"),
        ("REJECTED", "Rejected / Inactive"),
    ]

    LISTING_STATUS_CHOICES = [
        ("active", "Active"),  # From live portal search and/or confirmed OK
        ("expired", "Expired / Dead"),
        ("unverified", "Check failed (informational only)"),
    ]

    APPLY_MODE_CHOICES = [
        ("one_click", "One-Click Auto Apply"),
        ("manual_external", "Manual / External careers site"),
        ("already_applied", "Already Applied"),
        ("ineligible", "Ineligible for current filters"),
    ]

    title = models.CharField(max_length=300, db_index=True)
    company = models.ForeignKey(
        Company,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="jobs"
    )
    company_name = models.CharField(max_length=255, db_index=True)
    company_website = models.URLField(max_length=500, blank=True, default="")

    portal_source = models.CharField(max_length=50, choices=PORTAL_CHOICES, default="indeed", db_index=True)
    external_id = models.CharField(max_length=255, blank=True, default="", db_index=True)
    original_url = models.URLField(max_length=1500)
    apply_url = models.URLField(max_length=1500, blank=True, default="")
    
    description = models.TextField(blank=True, default="")
    locations = models.JSONField(default=list, blank=True)  # e.g. ["Bengaluru", "Remote", "Pune"]
    work_mode = models.CharField(max_length=50, choices=WORK_MODE_CHOICES, default="Remote")
    job_type = models.CharField(max_length=50, choices=JOB_TYPE_CHOICES, default="Full-time")
    experience_level = models.CharField(max_length=50, choices=EXPERIENCE_CHOICES, default="Fresher")
    min_years_required = models.IntegerField(null=True, blank=True, db_index=True)
    required_skills = models.JSONField(default=list, blank=True)

    # Compensation
    salary_min = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    salary_max = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    currency = models.CharField(max_length=10, default="INR")

    # Dates
    posted_at = models.DateTimeField(null=True, blank=True, db_index=True)
    discovered_at = models.DateTimeField(auto_now_add=True)
    last_verified_at = models.DateTimeField(null=True, blank=True)

    # Automation & Scoring
    is_easy_apply = models.BooleanField(default=False)
    match_score = models.IntegerField(default=0, db_index=True)  # 0 to 100%
    priority_rank = models.CharField(max_length=20, choices=PRIORITY_CHOICES, default="MEDIUM", db_index=True)
    application_status = models.CharField(max_length=40, choices=STATUS_CHOICES, default="MANUAL_APPLY_NEEDED", db_index=True)
    listing_status = models.CharField(
        max_length=20, choices=LISTING_STATUS_CHOICES, default="active", db_index=True
    )
    apply_mode = models.CharField(
        max_length=30, choices=APPLY_MODE_CHOICES, default="manual_external", db_index=True
    )
    eligibility_reasons = models.JSONField(default=list, blank=True)

    # Contact Enrichment
    contact_emails = models.JSONField(default=list, blank=True)  # e.g. ["careers@company.com", "hr@company.com"]
    contact_phones = models.JSONField(default=list, blank=True)
    
    notes = models.TextField(blank=True, default="")

    class Meta:
        ordering = ["-match_score", "-discovered_at"]
        indexes = [
            models.Index(fields=["portal_source", "application_status"]),
            models.Index(fields=["priority_rank", "-match_score"]),
            models.Index(fields=["listing_status", "is_easy_apply"]),
            models.Index(fields=["apply_mode", "is_easy_apply"]),
        ]

    def __str__(self):
        return f"{self.title} at {self.company_name} ({self.get_portal_source_display()})"


class DiscoveryRun(models.Model):
    """
    One Scan & Discover session. Jobs & Discovery feed shows the latest run only.
    """
    STATUS_CHOICES = [
        ("running", "Running"),
        ("completed", "Completed"),
        ("cancelled", "Cancelled"),
    ]

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="running", db_index=True)

    keywords = models.CharField(max_length=300, blank=True, default="")
    location = models.CharField(max_length=200, blank=True, default="India")
    time_window = models.CharField(max_length=20, blank=True, default="14d")
    experience = models.CharField(max_length=50, blank=True, default="Any")
    job_type = models.CharField(max_length=50, blank=True, default="all")
    work_mode = models.CharField(max_length=50, blank=True, default="all")

    current_page = models.PositiveIntegerField(default=1)
    max_pages = models.PositiveIntegerField(default=10)
    has_more = models.BooleanField(default=False)
    total_results = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"DiscoveryRun #{self.id} ({self.status}) page={self.current_page} results={self.total_results}"


class DiscoveryResult(models.Model):
    """Job appearance inside a specific DiscoveryRun (scan-scoped feed membership)."""

    run = models.ForeignKey(DiscoveryRun, on_delete=models.CASCADE, related_name="results")
    job = models.ForeignKey(Job, on_delete=models.CASCADE, related_name="discovery_results")
    page_found = models.PositiveIntegerField(default=1)
    position = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["position", "id"]
        unique_together = [("run", "job")]

    def __str__(self):
        return f"DiscoveryResult run={self.run_id} job={self.job_id}"


class BulkApplyRun(models.Model):
    """Tracks a Bulk Auto-Pilot session with per-job status transitions."""

    STATUS_CHOICES = [
        ("running", "Running"),
        ("paused", "Paused (awaiting user)"),
        ("completed", "Completed"),
        ("cancelled", "Cancelled"),
    ]

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="running", db_index=True)
    total_jobs = models.IntegerField(default=0)
    experience_filter = models.CharField(max_length=50, blank=True, default="Any")

    def completed_count(self) -> int:
        terminal = {
            "applied",
            "skipped_expired",
            "skipped_ineligible",
            "failed",
        }
        return self.items.filter(status__in=terminal).count()

    def __str__(self):
        return f"BulkRun #{self.id} ({self.status}) {self.completed_count()}/{self.total_jobs}"


class BulkApplyItem(models.Model):
    """Per-job status inside a Bulk Auto-Pilot run."""

    STATUS_CHOICES = [
        ("queued", "Queued"),
        ("running", "Running"),
        ("applied", "Applied (confirmed)"),
        ("skipped_expired", "Skipped — expired/dead"),
        ("skipped_ineligible", "Skipped — ineligible"),
        ("blocked_challenge", "Blocked — bot challenge"),
        ("failed", "Failed"),
    ]

    run = models.ForeignKey(BulkApplyRun, on_delete=models.CASCADE, related_name="items")
    job = models.ForeignKey(Job, on_delete=models.SET_NULL, null=True, blank=True, related_name="bulk_items")
    job_id_snapshot = models.IntegerField(db_index=True)
    title = models.CharField(max_length=300, blank=True, default="")
    company_name = models.CharField(max_length=255, blank=True, default="")
    url = models.URLField(max_length=1500, blank=True, default="")
    position = models.PositiveIntegerField(default=0)
    status = models.CharField(max_length=40, choices=STATUS_CHOICES, default="queued", db_index=True)
    reason = models.TextField(blank=True, default="")
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["position", "id"]
        unique_together = [("run", "job_id_snapshot")]

    def __str__(self):
        return f"BulkItem job={self.job_id_snapshot} {self.status}"
