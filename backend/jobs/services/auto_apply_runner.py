import os
os.environ["DJANGO_ALLOW_ASYNC_UNSAFE"] = "true"
import time
import random
from pathlib import Path
from playwright.sync_api import sync_playwright

from jobs.models import Job
from profiles.models import CandidateProfile, Resume


def run_stealth_auto_apply(job_id: int):
    """
    Executes automated job application with human-like stealth behavior,
    falling back safely if CAPTCHA or external redirects are encountered.
    """
    try:
        job = Job.objects.get(id=job_id)
    except Job.DoesNotExist:
        return {"success": False, "status": "ERROR", "message": "Job not found"}

    profile = CandidateProfile.objects.first()
    if not profile:
        return {"success": False, "status": "ERROR", "message": "Please configure your profile first"}

    primary_resume = Resume.objects.filter(profile=profile, is_primary=True).first()
    if not primary_resume:
        primary_resume = Resume.objects.filter(profile=profile).first()

    base_dir = Path(__file__).resolve().parent.parent.parent
    user_data_dir = base_dir / "browser_session"

    target_url = job.apply_url or job.original_url
    if not target_url:
        return {"success": False, "status": "ERROR", "message": "No valid application URL found"}

    # Run Playwright stealth automation
    with sync_playwright() as p:
        try:
            # Use persistent context if session exists, else standard context
            if user_data_dir.exists():
                context = p.chromium.launch_persistent_context(
                    user_data_dir=str(user_data_dir),
                    headless=True,
                    args=["--disable-blink-features=AutomationControlled"]
                )
                page = context.pages[0] if context.pages else context.new_page()
            else:
                browser = p.chromium.launch(
                    headless=True,
                    args=["--disable-blink-features=AutomationControlled"]
                )
                context = browser.new_context(
                    user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
                )
                page = context.new_page()

            # Set realistic viewport
            page.set_viewport_size({"width": 1280, "height": 800})

            # Navigate to target job URL
            page.goto(target_url, timeout=25000, wait_until="domcontentloaded")
            time.sleep(random.uniform(1.8, 3.2))

            # Simulate human scrolling
            page.evaluate("window.scrollBy(0, 450)")
            time.sleep(random.uniform(1.0, 2.0))

            # -------------------------------------------------------------
            # 1. Anti-Bot / CAPTCHA / Cloudflare Check
            # -------------------------------------------------------------
            page_title = page.title().lower()
            captcha_detected = False

            if any(cf in page_title for cf in ["just a moment", "blocked", "attention required", "security check", "challenge"]):
                captcha_detected = True
            else:
                for selector in [
                    'iframe[src*="captcha"]',
                    'iframe[src*="recaptcha"]',
                    'iframe[src*="hcaptcha"]',
                    'iframe[src*="challenges.cloudflare"]',
                    'div[class*="captcha"]',
                    '#g-recaptcha',
                    '#cf-challenge',
                ]:
                    if page.locator(selector).count() > 0:
                        captcha_detected = True
                        break

            if captcha_detected:
                # Do not downgrade job to MANUAL_APPLY_NEEDED if it's an easy-apply job.
                # Keep AUTO_APPLY_ELIGIBLE so JobPilot Chrome Extension Companion can apply in user's browser.
                context.close()
                return {
                    "success": False,
                    "status": job.application_status,
                    "message": f"{job.portal_source.title()} Cloudflare bot security challenge detected for background runner. Please click '1-Click Copilot' to auto-submit safely via your companion extension.",
                }

            # -------------------------------------------------------------
            # 2. Look for Apply Button (Indeed / Wellfound / General)
            # -------------------------------------------------------------
            apply_btn = None
            for btn_selector in [
                'button:has-text("Easily apply")',
                'button:has-text("Apply now")',
                'a:has-text("Apply now")',
                'button.jobsearch-IndeedApplyButton-button',
                'button:has-text("Apply with Resume")',
                'button:has-text("Quick Apply")',
            ]:
                loc = page.locator(btn_selector).first
                if loc.count() > 0 and loc.is_visible():
                    apply_btn = loc
                    break

            if not apply_btn:
                # If no direct in-page apply button, check if it's explicitly an external application portal
                is_external = page.locator('a:has-text("Apply on company site"), a:has-text("Apply on company website"), button:has-text("Apply on company site")').count() > 0
                has_form = page.locator('input[type="email"], input[name*="name"]').count() > 0
                if is_external:
                    job.application_status = "MANUAL_APPLY_NEEDED"
                    job.is_easy_apply = False
                    job.save(update_fields=["application_status", "is_easy_apply"])
                    context.close()
                    return {
                        "success": False,
                        "status": "MANUAL_APPLY_NEEDED",
                        "message": f"This position requires applying directly on {job.company_name}'s external careers website.",
                    }
                elif not has_form:
                    # Cloudflare or dynamic React hydration delayed button rendering
                    context.close()
                    return {
                        "success": False,
                        "status": job.application_status,
                        "message": "Apply button loading delayed by portal bot checks. Please click '1-Click Copilot' to auto-submit safely via your extension.",
                    }
            else:
                apply_btn.click()
                time.sleep(random.uniform(2.0, 3.5))

            # -------------------------------------------------------------
            # 3. Auto-Fill Standard Application Fields
            # -------------------------------------------------------------
            # Name
            for name_sel in ['input[name*="name"]', 'input[id*="name"]', 'input[autocomplete="name"]']:
                if page.locator(name_sel).count() > 0 and page.locator(name_sel).first.is_visible():
                    page.locator(name_sel).first.fill(profile.full_name)
                    break

            # Email
            for email_sel in ['input[type="email"]', 'input[name*="email"]']:
                if page.locator(email_sel).count() > 0 and page.locator(email_sel).first.is_visible():
                    page.locator(email_sel).first.fill(profile.email)
                    break

            # Phone
            for phone_sel in ['input[type="tel"]', 'input[name*="phone"]', 'input[name*="mobile"]']:
                if page.locator(phone_sel).count() > 0 and page.locator(phone_sel).first.is_visible():
                    page.locator(phone_sel).first.fill(profile.phone or "9876543210")
                    break

            # Resume Attachment (if file input present and file exists on disk)
            if primary_resume and primary_resume.file and os.path.exists(primary_resume.file.path):
                file_input = page.locator('input[type="file"]')
                if file_input.count() > 0:
                    try:
                        file_input.first.set_input_files(primary_resume.file.path)
                        time.sleep(1.5)
                    except Exception:
                        pass

            # Fill verified answers for common screening questions
            answers = profile.verified_answers or {}
            for q_input in page.locator('input[type="text"]:visible, textarea:visible').all()[:5]:
                try:
                    label = (q_input.get_attribute("aria-label") or q_input.get_attribute("placeholder") or "").lower()
                    if "experience" in label or "years" in label:
                        q_input.fill("1")
                    elif "notice" in label:
                        q_input.fill(str(answers.get("notice_period", "Immediate")))
                    elif "salary" in label or "ctc" in label:
                        q_input.fill(str(profile.preferences.get("min_salary", "600000")))
                except Exception:
                    continue

            time.sleep(random.uniform(1.5, 2.5))

            # -------------------------------------------------------------
            # 4. Check If Portal Requires Login / Authentication
            # -------------------------------------------------------------
            page_text = page.locator("body").inner_text().lower()
            if any(p in page_text for p in [
                "log in with your account",
                "set a password",
                "create a password",
                "sign in to apply",
                "please sign in",
                "login to apply",
            ]):
                job.application_status = "MANUAL_APPLY_NEEDED"
                job.save(update_fields=["application_status"])
                context.close()
                return {
                    "success": False,
                    "status": "MANUAL_APPLY_NEEDED",
                    "message": f"Account login required on {job.portal_source.title()}. Please click 'Portal Link' to apply directly with your account, or run 'python manage.py setup_browser_session' once in terminal to save your login session.",
                }

            # -------------------------------------------------------------
            # 5. Submit Application and Verify Portal Confirmation
            # -------------------------------------------------------------
            submit_btn = None
            for sub_sel in [
                'button:has-text("Submit application")',
                'button:has-text("Submit")',
                'button:has-text("Confirm and apply")',
                'button:has-text("Send application")',
            ]:
                loc = page.locator(sub_sel).first
                if loc.count() > 0 and loc.is_visible():
                    submit_btn = loc
                    break

            if submit_btn:
                # Actually click submit with short timeout
                try:
                    submit_btn.click(timeout=5000)
                    time.sleep(random.uniform(2.5, 4.0))

                    after_text = page.locator("body").inner_text().lower()
                    success_signals = [
                        "application submitted",
                        "applied successfully",
                        "thank you for applying",
                        "your application has been sent",
                        "application sent",
                        "we've received your application",
                    ]
                    if any(sig in after_text for sig in success_signals):
                        job.application_status = "AUTO_APPLIED"
                        job.save(update_fields=["application_status"])
                        context.close()
                        return {
                            "success": True,
                            "status": "AUTO_APPLIED",
                            "message": f"Successfully applied to {job.title} at {job.company_name}! Verified on portal confirmation.",
                        }
                except Exception as click_err:
                    print(f"Submit click warning: {click_err}")

                # Form submitted or clicked, but portal requires additional custom questions
                job.application_status = "MANUAL_APPLY_NEEDED"
                job.save(update_fields=["application_status"])
                context.close()
                return {
                    "success": False,
                    "status": "MANUAL_APPLY_NEEDED",
                    "message": "Form pre-filled. Portal requires final review or custom questions — please complete via 1-click Portal Link.",
                }
            else:
                job.application_status = "MANUAL_APPLY_NEEDED"
                job.save(update_fields=["application_status"])
                context.close()
                return {
                    "success": False,
                    "status": "MANUAL_APPLY_NEEDED",
                    "message": "Form fields pre-filled. Please review and submit via 1-click portal link.",
                }

        except Exception as e:
            job.application_status = "MANUAL_APPLY_NEEDED"
            job.save(update_fields=["application_status"])
            return {
                "success": False,
                "status": "MANUAL_APPLY_NEEDED",
                "message": f"Browser worker paused: {str(e)[:100]}. Job preserved for manual submission.",
            }
