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

### Fixed
- API authentication failed when any cookie came before `lf_session` in the Cookie header.
- Saved segments and logout did not write audit rows.
- Logs could include database/Redis passwords from driver errors; crawler logs dropped tracebacks.
- Bounce-ingest key used a non-constant-time comparison.
- Normalization could stall: a paused project's backlog (or orphaned staging rows) filled every sweep batch, so newer candidates were never processed. The sweep now selects only rows of running or cancelled projects.
- Overlapping normalizers (several worker replicas, or the sweep and the discovery queue) could process the same staged record twice; the loser hit a unique-constraint error and overwrote the result with REJECTED. Each record is now claimed with a row lock, and records for the same domain or registration number are serialized with transaction-scoped advisory locks.
- Staged company records and domain events had no foreign keys, so deleting an organization or project left them behind. Added cascading keys (migration removes existing orphans first).
- Vulnerable dependencies: zod 4.6.7 (GHSA-mrhx-c7xc-m3w5), deepmerge-ts 8.0.2 (GHSA-ggr8-5vv4-36mx). Dependency audits now run in CI.

### Changed
- Dashboard caches the email-status aggregate for 60 s per organization.
- Company normalization runs independent candidates in parallel (`NORMALIZE_CONCURRENCY`, default 8): candidates that could merge or look alike stay in one ordered group, and project caps stay exact. About 6x faster on imports.

### Upgrade
`scripts/backup.sh`, then `docker compose --profile crawler build && docker compose --profile crawler up -d`. The `migrate` service applies `20261118200000_promoted_candidate_evidence` and `20261118210000_staging_foreign_keys`. Rollback: restore the backup and redeploy the previous tag (migrations are forward-only).
