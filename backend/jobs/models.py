from django.db import models


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
    ats_slug = models.CharField(max_length=150, blank=True, default="")
    
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
        ("Fresher", "Fresher / 0-1 Years"),
        ("Entry-level", "Entry-level"),
        ("Mid", "Mid-level"),
        ("Senior", "Senior"),
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
    required_skills = models.JSONField(default=list, blank=True)

    # Compensation
    salary_min = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    salary_max = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    currency = models.CharField(max_length=10, default="INR")

    # Dates
    posted_at = models.DateTimeField(null=True, blank=True, db_index=True)
    discovered_at = models.DateTimeField(auto_now_add=True)

    # Automation & Scoring
    is_easy_apply = models.BooleanField(default=False)
    match_score = models.IntegerField(default=0, db_index=True)  # 0 to 100%
    priority_rank = models.CharField(max_length=20, choices=PRIORITY_CHOICES, default="MEDIUM", db_index=True)
    application_status = models.CharField(max_length=40, choices=STATUS_CHOICES, default="MANUAL_APPLY_NEEDED", db_index=True)

    # Contact Enrichment
    contact_emails = models.JSONField(default=list, blank=True)  # e.g. ["careers@company.com", "hr@company.com"]
    contact_phones = models.JSONField(default=list, blank=True)
    
    notes = models.TextField(blank=True, default="")

    class Meta:
        ordering = ["-match_score", "-discovered_at"]
        indexes = [
            models.Index(fields=["portal_source", "application_status"]),
            models.Index(fields=["priority_rank", "-match_score"]),
        ]

    def __str__(self):
        return f"{self.title} at {self.company_name} ({self.get_portal_source_display()})"
