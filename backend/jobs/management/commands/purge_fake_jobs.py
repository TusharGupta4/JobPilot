"""
Flag patterned/placeholder Indeed job keys and invalid listings as expired.
Usage: python manage.py purge_fake_jobs [--dry-run] [--delete]
"""
from django.core.management.base import BaseCommand
from django.utils import timezone

from jobs.models import Job
from jobs.services.job_validator import extract_indeed_jk, is_patterned_hex_id, is_valid_company_name, is_valid_job_url


class Command(BaseCommand):
    help = "Purge or flag fake/dead Indeed jobs (patterned jk placeholders, invalid companies)"

    def add_arguments(self, parser):
        parser.add_argument("--dry-run", action="store_true", help="Report only, do not modify")
        parser.add_argument("--delete", action="store_true", help="Hard-delete instead of flagging expired")

    def handle(self, *args, **options):
        dry = options["dry_run"]
        hard_delete = options["delete"]
        flagged = 0

        for job in Job.objects.all().iterator():
            reasons = []
            jk = (job.external_id or extract_indeed_jk(job.original_url) or "").lower()
            if job.portal_source == "indeed":
                if jk and is_patterned_hex_id(jk):
                    reasons.append(f"patterned jk={jk}")
                if not is_valid_job_url(job.original_url, "indeed"):
                    reasons.append("invalid indeed url")
            if not is_valid_company_name(job.company_name):
                reasons.append(f"bad company_name={job.company_name!r}")

            if not reasons:
                continue

            flagged += 1
            self.stdout.write(f"  #{job.id} {job.title} @ {job.company_name}: {', '.join(reasons)}")
            if dry:
                continue
            if hard_delete:
                job.delete()
            else:
                job.listing_status = "expired"
                job.is_easy_apply = False
                job.application_status = "REJECTED"
                job.eligibility_reasons = list(job.eligibility_reasons or []) + [
                    f"Purged fake/dead: {'; '.join(reasons)}"
                ]
                job.last_verified_at = timezone.now()
                job.save()

        verb = "Would flag" if dry else ("Deleted" if hard_delete else "Flagged")
        self.stdout.write(self.style.SUCCESS(f"{verb} {flagged} fake/dead job(s)."))
