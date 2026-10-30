from django.db import models


class CandidateProfile(models.Model):
    """
    Core candidate profile containing personal details, career history,
    skills, preferences, and verified answers for job applications.
    """
    full_name = models.CharField(max_length=255)
    email = models.EmailField()
    phone = models.CharField(max_length=50, blank=True, default="")
    location = models.CharField(max_length=255, blank=True, default="")
    title = models.CharField(max_length=255, blank=True, default="")  # e.g., Senior Full Stack Engineer
    bio = models.TextField(blank=True, default="")
    
    # Structured career attributes
    skills = models.JSONField(default=list, blank=True)
    experience = models.JSONField(default=list, blank=True)
    education = models.JSONField(default=list, blank=True)
    projects = models.JSONField(default=list, blank=True)
    
    # Preferences & soft criteria (no hard filtering, used for match scoring)
    preferences = models.JSONField(default=dict, blank=True)
    
    # Store of pre-verified answers (notice period, work authorization, URLs, etc.)
    verified_answers = models.JSONField(default=dict, blank=True)
    
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-updated_at"]
        verbose_name = "Candidate Profile"
        verbose_name_plural = "Candidate Profiles"

    def __str__(self):
        return self.full_name or self.email or f"Profile #{self.id}"


class Resume(models.Model):
    """
    Uploaded resume files and extracted text/metadata.
    """
    profile = models.ForeignKey(
        CandidateProfile,
        on_delete=models.CASCADE,
        related_name="resumes",
        null=True,
        blank=True
    )
    file = models.FileField(upload_to="resumes/")
    filename = models.CharField(max_length=255, blank=True, default="")
    file_size = models.PositiveIntegerField(default=0)  # in bytes
    file_type = models.CharField(max_length=100, blank=True, default="")
    extracted_text = models.TextField(blank=True, default="")
    is_primary = models.BooleanField(default=False)
    uploaded_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-uploaded_at"]

    def __str__(self):
        return f"{self.filename} ({self.uploaded_at.strftime('%Y-%m-%d')})"
