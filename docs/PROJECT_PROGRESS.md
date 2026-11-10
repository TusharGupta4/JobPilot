# AI Job Search Automation — Project Progress

> **Last updated:** 29 Oct 2026

---

## Overall Status: 🟢 CORE PLATFORM COMPLETE (Phases 0 to 4 Operational)

---

## Phase 0: Project Setup & Tooling

| Task | Status | Notes |
|---|---|---|
| Project plan reviewed | ✅ COMPLETED | v1.1 plan reviewed, no major issues found |
| Key decisions made | ✅ COMPLETED | See docs/DECISIONS.md |
| Environment verified | ✅ COMPLETED | Node 22, Python 3.12, PostgreSQL 18.4, Git 2.42 |
| Git initialized | ✅ COMPLETED | .gitignore configured for both stacks |
| Docs structure created | ✅ COMPLETED | DECISIONS.md, PROJECT_PROGRESS.md, learning/ |
| Next.js project setup | ✅ COMPLETED | Next.js 16 with Turbopack & TypeScript |
| Django project setup | ✅ COMPLETED | Django 6 with DRF, CORS & PostgreSQL config |
| PostgreSQL database created | ✅ COMPLETED | `job_portal` created & initial migrations applied |
| Tailwind + shadcn/ui configured | ✅ COMPLETED | Tailwind v4 + shadcn/ui initialized |
| First Git commit | ✅ COMPLETED | Initial baseline commit across full stack |

---

## Phase 1: Profile & Resume (Feature 1)

| Task | Status | Notes |
|---|---|---|
| Backend: CandidateProfile model | ✅ COMPLETED | Includes personal info, skills, preferences, verified answers |
| Backend: Profile API endpoint | ✅ COMPLETED | `/api/profile/me/` and `/api/profiles/` with DRF |
| Frontend: Profile page | ✅ COMPLETED | `/profile` tabbed manager with readiness stats |
| Backend: Resume upload model | ✅ COMPLETED | PyPDF automatic text extraction & primary resume flag |
| Frontend: Resume upload UI | ✅ COMPLETED | Upload, extracted text viewer, primary selector, delete |
| End-to-end test | ✅ COMPLETED | Verified against live PostgreSQL database |

---

## Phase 2: Multi-Portal Job Discovery, Advanced Filters & Contact Enrichment

| Task | Status | Notes |
|---|---|---|
| Backend: Job & Company models | ✅ COMPLETED | Contact fields (email, phone, site), portal source, priority rank, status |
| Backend: Advanced Filter Query Engine | ✅ COMPLETED | Filter by 24h/7d, domain/industry, location, fresher/intern, limit |
| Backend: Multi-Portal Discovery Crawlers | ✅ COMPLETED | Indeed India, Wellfound, Naukri, LinkedIn + ATS channels |
| Backend: Company Contact Discovery Crawler | ✅ COMPLETED | Auto-discover official email, HR email, phone from company sites |
| Frontend: Advanced Search & Filter Panel | ✅ COMPLETED | 24h toggle, domain, location, exp level, job count picker |
| Frontend: Centralised Jobs Dashboard | ✅ COMPLETED | Priority ranking, match %, contact info badges, application status |
| Frontend: Job Detail Drawer & Contact Viewer | ✅ COMPLETED | Full description, contacts, direct apply link |

---

## Phase 3: Resume Matching & Priority Ranking

| Task | Status | Notes |
|---|---|---|
| Backend: AI Resume Matcher (Gemini) | ✅ COMPLETED | Gemini SDK integrated, skill overlap, gap analysis & pitch generator |
| Backend: Priority Ranker | ✅ COMPLETED | HIGH/MEDIUM/LOW priority based on match score + freshness |
| Frontend: Ranking & Tier Visualizer | ✅ COMPLETED | AI Match breakdown dialog with matched skills, gaps, tailored pitch |

---

## Phase 4: Stealth Browser Automation & Auto-Apply with Fallback

| Task | Status | Notes |
|---|---|---|
| Backend: Playwright Stealth Setup | ✅ COMPLETED | Persistent user session command (`setup_browser_session`), human delays |
| Backend: Auto-Apply Runner (Indeed/Wellfound) | ✅ COMPLETED | Form auto-filler (contact, resume, screening answers, submit) |
| Backend: Fallback & Handoff Engine | ✅ COMPLETED | CAPTCHA detection and safe fallback to 1-click manual apply |
| Frontend: Application Tracker | ✅ COMPLETED | "⚡ Auto-Apply" action on cards with live toast feedback |

## Phase 5: JobPilot Chrome Extension (Cloudflare-Immune 1-Click Copilot)

| Task | Status | Notes |
|---|---|---|
| Extension: Manifest V3 Structure | ✅ COMPLETED | Created in `extension/` with permissions, icons, and background worker |
| Extension: Background Service Worker | ✅ COMPLETED | Dual-way sync with Django REST API (`/api/profile/me/`) and PostgreSQL |
| Extension: Semantic Form Matcher Engine | ✅ COMPLETED | Autocompletes Name, Email, Phone, CV, Location, and screening answers |
| Extension: In-Page Floating Copilot Dock | ✅ COMPLETED | Discreet pill/dock on job portals with 1-click fill and auto-record |
| Extension: Modern Dark Mode Popup UI | ✅ COMPLETED | Real-time profile review, backend connection badge, and active tab triggers |
| Extension: Multi-Layer Click Engine | ✅ COMPLETED | CDP hardware click (`isTrusted: true`) + Main-world React fiber dispatch |
| Extension: Cutshort Resume Automator | ✅ COMPLETED | HTML5 `DataTransfer` + dropzone DragEvent synthesis attaching candidate CV |
| Engine: Portal Classification Logic | ✅ COMPLETED | Strict distinction between External ("Apply on Company Site") vs Direct ("Apply Now") |
| Backend: `/api/jobs/record-application/` | ✅ COMPLETED | Real-time PostgreSQL status and `is_easy_apply` sync when viewed/submitted |
| Documentation & Setup Guide | ✅ COMPLETED | Documented in `docs/JOBPILOT_CHROME_EXTENSION_GUIDE.md` |

---

- **Company Directory & Outreach System (`/companies`)**: Centralized deduplicated company table with direct contact emails (`mailto:`), phone numbers (`tel:`), direct WhatsApp links, active job drawer, instant "Contacted" toggle checkbox, CSV export, and default "Ready for Outreach" filtering.
- **Bulk Sequential Auto-Pilot Queue & Emergency Stop**: Multi-select job cards + "Select All Auto-Apply" smart button with sequential 1-by-1 background tab execution, 3s polite delay, 50s watchdog timer, real-time floating progress widget, and instant **Emergency Stop** (`⏹️ Stop Auto-Pilot`) in dock and floating bar, plus auto-halt when closing the active application tab.
- **Accurate Portal Classification & Cutshort Experience Fix**: All 19 Cutshort jobs audited live and reclassified in PostgreSQL to `Mid` (11) and `Senior` (8) with exact experience ranges (`4 - 14 yrs`, `8 - 11 yrs`, etc.), completely removing experienced roles from Fresher / Entry-level dashboard views.
- **Pre-Apply Eligibility & Career Directives Guard**: Before clicking primary apply CTAs, JobPilot checks page text for experience mismatch (`\b([2-9]|\d{2,})\s*-\s*(\d+)\s*yrs`) and external career directives (`apply directly through our careers page`). Ineligible jobs are automatically skipped with `MANUAL_APPLY_NEEDED` without clicking Apply.
- **Chrome Reading Mode & Modal Freeze Fix**: Eliminated the 8.5s aggressive scroll loop that triggered Chrome's omnibox `Reading mode` button (now uses a gentle 600-950ms dwell time). Fixed undefined `bodyText` in `checkApplicationBlockReason` which previously caused silent exceptions inside modals, and enhanced Cutshort's `Current company` input autofill with automated autocomplete selection.
- **Bulk Sequential Auto-Pilot Queue & Emergency Stop**: Multi-select job cards + "Select All Auto-Apply" smart button with sequential 1-by-1 background tab execution, 3s polite delay, 50s watchdog timer, real-time floating progress widget, and instant **Emergency Stop** (`⏹️ Stop Auto-Pilot`) in dock and floating bar, plus auto-halt when closing the active application tab.
- **Smart Question Auto-Fill with Gemini 2.5 Flash**: Background extension proxies application textareas and screening questions ("Why should we hire you?", "Describe your experience", technical notes) to `/api/profile/answer-question/`, generating authentic first-person answers grounded in candidate CV, projects, and target JD.
- **Configurable Application Store (`/profile`)**: Dynamic fields for Notice Period, Expected CTC, Current CTC, Total Experience, Availability/Join Date, and Relocation. Extension autofills strictly according to these configured values.
- **Company Contacts Auto-Sync**: Contact details discovered during job scans immediately backfill and sync to `Company` database records, removing the need for manual crawling and keeping `/companies` clean and outreach-ready.

## Known Issues
_None — all core systems verified, TypeScript compiled with 0 errors._

## Completed Features
- [x] Indeed / Wellfound / Cutshort 1-Click Auto-Apply (CDP Hardware Clicks + React Synthetic Events)
- [x] Pre-Apply Experience & Careers Directive Guard (Skips 4-14 yr / external career site jobs)
- [x] Live Experience Reclassification for 19 Cutshort jobs (PostgreSQL database updated)
- [x] Chrome Reading Mode & Modal Crash Resolution (`bodyText` scope fix)
- [x] Emergency Stop (`⏹️ Stop Auto-Pilot`) & Tab Close Auto-Halt
- [x] Cutshort "Save and continue" modal deadlock fix & exit survey auto-dismiss
- [x] Smart Question Auto-Fill in Extension (Gemini 2.5 Flash + CV Grounding)
- [x] Configurable Verified Answers Store on `/profile` (Notice Period, CTC, Exp, Relocation)
- [x] Company Contacts Auto-Sync directly to `Company` records
- [x] Wellfound Location Preferences Resolver (Auto-selects "I can relocate to...", location dropdown & founder note)
- [x] Dedicated Company Outreach Directory (`/companies`) with WhatsApp & Email HR 1-click actions
- [x] Single & Bulk Deduplicated Company Export to CSV (`/api/companies/export/`)
- [x] Sequential Bulk Auto-Apply queue in Extension with live UI progress bar

## Next Steps for User
1. **Reload Chrome Extension**: Open `chrome://extensions`, toggle Developer Mode, and click the refresh icon on **JobPilot Copilot**.
2. **Refresh Dashboard**: Open [http://localhost:3000/jobs](http://localhost:3000/jobs) with **Fresher** filter — you will notice senior/mid jobs like Provenir (4-14 yrs) are no longer listed!
3. **Review Preferences on `/profile`**: Open [http://localhost:3000/profile](http://localhost:3000/profile) -> **Verified Answers Store** to review/adjust your Notice Period, Expected CTC, and Current CTC.
4. **Explore `/companies` Directory**: See all companies with verified contacts under "Ready for Outreach" with direct 1-click Cold Email & WhatsApp buttons.


