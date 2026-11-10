"""
Job URL / company-name / liveness validators used before persisting scraped jobs.
Rejects patterned placeholder Indeed IDs, sentence-like company names, and dead URLs.
"""
from __future__ import annotations

import re
from typing import Optional, Tuple
from urllib.parse import urlparse, parse_qs

import requests

# Indeed job keys are 16 hex chars. Patterned placeholders are sequential / descending hex.
INDEED_JK_RE = re.compile(r"^[a-f0-9]{16}$", re.IGNORECASE)
PLACEHOLDER_JK_EXACT = {
    "0f1e2d3c4b5a6978",
    "456789abcdef0123",
    "0123456789abcdef",
    "abcdef0123456789",
    "cdef0123456789ab",
    "fedcba9876543210",
    "1234567890abcdef",
}

DEAD_PAGE_SIGNATURES = (
    "we can't find this page",
    "we cant find this page",
    "page not found",
    "this job has expired",
    "job has expired on indeed",
    "this job is closed",
    "no longer accepting applications",
    "the job you are looking for is no longer available",
    "this posting is no longer available",
    "this position has been filled",
)

PORTAL_HOSTS = (
    "indeed.com",
    "wellfound.com",
    "cutshort.io",
    "naukri.com",
    "linkedin.com",
    "glassdoor.com",
)

# Company names that are clearly description fragments or industry labels, not employers
BAD_COMPANY_EXACT = {
    "tech company",
    "tech startup",
    "external company",
    "target company",
    "company",
    "solutions",
    "advertising industry",
    "software development",
}

SENTENCE_STARTERS = (
    "this role",
    "interns assist",
    "we are looking",
    "you will",
    "the ideal",
    "responsible for",
    "join our",
    "as a ",
)


def extract_indeed_jk(url: str) -> str:
    if not url:
        return ""
    m = re.search(r"[?&]jk=([a-zA-Z0-9]+)", url)
    if m:
        return m.group(1).lower()
    parsed = urlparse(url)
    qs = parse_qs(parsed.query)
    vals = qs.get("jk") or []
    return (vals[0] or "").lower() if vals else ""


def is_patterned_hex_id(jk: str) -> bool:
    """Detect sequential / descending / repeated placeholder hex IDs."""
    if not jk:
        return True
    jk = jk.lower()
    if jk in PLACEHOLDER_JK_EXACT:
        return True
    if not INDEED_JK_RE.match(jk):
        return True

    # Fully sequential ascending or descending nibble sequence
    digits = [int(c, 16) for c in jk]
    asc = all((digits[i] - digits[i - 1]) % 16 == 1 for i in range(1, len(digits)))
    desc = all((digits[i - 1] - digits[i]) % 16 == 1 for i in range(1, len(digits)))
    if asc or desc:
        return True

    # High runs of consecutive +1 / -1 steps
    ups = sum(1 for i in range(1, len(digits)) if (digits[i] - digits[i - 1]) % 16 == 1)
    downs = sum(1 for i in range(1, len(digits)) if (digits[i - 1] - digits[i]) % 16 == 1)
    if ups >= 10 or downs >= 10:
        return True

    # Too few unique nibbles (e.g. aaaaaaaabbbbbbbb)
    if len(set(jk)) <= 3:
        return True

    return False


def is_valid_indeed_url(url: str) -> bool:
    jk = extract_indeed_jk(url)
    if not jk or is_patterned_hex_id(jk):
        return False
    return True


def is_valid_cutshort_url(url: str) -> bool:
    if not url or "cutshort.io" not in url.lower():
        return False
    return "/job/" in url.lower() or "jobid=" in url.lower()


def is_valid_job_url(url: str, portal: str = "") -> bool:
    if not url or not url.startswith("http"):
        return False
    portal = (portal or "").lower()
    host = (urlparse(url).hostname or "").lower()

    if "indeed" in portal or "indeed" in host:
        return is_valid_indeed_url(url)
    if "cutshort" in portal or "cutshort" in host:
        return is_valid_cutshort_url(url)
    if "wellfound" in portal or "wellfound" in host:
        return "/jobs/" in url.lower()
    return True


def is_valid_company_name(name: str) -> bool:
    """
    Reject description sentences, truncated blurbs, and industry labels misused as company.
    """
    if not name:
        return False
    clean = re.sub(r"\s+", " ", name).strip()
    if len(clean) < 2 or len(clean) > 55:
        return False
    lower = clean.lower()
    if lower in BAD_COMPANY_EXACT:
        return False
    if any(lower.startswith(s) for s in SENTENCE_STARTERS):
        return False
    # Sentence-like: ends with ellipsis / period mid-sentence / too many words
    if "…" in clean or "..." in clean:
        return False
    if clean.count(" ") >= 5:
        return False
    # Allow legal suffixes (Inc. / Ltd.) but reject sentence-ending punctuation
    if re.search(r"[.!?]$", clean) and not re.search(
        r"\b(?:inc|ltd|llc|corp|co|pvt|limited)\.?$", clean, re.IGNORECASE
    ):
        if clean.count(" ") >= 2:
            return False
    # Looks like a URL / host:port / path
    if re.search(r"https?://|:\d{2,5}|www\.|\.com/|\.io/|\.org/", lower):
        return False
    if re.search(r"\b(assist|drives|responsible|looking for|join our|activates|unifying|achieve|outcomes|delivers|provides|empowers|focuses)\b", lower):
        return False
    return True


def sanitize_company_name(name: str, fallback: str = "") -> str:
    if is_valid_company_name(name):
        return re.sub(r"\s+", " ", name).strip()
    if fallback and is_valid_company_name(fallback):
        return re.sub(r"\s+", " ", fallback).strip()
    return ""


def check_job_liveness(url: str, timeout: float = 4.0) -> Tuple[str, str]:
    """
    HTTP-check a job URL. Returns (listing_status, reason).
    listing_status: active | expired | unverified
    """
    if not url:
        return ("unverified", "Missing URL")

    portal = ""
    host = (urlparse(url).hostname or "").lower()
    if "indeed" in host:
        portal = "indeed"
        if not is_valid_indeed_url(url):
            return ("expired", "Invalid or placeholder Indeed job key")
    elif "cutshort" in host:
        portal = "cutshort"
        if not is_valid_cutshort_url(url):
            return ("unverified", "Invalid Cutshort URL")

    try:
        resp = requests.get(
            url,
            timeout=timeout,
            allow_redirects=True,
            headers={
                "User-Agent": (
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
                )
            },
        )
        body = (resp.text or "").lower()[:8000]
        if resp.status_code == 404:
            return ("expired", "HTTP 404")
        if resp.status_code >= 400:
            return ("unverified", f"HTTP {resp.status_code}")
        if any(sig in body for sig in DEAD_PAGE_SIGNATURES):
            return ("expired", "Portal reports job missing or closed")
        # Cloudflare challenge pages are live but blocked — keep unverified for listing,
        # extension will mark blocked_challenge at apply time.
        if "just a moment" in body or "cf-turnstile" in body or "checking your browser" in body:
            return ("unverified", "Bot challenge page (Cloudflare)")
        return ("active", "OK")
    except requests.Timeout:
        return ("unverified", "Liveness check timed out")
    except Exception as exc:
        return ("unverified", f"Liveness check failed: {exc}")


def is_portal_website(url: str) -> bool:
    if not url:
        return True
    host = (urlparse(url).hostname or "").lower()
    return any(p in host for p in PORTAL_HOSTS)
