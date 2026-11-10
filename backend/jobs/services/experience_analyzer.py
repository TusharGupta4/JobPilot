import re

# Seniority signals in Job Title
SENIOR_TITLE_SIGNALS = [
    r"\bsenior\b", r"\bsr\b", r"\bsr\.", r"\blead\b", r"\bprincipal\b",
    r"\bstaff\b", r"\barchitect\b", r"\bmanager\b", r"\bdirector\b",
    r"\bhead of\b", r"\bvp\b", r"\bvice president\b", r"\bgeneral manager\b",
    r"\bsde[- /]?(?:2|ii|3|iii)\b",
    r"\bsoftware (?:development )?engineer[- /]?(?:2|ii|3|iii)\b",
    r"\bdeveloper[- /]?(?:2|ii|3|iii)\b",
    r"\bengineer[- /]?(?:2|ii|3|iii)\b",
    r"\bl2\b", r"\bl3\b",
    r"\bmid[- ]level\b",
    r"\bexperienced\b"
]

ENTRY_TITLE_SIGNALS = [
    r"\bintern\b", r"\binternship\b", r"\btrainee\b", r"\bjr\b", r"\bjr\.",
    r"\bjunior\b", r"\bassociate\b", r"\bgraduate\b", r"\bentry\b", r"\bfresher\b"
]

FRESHER_FRIENDLY_PHRASES = [
    r"open to freshers?",
    r"freshers? (?:can|also)? apply",
    r"recent graduates?",
    r"new graduates?",
    r"college graduates?",
    r"fresh graduates?",
    r"no experience (?:is)? required",
    r"no prior experience",
    r"entry[- ]level",
    r"0[- ](?:1|2) years?",
    r"0 to (?:1|2) years?",
    r"passion over experience",
    r"self[- ]taught developers? (?:are )?welcome",
    r"freshers? are welcome",
    r"graduates? welcome",
]

YEARS_PATTERNS = [
    # "3-5 years", "3 to 5 years", "3 - 5 yrs", "3-5 y"
    re.compile(r"(\d+)\s*(?:-|–|to)\s*(\d+)\s*(?:years?|yrs?|y\b)", re.IGNORECASE),
    # "3+ years", "5+ yrs", "4+ y"
    re.compile(r"(\d+)\s*\+\s*(?:years?|yrs?|y\b)", re.IGNORECASE),
    # "minimum 3 years", "at least 2 yrs"
    re.compile(r"(?:minimum|min|at least)\s*(\d+)\s*(?:years?|yrs?|y\b)", re.IGNORECASE),
    # "Experience: 4+ years", "Experience: 3 years", "Experience 4+"
    re.compile(r"experience[:\s]+(\d+)\s*(?:\+|years?|yrs?)", re.IGNORECASE),
    # "3 years of experience", "4+ years in engineering role"
    re.compile(r"(\d+)\s*(?:\+\s*)?(?:years?|yrs?|y\b)\s*(?:of)?\s*(?:relevant|hands-on|industry|work|in engineering)?\s*(?:exp|experience|role)?", re.IGNORECASE),
]


def analyze_experience_requirements(title: str, description: str = ""):
    """
    Intelligently extracts experience boundaries and determines whether a job is
    fresher-friendly, entry-level, mid, or senior from the actual text requirements,
    rather than blindly relying on portal category labels.
    """
    title_lower = (title or "").lower()
    desc_lower = (description or "").lower()
    combined = f"{title_lower} {desc_lower}"

    # 1. Title Seniority Check
    is_senior_title = any(re.search(pat, title_lower) for pat in SENIOR_TITLE_SIGNALS)
    is_entry_title = any(re.search(pat, title_lower) for pat in ENTRY_TITLE_SIGNALS)

    # 2. Fresher-Friendly Phrases Check
    is_fresher_friendly = any(re.search(pat, desc_lower) for pat in FRESHER_FRIENDLY_PHRASES)

    # 3. Extract numerical years
    min_years = None
    max_years = None

    for pat in YEARS_PATTERNS:
        matches = pat.findall(combined)
        for m in matches:
            if isinstance(m, tuple):
                y1 = int(m[0])
                y2 = int(m[1]) if m[1] else y1
                # Filter out crazy numbers (e.g. 2024, salary digits)
                if y1 > 20:
                    continue
                if min_years is None or y1 < min_years:
                    min_years = y1
                if max_years is None or y2 > max_years:
                    max_years = y2
            else:
                y = int(m)
                if y > 20:
                    continue
                if min_years is None or y < min_years:
                    min_years = y

    # 3b. High Salary / Compensation Detection
    # In India, compensation >= ₹15,00,000 / 15 LPA is minimum 3-5+ years!
    is_high_salary = False
    if not is_entry_title and not is_fresher_friendly:
        if re.search(r"\b(?:[1-9]\d|1[5-9]|2\d|3\d|4\d|5\d)\s*(?:lpa|lakhs?|lac)\b", combined) or \
           re.search(r"\b(?:1[5-9]|2\d|3\d|4\d|5\d),00,000\b", combined) or \
           re.search(r"\b(?:20|25|30|35|40|50),00,000\b", combined):
            is_high_salary = True

    # 4. Determine Normalized Experience Level Matching Database Choices
    # A. Explicit Senior/Lead/Manager/Architect/SDE 2 in Title ALWAYS takes precedence
    if is_senior_title:
        if re.search(r"\b(?:lead|principal|staff|architect|manager|director|head of|vp|general manager)\b", title_lower):
            classified_level = "Lead"
        elif re.search(r"\b(?:sde[- /]?(?:2|ii)|mid|experienced)\b", title_lower):
            classified_level = "Mid"
        else:
            classified_level = "Senior"
    # B. Numerical Years from text (e.g. 8+ years, 5+ years, 3-5 years, 1-2 years, 0-1 years)
    elif min_years is not None:
        if min_years == 0 or (min_years <= 1 and is_fresher_friendly):
            classified_level = "Fresher"
        elif min_years <= 2:
            classified_level = "Junior"
        elif min_years <= 5:
            classified_level = "Mid"
        elif min_years <= 8:
            classified_level = "Senior"
        else:
            classified_level = "Lead"
    # C. High Salary role (>= ₹15-20 LPA) without entry signals
    elif is_high_salary:
        classified_level = "Senior" if re.search(r"\b(?:3\d|4\d|5\d),00,000\b", combined) else "Mid"
        if min_years is None:
            min_years = 4 if classified_level == "Senior" else 3
    # D. Entry title (Intern, Junior, Trainee, Graduate)
    elif is_entry_title:
        if re.search(r"\b(?:intern|internship|trainee|fresher|graduate)\b", title_lower):
            classified_level = "Fresher"
            is_fresher_friendly = True
        else:
            classified_level = "Junior"
    else:
        if is_fresher_friendly:
            classified_level = "Fresher"
        else:
            # Plain "Software Engineer" / "Full Stack Engineer" without entry signals
            # requires standard 2+ years of experience (Mid-level)!
            classified_level = "Mid"
            if min_years is None:
                min_years = 2

    return {
        "experience_level": classified_level,
        "min_years": min_years if min_years is not None else (0 if is_fresher_friendly else 1),
        "max_years": max_years,
        "is_senior": is_senior_title or classified_level in ("Mid", "Senior", "Lead") or is_high_salary,
        "is_lead": classified_level == "Lead",
        "is_fresher_friendly": (is_fresher_friendly or is_entry_title or classified_level == "Fresher") and classified_level not in ("Mid", "Senior", "Lead") and not is_high_salary
    }
