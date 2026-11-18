# Backlog — spec §30 epics

Status as of 2026-11-18. "Operator" items need a person's decision or data and cannot be done in code.

## Epic A — Foundation
- [x] Monorepo and workspace conventions (pnpm + uv)
- [x] Next.js application
- [x] PostgreSQL/PostGIS (`postgis/postgis:16-3.5`, ADR-0022)
- [x] Prisma schema and migrations, drift check in CI
- [x] Redis + worker skeleton (BullMQ consumers + Postgres sweep, ADR-0021)
- [x] Authentication and roles (OWNER/ADMIN/ANALYST/VIEWER, API keys)
- [x] Structured logging (JSON in worker and crawler) and health checks

## Epic B — Geography
- [x] Import format (`data/geography/seed/*.tsv`; GeoNames importer)
- [x] Continents and countries (ISO 3166-1, in migration)
- [x] Regions and cities for initial coverage (SE, NO, DK, FI, DE, GB)
- [x] Hierarchy APIs (`/api/v1/geography/*`)
- [x] PostGIS spatial indexes (generated `geography` + GiST)
- [x] Location picker (wizard)
- [x] Map/list explorer (MapLibre)
- [ ] Operator: import wider GeoNames coverage for your markets (`scripts/import-geonames.mjs`)

## Epic C — Industry
- [x] Internal taxonomy (17 sectors, subsectors, versioned)
- [x] NACE Rev. 2 mappings (SNI accepted; ISIC/NAICS schemes supported in the model)
- [x] Hierarchy APIs (`/api/v1/industries`, `/:id/children`)
- [x] Sector/subsector picker with include/exclude
- [x] Include/exclude keywords

## Epic D — Discovery projects
- [x] Project schema (typed columns + filter tables + validated settings)
- [x] Wizard (9 steps, persistent scope summary)
- [x] Preview (scope, policy, budget, warnings, blockers)
- [x] Source policy validation (unapproved sources cannot start)
- [x] Start/pause/resume/cancel, high-volume approval
- [x] Progress dashboard (live)

## Epic E — Sources and crawling
- [x] Adapter contract (`services/leadforge/sources/base.py`)
- [x] Domain CSV import (through the same pipeline)
- [x] Registry adapter (`open_dataset`: registry/open-data exports)
- [x] Permitted directory adapter (OpenStreetMap via Overpass, ODbL)
- [ ] Operator: choose and approve a registry dataset for your markets (licence review)
- [ ] Search adapter: only if a provider's terms permit it (none bundled)
- [x] URL safety module (validation + connection-time pinning)
- [x] Robots/policy evaluator
- [x] HTTPX crawler (async, budgets, policy stops)
- [x] Bounded Playwright fallback (opt-in)
- [x] Crawl artefact storage (content-addressed, retention)

## Epic F — Extraction and enrichment
- [x] mailto/tel links, JSON-LD, visible patterns, forms
- [x] Pydantic schemas (source records, AI output)
- [x] Ollama classification with evidence grounding
- [x] Evidence spans (snippets, page URL, content hash)
- [x] Confidence (explainable components) and freshness
- [x] Model benchmark harness (`leadforge.ai_eval`) and default model (ADR-0025, 96% on the bundled set)

## Epic G — Data quality
- [x] Domain normalization (registrable domain, private PSL)
- [x] Company dedup (domain/registration auto; lookalikes to review)
- [x] Contact dedup (normalized email, role contacts per category)
- [x] Syntax, DNS and MX validation (separate statuses)
- [x] Duplicate review UI
- [x] Suppression checks (address and domain)
- [x] CSV export with provenance

## Epic H — Compliance and operations
- [x] Source policy registry
- [x] Retention configuration and jobs
- [x] Audit log
- [x] Access and erasure workflows
- [x] Jurisdiction profile framework (frozen with campaigns)
- [x] Load test at 100,000 records ([performance](./performance.md))
- [x] Security tests (SSRF, rebinding, redirects, oversized responses, challenges, authz, metrics auth)
- [x] Backup/restore runbook and drill ([runbooks](./runbooks.md))
- [ ] Operator: Phase 0 spike on real domains and labelling ([phase-0-spike](./phase-0-spike.md))
- [ ] Phase 9 (separate release): legal review, then campaign eligibility and SMTP
