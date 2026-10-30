import os
from pathlib import Path
from django.core.management.base import BaseCommand
from playwright.sync_api import sync_playwright

class Command(BaseCommand):
    help = "Opens a real Chrome browser session so you can log into Indeed, Naukri, or LinkedIn once to save session cookies locally."

    def handle(self, *args, **options):
        base_dir = Path(__file__).resolve().parent.parent.parent.parent
        user_data_dir = base_dir / "browser_session"
        user_data_dir.mkdir(parents=True, exist_ok=True)

        self.stdout.write(self.style.SUCCESS(f"Opening browser using session directory: {user_data_dir}"))
        self.stdout.write(self.style.WARNING("Please log in to your accounts (Indeed / Naukri / LinkedIn). When finished, simply close the browser window."))

        with sync_playwright() as p:
            context = p.chromium.launch_persistent_context(
                user_data_dir=str(user_data_dir),
                headless=False,
                channel="chrome",  # Uses real Chrome if installed, or falls back to Chromium
                args=[
                    "--start-maximized",
                    "--disable-blink-features=AutomationControlled",
                ],
                viewport=None,
            )

            page = context.new_page()
            page.goto("https://in.indeed.com")

            self.stdout.write(self.style.SUCCESS("Waiting for you to finish logging in and close the browser..."))
            
            # Wait until user closes all pages
            try:
                page.wait_for_event("close", timeout=0)
            except Exception:
                pass

            context.close()

        self.stdout.write(self.style.SUCCESS("Browser session and login cookies saved successfully! Auto-apply bot can now reuse this session."))
