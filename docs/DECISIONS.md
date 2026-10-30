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
