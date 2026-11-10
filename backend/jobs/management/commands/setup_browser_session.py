import os
from pathlib import Path
from django.core.management.base import BaseCommand
from playwright.sync_api import sync_playwright

class Command(BaseCommand):
    help = "Opens a real Chrome browser session so you can log into Wellfound, Indeed, and Cutshort once to save session cookies locally."

    def handle(self, *args, **options):
        base_dir = Path(__file__).resolve().parent.parent.parent.parent
        user_data_dir = base_dir / "browser_session"
        user_data_dir.mkdir(parents=True, exist_ok=True)

        self.stdout.write(self.style.SUCCESS(f"Opening browser using session directory: {user_data_dir}"))
        self.stdout.write(self.style.WARNING("Please log in to your accounts (Wellfound, Indeed, Cutshort)."))
        self.stdout.write(self.style.WARNING("Once logged in, simply close the browser window to save your session cookies."))

        with sync_playwright() as p:
            context = p.chromium.launch_persistent_context(
                user_data_dir=str(user_data_dir),
                headless=False,
                args=[
                    "--start-maximized",
                    "--disable-blink-features=AutomationControlled",
                ],
                viewport=None,
            )

            # Tab 1: Wellfound
            page1 = context.pages[0] if context.pages else context.new_page()
            page1.goto("https://wellfound.com/login")

            # Tab 2: Indeed India
            page2 = context.new_page()
            page2.goto("https://in.indeed.com")

            # Tab 3: Cutshort
            page3 = context.new_page()
            page3.goto("https://cutshort.io")

            self.stdout.write(self.style.SUCCESS("Waiting for you to log in. Close all browser tabs or window when done..."))

            # Keep open until user closes all pages
            try:
                page1.wait_for_event("close", timeout=0)
            except Exception:
                pass

            context.close()

        self.stdout.write(self.style.SUCCESS("✓ Browser session and login cookies saved successfully! Auto-apply can now submit applications directly through your real accounts."))

