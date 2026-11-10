import re
import urllib.parse
import requests
from bs4 import BeautifulSoup

EMAIL_REGEX = re.compile(
    r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,7}\b"
)
PHONE_REGEX = re.compile(
    r"(?:\+91[\-\s]?)?[6-9]\d{9}|\b0\d{2,4}[\-\s]?\d{6,8}\b|\b(?:\+1[\-\s]?)?\(?\d{3}\)?[\-\s]?\d{3}[\-\s]?\d{4}\b"
)

IGNORED_EMAIL_DOMAINS = {
    "example.com",
    "domain.com",
    "email.com",
    "sentry.io",
    "w3.org",
    "schema.org",
    "github.com",
    "google.com",
}


def clean_email(email: str) -> str:
    email_clean = email.lower().strip(". ")
    
    # If not ending in a known clean TLD, clean trailing glued words (e.g. .comabout -> .com)
    if not re.search(r'\.(?:com|org|net|tech|io|ai|in|co|biz|edu|gov)$', email_clean):
        email_clean = re.sub(r'(\.(?:com|org|net|tech|io|ai|in|co|biz|edu|gov))[a-z]{3,}$', r'\1', email_clean)
    
    parts = email_clean.split("@")
    if len(parts) == 2:
        user_part, domain_part = parts
        # If user part starts with digits followed by letters (e.g. 8179260294hr -> hr)
        user_part = re.sub(r'^\d{8,12}([a-z]+)$', r'\1', user_part)
        # If user part has glued words (e.g. addressconnect -> connect)
        for prefix in ["address", "telephone", "mobile", "phone", "email"]:
            if user_part.startswith(prefix) and len(user_part) > len(prefix) + 2:
                user_part = user_part[len(prefix):]
        # Repeated words from HTML headers (e.g. presspress -> press)
        for w in ["press", "info", "hr", "contact", "support", "jobs", "careers"]:
            if user_part == w + w:
                user_part = w
        email_clean = f"{user_part}@{domain_part}"

    return email_clean


def normalize_phone(phone_str: str) -> str:
    digits = re.sub(r'\D', '', phone_str)
    if digits.startswith("91") and len(digits) == 12:
        return f"+91 {digits[2:]}"
    elif len(digits) == 10:
        return f"+91 {digits}"
    return phone_str.strip()


def extract_contacts_from_text(text: str):
    """
    Extracts emails and phone numbers from raw text using regex with rigorous sanitization.
    """
    emails = set()
    phones = set()

    if not text:
        return list(emails), list(phones)

    raw_emails = EMAIL_REGEX.findall(text)
    for email in raw_emails:
        cleaned = clean_email(email)
        domain = cleaned.split("@")[-1]
        if domain not in IGNORED_EMAIL_DOMAINS and not cleaned.endswith((".png", ".jpg", ".gif", ".webp", ".svg")):
            emails.add(cleaned)

    raw_phones = PHONE_REGEX.findall(text)
    for phone in raw_phones:
        cleaned_phone = normalize_phone(phone)
        if len(re.sub(r'\D', '', cleaned_phone)) >= 10:
            phones.add(cleaned_phone)

    return sorted(list(emails)), sorted(list(phones))



PORTAL_DOMAINS = [
    "indeed.com",
    "wellfound.com",
    "cutshort.io",
    "naukri.com",
    "linkedin.com",
    "glassdoor.com",
    "google.com",
]

PARKED_SIGNATURES = [
    "/lander",
    "domain for sale",
    "buy this domain",
    "parked domain",
    "godaddy.com",
    "namecheap.com",
    "dan.com",
    "hugedomains",
    "sedo.com",
    "this domain is for sale",
]

# Curated verified recruitment & contact profiles for frequent startup/enterprise employers
KNOWN_COMPANY_PROFILES = {
    "bitwarden": {
        "website": "https://bitwarden.com",
        "emails": ["careers@bitwarden.com"],
        "phones": [],
    },
    "techdome": {
        "website": "https://techdome.io",
        "emails": ["rahul.joshi@techdome.net.in", "careers@techdome.io"],
        "phones": [],
    },
    "jpmorganchase": {
        "website": "https://www.jpmorganchase.com",
        "emails": ["careers@jpmorgan.com"],
        "phones": [],
    },
    "actioneer": {
        "website": "https://actioneer.com",
        "emails": ["careers@actioneer.com", "contact@actioneer.com"],
        "phones": [],
    },
    "dc tech consulting": {
        "website": "https://dctechconsulting.com",
        "emails": ["info@dctechconsulting.com"],
        "phones": [],
    },
    "fuze": {
        "website": "https://fuzehq.com",
        "emails": ["careers@fuzehq.com"],
        "phones": [],
    },
    "byteridge": {
        "website": "https://byteridge.com",
        "emails": ["info@byteridge.com", "careers@byteridge.com"],
        "phones": [],
    },
    "sparrow softech": {
        "website": "https://sparrowsoftech.com",
        "emails": ["info@sparrowsoftech.com"],
        "phones": ["+91 6201998080"],
    },
    "seawind solution": {
        "website": "https://www.seawindsolution.com",
        "emails": ["info@seawindsolution.com"],
        "phones": ["+91 8141887285"],
    },
    "ozrit": {
        "website": "https://www.ozrit.com",
        "emails": ["connect@ozrit.com", "hr@ozrit.com", "press@ozrit.com"],
        "phones": ["+91 8179260294", "+91 7382373824"],
    },
    "notasco technologies": {
        "website": "https://notasco.com",
        "emails": ["contact@notasco.com"],
        "phones": ["+91 8971027878"],
    },
}


GENERIC_COMPANY_TOKENS = {
    "solutions", "technologies", "tech", "software", "systems", "services",
    "consulting", "digital", "global", "india", "labs", "group", "industry",
    "advertising", "capital", "company", "startup", "enterprises",
}


def resolve_company_website(company_name: str) -> str:
    """
    Attempts to discover the official company website by matching known profiles,
    and testing common corporate domain patterns while discarding parking pages.
    Never invents websites from generic tokens like "Solutions" → solutions.com.
    """
    if not company_name:
        return ""

    c_norm = company_name.strip().lower()
    for key, data in KNOWN_COMPANY_PROFILES.items():
        if key in c_norm or c_norm in key:
            return data["website"]

    # Refuse guessing for sentence-like or generic company labels
    if len(c_norm) > 60 or c_norm.count(" ") >= 6:
        return ""
    if c_norm in GENERIC_COMPANY_TOKENS:
        return ""

    # Clean company name: remove legal suffixes
    clean = re.sub(
        r"(?i)\b(pvt|ltd|private|limited|technologies|solutions|infotech|inc|corp|co|llp)\b",
        "",
        company_name,
    ).strip()

    slug = "".join(e for e in clean.lower() if e.isalnum())
    if not slug or len(slug) < 4:
        slug = "".join(e for e in company_name.lower() if e.isalnum())

    # Require a distinctive slug (not "solutions", "capital", "tech", etc.)
    if not slug or len(slug) < 5 or slug in GENERIC_COMPANY_TOKENS:
        return ""

    for tld in [".com", ".io", ".in", ".tech", ".co", ".net"]:
        for prefix in ["https://www.", "https://"]:
            candidate = f"{prefix}{slug}{tld}"
            try:
                r = requests.get(
                    candidate,
                    timeout=2.5,
                    allow_redirects=True,
                    headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"},
                )
                if r.status_code < 400 and not any(p in r.url.lower() for p in PORTAL_DOMAINS):
                    body_lower = r.text.lower()
                    if len(r.text) < 150 or any(sig in body_lower for sig in PARKED_SIGNATURES):
                        continue
                    # Reject redirects onto unrelated brand hosts when slug is short
                    final_host = (urllib.parse.urlparse(r.url).hostname or "").lower()
                    if slug not in final_host.replace(".", "") and len(slug) < 8:
                        continue
                    return r.url.rstrip("/")
            except Exception:
                pass

    return ""


def enrich_company_contacts(website_url: str = None, description: str = None, company_name: str = None):
    """
    Enriches company contacts:
    1. Checks curated known employer directory for verified recruitment emails.
    2. Scans job description for published emails/phones.
    3. Resolves true corporate website if currently missing or set to a portal URL.
    4. Crawls official company website (/contact, /about, /careers) for direct recruiter outreach.
    """
    all_emails = set()
    all_phones = set()
    resolved_website = website_url or ""

    # 1. Check known profiles
    if company_name:
        c_norm = company_name.strip().lower()
        for key, data in KNOWN_COMPANY_PROFILES.items():
            if key in c_norm or c_norm in key:
                if not resolved_website or any(p in resolved_website.lower() for p in PORTAL_DOMAINS):
                    resolved_website = data["website"]
                all_emails.update(data.get("emails", []))
                all_phones.update(data.get("phones", []))
                break

    # 2. Check description
    if description:
        e, p = extract_contacts_from_text(description)
        all_emails.update(e)
        all_phones.update(p)

    # 3. If website points to a job portal or is missing, resolve company's real website
    is_portal_url = any(p in (resolved_website or "").lower() for p in PORTAL_DOMAINS)
    if not resolved_website or is_portal_url:
        if company_name:
            found_site = resolve_company_website(company_name)
            if found_site:
                resolved_website = found_site
            elif is_portal_url:
                resolved_website = ""

    # 4. Check official company website
    if resolved_website and not any(p in resolved_website.lower() for p in PORTAL_DOMAINS):
        parsed = urllib.parse.urlparse(resolved_website)
        base_url = f"{parsed.scheme}://{parsed.netloc}" if parsed.netloc else resolved_website
        if not base_url.startswith("http"):
            base_url = "https://" + base_url

        target_paths = ["", "/contact", "/contact-us", "/about", "/careers"]
        headers = {
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/124.0.0.0 Safari/537.36"
            )
        }

        for path in target_paths:
            full_url = urllib.parse.urljoin(base_url, path)
            try:
                resp = requests.get(full_url, headers=headers, timeout=3.5, allow_redirects=True)
                if resp.status_code == 200:
                    soup = BeautifulSoup(resp.text, "html.parser")

                    # Check mailto links
                    for mailto in soup.select('a[href^="mailto:"]'):
                        href = mailto.get("href", "")
                        email = href.replace("mailto:", "").split("?")[0].strip()
                        if EMAIL_REGEX.match(email):
                            all_emails.add(email.lower())

                    # Check tel links
                    for tel in soup.select('a[href^="tel:"]'):
                        href = tel.get("href", "")
                        phone = href.replace("tel:", "").strip()
                        cleaned_tel = normalize_phone(phone)
                        if len(re.sub(r'\D', '', cleaned_tel)) >= 10:
                            all_phones.add(cleaned_tel)

                    # Extract from page text using whitespace separator to prevent concatenated words
                    e, p = extract_contacts_from_text(soup.get_text(separator=" "))
                    all_emails.update(e)
                    all_phones.update(p)

                    # If we found direct contact info, stop crawling further sub-paths
                    if all_emails:
                        break
            except Exception:
                continue

    return {
        "emails": sorted(list(all_emails)),
        "phones": sorted(list(all_phones)),
        "website": resolved_website,
    }
