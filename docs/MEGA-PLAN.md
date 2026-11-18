# LeadForge — Mega Plan & Technical Implementation Specification

**Version:** 1.0 · **Date:** 18 November 2026 · **Status:** Controlling specification (see ADR-0020 in [decisions.md](./decisions.md))
**Project type:** Local-first, self-hosted B2B company and business-contact discovery platform

> This document is the controlling plan. Where any other document disagrees, this one wins until an ADR amends it.
> The earlier outreach-centred plan is archived at [`archive/MEGA-PLAN-v0.md`](./archive/MEGA-PLAN-v0.md).
> How the existing code is being brought in line is described in [`REALIGNMENT-PLAN.md`](./REALIGNMENT-PLAN.md).

## 1. Executive summary

LeadForge is a self-hosted B2B market-discovery and contact-research platform. Users create discovery projects by selecting a geographic scope — city, region, country, continent, or worldwide — then narrowing the target by industry, subsector, company characteristics, online presence, language, contact role, data quality, and exclusions.

The platform discovers companies first, then extracts evidence-backed business contact details from permitted sources. Every important field retains provenance: source URL, observation time, extraction method, confidence, and freshness.

Company discovery, contact discovery, legal basis/permission, campaign eligibility, and message delivery are separate stages. Discovering an email address does not grant permission to send marketing.

### Product principles

1. **Local-first:** crawling, extraction, storage, enrichment, and local AI run on infrastructure controlled by the operator.
2. **Self-hosted:** no mandatory paid SaaS APIs or external LLM APIs.
3. **Geography-led:** city, country, and continent are first-class filters.
4. **Evidence-based:** every extracted value is traceable.
5. **Company-first:** discover and deduplicate companies before contacts.
6. **Compliance by design:** respect source terms, robots policies, access restrictions, privacy obligations, and opt-outs.
7. **No fabricated contacts:** AI must never invent emails, people, phone numbers, or company facts.
8. **Scalable:** support 100,000 records initially, with a path toward one million.
9. **Human approval:** campaign eligibility and sending require explicit review.
10. **Auditable:** log crawls, transformations, verification, eligibility, and campaign events.

## 2. Scope and non-goals

### In scope

- Discovery projects driven by geography, sector, subsector, and advanced filters.
- Company discovery through permitted public sources and configured adapters.
- User-provided domains, CSV imports, and approved datasets.
- Bounded website crawling and contact extraction.
- Company classification, normalization, deduplication, and enrichment.
- Email syntax and DNS/MX checks.
- Provenance, confidence, freshness, search, review, tagging, and export.
- Local AI classification through Ollama.
- Compliance review and campaign eligibility gates.
- Later integration with operator-managed SMTP.

### Explicit non-goals

- Bypassing logins, paywalls, CAPTCHAs, access controls, or anti-bot challenges.
- Stealth browser fingerprints, residential proxy rotation, or evasion infrastructure.
- Ignoring robots directives, source terms, rate limits, or opt-outs.
- Harvesting private/non-public information.
- Guessing personal email addresses and treating them as discovered or verified.
- SMTP mailbox probing or recipient enumeration.
- Automatically adding discovered contacts to campaigns.
- Treating MX validity as proof of mailbox existence or marketing permission.

## 3. Target workflows

### A. Discover companies

1. Create a discovery project.
2. Select city, region, country, continent, or worldwide scope.
3. Select industry, subsector, and keywords.
4. Apply company, website, language, and technology filters.
5. Select permitted sources.
6. Set crawl limits and quality thresholds.
7. Preview scope and policy warnings.
8. Start discovery and monitor jobs.
9. Review, deduplicate, tag, and export results.

### B. Discover business contacts

1. Select companies or a project.
2. Choose contact categories: general, sales, procurement, management, press, support, or named professional contacts where lawfully available.
3. Crawl permitted company pages.
4. Extract only evidence-backed contact details.
5. Store source and extraction evidence.
6. Validate syntax and DNS/MX.
7. Review uncertain results.
8. Export or retain in the company dataset.

### C. Prepare a campaign (later phase)

1. Create a draft.
2. Select a target segment.
3. Run jurisdiction- and recipient-type-specific eligibility checks.
4. Exclude suppressed, objected, bounced, complained-about, and otherwise ineligible recipients.
5. Review legal basis and source evidence.
6. Approve content and recipient list.
7. Send a test and then controlled batches.
8. Process bounces, complaints, unsubscribe requests, and replies.

Discovery must never automatically trigger a campaign.

## 4. Product navigation

- Dashboard
- Market Explorer — Map · Geographic browser · Industry browser · Search results
- Discovery Projects — New project · Active jobs · Completed projects · Project results
- Companies — All companies · Lists and segments · Duplicate review
- Contacts — All contacts · Verification · Suppression list
- Sources — Source registry · Source policies · Crawl history
- Data Quality — Missing fields · Low-confidence records · Stale records · Human review
- Campaigns (later)
- Analytics
- Settings

Dashboard metrics should include companies discovered, contacts found, source evidence coverage, syntax/MX statuses, duplicate candidates, crawl success/failure/blocked counts, job queue state, stale records, and records awaiting review.

## 5. Discovery project builder

The project builder should be a guided wizard with a persistent scope summary and a preview before execution.

### 5.1 Geography filters

Hierarchy: `Continent → Country → Administrative region/state → City → Postal code`. Support one or many locations at any level.

Fields: geographic mode (city, region, country, continent, worldwide, custom selection); continent and country; region/state/province; city; postal code or prefix; optional radius around a point; include/exclude locations; include nearby cities (explicit opt-in); headquarters only, any branch, or all known locations; location confidence requirement.

Use stable geographic identifiers and country codes. Do not rely on free-text city names because city names can repeat across countries.

### 5.2 Industry and sector filters

Hierarchy: `Industry taxonomy → Sector → Subsector → Specialisation → Keywords`.

Support NACE, ISIC, NAICS, or other applicable external codes; an internal normalized taxonomy; user-defined sectors and subsectors; include/exclude keywords; company description, product, and service keywords; optional technology categories.

Initial broad sectors: IT and software · Manufacturing · Construction · Healthcare · Education · Retail and e-commerce · Logistics and transportation · Finance and insurance · Real estate · Hospitality and tourism · Energy and utilities · Professional services · Agriculture and food · Automotive · Media and communications · Wholesale and distribution · Other / unclassified.

Store classification source, method, confidence, and taxonomy version. A company may belong to multiple industries.

### 5.3 Company filters

Employee count range and size band; revenue range, only when backed by a reliable source; legal form / entity type; active, inactive, newly registered, or unknown; founded/registration year range; headquarters versus branch; independent, subsidiary, or franchise where evidence supports it; domain required/optional; website reachable/unreachable/unknown; HTTPS required; social profiles present; description required; exclude customers, competitors, or previously contacted companies.

Do not invent revenue or employee counts. Store sourced estimates as estimates.

### 5.4 Contact filters

General company email; sales; procurement/purchasing; management/executive; press/media; support/customer service; careers/recruitment; named professional contact; phone number; contact form URL; role-based only, named only, or both; exclude free-mail providers (optional); require source evidence; require syntax-valid email; require MX-valid domain; minimum confidence.

Store contact role separately from contact type and address.

### 5.5 Website and technology filters

Website exists/absent/unknown; CMS (WordPress, Drupal, Joomla, etc.); e-commerce (Shopify, Magento, WooCommerce, etc.); framework (Next.js, React, Vue, Angular, etc.); website language; HTTPS/TLS status; contact page and careers page presence; online booking, shop, or catalogue presence.

Technology detection is heuristic; save evidence and detection time.

### 5.6 Language filters

Website language; preferred company communication language; multiple languages; unknown-language handling; detection confidence. Do not assume website language is an individual contact's preferred language.

### 5.7 Sources and discovery controls

Source categories: company websites; user-provided domains; public business directories where reuse is permitted; search engines only through permitted interfaces and under their terms; official registries and open datasets with compatible licences; licensed datasets imported by the operator.

Project controls: maximum companies; maximum pages per company; maximum crawl depth; requests per domain per time window; global and per-source concurrency; crawl timeout; retry count and backoff; allowed/excluded URL patterns; maximum response size; accepted content types; crawl freshness window; stop conditions; human approval for high-volume runs.

### 5.8 Exclusions

Existing customers and competitors; previously contacted companies; suppressed domains and email addresses; countries, cities, sectors, domains, and keywords; excluded source domains; previously processed companies; companies without sufficient evidence.

### 5.9 Data quality filters

Minimum independent source observations; official website required; source URL required for every contact; minimum extraction confidence; maximum record age; email syntax and MX status; website reachability; duplicate status; human-reviewed status.

### 5.10 Project preview

Show geography, taxonomy, company/contact constraints, selected sources and policy status, exclusions, crawl budget, record cap, warnings, and filters likely to reduce coverage. Estimates are not guarantees of available records.

## 6. Geographic data architecture

Recommended datasets and tools: **GeoNames** for broad global geographic names and hierarchy; **OpenStreetMap** for features and boundaries, subject to its licence and attribution rules; **Nominatim** for geocoding only under its usage policy (self-hosted or appropriately licensed for production volume); **ISO 3166** for country and subdivision codes; **PostGIS** for spatial queries and indexing.

Do not use the public Nominatim endpoint as a bulk geocoding backend. Respect data licences, attribution, redistribution, and update requirements.

Geography entities: `continents`, `countries`, `admin_regions`, `cities`, `postal_areas`, `geo_aliases`, `geo_import_batches`. Store stable external identifiers, ISO codes, display and alternate names, parent IDs, centroid, boundary geometry, source, licence, and import version.

Example projects: construction companies in Gothenburg; software companies in Sweden; manufacturers in Västra Götaland; logistics companies in Germany; healthcare providers in the Nordic countries; e-commerce businesses in Europe; worldwide companies in a defined subsector. A project may contain multiple locations and exclusion zones.

## 7. Industry taxonomy architecture

Use a normalized internal taxonomy with mappings to external classifications.

Tables: `industries`, `industry_taxonomy_versions`, `industry_external_codes`, `industry_aliases`, `company_industries`, `discovery_industry_filters`.

Fields: `id`, `parent_id`, `code`, `name`, `description`, `taxonomy`, `taxonomy_version`, `external_code`, `language`, `is_active`.

Keep mappings versioned. A company may have multiple industry classifications, with a primary flag and confidence score.

## 8. Recommended technology stack

| Layer | Technology | Purpose |
| --- | --- | --- |
| Frontend | Next.js + TypeScript | Admin UI and project builder |
| UI | Tailwind CSS + shadcn/ui | Interface |
| Forms | React Hook Form + Zod | Form state and validation |
| Tables | TanStack Table | Filtering and large result sets |
| Maps | MapLibre GL JS | Self-hostable map UI |
| API | Next.js route handlers initially | Application endpoints |
| ORM | Prisma | Typed database access |
| Database | PostgreSQL | Main relational store |
| Geospatial | PostGIS | Geography and radius queries |
| Queue | Redis + BullMQ | Job orchestration |
| Crawler | Python + HTTPX | Efficient HTTP crawling |
| Browser automation | Playwright | JS-heavy pages only |
| HTML parsing | Selectolax / BeautifulSoup | Extraction |
| Schemas | Pydantic | Strict structured output |
| Local AI | Ollama | Classification and extraction assistance |
| Data processing | Polars | Batch transformations |
| Analytics | DuckDB | Local analytics and exports |
| Search | PostgreSQL FTS initially | Search |
| Extended search | OpenSearch, if measured need | Larger-scale search |
| Object storage | Local filesystem / MinIO | Crawl artefacts |
| SMTP (later) | Postfix + OpenDKIM + Rspamd | Operator-managed email |
| Observability | Prometheus + Grafana | Metrics |
| Deployment | Docker Compose | Self-hosting |

Start as a modular monolith plus separate Python workers. Do not introduce Kubernetes or many microservices prematurely. Deviations are recorded in [`decisions.md`](./decisions.md).

## 9. High-level architecture

```
                         ┌──────────────────────────┐
                         │       Next.js UI         │
                         │ Market Explorer / Admin  │
                         └────────────┬─────────────┘
                                      │
                         ┌────────────▼─────────────┐
                         │       Application API    │
                         │ Auth / Projects / Search │
                         └──────┬─────────────┬─────┘
                                │             │
                         ┌──────▼─────┐ ┌─────▼─────────┐
                         │ PostgreSQL │ │ Redis / Queue │
                         │ + PostGIS  │ │ BullMQ        │
                         └──────┬─────┘ └─────┬─────────┘
                                │             │
                     ┌──────────▼─────────────▼──────────┐
                     │         Python workers            │
                     │ Discovery / Crawl / Extract       │
                     │ Normalize / Verify / Enrich       │
                     └──────┬──────────────┬─────────────┘
                            │              │
                  ┌─────────▼──────┐ ┌─────▼────────────┐
                  │ Permitted      │ │ Ollama           │
                  │ source adapters│ │ local inference  │
                  └────────────────┘ └──────────────────┘

                 Later, separately gated:
                 Eligibility → Approval → SMTP → Events
```

Processing stages: (1) validate project; (2) expand geographic scope; (3) plan source queries; (4) discover company candidates; (5) normalize and deduplicate; (6) resolve company websites; (7) schedule policy-aware crawls; (8) fetch pages; (9) extract company/contact evidence; (10) validate structured output; (11) classify and enrich; (12) check email syntax and DNS/MX; (13) score confidence and freshness; (14) send uncertain records to human review; (15) update search and analytics; (16) export or use in CRM workflows; (17) optionally evaluate campaign eligibility.

## 10. Discovery source strategy

### Source adapters

```python
class SourceAdapter:
    source_name: str

    async def search(self, query, location, filters, limit):
        """Return normalized candidate company records."""

    async def get_policy(self):
        """Return configured source policy and usage constraints."""
```

Each adapter declares source type, terms/licence URL, permitted use, rate limit, attribution, retention restrictions, automated-access permission, commercial-reuse permission, policy review date, and enabled status.

### Source priority

1. User-provided company domains and files.
2. Official open registries and compatible datasets.
3. Company websites discovered through permitted sources.
4. Directories with compatible reuse permissions.
5. Search providers through permitted APIs/interfaces.

Do not scrape search-result pages contrary to provider terms. Prefer official APIs, licensed providers, or compatible datasets.

### Source evidence

Store source ID, source record ID, URL, discovery query/project, retrieval time, policy version, raw evidence reference, parsed values, and licence metadata.

## 11. Crawling system

### Crawl strategy

Use HTTPX first. Use Playwright only when JavaScript is required to expose relevant content and automated access is permitted.

Candidate page order: homepage; contact pages and localized equivalents; about pages; company pages; team, leadership, and management pages; sales, procurement, and press pages; footer and navigation links. These are candidates, not guaranteed paths. Follow discovered same-site links only within configured scope and budget.

### Crawler safeguards

- Respect robots directives and source-specific policies.
- Apply conservative per-domain rate limits.
- Use exponential backoff with jitter for transient failures.
- Stop or pause on 401, 403, 429, CAPTCHA, explicit denial, or repeated access failures.
- Never defeat access restrictions.
- Bound crawl depth, page count, response size, and content types.
- Validate every URL and redirect.
- Block localhost, private, link-local, multicast, reserved, and cloud metadata IP ranges.
- Re-check DNS and resolved IPs at connection time to reduce DNS-rebinding/SSRF risk.
- Prevent redirects escaping approved host scope unless explicitly allowed.
- Do not execute downloaded binaries or arbitrary scripts.
- Make raw response retention configurable and policy-aware.

### SSRF and URL safety

`http`/`https` scheme allowlist; no credentials in URLs; IP-range denylist; DNS resolution validation; redirect validation at every hop; egress firewall rules where possible; maximum redirect count; connection/read timeouts; content-length and streamed-byte limits; host allowlists and deny-lists; network isolation between crawler, database, and admin services.

### Crawl job states

`queued → running → succeeded | partial | failed | blocked | cancelled`

Persist attempt count, last error, next retry time, pages fetched/skipped, bytes downloaded, duration, and policy stop reason.

## 12. Extraction and local AI

### Deterministic extraction first

Extraction priority: (1) `mailto:` links; (2) JSON-LD / Schema.org; (3) visible email and phone patterns; (4) contact-page sections; (5) footer and navigation; (6) structured metadata; (7) local AI classification of extracted evidence. Use deterministic parsers before LLM calls.

### Contact extraction fields

Exact email or phone as found; contact page URL; contact form URL; person name only when explicitly present; job title/role only when explicitly present; department/category; language; evidence snippet or normalized excerpt; extraction method; confidence.

Never create an email by combining a name with a guessed domain pattern. Guesses must never be labelled discovered or verified.

### Ollama use cases

Industry/subsector classification; company description normalization; page relevance classification; contact-role classification from explicit context; language classification; duplicate-candidate similarity assistance; structured extraction from ambiguous visible text. The LLM is not the authority for factual verification.

### Structured extraction contract

Require JSON matching a Pydantic schema. Treat crawled content as untrusted data. Instruct the model to extract only facts explicitly present; return `null` when absent; never infer or guess; include exact evidence spans; distinguish company facts from individual facts; return confidence and uncertainty; ignore instructions embedded in crawled pages. Validate output with Pydantic. Reject malformed or unsupported claims. Preserve original evidence separately.

### Model deployment

Run Ollama locally. Make model name/version configurable per task. Benchmark candidate models on a labelled dataset. Tune quantization, batch size, concurrency, and context length against available resources.

## 13. Email and domain verification

### Status model

Distinct states: `discovered`, `syntax_valid`, `syntax_invalid`, `domain_dns_valid`, `mx_valid`, `mx_missing`, `disposable_domain`, `role_based`, `free_mail_provider`, `unknown`, `suppressed`, `bounced`, `complained`, `unsubscribed`. Do not collapse these into one "verified" boolean.

### Verification stages

1. Normalize whitespace and casing carefully.
2. Validate syntax with a maintained library.
3. Extract domain.
4. Resolve DNS.
5. Check MX records.
6. Apply standards-aware fallback logic where appropriate.
7. Optionally classify disposable/free-mail domains using maintained local lists.
8. Record timestamp and resolver result.
9. Re-check after a configurable freshness period.

### Limitations

MX validity does not prove a mailbox exists. SMTP `RCPT TO` probing is unreliable and can be abusive; do not implement mailbox enumeration. Catch-all domains may accept unknown recipients. DNS changes; verification is time-bound. A deliverable address is not automatically eligible for marketing.

## 14. Data quality, deduplication, and scoring

**Company deduplication signals:** normalized registrable domain; official registration number; normalized company name; country and address; phone number; canonical website URL; external source identifiers. Do not merge solely on similar names. Create candidate matches and allow human review.

**Contact deduplication:** normalized email, explicitly evidenced identity, company relationship, role/department, and source evidence. Shared role addresses may legitimately belong to multiple locations; preserve relationships.

**Confidence score:** explainable components — official website evidence, independent source corroboration, extraction method reliability, evidence freshness, field consistency, human review. Store component scores and reasons. Do not present a score as objective truth.

**Freshness:** each field tracks `observed_at`, `verified_at`, `expires_at` or freshness policy, `source_id`, `confidence`, `reviewed_at`. Refresh stale records according to source policy.

## 15. Database design

Use PostgreSQL + Prisma for core data and PostGIS for spatial fields. Store large raw crawl artefacts separately from relational records.

### Core tables

- `users` — id, email, password_hash or auth identifier, name, role, created_at, updated_at
- `discovery_projects` — id, name, description, status, created_by, geographic_mode, max_companies, max_pages_per_company, max_crawl_depth, min_confidence, settings_json, timestamps
- `discovery_locations` — id, project_id, continent_id, country_id, region_id, city_id, postal_area_id, include_or_exclude, radius_km, geometry
- `discovery_industry_filters` — id, project_id, industry_id, include_or_exclude, is_primary
- `discovery_keywords` — id, project_id, keyword, keyword_type, include_or_exclude, language
- `discovery_source_selections` — id, project_id, source_id, enabled, configuration_json
- `companies` — id, canonical_name, normalized_name, description, website_url, registrable_domain, registration_number, legal_form, employee and revenue ranges, founded_year, status, primary_language, country_id, timestamps
- `company_locations` — id, company_id, location_type, address fields, postal_code, city_id, region_id, country_id, latitude/longitude/geometry, is_headquarters, source_id, confidence
- `company_industries` — id, company_id, industry_id, is_primary, confidence, classification_method, source_id
- `contacts` — id, company_id, contact_type, email, normalized_email, phone, full_name, job_title, department, language, is_role_based, timestamps
- `contact_evidence` — id, contact_id, source_id, source_url, evidence_text, extraction_method, confidence, observed_at
- `sources` — id, name, source_type, base_url, terms_url, licence_name, permitted_use, rate_limit_json, policy_status, last_policy_review_at
- `source_observations` — id, source_id, company_id, field_name, field_value, source_url, observed_at, raw_artifact_id, confidence
- `crawl_jobs` — id, project_id, company_id, status, priority, attempt_count, started_at, finished_at, next_retry_at, error_code, error_message, metrics_json
- `crawl_pages` — id, crawl_job_id, url, http_status, content_type, content_hash, fetched_at, duration_ms, bytes_received, parse_status, artifact_path
- `email_verifications` — id, contact_id, syntax_status, dns_status, mx_status, provider_category, checked_at, expires_at, details_json
- `suppressions` — id, email_normalized, domain, reason, source, created_at, expires_at, notes
- `audit_logs` — id, actor_id, action, entity_type, entity_id, details_json, created_at

### Campaign tables (later phase)

`campaigns`, `campaign_recipients`, `delivery_events`, `sender_identities`, `consent_and_permission_records`.

### Database rules

Use foreign keys and appropriate unique constraints. Normalize emails into a canonical field. Index country, city, industry, domain, status, normalized email, and timestamps. Use PostGIS spatial indexes. Partition append-only event tables only when measured volume warrants it. Keep raw HTML out of large relational text columns; store compressed artefacts by reference. Encrypt secrets and sensitive configuration. Back up database and artefacts separately. Define deletion and retention policies.

The physical schema lives in [`packages/database/prisma/schema.prisma`](../packages/database/prisma/schema.prisma); [`data-model.md`](./data-model.md) maps these logical tables onto it.

## 16. API design

Versioned REST endpoints. Long-running operations return a job ID.

**Discovery projects:** `POST/GET /api/v1/discovery-projects`; `GET/PATCH/DELETE /api/v1/discovery-projects/:id`; `POST …/:id/preview`, `…/start`, `…/pause`, `…/resume`, `…/cancel`; `GET …/:id/progress`, `…/results`.

**Companies and contacts:** `GET/POST /api/v1/companies`; `GET/PATCH /api/v1/companies/:id`; `GET …/:id/contacts`, `…/:id/evidence`; `POST …/:id/crawl`; `GET /api/v1/contacts`; `GET/PATCH /api/v1/contacts/:id`; `POST …/:id/verify`, `…/:id/suppress`; `GET …/:id/evidence`.

**Geography and taxonomy:** `GET /api/v1/geography/{continents,countries,regions,cities}`; `GET /api/v1/industries`; `GET /api/v1/industries/:id/children`.

**Operations:** `GET /api/v1/jobs`; `GET /api/v1/jobs/:id`; `POST /api/v1/jobs/:id/retry`; `GET /api/v1/sources`; `PATCH /api/v1/sources/:id`; `GET /api/v1/audit-logs`.

**Campaigns (later):** create, eligibility-check, submit-for-approval, approve, send-test, schedule, pause; `POST /api/v1/unsubscribe`.

All list endpoints need pagination, sorting, validated filters, and safe query limits.

## 17. Queue and worker architecture

Redis + BullMQ for TypeScript orchestration. Python workers consume a compatible queue or receive jobs through a small internal service.

Queues: `discovery`, `source_search`, `company_normalization`, `crawl`, `extract`, `classify`, `verify`, `deduplicate`, `export`, `refresh`, `campaign_eligibility` (later), `email_delivery` (later).

Reliability: jobs are idempotent; stable job IDs prevent duplicates; retries are bounded with exponential backoff; transient errors are separated from permanent policy blocks; exhausted jobs are dead-lettered; cancellation and project pause are supported; per-domain and global concurrency are enforced; PostgreSQL is the system of record, Redis is not; a policy denial is never retried as a network error.

## 18. Security and privacy

**Application security:** authentication and role-based authorization; strong password hashing or a trusted self-hosted identity provider; CSRF protections; strict input validation and rate limiting; secure session cookies; secrets in environment variables or a secrets manager; restricted admin endpoints; patched dependencies; audited privileged actions; encrypted backups.

**Crawler security:** SSRF protections; egress network restrictions; crawled content treated as untrusted; page instructions never followed as commands; HTML sanitized before rendering; no unnecessary personal data stored.

**Privacy and retention:** define purpose and lawful basis before processing personal contact data; minimize personal data; separate corporate role accounts from identifiable individuals; record source and collection date; define retention and deletion workflows; handle access, correction, objection, and deletion requests; keep suppression data so opted-out addresses are not re-imported and contacted again; restrict access to personal contact information; document processing activities and source relationships.

## 19. Compliance architecture

This is an engineering framework, not legal advice. Obtain jurisdiction-specific legal review before campaigns.

Three separate questions: (1) may LeadForge access and reuse this source data; (2) may LeadForge process this personal data for the stated purpose; (3) may the operator send this marketing message to this recipient. A yes to one does not imply a yes to another.

Recipient categories: generic corporate role address; named employee at a company; sole trader / individual business owner; consumer / private individual; unknown. Do not assume all business-domain addresses are corporate recipients or that all B2B marketing is exempt from consent rules.

Jurisdiction profiles are configurable and versioned, built only after review by qualified counsel.

Eligibility outcomes: `eligible_pending_human_approval`, `ineligible`, `requires_legal_review`, `insufficient_information`. Default to not eligible when required information is missing.

Suppression is checked during import, contact creation, segment building, campaign approval, and immediately before sending.

## 20. SMTP and deliverability (later phase)

Self-hosted SMTP is operationally demanding; a residential connection is unsuitable for bulk business email. Required: Postfix, DKIM signing, SPF, staged DMARC, valid PTR, TLS, stable HELO, bounce mailbox and parser, complaint handling, unsubscribe (including one-click where required), and monitoring. Send only to recipients passing eligibility, with rate limits, sender identity and clear opt-out. Do not deploy bulk sending until eligibility, suppression, bounce processing, and approval are complete.

## 21. Frontend experience

**Market Explorer:** geographic map; continent/country/region/city browser; industry tree; search filters; result count and map/list toggle; saved filters; "Create discovery project from this selection". Use MapLibre GL JS with a compliant tile source; do not assume public OSM tile servers support a commercial application.

**New discovery project wizard:** (1) project details; (2) geography; (3) industry; (4) company profile; (5) contacts; (6) sources; (7) quality and exclusions; (8) review; (9) run.

**Results workspace:** company columns — company, city/country, industry, website, size estimate, contact count, evidence count, confidence, last observed, review status. Contact columns — email/phone, category, company, source, syntax status, MX status, confidence, last observed, suppression status. Saved views, bulk tagging, CSV export, review queues. Bulk campaign selection must not imply eligibility.

## 22. Performance and scaling

Design for 100,000 records first, with a path to one million: async HTTP crawling with bounded concurrency; sparing Playwright; cached DNS and robots results; deduplicate before crawling; avoid recrawling fresh pages; batch upserts; Polars/DuckDB for offline analysis; OpenSearch only on measured need; partitioning only when justified; separate crawler and database resource limits; monitor GPU memory and LLM queue depth.

Metrics: requests/minute and per domain; HTTP status distribution; crawl latency and pages/company; bytes downloaded; extraction yield and contacts/100 companies; duplicate rate; AI throughput and queue wait; DB query latency; queue age and retry rate; storage growth and export duration.

## 23. Docker Compose deployment

Services: `app`/`web` (Next.js), `postgres` (PostGIS), `redis`, `crawler` (Python), `ollama`, optional `minio`, optional `prometheus` and `grafana`. Do not expose PostgreSQL, Redis, Ollama, or internal worker ports publicly. Use persistent volumes and health checks. Pin image versions for production.

## 24–25. Development setup and Compose baseline

See [`deployment.md`](./deployment.md) and the repository `docker-compose.yml`. Use a real policy/contact URL and truthful user-agent before crawling. Do not impersonate another organization.

## 26. Testing strategy

**Unit:** URL normalization and domain extraction; email syntax and phone normalization; industry mapping and geography hierarchy; confidence scoring; suppression matching and eligibility rules; deduplication.

**Integration:** migrations and PostGIS queries; queue processing; crawl-to-extraction pipeline; Ollama structured-output validation; artefact storage; CSV import/export; source policy enforcement.

**Security:** SSRF and DNS-rebinding; redirect-to-private-IP; oversized responses and malformed HTML; XSS in extracted text; unauthorized API access; secret leakage in logs; queue replay and idempotency.

**Quality evaluation dataset:** manually labelled across countries, sectors, languages, and website types. Measure discovery precision, dedup precision/recall, email and phone extraction precision, industry and role classification accuracy, evidence-span correctness, and false-positive rate. Prioritize contact-extraction precision over recall.

## 27. Implementation roadmap

| Phase | Weeks | Exit |
| --- | --- | --- |
| 0 — Product and policy foundation | 1 | Approved scope, source checklist, schema draft, test dataset |
| 1 — Infrastructure and application shell | 2–3 | Authenticated app, migrations, queue connectivity, repeatable local startup |
| 2 — Geography and industry foundation | 4–5 | User can select geography and industry and save filters |
| 3 — Discovery project builder | 6–7 | Projects can be saved, previewed, started, paused, and cancelled |
| 4 — Company discovery and adapters | 8–10 | Project produces deduplicated company candidates with evidence |
| 5 — Website crawling and extraction | 11–13 | Permitted websites are crawled and evidence-backed data is extracted |
| 6 — Local AI and data quality | 14–15 | AI outputs are schema-valid, evidence-grounded, measured, and reviewable |
| 7 — Verification, search, and exports | 16–17 | Users can search, filter, review, verify, and export records with provenance |
| 8 — Hardening and release | 18–20 | Reliable self-hosted discovery with monitoring, backups, policy controls, and documentation |
| 9 — Campaign capability | separate release | Only after legal review and completion of required controls |

## 28. MVP definition

1. Login and admin role. 2. Geography selection: city, country, continent. 3. Industry and subsector selection. 4. Company size and website filters. 5. Discovery project wizard. 6. User-provided domain import. 7. One permitted company discovery source. 8. HTTPX website crawler with policy controls. 9. Company/contact extraction. 10. PostgreSQL storage with provenance. 11. Email syntax and MX checks. 12. Company/contact search and filtering. 13. CSV export. 14. Suppression list. 15. Audit log and job monitoring.

Leave SMTP sending and broad multi-source discovery for later.

## 29. Definition of done

A feature is complete only when it has automated tests; validates user input; records source evidence where relevant; has failure and retry behaviour; is observable through logs/metrics; respects source policies; handles duplicate and stale data; has documented operational behaviour; does not expose secrets or internal services; and has a migration and rollback strategy when schema changes.

A discovery project is complete when jobs reach terminal states, results are persisted, errors and policy stops are visible, and evidence can be inspected.

## 30–32. Backlog, decisions, build sequence

The backlog is tracked in [`backlog.md`](./backlog.md). Key architectural decisions: company-first discovery; modular monolith first; Python crawler workers; Next.js + Prisma + PostgreSQL; PostGIS; Redis queue; Ollama local AI; deterministic extraction before AI; evidence provenance; verification separate from deliverability; discovery separate from marketing eligibility; policy-aware adapters.

**Core product decision:** LeadForge is a high-quality, geographically targeted company-intelligence system first — not an email blaster. Its value comes from precise targeting, traceable evidence, clean company records, useful filters, and trustworthy contact data.
