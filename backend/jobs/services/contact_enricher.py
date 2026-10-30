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


def extract_contacts_from_text(text: str):
    """
    Extracts emails and phone numbers from raw text using regex.
    """
    emails = set()
    phones = set()

    if not text:
        return list(emails), list(phones)

    raw_emails = EMAIL_REGEX.findall(text)
    for email in raw_emails:
        email_clean = email.lower().strip(".")
        domain = email_clean.split("@")[-1]
        if domain not in IGNORED_EMAIL_DOMAINS and not email_clean.endswith((".png", ".jpg", ".gif", ".webp")):
            emails.add(email_clean)

    raw_phones = PHONE_REGEX.findall(text)
    for phone in raw_phones:
        cleaned_phone = phone.strip()
        if len(cleaned_phone) >= 10:
            phones.add(cleaned_phone)

    return list(emails), list(phones)


def enrich_company_contacts(website_url: str = None, description: str = None):
    """
    Enriches company contacts:
    1. Scans job description.
    2. If website URL is provided, scrapes contact/about pages with timeout and safe headers.
    """
    all_emails = set()
    all_phones = set()

    # 1. Check description first
    if description:
        e, p = extract_contacts_from_text(description)
        all_emails.update(e)
        all_phones.update(p)

    # 2. Check website
    if website_url:
        parsed = urllib.parse.urlparse(website_url)
        base_url = f"{parsed.scheme}://{parsed.netloc}" if parsed.netloc else website_url
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
                resp = requests.get(full_url, headers=headers, timeout=4, allow_redirects=True)
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
                        if len(phone) >= 8:
                            all_phones.add(phone)

                    # Extract from page text
                    e, p = extract_contacts_from_text(soup.get_text())
                    all_emails.update(e)
                    all_phones.update(p)

                    # If we found direct contact info, no need to crawl all paths
                    if all_emails:
                        break
            except Exception:
                continue

    return {
        "emails": list(all_emails),
        "phones": list(all_phones),
    }
