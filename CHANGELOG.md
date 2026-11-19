# Changelog

## 0.2.0 — 2026-11-18 (realignment release, spec v1.0)

Discovery-only release. Campaigns, eligibility and SMTP stay frozen until the Phase 9 legal review (ADR-0020).

### Added
- Specification v1.0 realignment: geography and industry foundations, discovery project wizard and lifecycle, source policy registry and adapters, Python crawler and extraction, local AI classification, verification, search and exports (see `docs/REALIGNMENT-PLAN.md`).
- Model benchmark tool `python -m leadforge.ai_eval` and a labelled classification set; default model `qwen3.8:27b` (ADR-0025).
- Prometheus alert rules with promtool unit tests for induced failures (`infrastructure/monitoring/alerts.yml`).
- Tenant-leak suite over four resource types; audit-coverage test for every mutating route; 10,000-URL SSRF fuzz; artifact replay determinism test; checks for no mailbox probing and no offset pagination (CI).
- Database CHECK constraint: a promoted extraction candidate must keep its source page.
- Load test at 1,000,000 companies (`docs/performance.md`).
- Project wizard: **Detect from a keyword** (`POST /api/v1/industries/suggest`). The local AI maps a keyword such as "olive oil producer" to taxonomy industries and proposes include/exclude keywords; codes are validated against the taxonomy, and the taxonomy aliases are the fallback when AI is off or fails.
- Trained triage classifier (ADR-0026): before the LLM, a per-organization scikit-learn model trained on earlier AI and manual labels decides the clear cases in milliseconds (method `MODEL`, confidence capped at 0.6, with the deciding words as evidence) and leaves the uncertain ones to the LLM. Settings `TRIAGE_*`.
- OpenStreetMap adapter: project keywords that name a niche product (olive oil, oil mills) select precise OSM tags instead of the broad sector tags, and OSM `product`/`produce` tags are kept as the record description so keyword filters can match them.

### Fixed
- API authentication failed when any cookie came before `lf_session` in the Cookie header.
- Saved segments and logout did not write audit rows.
- Logs could include database/Redis passwords from driver errors; crawler logs dropped tracebacks.
- Bounce-ingest key used a non-constant-time comparison.
- Normalization could stall: a paused project's backlog (or orphaned staging rows) filled every sweep batch, so newer candidates were never processed. The sweep now selects only rows of running or cancelled projects.
- Overlapping normalizers (several worker replicas, or the sweep and the discovery queue) could process the same staged record twice; the loser hit a unique-constraint error and overwrote the result with REJECTED. Each record is now claimed with a row lock, and records for the same domain or registration number are serialized with transaction-scoped advisory locks.
- Long discovery runs (one Overpass query per country) were re-queued as dead after `WORKER_STALE_RUNNING_MINUTES` while still working, because recovery read `startedAt`. The discovery worker now refreshes `DiscoveryRun.heartbeatAt` every minute and recovery reads it (migration `20261119080000_discovery_run_heartbeat`).
- One unavailable country made a multi-country OpenStreetMap run fail and start over. A failing area is now retried once, then skipped; the run ends PARTIAL and lists `skippedAreas` in its metrics.
- A project with many independent sites paused after its first `stopAfterBlocked` refusals (5 by default), though some sites always refuse crawlers. It now pauses only when refusals also make up half of the finished crawls.
- Crawls of dead domains (no DNS record, connection refused) were recorded as robots.txt refusals and counted toward pausing the project. They now end FAILED with `site_unreachable`.
- The AI classification step crashed on start: it read a `Company."industryLabel"` column that is stored as `industry`.
- Retrying a job of a FAILED or COMPLETED project left the project closed, so the job was never picked up and its results never normalized. Retrying now reopens the project.
- Staged company records and domain events had no foreign keys, so deleting an organization or project left them behind. Added cascading keys (migration removes existing orphans first).
- Vulnerable dependencies: zod 4.6.7 (GHSA-mrhx-c7xc-m3w5), deepmerge-ts 8.0.2 (GHSA-ggr8-5vv4-36mx). Dependency audits now run in CI.

### Changed
- Dashboard caches the email-status aggregate for 60 s per organization.
- Company normalization runs independent candidates in parallel (`NORMALIZE_CONCURRENCY`, default 8): candidates that could merge or look alike stay in one ordered group, and project caps stay exact. About 6x faster on imports.

### Upgrade
`scripts/backup.sh`, then `docker compose --profile crawler build && docker compose --profile crawler up -d`. The `migrate` service applies `20261118200000_promoted_candidate_evidence` and `20261118210000_staging_foreign_keys`. Rollback: restore the backup and redeploy the previous tag (migrations are forward-only).
