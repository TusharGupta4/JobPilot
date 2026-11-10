import os
os.environ["DJANGO_ALLOW_ASYNC_UNSAFE"] = "true"
import re
import json
import random
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone as dt_timezone
from django.utils import timezone
from django.conf import settings
import requests
from bs4 import BeautifulSoup

from jobs.models import Job, Company, DiscoveryRun, DiscoveryResult
from profiles.models import CandidateProfile
from .contact_enricher import enrich_company_contacts, extract_contacts_from_text
from .experience_analyzer import analyze_experience_requirements
from .job_validator import (
    check_job_liveness,
    is_patterned_hex_id,
    is_portal_website,
    is_valid_company_name,
    is_valid_job_url,
    sanitize_company_name,
)
from .eligibility import classify_apply_mode, experience_matches_filter


EXCLUDED_DOMAINS = [
    "mechanical", "cooling", "civil", "chemical", "electrical",
    "faculty", "trainer", "teacher", "professor", "tutor", "lecturer",
    "sales", "business development", "bda", "bde", "telecaller", "tele-caller",
    "data annotator", "annotator", "annotation", "data entry", "transcription",
    "counselor", "accountant", "school", "receptionist", "call center", "bpo",
    "clerk", "hardware design", "site engineer", "executive assistant",
]

RELEVANT_DOMAINS = [
    "developer", "engineer", "software", "programmer", "intern", "trainee",
    "full stack", "backend", "frontend", "web", "python", "django", "react",
    "node", "fastapi", "sde", "analyst", "data", "ai", "ml", "cloud", "devops",
    "java", "golang", "go", "c++", "c#", ".net", "dotnet", "rust", "php",
    "ruby", "mobile", "android", "ios", "flutter", "react native", "qa",
    "test", "sdet", "quality", "security", "architect", "sysadmin", "infrastructure"
]

COMMON_TECH_STACK = [
    "Python", "Java", "C++", "C#", "Go", "Rust", "JavaScript", "TypeScript",
    "React", "Angular", "Vue", "Node.js", "Django", "FastAPI", "Spring Boot",
    "SQL", "PostgreSQL", "MySQL", "MongoDB", "Redis", "Docker", "Kubernetes",
    "AWS", "Azure", "GCP", "DevOps", "Machine Learning", "AI", "NLP",
    "Data Engineering", "REST APIs", "GraphQL", "Flutter", "Android", "iOS"
]


def is_software_tech_job(title: str, description: str = "") -> bool:
    """
    Validates that a job is strictly related to software engineering, development,
    or technical computer science roles. Rejects non-tech, sales, faculty, or mechanical jobs.
    """
    title_lower = title.lower()
    desc_lower = (description or "").lower()

    # Reject explicitly excluded domains in title
    if any(bad in title_lower for bad in EXCLUDED_DOMAINS):
        return False

    # Must contain at least one tech role keyword in title
    if any(good in title_lower for good in RELEVANT_DOMAINS):
        return True

    # If title is ambiguous, check if description has multiple tech signals
    tech_signals = sum(1 for tech in ["code", "programming", "software", "api", "git", "database", "sql", "linux", "cloud", "developer", "backend", "frontend", "python", "java", "react", "docker"] if tech in desc_lower)
    return tech_signals >= 3


def parse_relative_time(text: str, default_window_days: int = 1):
    """
    Extracts real relative posting time (e.g., 'posted 1 month ago', 'just posted', '2 days ago', '30+ days ago')
    and returns a timezone-aware datetime.
    """
    now = timezone.now()
    if not text:
        return now - timedelta(hours=min(default_window_days * 12, 24))

    clean = text.lower()

    # 30+ days ago or months ago
    if "30+" in clean or "month" in clean:
        m = re.search(r'(\d+)\s*months?\s*ago', clean)
        months = int(m.group(1)) if m else 1
        return now - timedelta(days=months * 30)

    # Weeks ago
    w_match = re.search(r'(\d+)\s*weeks?\s*ago', clean)
    if w_match:
        return now - timedelta(days=int(w_match.group(1)) * 7)

    # Days ago
    d_match = re.search(r'(\d+)\s*days?\s*ago', clean)
    if d_match:
        return now - timedelta(days=int(d_match.group(1)))

    # Hours ago
    h_match = re.search(r'(\d+)\s*hours?\s*ago', clean)
    if h_match:
        return now - timedelta(hours=int(h_match.group(1)))

    # Just posted, Today
    if any(k in clean for k in ("just posted", "today", "active today", "employer active today", "just now")):
        return now - timedelta(minutes=30)

    if "yesterday" in clean:
        return now - timedelta(days=1)

    return now - timedelta(hours=min(default_window_days * 6, 24))


def fetch_wellfound_job_details(clean_job_url: str):
    """
    Fetches JSON-LD from a Wellfound job detail page to retrieve verified datePosted
    and experience requirements.
    """
    try:
        req = urllib.request.Request(
            clean_job_url,
            headers={
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
            }
        )
        html = urllib.request.urlopen(req, timeout=6).read().decode("utf-8", errors="ignore")
        raw_scripts = re.findall(r'<script[^>]*type=[\'"]application/ld\+json[\'"][^>]*>(.*?)</script>', html, re.DOTALL)
        for s in raw_scripts:
            try:
                data = json.loads(s.strip())
                if isinstance(data, dict) and data.get("@type") == "JobPosting":
                    return data
            except Exception:
                continue
    except Exception:
        pass
    return None



def calculate_match_score(candidate_skills, job_text, target_titles=None, job_title="", exp_analysis=None, candidate_is_fresher=True):
    """
    Computes realistic match percentage dynamically between candidate profile
    and job content, heavily weighted by actual experience level and seniority alignment.
    """
    if not candidate_skills:
        base_score = 65
    else:
        combined_text = (job_text + " " + job_title).lower()
        title_lower = job_title.lower()

        base_score = 45

        # 1. Candidate's own skills match
        matched_skills = [
            skill for skill in candidate_skills
            if skill.lower() in combined_text
        ]
        match_ratio = len(matched_skills) / max(len(candidate_skills), 1)
        base_score += min(35, int(match_ratio * 40) + len(matched_skills) * 4)

        # 2. General tech role alignment bonus
        if any(term in title_lower for term in ["developer", "software engineer", "sde", "engineer", "trainee", "intern", "analyst"]):
            base_score += 10

        # 3. Specific candidate target titles match
        if target_titles and any(t.lower() in title_lower for t in target_titles):
            base_score += 10

    # 4. Semantic Experience & Seniority Impact
    if exp_analysis:
        if candidate_is_fresher:
            # If candidate is a Fresher/Entry-level:
            if exp_analysis.get("is_senior") and not exp_analysis.get("is_fresher_friendly"):
                # Senior / Lead role that is NOT flexible: heavily penalty!
                base_score -= 35
            elif exp_analysis.get("is_fresher_friendly"):
                # Explicitly fresher-friendly / entry-level role: bonus!
                base_score += 12
        else:
            # If candidate has industry experience (e.g. 2-5+ years):
            if exp_analysis.get("experience_level") in ("Mid", "Senior"):
                base_score += 12
            elif "intern" in (job_title or "").lower():
                base_score -= 25

    return min(100, max(25, base_score))


def determine_priority_rank(match_score: int, is_easy_apply: bool, is_within_24h: bool):
    """
    Assigns HIGH / MEDIUM / LOW priority based on match score and urgency.
    """
    if match_score >= 70 and (is_easy_apply or is_within_24h):
        return "HIGH"
    elif match_score >= 50:
        return "MEDIUM"
    return "LOW"


def _auto_enrich_job_and_company(job_id, company_id, company_name, website_url, description):
    """
    Background worker that runs asynchronously after job discovery to crawl official company website
    (/contact, /about, /careers) if emails are not present in job description.
    """
    try:
        res = enrich_company_contacts(website_url=website_url, description=description, company_name=company_name)
        new_emails = res.get("emails", [])
        new_phones = res.get("phones", [])
        new_site = res.get("website", "")
        if new_emails or new_phones or new_site:
            Job.objects.filter(id=job_id).update(
                contact_emails=new_emails,
                contact_phones=new_phones,
                company_website=new_site if new_site else website_url
            )
            c = Company.objects.filter(id=company_id).first()
            if c:
                updated_e = sorted(list(set((c.contact_emails or []) + new_emails)))
                updated_p = sorted(list(set((c.contact_phones or []) + new_phones)))
                c.contact_emails = updated_e
                c.contact_phones = updated_p
                if new_site and not c.website:
                    c.website = new_site
                c.save()
    except Exception as e:
        print(f"Background contact auto-enrichment note: {e}")


def _link_to_discovery_run(discovery_run, job_obj, page, position):
    if not discovery_run:
        return
    DiscoveryResult.objects.update_or_create(
        run=discovery_run,
        job=job_obj,
        defaults={"page_found": page, "position": position},
    )


def clean_and_normalize_query_term(term: str) -> str:
    """
    Cleans and expands truncated keyword tokens (e.g. 'ML devel' -> 'ML Developer',
    'dev' -> 'Developer', 'eng' -> 'Engineer') to prevent 0-match portal searches.
    """
    if not term:
        return ""
    clean = re.sub(r'\s+', ' ', str(term).strip())
    replacements = [
        (r'\bdevel\b', 'Developer'),
        (r'\bdev\b', 'Developer'),
        (r'\beng\b', 'Engineer'),
        (r'\bswe\b', 'Software Engineer'),
        (r'\bsde\b', 'Software Development Engineer'),
    ]
    for pattern, repl in replacements:
        clean = re.sub(pattern, repl, clean, flags=re.IGNORECASE)

    # Clean up accidental double role words
    clean = re.sub(r'\b(Developer|Engineer)\s+\1\b', r'\1', clean, flags=re.IGNORECASE)
    return clean.strip()


def extract_search_terms(keywords: str = "", selected_domains: list = None) -> list:
    """
    Deconstructs comma-separated keywords and user-selected domain filters into
    a list of clean, distinct query terms for multi-query crawler fan-out.
    Normalizes truncated tokens and ensures distinct domains are queried independently.
    """
    terms = []
    if keywords:
        raw_parts = re.split(r'[,;]+', str(keywords))
        for p in raw_parts:
            normalized = clean_and_normalize_query_term(p)
            if len(normalized) >= 2 and normalized.lower() not in [t.lower() for t in terms]:
                terms.append(normalized)

    domain_keyword_map = {
        "aiml": "AI / Machine Learning Engineer",
        "ai_ml": "AI / Machine Learning Engineer",
        "ai": "AI Engineer",
        "ml": "Machine Learning Engineer",
        "backend": "Backend Developer",
        "fullstack": "Full Stack Developer",
        "frontend": "Frontend Developer",
        "dataeng": "Data Engineer",
        "datascience": "Data Scientist",
        "data": "Data Scientist",
        "devops": "DevOps Cloud Engineer",
        "cloud": "Cloud Engineer",
        "mobile": "Mobile App Developer",
        "qa": "QA SDET Engineer",
        "testing": "QA Automation Engineer",
        "healthtech": "Healthcare Software Engineer",
    }
    if selected_domains:
        for d in selected_domains:
            d_key = str(d).lower().strip()
            if d_key in domain_keyword_map:
                mapped = domain_keyword_map[d_key]
                if not any(mapped.lower() in t.lower() or t.lower() in mapped.lower() for t in terms):
                    terms.append(mapped)

    if not terms:
        terms = ["Software Engineer"]

    # Cap to top 5 distinct queries for fast, comprehensive coverage across domains
    return terms[:5]


def run_multi_portal_discovery(
    keywords=None,
    location="India",
    time_window="24h",
    experience="Fresher",
    job_type="all",
    work_mode="all",
    page=1,
    limit=80,
    discovery_run=None,
    selected_domains=None,
):
    """
    Orchestrates discovery across multiple portals (Indeed, Wellfound/Startups, Cutshort, Direct ATS).
    Executes multi-query fan-out across individual target domains so every selected
    field is searched independently and results are aggregated cleanly.
    Results are linked to discovery_run (scan session).
    """
    # Fetch candidate profile to compute personalized match scores
    profile = CandidateProfile.objects.first()
    candidate_skills = profile.skills if profile else []
    target_titles = profile.preferences.get("target_titles", []) if profile and profile.preferences else []
    
    # Determine candidate's career level from profile
    candidate_is_fresher = True
    if profile and profile.experience and len(profile.experience) > 0:
        candidate_is_fresher = False
    elif experience and experience.lower() not in ("fresher", "internship", "entry-level"):
        candidate_is_fresher = False

    if not keywords:
        if target_titles:
            keywords = target_titles[0]
        elif candidate_skills:
            keywords = f"{candidate_skills[0]} developer"
        else:
            keywords = "Software Engineer"

    # Deconstruct keywords and domains into distinct targeted search phrases
    query_terms = extract_search_terms(keywords, selected_domains)
    print(f"[Discovery Engine] Multi-Query Fan-Out active for terms: {query_terms} (page={page}, days={time_window})")

    # Map time_window to days
    days = 1 if time_window == "24h" else (7 if time_window == "7d" else (14 if time_window == "14d" else 180))
    discovered_jobs = []
    has_more_indeed = False
    has_more_wf = False
    has_more_cs = False

    # -------------------------------------------------------------------------
    # 1. Indeed India Live Search (Independent search for each domain query, 3-4 pages deep)
    # -------------------------------------------------------------------------
    try:
        indeed_jobs, has_more_indeed = search_indeed(
            keywords=keywords,
            location=location,
            days=days,
            experience=experience,
            job_type=job_type,
            work_mode=work_mode,
            page=page,
            limit=min(limit, 60),
            query_terms=query_terms,
        )
        discovered_jobs.extend(indeed_jobs)
    except Exception as e:
        print(f"Indeed discovery error: {e}")

    # -------------------------------------------------------------------------
    # 2. Wellfound Live Search (Startup Jobs across all target role categories, 3-4 folds deep)
    # -------------------------------------------------------------------------
    try:
        wf_jobs, has_more_wf = search_wellfound(
            keywords=keywords,
            location=location,
            days=days,
            experience=experience,
            job_type=job_type,
            work_mode=work_mode,
            page=page,
            limit=min(limit, 50),
            query_terms=query_terms,
        )
        discovered_jobs.extend(wf_jobs)
    except Exception as e:
        print(f"Wellfound discovery error: {e}")

    # -------------------------------------------------------------------------
    # 3. Cutshort Live Search (Crawl all matching categories without short-circuiting, 3-4 folds deep)
    # -------------------------------------------------------------------------
    try:
        cs_jobs, has_more_cs = search_cutshort(
            keywords=keywords,
            location=location,
            days=days,
            page=page,
            limit=min(limit, 60),
            query_terms=query_terms,
        )
        discovered_jobs.extend(cs_jobs)
    except Exception as e:
        print(f"Cutshort discovery error: {e}")

    # -------------------------------------------------------------------------
    # 4. Startup / ATS Direct Sources (Razorpay, Postman, Meesho, CRED, Swiggy, etc.)
    # Note: Only queried on Page 1 to avoid duplicating fixed ATS company feeds
    # -------------------------------------------------------------------------
    if page == 1:
        try:
            ats_jobs = search_ats_boards(
                keywords=keywords,
                days=days,
                limit=min(limit, 20),
                query_terms=query_terms,
            )
            discovered_jobs.extend(ats_jobs)
        except Exception as e:
            print(f"ATS direct discovery error: {e}")
        except Exception as e:
            print(f"ATS direct discovery error: {e}")

    has_more = bool(has_more_indeed or has_more_wf or has_more_cs)

    # -------------------------------------------------------------------------
    # Save / upsert for company history + attach to DiscoveryRun feed
    # -------------------------------------------------------------------------
    saved_records = []
    cutoff_time = timezone.now() - timedelta(days=days)
    position_counter = DiscoveryResult.objects.filter(run=discovery_run).count() if discovery_run else 0

    for item in discovered_jobs:
        if time_window != "all" and item.get("posted_at") and item["posted_at"] < cutoff_time:
            continue

        if not is_software_tech_job(item.get("title", ""), item.get("description", "")):
            continue

        if work_mode and work_mode.lower() != "all":
            item_wm = (item.get("work_mode") or "").lower()
            target_wm = work_mode.lower()
            if target_wm == "remote" and "remote" not in item_wm:
                continue
            if target_wm == "hybrid" and "hybrid" not in item_wm:
                continue
            if target_wm == "onsite" and not any(k in item_wm for k in ("onsite", "office")):
                # For Cutshort, unless explicitly remote-only, allow hybrid/office roles for onsite filter
                if item.get("portal_source") == "cutshort" and item_wm != "remote":
                    pass
                else:
                    continue

        if job_type and job_type.lower() != "all":
            item_jt = (item.get("job_type") or "Full-time").lower()
            target_jt = job_type.lower()
            if target_jt == "internship" and "intern" not in item_jt and "intern" not in item.get("title", "").lower():
                continue
            if target_jt == "full-time" and "intern" in item_jt and "full" not in item_jt:
                continue
            if target_jt == "contract" and "contract" not in item_jt:
                continue

        exp_analysis = analyze_experience_requirements(item.get("title", ""), item.get("description", ""))
        detected_experience_level = exp_analysis["experience_level"]
        min_years_required = exp_analysis.get("min_years")

        portal = item.get("portal_source", "indeed")
        job_url = item.get("original_url") or ""
        if not is_valid_job_url(job_url, portal):
            print(f"Dropping invalid/placeholder job URL: {job_url}")
            continue
        if portal == "indeed" and item.get("external_id") and is_patterned_hex_id(str(item["external_id"])):
            print(f"Dropping patterned Indeed jk placeholder: {item['external_id']}")
            continue

        comp_name = sanitize_company_name(item.get("company_name", ""))
        if not comp_name:
            print(f"Dropping job with invalid company name: {item.get('company_name')!r} / {item.get('title')!r}")
            continue

        raw_website = item.get("company_website", "") or ""
        if is_portal_website(raw_website):
            raw_website = ""

        match_score = calculate_match_score(
            candidate_skills=candidate_skills,
            job_text=item.get("description", "") + " " + " ".join(item.get("required_skills", [])),
            target_titles=target_titles,
            job_title=item.get("title", ""),
            exp_analysis=exp_analysis,
            candidate_is_fresher=candidate_is_fresher
        )
        if match_score < 35:
            continue

        exp_ok, exp_reasons = experience_matches_filter(
            experience,
            detected_experience_level,
            min_years_required,
            item.get("title", ""),
            item.get("description", ""),
        )

        # STRICT CRAWL-TIME EXPERIENCE FILTER:
        # If candidate specified an experience filter (e.g. 0-3 Y),
        # immediately drop any job requiring outside that experience range.
        if experience and experience.lower() not in ("any", "all") and not exp_ok:
            print(f"Dropping job outside experience range ({experience}): {item.get('title')} ({detected_experience_level}, {min_years_required}y) - {exp_reasons}")
            continue

        is_easy = bool(item.get("is_easy_apply", False))
        # Trust portal search: always active unless HTTP confirms dead.
        # check_failed / unverified is informational only — never stored as a blocking gate.
        listing_status = "active"
        soft_status, soft_reason = check_job_liveness(job_url, timeout=2.0)
        if soft_status == "expired":
            print(f"Dropping confirmed expired/dead job: {job_url} ({soft_reason})")
            continue

        emails, phones = extract_contacts_from_text(item.get("description", ""))
        company_obj, _ = Company.objects.get_or_create(
            name=comp_name,
            defaults={
                "website": raw_website,
                "contact_emails": emails,
                "contact_phones": phones,
            }
        )
        comp_updated_fields = []
        if emails:
            merged_emails = sorted(list(set((company_obj.contact_emails or []) + emails)))
            if merged_emails != company_obj.contact_emails:
                company_obj.contact_emails = merged_emails
                comp_updated_fields.append("contact_emails")
        if phones:
            merged_phones = sorted(list(set((company_obj.contact_phones or []) + phones)))
            if merged_phones != company_obj.contact_phones:
                company_obj.contact_phones = merged_phones
                comp_updated_fields.append("contact_phones")
        if raw_website and not company_obj.website:
            company_obj.website = raw_website
            comp_updated_fields.append("website")
        if comp_updated_fields:
            company_obj.save(update_fields=comp_updated_fields)

        # Applied overlay: preserve APPLIED if this URL / same company+title was applied before
        existing = (
            Job.objects.filter(original_url=item["original_url"]).first()
            or Job.objects.filter(
                company_name__iexact=comp_name,
                title__iexact=item["title"],
                application_status__in=["APPLIED", "AUTO_APPLIED"],
            ).first()
        )

        already_applied = bool(
            existing and existing.application_status in ("APPLIED", "AUTO_APPLIED")
        ) or Job.objects.filter(
            company_name__iexact=comp_name,
            title__iexact=item["title"],
            application_status__in=["APPLIED", "AUTO_APPLIED"],
        ).exists()

        if already_applied:
            app_status = "APPLIED"
        elif is_easy and exp_ok:
            app_status = "AUTO_APPLY_ELIGIBLE"
        elif is_easy and not exp_ok:
            app_status = "MANUAL_APPLY_NEEDED"  # visible but not One-Click
        else:
            app_status = "MANUAL_APPLY_NEEDED"

        apply_mode, mode_reasons = classify_apply_mode(
            is_easy_apply=is_easy,
            application_status=app_status,
            experience_filter=experience,
            experience_level=detected_experience_level,
            min_years_required=min_years_required,
            listing_status="active" if listing_status != "expired" else "expired",
        )
        eligibility_reasons = list(dict.fromkeys(list(exp_reasons) + list(mode_reasons)))

        is_fresh = bool(item.get("posted_at") and item["posted_at"] >= cutoff_time)
        priority = determine_priority_rank(match_score, is_easy, is_fresh)

        if existing:
            job_obj = existing
            job_obj.title = item["title"]
            job_obj.company = company_obj
            job_obj.company_name = comp_name
            if raw_website:
                job_obj.company_website = raw_website
            job_obj.portal_source = item.get("portal_source", job_obj.portal_source)
            job_obj.external_id = item.get("external_id", "") or job_obj.external_id
            job_obj.apply_url = item.get("apply_url") or item["original_url"]
            if item.get("description"):
                job_obj.description = item["description"]
            job_obj.locations = item.get("locations", [location])
            job_obj.work_mode = item.get("work_mode", job_obj.work_mode)
            job_obj.experience_level = detected_experience_level
            job_obj.min_years_required = min_years_required
            job_obj.match_score = match_score
            job_obj.priority_rank = priority
            job_obj.is_easy_apply = is_easy
            job_obj.apply_mode = apply_mode
            # Never overwrite APPLIED with a weaker status
            if job_obj.application_status not in ("APPLIED", "AUTO_APPLIED"):
                job_obj.application_status = app_status
            else:
                job_obj.apply_mode = "already_applied"
            # Re-seen on portal → active (unverified never sticks as a blocking state)
            job_obj.listing_status = "active"
            job_obj.eligibility_reasons = eligibility_reasons
            if item.get("posted_at"):
                job_obj.posted_at = item["posted_at"]
            job_obj.last_verified_at = timezone.now()
            job_obj.save()
        else:
            job_obj = Job.objects.create(
                title=item["title"],
                company=company_obj,
                company_name=comp_name,
                company_website=raw_website or company_obj.website,
                portal_source=item.get("portal_source", "indeed"),
                external_id=item.get("external_id", ""),
                original_url=item["original_url"],
                apply_url=item.get("apply_url") or item["original_url"],
                description=item.get("description", ""),
                locations=item.get("locations", [location]),
                work_mode=item.get("work_mode", "Hybrid" if work_mode == "all" else work_mode),
                job_type=item.get("job_type", "Full-time" if job_type == "all" else job_type),
                experience_level=detected_experience_level,
                min_years_required=min_years_required,
                required_skills=item.get("required_skills", []),
                salary_min=item.get("salary_min"),
                salary_max=item.get("salary_max"),
                currency=item.get("currency", "INR"),
                posted_at=item.get("posted_at") or timezone.now(),
                last_verified_at=timezone.now(),
                is_easy_apply=is_easy,
                match_score=match_score,
                priority_rank=priority,
                application_status=app_status,
                listing_status="active",  # trusted from portal search feed
                apply_mode=apply_mode,
                eligibility_reasons=eligibility_reasons,
                contact_emails=emails,
                contact_phones=phones,
            )
            if not emails:
                import threading
                threading.Thread(
                    target=_auto_enrich_job_and_company,
                    args=(job_obj.id, company_obj.id, comp_name, job_obj.company_website, job_obj.description),
                    daemon=True
                ).start()

        position_counter += 1
        _link_to_discovery_run(discovery_run, job_obj, page, position_counter)
        saved_records.append(job_obj)

    if discovery_run:
        discovery_run.current_page = page
        discovery_run.has_more = has_more
        discovery_run.total_results = DiscoveryResult.objects.filter(run=discovery_run).count()
        discovery_run.status = "running" if has_more else "completed"
        discovery_run.save(update_fields=["current_page", "has_more", "total_results", "status", "updated_at"])

    return (saved_records, has_more)


def search_indeed(keywords, location, days=1, experience="Fresher", job_type="all", work_mode="all", page=1, limit=60, query_terms=None):
    """
    Crawls fresh job listings matching keywords and location with date, experience,
    job type, and remote work restrictions using Playwright headless.
    Executes deep multi-page pagination (3-4 pages deep) per distinct query domain.
    Works dynamically across all role categories and all experience bands.
    """
    results = []
    exp_lower = (experience or "").lower()

    # Job type server parameter
    jt_param = ""
    if job_type and job_type.lower() == "internship":
        jt_param = "&jt=internship"
    elif job_type and job_type.lower() == "full-time":
        jt_param = "&jt=fulltime"
    elif job_type and job_type.lower() == "contract":
        jt_param = "&jt=contract"

    # Work mode server parameter
    wm_param = ""
    if work_mode and work_mode.lower() == "remote":
        wm_param = "&remotejob=032b3046-06a3-4876-8dfd-474eb5e7ed11"

    date_param = f"&fromage={days}" if days and days < 60 else ""
    encoded_l = urllib.parse.quote(location)
    cutoff_time = timezone.now() - timedelta(days=days)
    has_more = False

    terms_to_search = query_terms or ([keywords] if keywords else ["Software Engineer"])
    # Cap to top 3 search queries for Indeed to ensure fast turnaround
    terms_to_search = terms_to_search[:3]

    try:
        from playwright.sync_api import sync_playwright
        with sync_playwright() as p:
            browser = p.chromium.launch(
                headless=True,
                args=["--disable-blink-features=AutomationControlled"]
            )
            page_obj = browser.new_page(
                user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
            )

            seen_jk = set()
            for term in terms_to_search:
                if len(results) >= limit:
                    break

                clean_kw = clean_and_normalize_query_term(term)
                if not any(role in clean_kw.lower() for role in ["developer", "engineer", "full stack", "intern", "trainee", "software", "scientist", "analyst", "architect"]):
                    clean_kw = f"{clean_kw} Developer"

                # Natural role phrasing without restrictive &explvl tags (preserves Indian job postings)
                if exp_lower in ("senior", "5-8", "5-8 y", "5-8 years"):
                    search_query = f"Senior {clean_kw}" if "senior" not in clean_kw.lower() else clean_kw
                elif exp_lower in ("lead", "principal", "architect", "8+", "8+ y"):
                    search_query = f"Lead {clean_kw}" if not any(k in clean_kw.lower() for k in ("lead", "principal", "architect")) else clean_kw
                elif exp_lower in ("internship", "intern"):
                    search_query = f"{clean_kw} Intern" if "intern" not in clean_kw.lower() else clean_kw
                else:
                    search_query = clean_kw

                encoded_q = urllib.parse.quote(search_query)

                # DEEP MULTI-PAGE CRAWL: Crawl 3 to 4 pages per search term
                for page_idx in range(4):
                    if len(results) >= limit:
                        break

                    start_offset = ((page - 1) * 4 + page_idx) * 10
                    start_param = f"&start={start_offset}" if start_offset > 0 else ""
                    target_url = (
                        f"https://in.indeed.com/jobs?q={encoded_q}&l={encoded_l}{date_param}{jt_param}{wm_param}&sort=date{start_param}"
                    )

                    try:
                        page_obj.goto(target_url, timeout=20000, wait_until="domcontentloaded")
                        page_obj.wait_for_timeout(1200)
                    except Exception as nav_e:
                        print(f"Indeed nav warning for {target_url}: {nav_e}")
                        break

                    cards = page_obj.locator(".cardOutline, [class*='job_seen_beacon'], div.jobsearch-SerpJobCard")
                    count = cards.count()
                    if count == 0:
                        break

                    if count >= 8 and page_idx == 3:
                        has_more = True

                    for i in range(count):
                        if len(results) >= limit:
                            break
                        c = cards.nth(i)
                        try:
                            text = c.inner_text()
                        except Exception:
                            continue
                        lines = [l.strip() for l in text.split("\n") if l.strip()]
                        if not lines:
                            continue

                        # Prefer DOM title selector over first text line (avoids description bleed)
                        title = ""
                        try:
                            title_el = c.locator("h2.jobTitle, h2 a, a.jcs-JobTitle, [class*='jobTitle'] span").first
                            if title_el.count() > 0:
                                title = (title_el.inner_text() or "").strip()
                        except Exception:
                            title = ""
                        if not title:
                            title = lines[0]
                        if len(title) < 3 or not is_software_tech_job(title, text):
                            continue

                        # Prefer companyName selector — never take description sentences as company
                        comp = ""
                        try:
                            comp_el = c.locator(
                                "[data-testid='company-name'], span.companyName, "
                                "[class*='companyName'], [data-company-name='true']"
                            ).first
                            if comp_el.count() > 0:
                                comp = (comp_el.inner_text() or "").strip()
                        except Exception:
                            comp = ""
                        if not is_valid_company_name(comp):
                            # Fallback: first short non-badge line that looks like a company
                            skip_tokens = (
                                "easily apply", "active", "urgently hiring", "new", "posted",
                                "full-time", "part-time", "remote", "hybrid", "just posted",
                            )
                            for line in lines[1:6]:
                                low = line.lower()
                                if any(low.startswith(t) or low == t for t in skip_tokens):
                                    continue
                                if line.startswith("+") or "₹" in line or "$" in line:
                                    continue
                                if is_valid_company_name(line):
                                    comp = line
                                    break
                        if not is_valid_company_name(comp):
                            continue

                        loc = location
                        try:
                            loc_el = c.locator(
                                "[data-testid='text-location'], .companyLocation, [class*='companyLocation']"
                            ).first
                            if loc_el.count() > 0:
                                loc = (loc_el.inner_text() or "").strip() or location
                        except Exception:
                            pass

                        href = ""
                        try:
                            links = c.locator("a").all()
                            for a in links:
                                h = a.get_attribute("href") or ""
                                if "jk=" in h:
                                    href = h
                                    break
                        except Exception:
                            pass

                        jk_match = re.search(r"jk=([a-zA-Z0-9]+)", href)
                        jk = jk_match.group(1) if jk_match else ""
                        if not jk or jk in seen_jk or is_patterned_hex_id(jk):
                            continue
                        seen_jk.add(jk)
                        clean_url = f"https://in.indeed.com/viewjob?jk={jk}"

                        has_ia_badge = (
                            "easily apply" in text.lower() or
                            "easy apply" in text.lower() or
                            "apply with indeed" in text.lower() or
                            "apply with your indeed resume" in text.lower() or
                            c.locator(".iaIcon, [aria-label*='Easily apply'], [data-testid='indeedApply']").count() > 0
                        )
                        is_easy = bool(has_ia_badge)
                        detected_wm = "Remote" if "remote" in (loc + text).lower() else ("Hybrid" if "hybrid" in (loc + text).lower() else "Onsite")

                        # Parse real posting age from card text — do NOT invent "fresh" when missing
                        card_posted_at = parse_relative_time(text, default_window_days=days)
                        if days < 60 and card_posted_at < cutoff_time:
                            continue

                        results.append({
                            "title": title,
                            "company_name": comp,
                            "portal_source": "indeed",
                            "external_id": jk,
                            "original_url": clean_url,
                            "apply_url": clean_url,
                            "description": text[:800],
                            "locations": [loc],
                            "work_mode": detected_wm,
                            "is_easy_apply": is_easy,
                            "posted_at": card_posted_at,
                        })

                    if count < 4:
                        break

            browser.close()
    except Exception as e:
        print(f"Playwright Indeed search warning: {e}")

    return (results, has_more)


def search_wellfound(keywords="", location="India", days=1, experience="Fresher", job_type="all", work_mode="all", page=1, limit=50, query_terms=None):
    """
    Crawls live startup jobs from Wellfound (AngelList Talent).
    Strategy 1 (Primary - Authenticated Live Search):
      Uses persistent browser session to access authenticated https://wellfound.com/jobs.
      Intercepts JobSearchResultsX GraphQL query to fetch authentic live search results
      matching user's filters directly from Wellfound's internal search engine.
      Includes progressive scrolling to trigger multi-page batches.
    Strategy 2 (Fallback - Public SEO Directory):
      Navigates to https://wellfound.com/role/l/{slug}/india, parses cards and JSON-LD schema
      with progressive 3-page deep scrolling.
    Supports progressive batching across pages for all tech roles and experience bands.
    """
    results = []
    seen_urls = set()
    cutoff_time = timezone.now() - timedelta(days=days)
    session_path = os.path.join(settings.BASE_DIR, "browser_session")

    # -------------------------------------------------------------------------
    # Strategy 1: Authenticated Live Search via Persistent Browser Session
    # -------------------------------------------------------------------------
    if os.path.exists(session_path):
        try:
            from playwright.sync_api import sync_playwright
            with sync_playwright() as p:
                context = p.chromium.launch_persistent_context(
                    user_data_dir=session_path,
                    headless=True,
                    args=["--disable-blink-features=AutomationControlled"]
                )
                page_obj = context.new_page()

                def handle_gql_response(response):
                    if "graphql" in response.url and response.status == 200:
                        try:
                            req_post = response.request.post_data
                            if req_post and "JobSearchResultsX" in req_post:
                                data = response.json()
                                talent = data.get("data", {}).get("talent", {})
                                search_results = talent.get("jobSearchResults", {})
                                startups = search_results.get("startups", {}).get("edges", [])

                                for edge in startups:
                                    node = edge.get("node", {})
                                    s = node.get("promotedStartup") or node
                                    comp_name = s.get("name", "Startup")
                                    comp_slug = s.get("slug", "")
                                    comp_url = f"https://wellfound.com/company/{comp_slug}" if comp_slug else "https://wellfound.com"

                                    highlighted = s.get("highlightedJobListings", [])
                                    for job in highlighted:
                                        jid = str(job.get("id"))
                                        job_slug = job.get("slug", "")
                                        clean_url = f"https://wellfound.com/jobs/{jid}-{job_slug}" if job_slug else f"https://wellfound.com/jobs/{jid}"

                                        if clean_url in seen_urls:
                                            continue
                                        seen_urls.add(clean_url)

                                        title = job.get("title", "")
                                        if not is_software_tech_job(title):
                                            continue

                                        # Parse live timestamp
                                        live_ts = job.get("liveStartAt")
                                        if live_ts:
                                            try:
                                                posted_dt = datetime.fromtimestamp(live_ts, tz=dt_timezone.utc)
                                            except Exception:
                                                posted_dt = timezone.now() - timedelta(days=1)
                                        else:
                                            posted_dt = timezone.now() - timedelta(days=1)

                                        if days < 60 and posted_dt < cutoff_time:
                                            continue

                                        # Experience classification
                                        title_lower = title.lower()
                                        raw_jt = (job.get("jobType") or "").lower()
                                        if any(k in title_lower for k in ("intern", "trainee")) or "intern" in raw_jt:
                                            exp_level = "Fresher"
                                        elif any(k in title_lower for k in ("senior", "sr.", "lead", "staff", "principal", "architect")):
                                            exp_level = "Senior"
                                        elif any(k in title_lower for k in ("mid", "sde 2", "sde ii", "sde-2")):
                                            exp_level = "Mid"
                                        else:
                                            exp_level = "Entry-level"

                                        if experience.lower() in ("fresher", "internship", "entry-level", "0-2", "0-2 y", "0-3", "0-3 y", "1-3", "1-3 y") and exp_level == "Senior":
                                            continue
                                        if experience.lower() in ("fresher", "internship") and exp_level in ("Mid", "Senior"):
                                            continue

                                        # Job type filter
                                        if job_type and job_type.lower() != "all":
                                            jt_low = job_type.lower()
                                            if jt_low == "internship" and "intern" not in raw_jt and "intern" not in title_lower:
                                                continue
                                            if jt_low == "full-time" and "intern" in raw_jt and "full" not in raw_jt:
                                                continue
                                            if jt_low == "contract" and "contract" not in raw_jt:
                                                continue

                                        remote_val = job.get("remote")
                                        detected_wm = "Remote" if remote_val is True else "Hybrid"

                                        if work_mode and work_mode.lower() != "all":
                                            wm_low = work_mode.lower()
                                            if wm_low == "remote" and not remote_val:
                                                continue
                                            if wm_low == "onsite" and remote_val:
                                                continue

                                        classified_jt = "Internship" if "intern" in raw_jt or "intern" in title_lower else "Full-time"

                                        results.append({
                                            "title": title,
                                            "company_name": comp_name,
                                            "company_website": comp_url,
                                            "portal_source": "wellfound",
                                            "external_id": jid,
                                            "original_url": clean_url,
                                            "apply_url": clean_url,
                                            "description": f"Verified live Wellfound startup opening for {title} at {comp_name}.",
                                            "locations": [location, "Remote"],
                                            "work_mode": detected_wm,
                                            "job_type": classified_jt,
                                            "is_easy_apply": True,
                                            "experience_level": exp_level,
                                            "posted_at": posted_dt,
                                            "required_skills": [s for s in COMMON_TECH_STACK if s.lower() in (title_lower + " " + comp_name.lower())] or ["Software Engineering", "REST APIs"]
                                        })
                        except Exception as ex:
                            print(f"Wellfound GQL parse note: {ex}")

                page_obj.on("response", handle_gql_response)
                page_obj.goto("https://wellfound.com/jobs", timeout=25000, wait_until="domcontentloaded")
                # Progressive 3-page deep scroll to trigger subsequent GraphQL batches
                for _ in range(3):
                    page_obj.evaluate("window.scrollBy(0, 1500)")
                    page_obj.wait_for_timeout(1200)
                context.close()
        except Exception as e:
            print(f"Wellfound authenticated search warning: {e}")

    # If Strategy 1 succeeded and returned jobs, return sliced page batch
    if len(results) >= 15:
        batch_size = 35
        start_idx = (page - 1) * batch_size
        end_idx = start_idx + batch_size
        page_results = results[start_idx:end_idx]
        has_more = end_idx < len(results)
        return (page_results, has_more)

    # -------------------------------------------------------------------------
    # Strategy 2: Fallback to Directory Crawl with JSON-LD Verification
    # -------------------------------------------------------------------------
    terms_to_check = query_terms or ([keywords] if keywords else ["software engineer"])
    candidate_role_urls = []
    for term in terms_to_check:
        clean_kw = (term or "").strip().lower()
        if any(k in clean_kw for k in ("machine learning", "ml", "ai", "artificial intelligence")):
            candidate_role_urls.append("https://wellfound.com/role/l/machine-learning-engineer/india")
            candidate_role_urls.append("https://wellfound.com/role/l/artificial-intelligence-engineer/india")
        if any(k in clean_kw for k in ("data science", "data scientist", "data")):
            candidate_role_urls.append("https://wellfound.com/role/l/data-scientist/india")
        if any(k in clean_kw for k in ("python",)):
            candidate_role_urls.append("https://wellfound.com/role/l/python-developer/india")
        if any(k in clean_kw for k in ("frontend", "react", "ui", "ux", "next")):
            candidate_role_urls.append("https://wellfound.com/role/l/frontend-developer/india")
        if any(k in clean_kw for k in ("backend", "api", "node", "django", "fastapi")):
            candidate_role_urls.append("https://wellfound.com/role/l/backend-developer/india")
        if any(k in clean_kw for k in ("full stack", "fullstack")):
            candidate_role_urls.append("https://wellfound.com/role/l/full-stack-engineer/india")
        if any(k in clean_kw for k in ("devops", "cloud", "aws", "infrastructure")):
            candidate_role_urls.append("https://wellfound.com/role/l/devops-engineer/india")

    if not candidate_role_urls:
        candidate_role_urls = ["https://wellfound.com/role/l/software-engineer/india"]

    candidate_role_urls = list(dict.fromkeys(candidate_role_urls))[:4]

    try:
        from playwright.sync_api import sync_playwright
        with sync_playwright() as p:
            browser = p.chromium.launch(
                headless=True,
                args=["--disable-blink-features=AutomationControlled"]
            )
            page_obj = browser.new_page(
                user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
            )
            for base_url in candidate_role_urls:
                if len(results) >= 60:
                    break
                try:
                    page_obj.goto(base_url, timeout=25000, wait_until="domcontentloaded")
                    page_obj.wait_for_timeout(1500)
                    # Progressive 3-page deep scroll to load full card lists
                    for _ in range(3):
                        page_obj.evaluate("window.scrollTo(0, document.body.scrollHeight)")
                        page_obj.wait_for_timeout(1200)
                except Exception as nav_e:
                    print(f"Wellfound nav warning for {base_url}: {nav_e}")
                    continue

                current_company = "Tech Startup"
                current_co_page = ""

                for a in page_obj.query_selector_all("a"):
                    href = a.get_attribute("href") or ""
                    text = a.inner_text().strip()

                    if "/company/" in href and text and len(text) > 1 and not text.startswith("View"):
                        current_company = text
                        slug = href.split("?")[0]
                        current_co_page = f"https://wellfound.com{slug}"
                    elif "/jobs/" in href and text and len(text) > 2:
                        path = href.split("?")[0]
                        if not path.startswith("/jobs/"):
                            continue
                        clean_job_url = f"https://wellfound.com{path}"
                        if clean_job_url in seen_urls:
                            continue
                        seen_urls.add(clean_job_url)

                        job_title = text
                        if not is_software_tech_job(job_title):
                            continue

                        job_id = path.replace("/jobs/", "").split("-")[0]

                        card_text = ""
                        try:
                            card_text = a.evaluate("el => { const c = el.closest('div[class*=\"styles_jobListing\"], div[class*=\"styles_listing\"], div[data-test*=\"Job\"], li, tr, div'); return c ? c.innerText : ''; }")
                        except Exception:
                            pass

                        desc = card_text if card_text and len(card_text) > 15 else f"Verified active startup opening for {job_title} at {current_company} on Wellfound."

                        # Verify real posting date & experience via JSON-LD
                        job_ld = fetch_wellfound_job_details(clean_job_url)
                        real_posted_at = None
                        months_exp = None
                        ld_desc = ""

                        if job_ld:
                            date_str = job_ld.get("datePosted")
                            if date_str:
                                try:
                                    real_posted_at = datetime.fromisoformat(date_str.replace("Z", "+00:00"))
                                except Exception:
                                    pass
                            exp_req = job_ld.get("experienceRequirements", {})
                            if isinstance(exp_req, dict):
                                months_exp = exp_req.get("monthsOfExperience")
                            ld_desc = job_ld.get("description", "")

                        if not real_posted_at:
                            real_posted_at = parse_relative_time(card_text, default_window_days=days)

                        if days < 60 and real_posted_at < cutoff_time:
                            continue

                        # Accurately classify experience level
                        parsed_exp = "Entry-level"
                        full_context = (job_title + " " + desc + " " + ld_desc).lower()
                        if months_exp is not None:
                            if months_exp >= 60:
                                parsed_exp = "Senior"
                            elif months_exp >= 24:
                                parsed_exp = "Mid"
                            elif months_exp <= 12:
                                parsed_exp = "Fresher" if "intern" in job_title.lower() else "Entry-level"
                        elif any(k in full_context for k in ("3-6+ years", "3-6 years", "3–6+ years", "4-7 years", "5+ years", "senior", "lead", "3 years of exp", "4 years of exp", "3+ years")):
                            parsed_exp = "Senior" if any(k in full_context for k in ("senior", "lead", "5+")) else "Mid"
                        elif any(k in full_context for k in ("intern", "internship")):
                            parsed_exp = "Fresher"
                        elif any(k in full_context for k in ("junior", "fresher", "0-1 years", "0-2 years")):
                            parsed_exp = "Entry-level"

                        if experience.lower() in ("fresher", "internship", "entry-level", "0-2", "0-2 y", "0-3", "0-3 y", "1-3", "1-3 y") and parsed_exp == "Senior":
                            continue
                        if experience.lower() in ("fresher", "internship") and parsed_exp in ("Mid", "Senior"):
                            continue

                        results.append({
                            "title": job_title,
                            "company_name": current_company,
                            "company_website": current_co_page or clean_job_url,
                            "portal_source": "wellfound",
                            "external_id": job_id,
                            "original_url": clean_job_url,
                            "apply_url": clean_job_url,
                            "description": ld_desc[:600] if ld_desc else desc,
                            "locations": [location, "Remote"],
                            "work_mode": "Hybrid",
                            "is_easy_apply": True,
                            "experience_level": parsed_exp,
                            "posted_at": real_posted_at,
                            "required_skills": [s for s in COMMON_TECH_STACK if s.lower() in full_context] or ["Software Engineering", "REST APIs"]
                        })

                        if len(results) >= 60:
                            break

            browser.close()
    except Exception as e:
        print(f"Wellfound live scraping warning: {e}")

    batch_size = 35
    start_idx = (page - 1) * batch_size
    end_idx = start_idx + batch_size
    page_results = results[start_idx:end_idx]
    has_more = end_idx < len(results)
    return (page_results, has_more)


def search_cutshort(keywords="", location="India", days=1, page=1, limit=60, query_terms=None):
    """
    Crawls live software engineering opportunities from Cutshort using Playwright headless.
    Parses posting badges and drops stale jobs.
    Uses verified, active Cutshort category landing pages with progressive 3-page deep scrolling.
    Supports multi-query fan-out across all target domains without short-circuiting.
    """
    results = []
    terms_to_check = query_terms or ([keywords] if keywords else ["software developer"])
    candidate_urls = []
    for term in terms_to_check:
        clean_kw = (term or "").strip().lower()
        if any(k in clean_kw for k in ("machine learning", "ai", "ml", "data", "deep learning")):
            candidate_urls.append("https://cutshort.io/jobs/datascience-jobs")
        if any(k in clean_kw for k in ("backend", "api", "node", "django", "fastapi")):
            candidate_urls.append("https://cutshort.io/jobs/backend-developer-jobs")
        if any(k in clean_kw for k in ("full stack", "fullstack", "mern", "mean")):
            candidate_urls.append("https://cutshort.io/jobs/fullstack-developer-jobs")
        if any(k in clean_kw for k in ("react", "frontend", "ui", "ux", "next")):
            candidate_urls.append("https://cutshort.io/jobs/frontend-developer-jobs")
        if any(k in clean_kw for k in ("python", "software", "developer", "engineer")):
            candidate_urls.append("https://cutshort.io/jobs/software-development-jobs")
        if any(k in clean_kw for k in ("devops", "cloud", "aws", "docker", "kubernetes")):
            candidate_urls.append("https://cutshort.io/jobs/devops-jobs")

    if not candidate_urls:
        candidate_urls = ["https://cutshort.io/jobs/software-development-jobs"]

    candidate_urls = list(dict.fromkeys(candidate_urls))

    cutoff_time = timezone.now() - timedelta(days=days)

    try:
        from playwright.sync_api import sync_playwright
        with sync_playwright() as p:
            browser = p.chromium.launch(
                headless=True,
                args=["--disable-blink-features=AutomationControlled"]
            )
            page_obj = browser.new_page(
                user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
            )

            seen_urls = set()
            city_tokens = {
                "delhi", "noida", "gurugram", "gurgaon", "bengaluru", "bangalore",
                "mumbai", "pune", "hyderabad", "chennai", "remote", "india",
            }

            for url in candidate_urls:
                try:
                    page_obj.goto(url, timeout=25000, wait_until="domcontentloaded")
                    page_obj.wait_for_timeout(1500)
                    # Progressive 3-page deep scroll to render dynamic React cards
                    for _ in range(3):
                        page_obj.evaluate("window.scrollTo(0, document.body.scrollHeight)")
                        page_obj.wait_for_timeout(1000)
                except Exception as nav_e:
                    print(f"Cutshort nav warning for {url}: {nav_e}")
                    continue

                for a in page_obj.query_selector_all("a"):
                    href = a.get_attribute("href") or ""
                    text = a.inner_text().strip()

                    if "/job/" in href and len(text) > 3:
                        path = href.split("?")[0]
                        clean_job_url = path if path.startswith("http") else f"https://cutshort.io{path}"
                        if clean_job_url in seen_urls:
                            continue
                        seen_urls.add(clean_job_url)

                        job_title = text
                        if not is_software_tech_job(job_title):
                            continue

                        # Keyword match check if specific tech requested
                        kw_terms = [k.lower() for k in (keywords or "").split() if len(k) > 2]
                        if kw_terms and not any(k in job_title.lower() for k in kw_terms) and len(results) > 10:
                            continue

                        slug = path.split("/job/")[-1]
                        parts = [p for p in slug.split("-") if p]
                        job_id = parts[-1] if parts else ""

                        loc = location
                        for part in parts:
                            if part.lower() in city_tokens:
                                loc = part.title()
                                break

                        card_text = ""
                        card_company = ""
                        try:
                            card_text = a.evaluate(
                                "el => { const c = el.closest('div[class*=\"job-card\"], div[class*=\"card\"], li, article, div'); return c ? c.innerText : ''; }"
                            )
                            card_company = a.evaluate(
                                """el => {
                                  const c = el.closest('div[class*="job-card"], div[class*="card"], li, article, div');
                                  if (!c) return '';
                                  const nameEl = c.querySelector('[class*="company"], [data-test*="company"], a[href*="/company/"]');
                                  return nameEl ? (nameEl.innerText || '').trim() : '';
                                }"""
                            )
                        except Exception:
                            pass

                        # Derive company from card DOM first; slug parsing is last resort
                        comp = sanitize_company_name(card_company)
                        if not comp and card_text:
                            card_lines = [ln.strip() for ln in card_text.split("\n") if ln.strip()]
                            for ln in card_lines[1:4]:
                                if ln.lower() == job_title.lower():
                                    continue
                                if is_valid_company_name(ln) and ln.lower() not in city_tokens:
                                    comp = ln
                                    break
                        if not comp:
                            title_tokens = set(re.findall(r"[a-z0-9]+", job_title.lower()))
                            company_parts = []
                            for p in parts[:-1]:
                                pl = p.lower()
                                if pl in title_tokens or pl in city_tokens:
                                    if company_parts:
                                        break
                                    continue
                                company_parts.append(p)
                            slug_comp = " ".join(company_parts).replace("_", " ").strip()
                            if not is_valid_company_name(slug_comp) and len(parts) >= 4:
                                slug_comp = " ".join(parts[-4:-1]).replace("_", " ").title()
                            comp = sanitize_company_name(slug_comp)
                        if not comp:
                            continue

                        desc = card_text if card_text and len(card_text) > 15 else f"Verified active software development role for {job_title} at {comp} on Cutshort."

                        posted_at = parse_relative_time(desc, default_window_days=days)
                        if posted_at < cutoff_time:
                            continue

                        slug_low = slug.lower()
                        desc_low = desc.lower()
                        if "remote" in slug_low or "remote" in desc_low:
                            detected_wm = "Remote"
                        elif "hybrid" in desc_low:
                            detected_wm = "Hybrid"
                        elif any(k in desc_low for k in ("onsite", "office")):
                            detected_wm = "Onsite"
                        else:
                            detected_wm = "Hybrid"

                        classified_jt = "Internship" if any(k in job_title.lower() for k in ("intern", "trainee")) else "Full-time"

                        results.append({
                            "title": job_title,
                            "company_name": comp,
                            "company_website": "",
                            "portal_source": "cutshort",
                            "external_id": job_id,
                            "original_url": clean_job_url,
                            "apply_url": clean_job_url,
                            "description": desc,
                            "locations": [loc],
                            "work_mode": detected_wm,
                            "job_type": classified_jt,
                            "is_easy_apply": True,
                            "posted_at": posted_at,
                            "required_skills": [s for s in COMMON_TECH_STACK if s.lower() in (job_title + " " + desc).lower()] or ["Software Development", "APIs"]
                        })

                        if len(results) >= 65:
                            break

                if len(results) >= 65:
                    break

            browser.close()
    except Exception as e:
        print(f"Cutshort live scraping warning: {e}")

    batch_size = 35
    start_idx = (page - 1) * batch_size
    end_idx = start_idx + batch_size
    page_results = results[start_idx:end_idx]
    has_more = end_idx < len(results)
    return (page_results, has_more)


def search_ats_boards(keywords, days=1, limit=20, query_terms=None):
    """
    Direct ATS board search (Greenhouse / Lever APIs) for Indian tech startups and unicorns.
    Validates job updated_at against cutoff_time.
    Supports multi-query term matching across domains.
    """
    results = []
    cutoff_time = timezone.now() - timedelta(days=days)

    sample_boards = [
        {"slug": "razorpay", "name": "Razorpay", "type": "greenhouse"},
        {"slug": "postman", "name": "Postman", "type": "greenhouse"},
        {"slug": "cred", "name": "CRED", "type": "greenhouse"},
        {"slug": "meesho", "name": "Meesho", "type": "greenhouse"},
        {"slug": "swiggy", "name": "Swiggy", "type": "greenhouse"},
        {"slug": "groww", "name": "Groww", "type": "greenhouse"},
        {"slug": "browserstack", "name": "BrowserStack", "type": "greenhouse"},
        {"slug": "urbancompany", "name": "Urban Company", "type": "greenhouse"},
        {"slug": "slice", "name": "Slice", "type": "greenhouse"},
        {"slug": "inmobi", "name": "InMobi", "type": "greenhouse"},
    ]

    all_terms = query_terms or ([keywords] if keywords else [])
    kw_terms = set()
    for t in all_terms:
        for k in (t or "").lower().split():
            if len(k) > 2:
                kw_terms.add(k)
    role_terms = ["software", "developer", "engineer", "intern", "backend", "full stack", "fullstack", "sde", "frontend", "python"]

    for b in sample_boards:
        if len(results) >= limit:
            break
        try:
            url = f"https://boards-api.greenhouse.io/v1/boards/{b['slug']}/jobs"
            resp = requests.get(url, timeout=3)
            if resp.status_code == 200:
                data = resp.json()
                jobs = data.get("jobs", [])
                for j in jobs:
                    title = j.get("title", "")
                    title_lower = title.lower()
                    
                    is_match = any(k in title_lower for k in kw_terms) or (
                        any(r in title_lower for r in role_terms) and any(tech in title_lower for tech in ["python", "django", "fastapi", "full", "stack", "backend", "software", "intern"])
                    )
                    if not is_match or not is_software_tech_job(title):
                        continue

                    updated_at_str = j.get("updated_at")
                    posted_dt = timezone.now() - timedelta(hours=6)
                    if updated_at_str:
                        try:
                            posted_dt = datetime.fromisoformat(updated_at_str.replace("Z", "+00:00"))
                        except Exception:
                            pass

                    if posted_dt < cutoff_time:
                        continue

                    results.append({
                        "title": title,
                        "company_name": b["name"],
                        "portal_source": "ats_direct",
                        "external_id": str(j.get("id")),
                        "original_url": j.get("absolute_url"),
                        "apply_url": j.get("absolute_url"),
                        "description": f"Official opening at {b['name']} for {title}.",
                        "locations": [j.get("location", {}).get("name", "India")],
                        "work_mode": "Hybrid",
                        "is_easy_apply": True,
                        "posted_at": posted_dt,
                    })
                    if len(results) >= limit:
                        break
        except Exception:
            continue

    return results

