# AI Job Search, Application & Contact Enrichment Automation

## Product Plan and Implementation Blueprint — v2.0

**Version:** 2.0 (supersedes 1.1)  
**Date:** 30 October 2026  
**Scope:** Personal, single-user tool. Solo build. Fresher & startup focus across India/Remote.  
**Primary goal:** An autonomous job-search assistant that scans major portals (Indeed, Wellfound, Naukri, LinkedIn, Cutshort) and direct ATS boards with granular filters (24h/7d, domain, location, fresher/intern), enriches company contact info (HR emails, phones), ranks jobs by resume match and priority, auto-applies via stealth browser automation where supported, and provides a centralized 1-click fallback dashboard so no opportunity is ever lost.

---

## 0. Version Evolution (v1.0 -> v1.1 -> v2.0)

| Area | v1.1 | **v2.0 (Current Blueprint)** |
|---|---|---|
| **Discovery Scope** | Fixed company seed list & ATS only | **Multi-Portal Query Engine** (Indeed, Wellfound, Naukri, LinkedIn, Cutshort + ATS). Not restricted to 50 companies; targets startups, internships, and freshers. |
| **Search Filters** | Static soft preferences | **Dynamic Filter Panel**: Posting date (last 24h, 7d), domain/industry, location, fresher/intern, job count limit. |
| **Submission** | Manual handoff only | **Dual Engine**: Priority 1 = Stealth Auto-Apply (Indeed Easy Apply, Wellfound) via Playwright; Priority 2 = Ranked 1-click manual fallback. |
| **Bot Detection** | Avoided automation | **Human-Like Stealth Automation**: Persistent browser profile (reuses logged-in session), randomized delays, smooth scrolling, fingerprint masking. |
| **Contact Info** | Gated experiment | **Automated Company Contact Enrichment**: Scrapes official company website & listing for HR/careers emails and phone numbers. |
| **Dashboard** | Basic listing | **Centralized Priority-Ranked Command Center**: Match %, priority badges, application status (Auto-Applied vs Manual), contact cards. |

---

## 1. Executive Summary

A web app, run locally, that helps me run a structured job search from one dashboard.

The system will:

1. Discover jobs from sources that allow it: public ATS job-board APIs, company career pages, my job-alert emails, and pages I save from my own browser.
2. Normalize and deduplicate listings, grouping the same role posted for many locations into one job.
3. Score each job against my resume, projects, skills and preferences, shown as tiers (Strong / Stretch / Long shot), never hiding things silently.
4. Save the original job link and, where verifiable, the official careers page.
5. Optionally look for publicly listed business/recruitment contact details, with provenance.
6. Prepare tailored resume versions, cover letters and answers using only true facts.
7. Hand off to me for submission by default, with materials ready, opening the link in my own logged-in browser.
8. Track every application and outcome.
9. Later: draft (and optionally send) outreach emails with safeguards.

**Feasibility rule.** The product is feasible. Universal unattended submission is not, and some portals prohibit automation even from a member's own account. Each source gets its own adapter and capability flags, and the tool degrades to capture, preparation and handoff where automation isn't permitted.

---

## 2. Source Access and Portal Policy

### 2.1 Findings from research (verify again in Phase 0)

- **Greenhouse, Lever, Ashby:** public job-board read APIs exist. Greenhouse reads need no authentication. Submitting an application on Greenhouse needs the employer's own Job Board API key, so auto-submit through ATS APIs is generally not available to a candidate tool. (Verified for Greenhouse only; Lever and Ashby apply endpoints still to check.)
- **LinkedIn:** the user agreement prohibits bots and automated access, including inside a member's own logged-in session; accounts can be restricted. Its robots.txt disallows crawlers.
- **Indeed:** no self-service consumer search/apply API is documented; the developer agreement restricts algorithmic queries.
- **Naukri:** terms prohibit automated crawling and scraping.
- **Wellfound:** reported (secondary source) to prohibit automated access outside its official API.
- **Cutshort:** not yet verified.
- Using my own account does **not** change these terms.

### 2.2 Policy for my own accounts

The tool never logs in to, scrapes, or clicks inside LinkedIn, Naukri, Indeed, Wellfound or Cutshort on my behalf by default. No stealth, anti-detection or CAPTCHA/bot-protection evasion is built. Instead:

1. **Browser extension / bookmarklet ("Save to tracker").** I browse normally while logged in; clicking the extension sends the current job page's data to my local backend.
2. **Email job alerts.** Portal alert emails in my inbox are parsed into job records (via n8n or a Django task).
3. **Paste-a-URL import.** Manual fallback for any source.
4. **Open in my browser.** Every job link opens in my own session, so I am already logged in. The app shows materials to copy or upload.
5. **Account provenance.** Each job records `source_portal` and `source_account_label` (which of my accounts/alerts it came from) and the saved-search or alert it originated from.

Any future scripted behavior inside a portal account would be a separate, explicit decision, per portal, made after re-reading its terms and weighing the risk to my account. Recommendation: do not do this for LinkedIn.

### 2.3 Source priority

1. Public ATS job-board APIs (Greenhouse, Lever, Ashby; check Workable, SmartRecruiters, Recruitee).
2. Company career pages, including schema.org `JobPosting` structured data where present.
3. Job-alert emails and saved links from my own accounts.
4. Browser-extension captures and pasted URLs.
5. Official feeds/APIs from other boards, if any are found in Phase 0.

### 2.4 Company seed list (new)

ATS discovery needs board slugs. Build a `Company` seed list from: companies I choose manually, companies seen in alerts and captures, and companies whose career URL reveals an ATS (e.g. `boards.greenhouse.io/<slug>`). The system records the detected ATS and slug per company and polls those boards.

### 2.5 Adapter contract and capability flags

One adapter per source or family. Each documents method, credentials, rate limits, reliable fields and last terms review. Flags:

`can_search`, `can_get_details`, `can_enrich_contacts`, `can_prepare_application`, `can_submit_application`, `requires_user_handoff`, `terms_reviewed_at`, `integration_status`.

Technical ability to control a browser never enables automatic submission by itself. Policy-blocked sources are never retried as if the error were temporary.

---

## 3. Scope

### 3.1 MVP

- Local single-user app (no login).
- Resume upload and structured profile extraction, with my corrections.
- Job preferences (soft preferences only; see §6).
- Discovery from ATS APIs + email alerts + extension/paste import.
- Canonical jobs, deduplication, multi-location grouping.
- Two-stage matching with tiers and explanations.
- Original job links and verified careers links.
- Application preparation (resume version, cover letter, verified answers).
- Assisted handoff and application tracking.
- Run history and audit log.

### 3.2 Later

- Public contact enrichment (after a yield experiment).
- Daily scheduled runs and notifications.
- Email outreach (draft-only by default).
- Reply tracking, analytics.
- Authentication and security hardening (needed before any non-local deployment).
- Auto-submit for any source with an approved route.

### 3.3 Out of scope

- Bypassing CAPTCHAs, anti-bot controls, login protections or rate limits.
- Scripted actions inside portal accounts without an explicit per-portal decision.
- Fabricating resume details, answers, experience or contacts.
- Bulk or deceptive outreach.
- Guaranteeing automation on every portal.

---

## 4. Technology Stack

**Frontend:** Next.js + TypeScript, Tailwind CSS, shadcn/ui, React Hook Form + Zod. Polling for run progress.

**Backend:** Python + Django + DRF, service layer for matching, adapters, enrichment, preparation.

**Data and jobs:** PostgreSQL; Celery + Redis; private local file storage for resumes and generated documents.

**AI:** LLM for structured extraction, match explanations, cover-letter drafts; embeddings for the prefilter stage; schema validation of all model output.

**Browser capture:** a small Chrome-compatible extension that posts the current job page's content to `localhost`.

**Optional orchestration:** n8n, self-hosted (see §5).

**Playwright:** only for tests and for sources where automation is explicitly permitted.

**Local security basics (no auth yet):** bind to `127.0.0.1`, secrets in `.env`, CORS limited to the local frontend and the extension, never expose publicly.

---

## 5. n8n: Role and Boundaries

**Verdict:** useful glue, not the core. Self-hosted community edition is free for personal use under the Sustainable Use License.

**Good uses:**

- Schedule trigger that calls Django's "start run" endpoint.
- Polling ATS JSON boards and posting results to a Django ingest endpoint.
- Parsing portal job-alert emails from Gmail.
- Daily summary notifications (Telegram/email).
- Throwaway Phase 0 experiments to test sources quickly.

**Not for:** matching, dedup, state transitions, idempotency, resume versioning, the dashboard, or anything needing tests. Those stay in Django.

**Rules:**

1. Django is the single source of truth; n8n holds no business state.
2. n8n talks to Django only through documented ingest/trigger endpoints.
3. Keep workflows small (a few nodes each). If one grows large, move the logic into Django.
4. If n8n feels like overhead after the first few workflows, replace it with Celery beat and a Django email-parsing task. The architecture must allow either.

---

## 6. Job Discovery, Matching and Preferences

### 6.1 No location or category restrictions

Search is unrestricted by location, work mode and job type. Internships, fresher roles and any other suitable positions are all in scope.

### 6.2 Normalized job fields

Source and external ID; title; company; original URL; verified company site and careers URL; description; **locations (list)**; work mode; employment type; seniority label; experience and education requirements; required/preferred skills; salary range and **normalized currency/unit**; posted/last-checked dates; application URL; status (active/expired/closed/unknown); `source_portal`; `source_account_label`; raw metadata where retention is permitted.

### 6.3 Deduplication and grouping

1. Canonical URL. 2. Source + external ID. 3. Company + normalized title (+ location). 4. Description similarity as a secondary signal.

Same role posted for many cities becomes **one job with many locations**. Uncertain duplicates are flagged for review, not merged silently.

### 6.4 Freshness

Recheck links before preparing an application; mark expired/closed; store last-verified time; never show unknown as active.

### 6.5 Two-stage matching

1. **Prefilter (cheap):** keyword/embedding similarity against my profile. Keeps the top N per run.
2. **LLM scoring (expensive):** only for the survivors. Output validated against a schema.

Initial dimensions (weights are tunable, not validated):

| Dimension | Initial weight |
|---|---|
| Technical skills | 30% |
| Projects and experience relevance | 25% |
| Role responsibilities | 20% |
| Seniority fit | 15% |
| Preferences | 10% |

### 6.6 Tiers instead of hiding

- **Strong match**, **Stretch**, **Long shot**.
- Real filters only for: closed/expired, already applied, duplicate, and categories I explicitly exclude (none by default).
- **Eligibility flags, not filters:** "may need visa/work authorization", "may need relocation", "experience requirement above my level".
- Every result shows score, evidence, gaps, eligibility flags, source, freshness and recommended action.

### 6.7 Evaluation set (new)

Hand-label 50 to 100 jobs (good / maybe / bad) and measure the scoring against them before trusting or tuning weights. Record corrections I make and feed them into the evaluation set.

---

## 7. Candidate Profile and Resume

- Store original resume privately; extract structured data with source evidence; I review and correct it.
- Multiple resume versions; role-specific versions only rearrange or emphasize truthful content.
- Never invent qualifications, dates, experience, projects or skills.
- Record which resume version was used for each application.
- **Verified answers store:** reusable answers to common questions (notice period, salary, work authorization, relocation, links). Sensitive or high-consequence answers always require my confirmation.

---

## 8. Company and Contact Enrichment (experiment first)

Expectation: many careers pages publish no HR email because applications go through an ATS. Yield may be low.

**Phase gate:** run a 50-company experiment before building the full feature. Measure how many companies yield a verifiable, relevant contact. Build the dashboard only if the result justifies it.

Process: find and verify the official domain; inspect permitted public pages (Careers, Contact, About); extract role-based or published business contacts (careers@, hr@, recruitment numbers); store source URL, page title, discovery time, last checked, verification status, confidence and notes; let me correct, dismiss or suppress records.

Rules:

- Never invent or pattern-guess an address and call it verified.
- Prefer role-based addresses over named individuals' personal emails.
- Respect site terms, robots guidance and rate limits.
- If nothing is found, show **Not found** and keep the careers/job URL as the next action.

---

## 9. Application Preparation and Submission

### 9.1 Modes

- **Mode B: Assisted (default).** Prepare resume version, cover letter and answers, then open the application link in my own browser. I submit.
- **Mode C: User input required.** Pause when an answer is missing, ambiguous, sensitive or high-consequence (salary, work authorization, relocation, notice period, declarations, demographic questions).
- **Mode A: Authorized automatic submission (stretch).** Only where a documented, permitted route exists and I have the required credentials. Currently unlikely for third-party candidate tools.

### 9.2 Safeguards

Check I haven't already applied; check the job is still open; validate required fields; no fabricated answers; no CAPTCHA/anti-bot bypass; no plaintext passwords or cookies; stop on access denial or policy errors; record success only with evidence; idempotent duplicate prevention; log errors without unnecessary sensitive data.

### 9.3 Status model (split)

**Job status** (on the match record): `DISCOVERED → SCORED → SHORTLISTED`, plus `REJECTED_BY_FILTER`, `EXPIRED`, `DISMISSED`.

**Application status:** `PREPARED → READY_FOR_REVIEW → HANDED_OFF → SUBMITTED → CONFIRMED`, plus `NEEDS_INPUT`, `FAILED`, `BLOCKED_BY_SOURCE_POLICY`, `ALREADY_APPLIED`, `WITHDRAWN`, `INTERVIEW`, `REJECTED_BY_EMPLOYER`.

### 9.4 Evidence of submission in assisted mode

The app cannot see my submission on a portal. So:

- `HANDED_OFF` means I was sent to the link.
- `SUBMITTED` is set by my "I applied" button (with optional note/date).
- `CONFIRMED` requires evidence: a confirmation email forwarded to a tracker address or detected through an n8n/Gmail alert rule, or a manual attachment of confirmation text.

A click is never recorded as a confirmed application.

---

## 10. Future Email Outreach

Later phase, draft-only by default. Workflow: select a job, use verified company/role details, find a legitimately published contact, generate from an approved template with truthful personalization, show me the draft and recipient, send only after explicit opt-in, log message ID, recipient, template version and job.

Safeguards: explicit opt-in; rate and per-company limits; no duplicate messages per role; suppression/do-not-contact list; no deceptive or mass messaging; no automatic follow-up after a negative response; least-privilege email scopes; global pause.

To verify before committing: Gmail/Outlook OAuth requirements (especially for reading replies), and sending-volume practices for a personal mailbox.

---

## 11. Architecture

```text
Browser extension ─┐
Email alerts (n8n) ─┤
Pasted URLs ────────┤
                    v
Next.js Dashboard ──REST──> Django REST API (localhost only)
                              |
                              +--> Source Adapter Registry (ATS APIs, career pages, imports)
                              +--> Normalization, Dedup, Location Grouping
                              +--> Prefilter + LLM Matching (tiers, flags)
                              +--> Company/Contact Enrichment (gated experiment)
                              +--> Application Preparation + Handoff
                              +--> Audit, Status, Notifications
                              v
              PostgreSQL <--> Celery Workers <--> Redis
                              |
                              +--> Private local file storage

Optional: n8n (schedule, email-alert parsing, notifications) <--> Django ingest/trigger endpoints
```

Principles: frontend and backend separate; database is the source of truth; slow work is async; each source isolated behind an adapter; discovered/prepared/handed-off/submitted/confirmed are always distinct; every contact keeps provenance; one source failing never stops a run.

---

## 12. Data Model

| Model | Purpose |
|---|---|
| `CandidateProfile` | Structured profile and preferences (single record for now, with an `owner` field for future auth) |
| `ResumeDocument` | Original file, parsed data, version, storage key |
| `GeneratedDocument` *(new)* | Tailored resumes and cover letters, linked to resume version and job |
| `VerifiedAnswer` *(new)* | Reusable screening answers with sensitivity flag and last-confirmed date |
| `JobSource` | Source config and capability flags |
| `Company` | Identity, verified site, careers URL, detected ATS and slug |
| `SearchRun` | Each manual/daily run |
| `SourceRunResult` *(new)* | Per-source result, counts, errors, duration within a run |
| `Job` | Normalized listing |
| `JobLocation` *(new)* | Multiple locations per job |
| `JobMatch` | Score, tier, explanation, eligibility flags, job status |
| `CompanyContact` | Public contact and provenance (gated) |
| `ApplicationDraft` | Resume version, cover letter, prepared answers |
| `Application` | Application status and submission details |
| `ApplicationEvent` | Append-only status history |
| `ImportCapture` *(new)* | Raw extension/email/pasted input and its origin (portal, account label) |
| `EmailDraft`, `EmailEvent` | Future outreach |
| `AuditEvent` | Automation decisions and sensitive actions |

Constraints: unique source + external ID; canonical URL uniqueness; no duplicate application per job; provenance and timestamps on contacts; transactions around state transitions; retention rules for old jobs, resumes, contacts and logs; secrets never in ordinary fields.

---

## 13. API Endpoints (proposed)

- **Profile/resumes:** `GET/PATCH /api/profile/`, `POST/GET /api/resumes/`, `POST /api/resumes/{id}/parse/`
- **Preferences/sources:** `GET/PATCH /api/preferences/`, `GET /api/sources/`, `PATCH /api/sources/{id}/`
- **Companies:** `GET/POST /api/companies/`, `POST /api/companies/{id}/detect-ats/`
- **Runs/jobs:** `POST/GET /api/search-runs/`, `GET /api/search-runs/{id}/`, `GET /api/jobs/`, `GET /api/jobs/{id}/`, `POST /api/jobs/{id}/shortlist/`, `/dismiss/`, `/refresh/`
- **Ingest (new):** `POST /api/ingest/capture/` (extension, email alerts, n8n), `POST /api/ingest/url/` (paste URL)
- **Contacts:** `POST /api/companies/{id}/enrich/`, `GET /api/companies/{id}/contacts/`, `POST /api/contacts/{id}/verify/`, `/suppress/`
- **Applications:** `POST /api/jobs/{id}/prepare-application/`, `GET /api/applications/`, `POST /api/applications/{id}/handoff/`, `/mark-applied/`, `/mark-status/`
- **Outreach (future):** drafts, approve, send (opt-in only), events

Even without auth: validation, rate limits on ingest, and audit logging stay in.

---

## 14. Background Jobs

`run_source_search`, `normalize_job_results`, `deduplicate_jobs`, `group_job_locations`, `prefilter_jobs`, `score_job_match`, `refresh_job_status`, `prepare_application_materials`, `send_daily_summary`; gated: `enrich_company_website`, `extract_public_contacts`; future: outreach tasks.

Tasks are retry-safe and idempotent. Exponential backoff for transient errors only; never retry policy or authorization failures as temporary. Manual one-click run first; scheduling (Celery beat or n8n) after the workflow is reliable.

---

## 15. Security and Privacy (personal-use baseline)

- Localhost-only binding; secrets in `.env`; no keys in the frontend or in git.
- Resumes in private local storage; upload size/type limits.
- Avoid logging resume content or tokens.
- Treat job descriptions and web pages as untrusted input (prompt-injection safe); model output never triggers actions without validation.
- Respect source terms, rate limits and robots guidance.
- Global pause for discovery and any future sending.
- Be aware resume text is sent to the LLM provider; choose the provider and settings deliberately.
- **Before any deployment beyond my machine:** add authentication, per-user authorization, HTTPS, encrypted credentials, retention controls and a privacy review (India's DPDP Rules are being phased in through about May 2027).

This is an engineering plan, not legal advice.

---

## 16. Observability and Testing

**Track:** run success by source, jobs retrieved/rejected, duplicate rate, score distribution, tier counts, contact yield, handoffs, confirmed vs. submitted, retries, time per run, my corrections to extraction and matches.

**Tests:**

- Unit: normalization, URL canonicalization, dedup, location grouping, scoring, tier assignment, state transitions, idempotency.
- Integration: API validation, constraints, Celery retries, adapter fixtures, LLM schema validation, ingest endpoints, extension payloads.
- Adapter contract tests that detect API drift.
- Evaluation: scoring against the hand-labeled set.
- Safety: malicious text in a job description doesn't change policy; nothing prepared with missing required answers; policy-blocked source not retried; unverified action not shown as success; no email sent without opt-in.

---

## 17. Roadmap (ordered, no dates)

**Phase 0 — Research and spikes.** Source capability matrix; terms review per portal (including Cutshort); check Lever/Ashby apply routes; Gmail/Outlook scope check; small n8n trial; 50-company contact yield experiment design; start the labeled evaluation set.

**Phase 1 — Core platform.** Django + Postgres schema, Next.js shell, profile and resume upload, preferences, Celery/Redis.

**Phase 2 — Discovery and import.** Company seed list and ATS detection; Greenhouse/Lever/Ashby adapters; browser extension; email-alert ingestion; paste-URL; normalization, dedup, location grouping; run history.

**Phase 3 — Matching.** Prefilter, LLM scoring, tiers, eligibility flags, explanations, correction controls, evaluation against the labeled set.

**Phase 4 — Application preparation and handoff.** Tailored materials, verified-answer store, open-in-my-browser handoff, "I applied" flow, tracking and idempotency.

**Phase 5 — Reliability and daily workflow.** One-click run, retry/resume, notifications, optional scheduling (Celery beat or n8n), metrics, audit.

**Phase 6 — Contact enrichment (gated).** Only if the experiment shows worthwhile yield.

**Phase 7 — Email outreach.** Draft-only first; opt-in sending later.

**Phase 8 — Hardening.** Authentication and security features, then any deployment beyond local.

---

## 18. MVP Acceptance Criteria

1. I can upload a resume and review/correct the extracted profile.
2. Preferences are saved and reused across runs.
3. One click starts a background run.
4. At least two ATS sources plus email-alert or extension import return normalized jobs.
5. Search applies no location or job-type restriction.
6. Duplicates are not shown as new; multi-location postings are grouped.
7. Jobs appear in Strong/Stretch/Long-shot tiers with explanations and eligibility flags.
8. Every job has its source URL, `source_portal` and account label.
9. The careers link is shown when verifiable.
10. Application materials are prepared without inventing facts.
11. Every handoff opens the link for me to submit in my own session.
12. Application status distinguishes handed-off, submitted and confirmed, and nothing is marked confirmed without evidence.
13. Duplicate applications are prevented; errors are recorded.
14. Automation can be paused; the app runs only on localhost.

---

## 19. Decisions Locked in v1.1

- Personal single-user tool; auth deferred.
- Portal access through my own accounts via human-in-the-loop capture, never bot automation of portal accounts by default.
- Assisted submission is the default; auto-submit only where an approved route exists.
- No location or job-type restriction; tiers and flags instead of hard filters.
- Django is the source of truth; n8n optional and bounded.
- Stack: Django + DRF, PostgreSQL, Celery + Redis, Next.js + TypeScript, Tailwind + shadcn/ui, validated LLM output.
- Contact enrichment gated behind a yield experiment.

## 20. Open Items for Phase 0

- Terms and access for Cutshort; re-verify LinkedIn, Indeed, Naukri and Wellfound.
- Lever and Ashby application routes.
- Which other ATS platforms to support (Workable, SmartRecruiters, Recruitee).
- Browser extension scope and packaging (personal, unpacked install is enough).
- Email-alert parsing format per portal.
- LLM provider and cost per run.
- Gmail/Outlook OAuth requirements for later phases.
