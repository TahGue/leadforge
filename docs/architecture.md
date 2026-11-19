# LeadForge — Architecture

Companion to [`MEGA-PLAN.md`](./MEGA-PLAN.md) §9 and §17. Decisions are recorded in [`decisions.md`](./decisions.md).

## 1. Processes

```
 browser ──► web (Next.js: UI + /api/v1) ──┬──► PostgreSQL + PostGIS  (system of record)
                                           └──► Redis / BullMQ        (orchestration only)
 worker  (TypeScript) ── BullMQ consumers + Postgres sweep ──► PostgreSQL
 crawler (Python)     ── claims rows FOR UPDATE SKIP LOCKED ──► PostgreSQL, artifacts volume
           ├─ discovery role: source adapters ──► permitted sources (egress network)
           ├─ crawl role:     website crawler ──► company websites (egress network)
           ├─ classify role:  Ollama client    ──► ollama (internal network, optional)
           └─ retention role: artifact purge
```

| Process | Package | Scales by | Network |
| --- | --- | --- | --- |
| web | `apps/web` | replicas behind a proxy | internal + edge (127.0.0.1:3000) |
| worker | `apps/worker` | replicas (sweep is idempotent) | internal + egress (DNS for MX checks) |
| crawler | `services/leadforge` | processes × `CRAWLER_GLOBAL_CONCURRENCY` | internal + egress |
| postgres, redis, ollama | images | vertical | internal only |

Postgres holds all business state. Redis carries BullMQ jobs that can be rebuilt from Postgres, so losing Redis delays work but loses nothing (ADR-0021).

## 2. Pipeline (spec §9)

| # | Stage | Where | Tables |
| --- | --- | --- | --- |
| 1 | Validate project | `pipeline/projects.ts` (Zod + reference checks) | `DiscoveryProject`, filter tables |
| 2 | Expand geography | `pipeline/geo.ts`, `services/leadforge/sources/scope.py` | `DiscoveryLocation`, `City`, `AdminRegion`, `Country` |
| 3 | Plan source queries | start → one `DiscoveryRun` per approved source | `DiscoveryRun` |
| 4 | Discover candidates | `services/leadforge/discovery.py` + adapters | `CompanyCandidate` (staging) |
| 5 | Normalize, deduplicate | `pipeline/normalize.ts` (`company_normalization`) | `Company`, `CompanyDomain`, `CompanyLocation`, `CompanyIndustry`, `SourceObservation`, `CompanyDuplicateCandidate`, `ProjectCompany` |
| 6 | Resolve websites | registrable domain from the source record | `Domain` |
| 7 | Schedule crawls | `createCrawlJob` (skips fresh sites) | `CrawlJob` |
| 8 | Fetch pages | `services/leadforge/crawler.py`, `net.py`, `robots.py` | `CrawlPage`, `FetchArtifact` |
| 9 | Extract evidence | `services/leadforge/extract.py` | `ExtractionRun`, `ExtractionCandidate` |
| 10 | Validate structure | Pydantic (`sources/base.py`, `ai.py`), Zod | — |
| 11 | Classify and enrich | taxonomy rules, then `ai.py` (Ollama) | `CompanyIndustry` |
| 12 | Syntax / DNS / MX | `pipeline/verify.ts` (worker sweep, contact action) | `EmailVerification`, `EmailAddress` |
| 13 | Score | `pipeline/scoring.ts` (explainable components) | `Company.confidenceDetail` |
| 14 | Human review | review queue, duplicate review, data quality | `ExtractionCandidate`, `CompanyDuplicateCandidate` |
| 15 | Search and analytics | Postgres FTS (`searchVector`), metrics | — |
| 16 | Export | `pipeline/exports.ts` (CSV with provenance) | — |
| 17 | Eligibility | `packages/compliance` (frozen, Phase 9) | — |

## 3. Project lifecycle

```
DRAFT/READY ──start──► RUNNING ──pause──► PAUSED ──resume──► RUNNING
     any non-terminal ──cancel──► CANCELLED
RUNNING ──(runs, staged records and crawls all terminal)──► COMPLETED | FAILED
RUNNING ──(N sites refused access)──► PAUSED (automatic, spec §11)
```

Starting requires an approved, enabled source, and a person's approval when the cap exceeds `DISCOVERY_HIGH_VOLUME_THRESHOLD`. Pausing stops normalization and new crawls; in-flight crawls notice at the next page.

## 4. Work claiming and reliability

- Discovery runs and crawl jobs are claimed with `UPDATE … WHERE id = (SELECT … FOR UPDATE SKIP LOCKED)`. A domain is never crawled by two jobs at once.
- Job states: `QUEUED → RUNNING → SUCCEEDED | PARTIAL | FAILED | BLOCKED | CANCELLED`, with attempts, next retry, error code and policy stop reason.
- Transient failures back off exponentially with jitter, up to `maxAttempts`. **Policy stops (`BLOCKED`) are never retried automatically**; an admin can re-queue one, and that is audited.
- Leases: a job `RUNNING` for longer than `WORKER_STALE_RUNNING_MINUTES` without a heartbeat is re-queued by the sweep.
- BullMQ jobs use deterministic IDs and bounded retries. Exhausted jobs go to the `dead-letter` queue.

## 5. Crawling safeguards (spec §11)

1. `validate_url` on every URL and redirect hop: scheme allowlist, no credentials, blocked ports, metadata hosts, blocked IP ranges.
2. `SafeNetworkBackend` re-resolves at connect time and connects only to vetted addresses (DNS rebinding).
3. Redirects may not leave the site's registrable domain.
4. robots.txt per RFC 9309 (5xx means disallow, 4xx means allow) and `Crawl-delay`.
5. Per-domain rate limit `max(60/rpm, robots delay, CRAWLER_DELAY_MS)`.
6. 401/403/407/429/451 and challenge pages are terminal policy stops, plus a 24 h domain cooldown.
7. Byte limits (declared and streamed), content-type allowlist, timeouts, page and depth budgets, URL allow/deny patterns.
8. Playwright only when the project allows it and the operator enabled it. The browser has the same per-request guard, blocks images, media, fonts and downloads, and never interacts with challenges.

## 6. Data at rest

- Raw pages: gzip, content-addressed (`artifacts/<aa>/<sha256>.html.gz`), purged after `ARTIFACT_RETENTION_DAYS`. Evidence keeps the URL and hash.
- Spatial columns: generated `geography(Point,4326)` with GiST indexes. Full text: generated `tsvector` with a GIN index.
- Reference data (geography, taxonomy) is global and versioned; tenant data is scoped by `organizationId`.
