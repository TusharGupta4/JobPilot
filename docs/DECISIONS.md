# Project Decisions Log

> This file records all important architectural and technical decisions.  
> Each decision includes the date, context, and rationale.

---

## Decision 001 — LLM Provider: Google Gemini
**Date:** 29 Oct 2026  
**Context:** Need an LLM for resume extraction, job scoring, match explanations, and material generation.  
**Decision:** Use Google Gemini API.  
**Rationale:** Good pricing, strong capabilities, competitive structured output support.  
**Notes:** Will build a provider-agnostic abstraction layer so switching is easy. Resume text will be sent to Google's API — acceptable for personal use.

## Decision 002 — CSS Framework: Tailwind CSS + shadcn/ui
**Date:** 29 Oct 2026  
**Context:** Plan specified Tailwind + shadcn/ui; needed confirmation.  
**Decision:** Use Tailwind CSS + shadcn/ui.  
**Rationale:** Faster development, consistent design system, shadcn components are owned (not black-box), teaches utility-first CSS and component architecture.

## Decision 003 — Skip n8n in Early Phases
**Date:** 29 Oct 2026  
**Context:** Plan included optional n8n orchestration layer.  
**Decision:** Skip n8n for Phases 1–5. Use Celery beat for scheduling.  
**Rationale:** Fewer moving parts to learn and maintain.

## Decision 004 — Visual Design: Light Modern Theme
**Date:** 29 Oct 2026  
**Decision:** Light / modern theme with accent colors, professional dashboard aesthetic.

## Decision 005 — Project Setup: Walk-Through Approach
**Date:** 29 Oct 2026  
**Decision:** Create the project from scratch together, explaining each step.

## Decision 006 — Full-Stack Feature-by-Feature Development
**Date:** 29 Oct 2026  
**Decision:** Build each feature end-to-end — backend (Django model + API) and frontend (Next.js page) together.  
**Rationale:** Every feature works with real data from day one. No mock-to-real migration later.  
**Supersedes:** Original "frontend-first" preference.

## Decision 007 — Environment Verified
**Date:** 29 Oct 2026  
**Versions:** Node.js v22.13.1, npm 11.1.0, Python 3.12.10, pip 26.1.2, PostgreSQL 18.4, Git 2.42.0. All compatible.

## Decision 008 — Monorepo Structure
**Date:** 29 Oct 2026  
**Decision:** Single repository with `frontend/`, `backend/`, and `docs/` directories.  
**Rationale:** Everything in one place, but cleanly separated. Simple for a solo developer.

## Decision 009 — Multi-Portal Discovery, Stealth Auto-Apply with Fallback & Contact Enrichment
**Date:** 30 Oct 2026  
**Context:** Solo fresher job-search requiring broad market coverage (startups, internships, entry-level) across major platforms (Indeed, Wellfound, Naukri, LinkedIn, Cutshort) without being restricted to a fixed company list, with maximum automation and minimum manual effort.  
**Decision:**
1. **Query-Based Multi-Portal Discovery:** Dynamic filtering by posting date (last 24h, 7d), domain/industry, location (India/Remote/city), job type (internship/full-time), and experience level (fresher/entry-level) across major portals, combined with direct ATS channels.
2. **Stealth Browser Automation (Playwright):** Use persistent user browser sessions (reusing existing login cookies) with randomized delays, human-like scrolling, and stealth headers to avoid bot detection.
3. **Auto-Apply Priority with Intelligent Fallback:** Automatically submit standardized forms (Indeed Easy Apply, Wellfound) using candidate profile and verified answers. If blocked by CAPTCHA or external portal, never discard the job; instead, rank it by resume match score and priority for 1-click assisted manual submission.
4. **Company Contact Information Enrichment:** Automatically discover official company website, HR/recruitment emails, and contact phone numbers from job postings and company public web pages.

## Decision 010 — Dedicated Multi-Portal View & Domain-Based Semantic Matching Engine
**Date:** 30 Oct 2026  
**Context:** Candidate needs to clearly identify and filter jobs by source platform (Indeed, Wellfound, Cutshort, Direct ATS) and view domain-specific opportunities without relying on rigid keyword matching, accounting for diverse naming conventions across portals.  
**Decision:**
1. **Dedicated Multi-Portal Dashboard Section:** Added dedicated portal tabs on the main dashboard (`All`, `Indeed`, `Wellfound`, `Cutshort`, `Direct ATS`) allowing 1-click platform isolation with real-time job counts and distinctive portal branding.
2. **Contextual Semantic Domain Matching:** Implemented ontology-based semantic matching (`semantic_domain_matcher.py`) classifying roles into `aiml` (AI/ML, NLP, GenAI, Python AI tools), `fullstack`, `backend`, `frontend`, `data`, `healthcare`, and `devops`. Uses boundary-aware contextual relevance rather than exact keywords, properly handling dual overlaps (e.g. `Full Stack Developer (AI Tools)` matching both AI/ML and Full Stack).
3. **Dual-Layer Filtering:** Both backend API (`?portal=...&domain=...`) and instant client-side memoized filters work cohesively with match score priority tiers.


