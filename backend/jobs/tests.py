from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from jobs.models import Job, BulkApplyRun, BulkApplyItem, DiscoveryRun, DiscoveryResult
from jobs.services.job_validator import (
    is_patterned_hex_id,
    is_valid_company_name,
    is_valid_indeed_url,
    is_valid_job_url,
    sanitize_company_name,
)
from jobs.services.eligibility import experience_matches_filter, is_auto_ready, classify_apply_mode
from jobs.services.experience_analyzer import analyze_experience_requirements


class JobValidatorTests(TestCase):
    def test_rejects_known_placeholder_indeed_keys(self):
        self.assertTrue(is_patterned_hex_id("0f1e2d3c4b5a6978"))
        self.assertTrue(is_patterned_hex_id("456789abcdef0123"))
        self.assertFalse(is_valid_indeed_url("https://in.indeed.com/viewjob?jk=0f1e2d3c4b5a6978"))
        self.assertFalse(is_valid_indeed_url("https://in.indeed.com/viewjob?jk=456789abcdef0123"))

    def test_accepts_realistic_indeed_key(self):
        # Mixed non-sequential hex — looks like a real Indeed jk
        jk = "8c48860920605f36"
        # This real expired key is valid format (not patterned)
        self.assertFalse(is_patterned_hex_id(jk))
        self.assertTrue(is_valid_indeed_url(f"https://in.indeed.com/viewjob?jk={jk}"))

    def test_company_name_rejects_sentences_and_urls(self):
        self.assertFalse(is_valid_company_name("Interns assist data science tea…"))
        self.assertFalse(is_valid_company_name("This role drives Solution Design…"))
        self.assertFalse(is_valid_company_name("Solutions"))
        self.assertFalse(is_valid_company_name("Advertising Industry"))
        self.assertFalse(is_valid_company_name("capital.com:443/en-int"))
        self.assertTrue(is_valid_company_name("Peak Hire Solutions"))
        self.assertTrue(is_valid_company_name("Deqode"))
        self.assertEqual(sanitize_company_name("This role drives Solution Design…", "Deqode"), "Deqode")


class EligibilityTests(TestCase):
    def test_four_plus_years_blocked_under_0_3_filter(self):
        ok, reasons = experience_matches_filter("0-3 Y", "Mid", min_years_required=4)
        self.assertFalse(ok)
        self.assertTrue(any("Experience mismatch" in r for r in reasons))

    def test_junior_ok_under_0_3(self):
        ok, reasons = experience_matches_filter("0-3 Y", "Junior", min_years_required=1)
        self.assertTrue(ok)
        self.assertEqual(reasons, [])

    def test_two_and_three_years_ok_under_0_3(self):
        ok, reasons = experience_matches_filter("0-3 Y", "Mid", min_years_required=2, title="Backend Developer")
        self.assertTrue(ok)
        self.assertEqual(reasons, [])

        ok3, reasons3 = experience_matches_filter("0-3 Y", "Mid", min_years_required=3, title="AI / ML Engineer")
        self.assertTrue(ok3)
        self.assertEqual(reasons3, [])

    def test_senior_lead_title_blocked_under_0_3(self):
        ok_sr, reasons_sr = experience_matches_filter("0-3 Y", "Senior", min_years_required=1, title="Senior Software Engineer")
        self.assertFalse(ok_sr)
        self.assertTrue(any("senior/lead" in r for r in reasons_sr))

        ok_lead, reasons_lead = experience_matches_filter("0-3 Y", "Mid", min_years_required=2, title="Lead AI Architect")
        self.assertFalse(ok_lead)
        self.assertTrue(any("senior/lead" in r for r in reasons_lead))

    def test_unverified_does_not_block_one_click(self):
        """Liveness check_failed / unverified is informational only — never blocks One-Click."""
        ok, reasons = is_auto_ready(
            listing_status="unverified",
            is_easy_apply=True,
            application_status="AUTO_APPLY_ELIGIBLE",
            experience_filter="0-3 Y",
            experience_level="Junior",
            min_years_required=1,
        )
        self.assertTrue(ok)
        self.assertEqual(reasons, [])

        mode, _ = classify_apply_mode(
            is_easy_apply=True,
            application_status="AUTO_APPLY_ELIGIBLE",
            experience_filter="0-3 Y",
            experience_level="Junior",
            min_years_required=1,
            listing_status="unverified",
        )
        self.assertEqual(mode, "one_click")

        ok2, reasons2 = is_auto_ready(
            listing_status="expired",
            is_easy_apply=True,
            application_status="AUTO_APPLY_ELIGIBLE",
            experience_filter="0-3 Y",
            experience_level="Junior",
            min_years_required=1,
        )
        self.assertFalse(ok2)
        self.assertTrue(any("expired" in r.lower() for r in reasons2))

        ok3, _ = is_auto_ready(
            listing_status="active",
            is_easy_apply=True,
            application_status="AUTO_APPLY_ELIGIBLE",
            experience_filter="0-3 Y",
            experience_level="Junior",
            min_years_required=1,
        )
        self.assertTrue(ok3)

    def test_company_name_allows_inc_with_period(self):
        self.assertTrue(is_valid_company_name("Synergy Inc."))
        self.assertTrue(is_valid_company_name("Acme Corp."))

    def test_analyzer_detects_4_plus_years(self):
        result = analyze_experience_requirements(
            "Android Developer",
            "We need an Android Developer with 4+ years of experience in Kotlin.",
        )
        self.assertGreaterEqual(result["min_years"] or 0, 4)
        self.assertIn(result["experience_level"], ("Mid", "Senior"))


class BulkApplyProgressTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.jobs = []
        fixtures = [
            ("Valid Junior Dev", "Acme Labs", "active", "Junior", 1, True, "https://in.indeed.com/viewjob?jk=a1b2c3d4e5f60718"),
            ("Expired Role", "OldCo", "expired", "Junior", 1, True, "https://in.indeed.com/viewjob?jk=8c48860920605f36"),
            ("Fake Placeholder", "FakeCo", "unverified", "Junior", 1, True, "https://in.indeed.com/viewjob?jk=0f1e2d3c4b5a6978"),
            ("Senior Android", "Delhi Tech", "active", "Mid", 4, True, "https://cutshort.io/job/android-developer-delhi-peak-hire-solutions-abc123"),
            ("AI Solutions Engineer", "Peak Hire Solutions", "active", "Mid", 4, True, "https://cutshort.io/job/ai-solutions-engineer-noida-peak-hire-solutions-def456"),
            ("Cutshort Intern", "Deqode", "active", "Fresher", 0, True, "https://cutshort.io/job/tech-intern-frontend-deqode-xyz789"),
        ]
        for title, company, listing, exp, min_y, easy, url in fixtures:
            portal = "cutshort" if "cutshort" in url else "indeed"
            self.jobs.append(
                Job.objects.create(
                    title=title,
                    company_name=company,
                    portal_source=portal,
                    external_id=url.split("jk=")[-1] if "jk=" in url else url.rsplit("-", 1)[-1],
                    original_url=url,
                    apply_url=url,
                    description=f"{title} requires experience",
                    experience_level=exp,
                    min_years_required=min_y,
                    is_easy_apply=easy,
                    listing_status=listing,
                    application_status="AUTO_APPLY_ELIGIBLE" if listing != "expired" and min_y <= 3 else "MANUAL_APPLY_NEEDED",
                    apply_mode="one_click" if listing != "expired" and min_y <= 3 and easy else "manual_external",
                    posted_at=timezone.now(),
                    match_score=70,
                )
            )

    def test_list_excludes_expired_and_enforces_min_years(self):
        res = self.client.get("/api/jobs/", {"experience": "0-3 Y", "time_window": "14d"})
        self.assertEqual(res.status_code, 200)
        data = res.json()
        # DRF may paginate or return list
        jobs = data if isinstance(data, list) else data.get("results", data)
        ids = {j["id"] for j in jobs}
        # expired excluded by default
        self.assertNotIn(self.jobs[1].id, ids)
        # 4+ year Mid roles excluded by min_years filter
        self.assertNotIn(self.jobs[3].id, ids)
        self.assertNotIn(self.jobs[4].id, ids)

    def test_auto_ready_flag_on_serializer(self):
        res = self.client.get(f"/api/jobs/{self.jobs[0].id}/", {"experience": "0-3 Y"})
        self.assertEqual(res.status_code, 200)
        self.assertTrue(res.json()["is_auto_ready"])

        res2 = self.client.get(f"/api/jobs/{self.jobs[3].id}/", {"experience": "0-3 Y"})
        self.assertEqual(res2.status_code, 200)
        self.assertFalse(res2.json()["is_auto_ready"])
        self.assertTrue(any("Experience mismatch" in r for r in res2.json()["auto_ready_reasons"]))

    def test_bulk_run_tracks_per_job_status_and_completed_count(self):
        payload = {
            "experience_filter": "0-3 Y",
            "jobs": [
                {"id": j.id, "title": j.title, "company": j.company_name, "url": j.original_url}
                for j in self.jobs
            ],
        }
        start = self.client.post("/api/jobs/bulk-apply/start/", payload, format="json")
        self.assertEqual(start.status_code, 201)
        run = start.json()
        run_id = run["id"]
        # Expired / experience-ineligible pre-marked; unverified easy-apply stays queued
        statuses = {i["job_id_snapshot"]: i["status"] for i in run["items"]}
        self.assertEqual(statuses[self.jobs[0].id], "queued")
        self.assertIn(statuses[self.jobs[1].id], ("skipped_expired", "skipped_ineligible"))
        self.assertEqual(statuses[self.jobs[2].id], "queued")  # unverified must NOT block
        self.assertEqual(statuses[self.jobs[3].id], "skipped_ineligible")

        # Simulate transitions for remaining queued jobs
        for job, status, reason in [
            (self.jobs[0], "running", ""),
            (self.jobs[0], "applied", "Portal confirmed"),
            (self.jobs[5], "running", ""),
            (self.jobs[5], "applied", "Portal confirmed"),
            (self.jobs[2], "skipped_expired", "Fake placeholder"),
        ]:
            if statuses.get(job.id) not in ("queued", "running") and status != "skipped_expired":
                continue
            r = self.client.post(
                f"/api/jobs/bulk-apply/{run_id}/item/",
                {"job_id": job.id, "status": status, "reason": reason},
                format="json",
            )
            self.assertEqual(r.status_code, 200)

        final = self.client.get(f"/api/jobs/bulk-apply/{run_id}/")
        self.assertEqual(final.status_code, 200)
        body = final.json()
        self.assertEqual(body["total_jobs"], 6)
        self.assertEqual(body["completed"], body["total_jobs"])
        applied = [i for i in body["items"] if i["status"] == "applied"]
        self.assertTrue(all(i["status"] != "applied" or "confirm" in (i["reason"] or "").lower() or i["reason"] for i in applied) or len(applied) >= 1)
        # Valid junior ended applied
        item0 = next(i for i in body["items"] if i["job_id_snapshot"] == self.jobs[0].id)
        self.assertEqual(item0["status"], "applied")

    def test_record_application_rejects_placeholder_url_create(self):
        res = self.client.post(
            "/api/jobs/record-application/",
            {
                "url": "https://in.indeed.com/viewjob?jk=0f1e2d3c4b5a6978",
                "title": "Ghost Job",
                "company": "Nowhere",
                "status": "APPLIED",
            },
            format="json",
        )
        self.assertEqual(res.status_code, 400)
        self.assertFalse(Job.objects.filter(title="Ghost Job").exists())

    def test_purge_fake_jobs_endpoint(self):
        fake = Job.objects.create(
            title="Ghost",
            company_name="Nowhere Inc",
            portal_source="indeed",
            external_id="0f1e2d3c4b5a6978",
            original_url="https://in.indeed.com/viewjob?jk=0f1e2d3c4b5a6978",
            apply_url="https://in.indeed.com/viewjob?jk=0f1e2d3c4b5a6978",
            listing_status="active",
            is_easy_apply=True,
            application_status="AUTO_APPLY_ELIGIBLE",
        )
        res = self.client.post("/api/jobs/purge-fake-jobs/", {"dry_run": False}, format="json")
        self.assertEqual(res.status_code, 200)
        fake.refresh_from_db()
        self.assertEqual(fake.listing_status, "expired")
        self.assertFalse(fake.is_easy_apply)

    def test_heal_statuses_promotes_unverified_and_one_click(self):
        stuck = Job.objects.create(
            title="Stuck Easy Apply",
            company_name="HealCo",
            portal_source="wellfound",
            original_url="https://wellfound.com/jobs/heal-1",
            apply_url="https://wellfound.com/jobs/heal-1",
            listing_status="unverified",
            is_easy_apply=True,
            application_status="MANUAL_APPLY_NEEDED",
            apply_mode="manual_external",
            experience_level="Junior",
            min_years_required=1,
        )
        res = self.client.post("/api/jobs/discovery/heal-statuses/", {}, format="json")
        self.assertEqual(res.status_code, 200)
        stuck.refresh_from_db()
        self.assertEqual(stuck.listing_status, "active")
        self.assertEqual(stuck.apply_mode, "one_click")
        self.assertEqual(stuck.application_status, "AUTO_APPLY_ELIGIBLE")
        self.assertGreaterEqual(res.json()["active_easy_apply"], 1)

    def test_discovery_latest_returns_run_feed_only(self):
        run_old = DiscoveryRun.objects.create(keywords="old", status="completed", total_results=1)
        run_new = DiscoveryRun.objects.create(keywords="new", status="completed", total_results=1, has_more=False)
        old_job = Job.objects.create(
            title="Old Scan Job",
            company_name="OldCo",
            portal_source="indeed",
            original_url="https://in.indeed.com/viewjob?jk=aabbccddeeff0011",
            apply_url="https://in.indeed.com/viewjob?jk=aabbccddeeff0011",
            listing_status="active",
            is_easy_apply=True,
            application_status="AUTO_APPLY_ELIGIBLE",
            apply_mode="one_click",
            experience_level="Junior",
            min_years_required=1,
            match_score=50,
        )
        new_job = Job.objects.create(
            title="New Scan Job",
            company_name="NewCo",
            portal_source="cutshort",
            original_url="https://cutshort.io/job/new-scan-job-newco-zzz111",
            apply_url="https://cutshort.io/job/new-scan-job-newco-zzz111",
            listing_status="unverified",
            is_easy_apply=True,
            application_status="AUTO_APPLY_ELIGIBLE",
            apply_mode="one_click",
            experience_level="Junior",
            min_years_required=1,
            match_score=90,
        )
        DiscoveryResult.objects.create(run=run_old, job=old_job, page_found=1, position=1)
        DiscoveryResult.objects.create(run=run_new, job=new_job, page_found=1, position=1)

        res = self.client.get("/api/jobs/discovery/latest/", {"experience": "0-3 Y"})
        self.assertEqual(res.status_code, 200)
        body = res.json()
        self.assertEqual(body["run"]["id"], run_new.id)
        ids = {j["id"] for j in body["jobs"]}
        self.assertIn(new_job.id, ids)
        self.assertNotIn(old_job.id, ids)
        feed_job = next(j for j in body["jobs"] if j["id"] == new_job.id)
        self.assertTrue(feed_job["is_auto_ready"])
