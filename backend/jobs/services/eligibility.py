"""
Shared experience / apply-mode eligibility used at discovery time and API list time.

Important product rules (agreed architecture):
- Portal search results are trusted as discovery candidates.
- listing_status "unverified" / check_failed is informational ONLY — never blocks One-Click.
- Only confirmed "expired" blocks auto-apply.
- Manual Apply means external careers / not easy-apply — not "we couldn't HTTP-verify".
"""
from __future__ import annotations

from typing import List, Optional, Tuple


def candidate_max_years_for_filter(experience_filter: str) -> Optional[int]:
    """Upper bound of years the candidate filter allows (None = unrestricted)."""
    req = (experience_filter or "").strip().lower()
    if not req or req in ("any", "all"):
        return None
    if req == "fresher":
        return 1
    if req in ("0-2 y", "0-2", "0-2 years"):
        return 2
    if req in ("0-3 y", "0-3", "0-3 years", "1-3 y", "1-3", "1-3 years"):
        return 3
    if req in ("junior", "entry-level"):
        return 3
    if req in ("mid", "mid-level"):
        return 6
    if req == "senior":
        return 10
    if req == "lead":
        return 40
    return None


def candidate_min_years_for_filter(experience_filter: str) -> int:
    req = (experience_filter or "").strip().lower()
    if req in ("1-3 y", "1-3", "1-3 years"):
        return 1
    if req in ("mid", "mid-level"):
        return 2
    if req == "senior":
        return 3
    if req == "lead":
        return 5
    return 0


def experience_matches_filter(
    experience_filter: str,
    experience_level: str,
    min_years_required: Optional[int] = None,
    title: str = "",
    description: str = "",
) -> Tuple[bool, List[str]]:
    """
    Returns (eligible, reasons). Reasons are empty when eligible.
    """
    reasons: List[str] = []
    req = (experience_filter or "").strip().lower()
    if not req or req in ("any", "all"):
        return True, reasons

    level = (experience_level or "").strip().lower()
    min_y = min_years_required if min_years_required is not None else 0
    max_allowed = candidate_max_years_for_filter(req)

    title_lower = (title or "").lower()
    is_senior_title = any(
        k in title_lower
        for k in (
            "senior", "sr.", "sr ", "lead", "principal", "staff", "architect",
            "manager", "director", "head of", "vp"
        )
    )
    is_lead_title = any(
        k in title_lower
        for k in (
            "lead", "principal", "staff", "architect", "manager", "director",
            "head of", "vp"
        )
    )

    if max_allowed is not None and min_y > max_allowed:
        reasons.append(
            f"Experience mismatch: role requires {min_y}+ years; filter allows up to {max_allowed}"
        )

    if req == "fresher":
        if is_senior_title or level in ("mid", "senior", "lead") or "senior" in level or "lead" in level:
            reasons.append("Experience mismatch: mid/senior role under Fresher filter")
        elif min_y > 1:
            reasons.append(f"Experience mismatch: role requires {min_y}+ years under Fresher filter")
    elif req in ("0-2 y", "0-2", "0-2 years"):
        if is_senior_title or level in ("senior", "lead") or "senior" in level or "lead" in level:
            reasons.append("Experience mismatch: senior/lead role under 0-2 Y filter")
    elif req in ("0-3 y", "0-3", "0-3 years"):
        if is_senior_title or level in ("senior", "lead") or "senior" in level or "lead" in level:
            reasons.append("Experience mismatch: senior/lead role under 0-3 Y filter")
    elif req in ("1-3 y", "1-3", "1-3 years"):
        if is_senior_title or level in ("senior", "lead") or "senior" in level or "lead" in level:
            reasons.append("Experience mismatch: senior/lead role under 1-3 Y filter")
        if level == "fresher" and min_y == 0:
            reasons.append("Experience mismatch: fresher-only role under 1-3 Y filter")
    elif req in ("junior", "entry-level"):
        if is_senior_title or level in ("senior", "lead") or "senior" in level or "lead" in level:
            reasons.append("Experience mismatch: role exceeds Junior band")
    elif req in ("mid", "mid-level"):
        if level == "fresher" and min_y < 2:
            reasons.append("Experience mismatch: fresher role under Mid filter")
        if (is_lead_title or "lead" in level) and min_y >= 8:
            reasons.append("Experience mismatch: Lead role under Mid filter")
    elif req == "senior":
        if level in ("fresher", "junior", "entry-level"):
            reasons.append("Experience mismatch: junior/fresher role under Senior filter")
    elif req == "lead":
        if level in ("fresher", "junior", "entry-level"):
            reasons.append("Experience mismatch: junior/fresher role under Lead filter")

    seen = set()
    uniq = []
    for r in reasons:
        if r not in seen:
            seen.add(r)
            uniq.append(r)
    return (len(uniq) == 0, uniq)


def classify_apply_mode(
    *,
    is_easy_apply: bool,
    application_status: str,
    experience_filter: str = "Any",
    experience_level: str = "",
    min_years_required: Optional[int] = None,
    listing_status: str = "active",
    title: str = "",
    description: str = "",
) -> Tuple[str, List[str]]:
    """
    Returns (apply_mode, reasons).
    apply_mode: one_click | manual_external | already_applied | ineligible
    """
    app = (application_status or "").upper()
    listing = (listing_status or "active").lower()
    reasons: List[str] = []

    if app in ("APPLIED", "AUTO_APPLIED"):
        return "already_applied", ["Already applied"]

    if listing == "expired":
        return "ineligible", ["Listing expired or closed"]

    ok_exp, exp_reasons = experience_matches_filter(
        experience_filter,
        experience_level,
        min_years_required,
        title=title,
        description=description,
    )
    if not ok_exp:
        return "ineligible", exp_reasons

    if app == "MANUAL_APPLY_NEEDED":
        return "manual_external", ["Requires manual application"]

    if app == "REJECTED":
        return "ineligible", ["Listing rejected or inactive"]

    if is_easy_apply:
        return "one_click", []

    return "manual_external", ["Requires manual / external application"]


def is_auto_ready(
    *,
    listing_status: str,
    is_easy_apply: bool,
    application_status: str,
    experience_filter: str = "Any",
    experience_level: str = "",
    min_years_required: Optional[int] = None,
    title: str = "",
    description: str = "",
) -> Tuple[bool, List[str]]:
    """
    One-Click Auto Apply gate.

    - unverified / check_failed does NOT block
    - expired blocks
    - must be easy-apply and not already applied / manual-only
    """
    mode, reasons = classify_apply_mode(
        is_easy_apply=is_easy_apply,
        application_status=application_status,
        experience_filter=experience_filter,
        experience_level=experience_level,
        min_years_required=min_years_required,
        listing_status=listing_status,
        title=title,
        description=description,
    )
    if mode == "one_click":
        return True, []
    return False, reasons
