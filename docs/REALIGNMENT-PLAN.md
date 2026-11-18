# LeadForge — Realignment Plan

**Date:** 2026-11-18 · **Status:** Proposed · **Target spec:** *LeadForge Mega Plan & Technical Implementation Specification v1.0* (18 Nov 2026)

## Why this exists

The code on `main` was built from an earlier, outreach-centred plan (`docs/MEGA-PLAN.md`). The controlling spec is geography- and company-first, and puts campaigns in a separately approved Phase 9. An audit of `main` at `e93d96c` found:

| Area | Spec says | `main` has |
| --- | --- | --- |
| Priority | Discovery first; campaigns are Phase 9 | Campaigns, eligibility, SMTP worker, unsubscribe and bounces built in v1 |
| Phase 0 | Approved scope and labelled dataset before building | No findings recorded; full app shipped in one commit |
| Geography | Continent → country → region → city → postal code, PostGIS, stable IDs | Free-text `countryCode`/`region`/`city` on `Company`; no PostGIS |
| Industry | Versioned taxonomy, NACE/ISIC/NAICS mappings, many-to-many | One free-text `industry` string |
| Discovery | Adapters find **new** companies from permitted sources | `run` filters companies already in the DB and queues their homepages |
| Project builder | 9-step wizard, preview, pause/resume/cancel, progress | `criteria` JSON blob and a single `run` endpoint |
| Queue | Redis + BullMQ, idempotent jobs, dead-lettering | Redis provisioned but unused; Postgres polling |
| Crawler | Async HTTPX, Playwright fallback, rich job states | Sync HTTPX, homepage plus contact pages, 5 states |
| Contacts | Email, phone, form URL, role categories | Email only; `PERSON`/`GENERIC_BUSINESS` |
| Email status | Separate syntax, DNS and MX states | Several failures collapse into `UNDELIVERABLE` |
| Local AI | Ollama classification with Pydantic contracts | A config URL only |
| UI | Market Explorer, map, wizard, TanStack tables | Dashboard, companies, review, sources, suppressions, campaigns |

The foundation is still useful. This plan reuses it, freezes what came too early, and builds what is missing in the spec's order.

## Guiding rules

1. **The spec wins.** Where this plan and the spec disagree, the spec wins until an ADR amends it.
2. **Additive migrations first.** Add new tables and backfill them. Drop old columns only after a release has read from the new ones.
3. **Freeze, don't delete.** Campaign code stays in the repo behind a flag, so Phase 9 can reuse it after legal review.
4. **Each phase ends green.** CI passes, a migration is in place, tests cover new behaviour, and the spec's §29 definition of done holds.
5. **Precision over recall** for contacts, as in spec §26.

## Inventory: keep, adapt, freeze, remove

### Keep as is

- Auth, sessions, RBAC and API keys (`apps/web/src/lib/auth.ts`, `api/v1/auth/*`, `api-keys`)
- Audit log (`lib/audit.ts`, `AuditLog`)
- SSRF guard and robots handling (`services/leadforge/safety.py`, `robots.py`) and their tests
- Deterministic extraction: mailto, JSON-LD, visible text (`extract.py`)
- Evidence chain: `FetchArtifact`, `ExtractionRun`, `ExtractionCandidate`, `SourceEvidence`. This already meets spec §10 and §12 provenance.
- Suppressions, CSV import and export, review queue, MX-only verification (no mailbox probing)
- Compose network split (`internal` / `edge` / `egress`), loopback-only ports, health checks, CI, secret scan
- `Organization` multi-tenancy. The spec doesn't require it, but it costs nothing and helps later.

### Adapt

| Item | Change |
| --- | --- |
| `Company.countryCode/region/city` | Replace with `company_locations` that reference geography IDs (R4) |
| `Company.industry` | Replace with `company_industries` (R5) |
| `DiscoveryProject.criteria/budget` JSON | Replace with normalised filter tables plus typed settings (R6) |
| `Source` | Add the policy fields from spec §10 (R7) |
| `CrawlTarget` | Becomes `crawl_jobs` + `crawl_pages` with spec §11 states and metrics (R8) |
| `EmailStatus` enum | Split into `syntax_status` / `dns_status` / `mx_status` / `provider_category` (R8) |
| `Contact` | Add phone, contact form URL, contact category and role (R8) |
| Python worker | Sync to async HTTPX, with per-domain concurrency (R8) |
| `postgres:16-alpine` | Switch to a pinned `postgis/postgis` image (R3) |

### Freeze until Phase 9

Campaigns, recipients, sends, templates, jurisdictions approval, eligibility evaluation, test-send, bounce ingestion, unsubscribe tokens, the worker's campaign loop, `lib/mail.ts`, and the `campaigns` UI.

- **Mechanism:** a `FEATURE_CAMPAIGNS` env flag that defaults to `false`. When it is off, routes return 404, the nav hides the pages, and the worker skips the campaign loop. Tests run with the flag on so the code doesn't rot.
- **Keep running:** the suppression list and the compliance engine package. Discovery needs suppression checks at import (spec §19).

### Remove

- The `EmailPattern` model. It is unused, and spec §12 forbids guessing addresses from patterns.
- `@electric-sql/pglite`, `@electric-sql/pglite-socket`, `embedded-postgres`, and the shim path in `scripts/dev-db.mjs`. Local development now uses real Postgres.

---

## Phases

Estimates assume one full-time engineer, as in the spec, and are not commitments. The spec's 20-week plan becomes about 16 weeks, because auth, infrastructure, evidence and SSRF work already exists.

### R0 — Reset (≈2 days)

- Save the v1.0 spec as `docs/MEGA-PLAN.md`. Move the current one to `docs/archive/MEGA-PLAN-v0.md` and update `roadmap.md` and `backlog.md` to point at this plan.
- ADR-0020 in `docs/decisions.md`: record the realignment and the freeze.
- Fix the local install: remove `node_modules` (root and workspaces), run `pnpm install`, and confirm `pnpm -r typecheck` passes. `apps/worker` currently can't resolve workspace packages.
- Remove `EmailPattern` and the pglite/embedded-postgres leftovers.

**Exit:** the spec is in the repo, the ADR is merged, a clean install typechecks, and CI is green.

### R1 — Freeze campaigns (≈2 days)

- Add the `FEATURE_CAMPAIGNS` flag in `lib/env.ts`, the route guards, the nav and the worker loop, as described above.
- Add a test that every campaign route returns 404 when the flag is off.

**Exit:** with default config, no campaign surface is reachable and the worker sends nothing.

### R2 — Phase 0 foundation, done properly (≈1 week) · spec Phase 0

- Run the spike in `docs/phase-0-spike.md` on 50 real domains across 3 countries with `services/leadforge/probe.py`.
- Build the labelled dataset from spec §26 in `tests/golden/`, including pages, expected emails, phones, roles and industry.
- Write `docs/phase-0-findings.md` with yield, precision and false-positive rates.
- Pick the initial countries and industries; the spec suggests Sweden and the Nordics. Draft the source checklist.

**Exit:** a findings doc with a go/no-go decision, a labelled dataset in the repo, and the initial scope agreed.

### R3 — Platform alignment (≈1 week) · spec Phase 1 gaps

- **PostGIS:** switch to a pinned `postgis/postgis` image matching the current Postgres major version. Add a `CREATE EXTENSION postgis` migration and update the CI service container. Dev data can be thrown away, so no dump/restore is needed.
- **Queue:** add ADR-0002 on the queue design. Recommendation:
  - BullMQ on Redis for orchestration in TypeScript: the `discovery`, `source_search`, `company_normalization`, `verify`, `deduplicate`, `export` and `refresh` queues.
  - Python crawling keeps a Postgres-backed `crawl_jobs` claim (`FOR UPDATE SKIP LOCKED`). This avoids a fragile Python port of BullMQ, and Postgres is the system of record either way (spec §17).
  - BullMQ jobs use stable IDs, bounded retries and a dead-letter queue. Policy denials are never retried.
- **Rate limiter:** move it to Redis.
- **Ollama:** add it to Compose as an opt-in profile on the internal network only.
- **Logging and metrics:** structured logs in both runtimes, and a `/metrics` endpoint stub.

**Exit:** `docker compose up` brings up PostGIS, Redis-backed queues pass a round-trip test, and the existing tests still pass.

### R4 — Geography (≈2 weeks) · spec Phase 2, Epic B

- **Schema:** `continents`, `countries`, `admin_regions`, `cities`, `postal_areas`, `geo_aliases`, `geo_import_batches`. Store stable external IDs, ISO 3166 codes, parent IDs, `geography(Point)` centroids, optional boundaries, source, licence and import version. Add GiST indexes.
- **Importer:** `scripts/import-geography` loads GeoNames (countries, admin1, and cities with more than 1,000 people for the initial countries) from `data/geography/`. It records licence and attribution. Never use the public Nominatim endpoint for bulk geocoding.
- **Company locations:** a `company_locations` table with address, geography IDs, point, `is_headquarters`, source and confidence. Backfill it from the free-text fields, matching by ISO code and city alias. Rows that don't match go to review instead of being guessed.
- **APIs:** `GET /api/v1/geography/{continents,countries,regions,cities}` with pagination and search.
- **UI:** a location picker that supports many locations at any level plus include/exclude.

**Exit:** a user can select geography at any level, and companies are linked to locations by ID. Spatial radius queries are tested.

### R5 — Industry taxonomy (≈1 week) · spec Phase 2, Epic C

- **Schema:** `industry_taxonomy_versions`, `industries` (a tree), `industry_external_codes` (NACE Rev. 2 first, then ISIC and NAICS), `industry_aliases`, and `company_industries` with primary flag, confidence, method and source.
- **Seed:** the 17 broad sectors from spec §5.2 with subsectors, in `data/taxonomy/`. Mappings are versioned.
- **Backfill:** map existing `industry` strings through aliases. Strings that don't map are set to *Other / unclassified*.
- **APIs and UI:** `GET /api/v1/industries` and `/:id/children`, plus a sector/subsector picker with include/exclude keywords.

**Exit:** companies can have several industries, and projects can filter by subtree.

### R6 — Discovery project builder (≈2 weeks) · spec Phase 3, Epic D

- **Schema:**
  - Filter tables: `discovery_locations`, `discovery_industry_filters`, `discovery_keywords`, `discovery_source_selections`.
  - Typed project columns: `geographic_mode`, `max_companies`, `max_pages_per_company`, `max_crawl_depth`, `min_confidence`, and a `status` enum (`draft`, `ready`, `running`, `paused`, `completed`, `cancelled`, `failed`).
  - Migrate existing `criteria` JSON into these tables, then drop it.
- **API:** the full set from spec §16: CRUD plus `preview`, `start`, `pause`, `resume`, `cancel`, `progress` and `results`. `start` enqueues a `discovery` job and returns its job ID.
- **Preview:** shows scope summary, policy warnings, crawl budget, and filters likely to reduce coverage. Estimates are labelled as estimates.
- **UI stack:** bring in shadcn/ui, React Hook Form + Zod (sharing schemas from `packages/shared`) and TanStack Table for new screens. Existing screens move over as they are touched.
- **Wizard:** the 9 steps in spec §21, with a persistent scope summary.

**Exit:** projects can be saved, previewed, started, paused, resumed and cancelled, and progress is visible. This is the spec's Phase 3 exit.

### R7 — Source adapters and real discovery (≈3 weeks) · spec Phase 4, Epic E

- **Source policy registry:** extend `Source` with `terms_url`, `licence_name`, `permitted_use`, `automated_access_allowed`, `commercial_reuse_allowed`, `attribution`, `retention_restriction`, `rate_limit_json`, `policy_status` and `last_policy_review_at`. Disabled or unreviewed sources can't be selected.
- **Adapter contract:** a `SourceAdapter` in `services/leadforge/sources/` with `search()` and `get_policy()` as in spec §10, returning Pydantic `CompanyCandidate` records with provenance.
- **Adapters, in priority order:**
  1. User-provided domains and CSV. This wraps the current import, so imports also go through the pipeline.
  2. **One** permitted open registry or dataset for the initial countries. Choose it in R2 after a terms and licence review, and record the review in `docs/sources/`.
  3. A search adapter only if a permitted API exists. No scraping of search result pages.
- **Normalisation and dedup:** registrable domain, registration number, normalised name with country, and external IDs. Merge automatically only on domain or registration number. Name-only matches go to the duplicate review queue.
- **Pipeline:** `discovery` → `source_search` → `company_normalization` → `deduplicate` → website resolution → `crawl`.

**Exit:** a project produces new, deduplicated company candidates with source evidence. This is the spec's Phase 4 exit.

### R8 — Crawler and extraction upgrade (≈2.5 weeks) · spec Phase 5, Epic E/F

- **Jobs:** `crawl_jobs` (`queued → running → succeeded | partial | failed | blocked | cancelled`, with attempts, next retry, error code, metrics and policy stop reason) and `crawl_pages`. Migrate `CrawlTarget` into them.
- **Async HTTPX:** global and per-domain concurrency, jittered backoff, stopping on 401/403/429 or a CAPTCHA, streamed byte limits, and redirect validation at every hop. The SSRF tests are extended to DNS rebinding.
- **Candidate pages:** follow the order in spec §11, including localised contact and about paths, within depth and page budgets.
- **Playwright:** a bounded fallback, opt-in per source, for pages that need JavaScript.
- **Extraction:** phone numbers (`phonenumbers`), contact form URLs, the contact categories in spec §5.4 (general, sales, procurement, management, press, support, careers, named), and names or titles only when explicitly present. Contact role is stored separately from contact type.
- **Email verification:** replace the merged statuses with an `email_verifications` row per spec §15: separate syntax, DNS (with A/AAAA fallback) and MX statuses, a provider category (free mail, disposable, role), `checked_at`, `expires_at`, and details. Bounce, complaint and unsubscribe states stay in the frozen campaign area.

**Exit:** permitted sites are crawled within budget, and contacts with phones and categories are extracted with evidence. The golden-set precision target from R2 is met.

### R9 — Local AI (≈1.5 weeks) · spec Phase 6

- An Ollama client in Python, with the model set per task by env.
- Pydantic output contracts for industry classification, page relevance, contact role from explicit context, and language.
- Prompts treat crawled content as untrusted, return `null` when a fact is absent, and include evidence spans. Output that fails validation is rejected, never patched.
- Only deterministic extraction creates contacts. AI only classifies and annotates.
- An evaluation harness compares candidate models on the golden set; record the chosen model in an ADR.

**Exit:** AI outputs are schema-valid, grounded, measured and reviewable.

### R10 — Data quality, search, explorer and export (≈2 weeks) · spec Phase 7

- Explainable confidence components, and freshness fields (`observed_at`, `verified_at`, `expires_at`, `reviewed_at`) with refresh jobs.
- A duplicate review UI for companies and contacts.
- Postgres full-text search, saved filters and segments, and the results workspace columns from spec §21.
- **Market Explorer:** MapLibre with a self-hosted or permitted tile source, and geography and industry browsers. "Create a project from this selection" opens the wizard.
- CSV export that carries provenance columns, plus audit reports.
- Dashboard metrics from spec §4.

**Exit:** users can search, filter, review, verify and export with provenance.

### R11 — Hardening (≈2 weeks) · spec Phase 8

- A security test suite: SSRF and rebinding, oversized responses, XSS in extracted text, unauthorised API access, secrets in logs, and queue replay.
- A load test at 100,000 companies and contacts, then tune indexes and batch upserts.
- Prometheus and Grafana as an opt-in Compose profile.
- Retention and deletion workflows, and handling of data subject requests (the `DataSubjectRequest` table already exists).
- A tested backup and restore drill, plus runbooks and a production checklist.

**Exit:** the spec's Phase 8 exit. This is the first production-quality release.

### R12 — Unfreeze campaigns (separate release) · spec Phase 9

This starts only after legal review. Re-check the frozen code against spec §19 and §20. Missing pieces include recipient-type classification, versioned jurisdiction profiles approved by counsel, and the eligibility outcomes `eligible_pending_human_approval`, `ineligible`, `requires_legal_review` and `insufficient_information`. Then turn on `FEATURE_CAMPAIGNS`.

---

## Schema migration order

1. `R0` Drop `EmailPattern`.
2. `R3` `CREATE EXTENSION postgis`.
3. `R4` Add the geography tables and `company_locations`, then backfill.
4. `R5` Add the taxonomy tables and `company_industries`, then backfill.
5. `R6` Add the discovery filter tables and typed columns, then migrate `criteria`.
6. `R7` Add the source policy columns and `source_observations`.
7. `R8` Add `crawl_jobs`/`crawl_pages`, migrate `CrawlTarget`, then add `email_verifications` v2 and the contact fields.
8. `R10` (one release later) Drop `Company.countryCode/region/city/industry`, `DiscoveryProject.criteria/budget` and `CrawlTarget`.

Each migration needs a rollback note, as spec §29 requires.

## Risks

| Risk | Mitigation |
| --- | --- |
| R2 yield is poor | Follow the spec's fallback: move to registry/dataset-first sourcing before building more UI |
| No permitted discovery source for the target countries | R7 still ships with user domains and CSV. Add more sources only after review; never scrape against terms |
| GeoNames or OSM licence obligations | Store licence and attribution per import batch, and show attribution in the UI |
| The backfill mis-assigns locations or industries | Send rows that don't match to review; never guess |
| Campaign code rots while frozen | Keep its tests in CI with the flag on |
| Scope creep from the old plan | Anything outside this document needs an ADR |

## Immediate next actions

1. Approve this plan and ADR-0020.
2. R0: commit the spec, reinstall dependencies, and remove the dead code.
3. R1: add the `FEATURE_CAMPAIGNS` flag.
4. R2: choose the 50 spike domains and the initial countries and sectors.

---

## Status — 2026-11-18

| Phase | Status | Evidence |
| --- | --- | --- |
| R0 Reset | Done | Spec is `MEGA-PLAN.md`, v0 archived, ADR-0020…0024, clean install, `EmailPattern` and the pglite/embedded-postgres fallbacks removed |
| R1 Freeze campaigns | Done | `FEATURE_CAMPAIGNS` guard on routes, pages, nav and worker loop; freeze tested (404) and campaign tests still run with the flag on |
| R2 Phase 0 | Tooling done | `leadforge.spike`, `leadforge.evaluate`, golden set with traps (precision gate in CI). **Operator:** run on 50 real domains and label ([phase-0-spike](./phase-0-spike.md)) |
| R3 Platform | Done | PostGIS image, BullMQ queues with dead-letter + Postgres sweep fallback, Ollama and monitoring profiles, `/metrics`, JSON logs |
| R4 Geography | Done | Geography tables with generated `geography` + GiST, ISO 3166-1 in migration, seed regions and cities, aliases, APIs, picker, GeoNames importer |
| R5 Taxonomy | Done | Versioned taxonomy, NACE mappings, aliases, `CompanyIndustry`, picker, APIs |
| R6 Project builder | Done | Filter tables, typed settings, lifecycle API, preview, approval, 9-step wizard, live progress, strict results |
| R7 Sources | Done | Adapter contract, `domain_list`, `open_dataset`, `osm_overpass`, policy registry with versioning, staging + normalization with dedup. **Operator:** choose and approve a real dataset |
| R8 Crawler | Done | Async HTTPX with connection-time pinning, `CrawlJob`/`CrawlPage`, phones/forms/categories, auto-promotion rules, separate verification statuses, Playwright opt-in |
| R9 Local AI | Done | Ollama client, grounded Pydantic contract, AI classification with audit trail, benchmark harness, default model chosen (ADR-0025) |
| R10 Search & explorer | Done | FTS, filters, saved views, duplicate review, data-quality page, Market Explorer (MapLibre), exports with provenance |
| R11 Hardening | Done | Security tests, 100k load test ([performance](./performance.md)), restore drill ([runbooks](./runbooks.md)), retention and erasure, Grafana dashboard, production checklist |
| R12 Campaigns | Not started (by design) | Requires the Phase 9 legal review |

Migration note: `Company.countryCode`, `CompanyLocation.rawText` and `Company.industryLabel` (DB column `industry`) remain as source facts, not as classification. The v0 columns that were replaced (`city`, `region`, `criteria`, `budget`, `CrawlTarget`) were migrated and dropped in `20261118120000_realign_discovery`, since there was no production data to keep for a release.
