# LeadForge — Quality Gates & Test Strategy

Companion to [`MEGA-PLAN.md`](./MEGA-PLAN.md) §16. No phase ships on vibes.

---

## 1. Test layers

| Layer | Scope | Tooling | Runs |
| --- | --- | --- | --- |
| Unit | pure functions: validators, normalizers, parsers | Vitest / pytest | every commit |
| Contract | TS ↔ Python job payloads, API schemas | JSON Schema diff + Pydantic/Zod | every commit |
| Integration | DB + Redis + MinIO with real containers | testcontainers / compose | every PR |
| Golden set | extraction + verification quality | labelled corpus | every PR touching extraction, nightly |
| Adversarial | SSRF, XSS, injection, malformed input | fixture suites | every PR |
| E2E | browser flows: login → import → review → campaign | Playwright | every PR (smoke), nightly (full) |
| Load | 1M contacts, 10k crawl targets | k6 + seeded DB | per phase release |
| Restore | backup → fresh host → verify | scripted | per phase release |

Coverage targets are not the goal; **the golden set and adversarial suites are the real gates.** A 90% coverage number with a broken extractor is worthless.

---

## 2. Golden set methodology

- **Corpus**: 500 pages across 8 archetypes — corporate homepage, contact page, team page, footer-only, JS-rendered SPA, German `Impressum`, French `mentions légales`, directory profile.
- **Labels**: per page, a list of `(email, company, person?, role?)` that a human confirms by eye, plus a list of explicit traps.
- **Trap categories**: `logo@2x.png`, `example@example.com`, `sentry@vendor.com`, `wixpress.com`, `u003e` escapes, `[at]` obfuscation, Cloudflare `data-cfemail`, base64 in script, hidden `display:none` blocks, iframe-only content, third-party chat widget addresses.
- **Metrics**: precision (promoted candidates that are genuinely on-page and belong to the company) and recall (labelled emails found). Both reported per extractor version.
- **Thresholds**: precision ≥ 90%, recall ≥ 70% for v1; no regression > 2 points without an approved explanation.
- **Ownership**: golden set lives in `tests/golden/` with a labeling sheet; changes require a second reviewer.

---

## 3. Phase gates

Status for the 0.2.0 discovery release (2026-11-18). Every checked item names its evidence; CI runs the automated ones on every push.
Items that need real-world data, a legal decision or a person are listed separately under **Operator sign-off**, and campaign/SMTP gates (G7–G9) belong to the separate Phase 9 release (ADR-0020).

### G1 — Foundation
- [x] clean-machine `docker compose up` < 2 min: stack healthy 27 s after `up` (images build in 108 s; CI `docker` job)
- [x] auth + RBAC tests green (`api.integration.test.ts`, `discovery.integration.test.ts`: bad password, unauthenticated, analyst cannot re-queue policy stops)
- [x] tenant-leak suite green, 4 resource types × detail/list/update/delete with two real sessions (`tenant-isolation.integration.test.ts`)
- [x] CI green on a clean clone: green on `main`; for this branch every job was reproduced locally on 2026-11-18 (all suites, audits, drift, promtool, image build and smoke). Confirm the GitHub run when the branch is pushed
- [x] secret scan clean (`scripts/secret-scan.mjs`, CI `secrets`)

### G2 — CRM
- [x] 100k import < 10 min, resumable: 100,000 rows staged in 8.8 s and normalized in 525 s (8.9 min total, all created; the 50,000 left pending after a simulated crash resumed) (`apps/worker/scripts/import-load-test.ts`; staged rows survive a crash and the worker resumes them)
- [x] duplicate import is idempotent (idempotency key; `imports a CSV idempotently`; domain merge on re-import)
- [x] p95 list < 300 ms at 100k: every list query under 5 ms ([performance](./performance.md))
- [x] audit row per mutation (`audit-coverage.test.ts`: every mutating route audits or is exempted with a reason)
- [x] cursor pagination has no offset usage (`scripts/check-pagination.mjs`, CI)

### G3 — Sources
- [x] no target without approved source (`test_unapproved_sources_never_run`, `refuses to start with only an unreviewed source`)
- [x] budget caps enforced in worker (page budget in `crawler.py`, `budget_reached`; project company cap in normalization, exact under concurrency)
- [x] policy change audited + versioned (`policyVersion` on sources and on every observation; approval requires terms, permitted use and access confirmation, tested)
- [x] adapter contract tests for 2 adapters (`domain_list`, `open_dataset`, `osm_overpass` in `tests/test_sources.py`)

### G4 — Crawler
- [x] SSRF suite green (`test_safety.py`, `test_net.py`: connection-time pinning, rebinding, redirects). The TypeScript side makes no outbound fetches since crawling moved to Python (ADR-0021), so one suite covers it
- [x] robots/`Crawl-delay` honored (`test_replay.py` parses agent-specific delays and RFC 9309 status handling; the crawler waits `max(project delay, Crawl-delay)`; integration test skips a robots-disallowed page)
- [x] 429 storm backoff verified (401/403/429/CAPTCHA are policy stops, never retried, domain cooldown 24 h; `test_net.py`, alert `LeadForgePolicyStopsSpike`)
- [x] artifact replay hash-identical (`test_artifact_replay_is_hash_identical`)
- [x] 10k-URL fuzz: zero private-IP requests (`tests/test_ssrf_fuzz.py`)

### G5 — Extraction
- [x] precision ≥ 90%, recall ≥ 70% (`test_golden_set_meets_quality_gate`, CI)
- [x] zero trap promotions (same test asserts `traps_hit == []`)
- [x] replay 1k pages < 5 min (`test_replay_is_fast_enough_for_1k_pages`)
- [x] every promoted record has evidence (DB constraint `ExtractionCandidate_promoted_has_evidence`; `SourceEvidence.pageUrl` NOT NULL; alert on contacts without evidence)
- [x] extractor version recorded on every candidate (`extractorVersion` NOT NULL on runs and evidence)

### G6 — Verification
- [x] status lattice tests (`keeps DNS and MX states separate`, compliance engine tests)
- [x] NXDOMAIN / no-MX / null-MX / implicit-MX / DNS error or timeout distinguished (`keeps DNS and MX states separate`); catch-all cannot be detected without probing, so no status ever claims a mailbox exists (`summarizes without claiming mailbox existence`)
- [x] stale status blocks sending (`blocks stale verification`, `expires eligible decisions after 24 hours`)
- [x] `grep` test: no SMTP probe implementation (`tests/test_invariants.py`)

### G10 — Hardening
- [x] p95 < 300 ms at 1M rows: list and search queries under 50 ms; the one aggregate near 300 ms is cached per minute ([performance](./performance.md#one-million-companies))
- [x] restore drill RTO < 4 h, RPO < 24 h ([runbooks](./runbooks.md#restore-drill-log); nightly backups)
- [x] no critical/high security findings (`pnpm audit --prod`, `pip-audit` clean and enforced in CI; [security checklist](./security.md))
- [x] alerting tested via induced failure (`infrastructure/monitoring/alerts.test.yml`, promtool in CI)
- [x] runbooks reviewed (2026-11-18, with this release)

### Operator sign-off (needs real data or a person; cannot be done in code)
- G0 Phase 0 spike on real domains: 50 companies, zero policy incidents, ≥ 15 usable business emails, precision ≥ 85% on 25 emails, findings recorded ([phase-0-spike](./phase-0-spike.md)). Tooling is ready: `python -m leadforge.spike`.
- Pick and approve a registry dataset for your markets (licence review); import wider GeoNames coverage.
- Extend the AI classification set with real labelled companies before relying on its accuracy figure.
- Production checklist in [deployment](./deployment.md#10-production-checklist) (secrets, TLS, user agent, backups, retention).

### Phase 9 release (frozen, ADR-0020)
G7 compliance, G8 campaigns and G9 SMTP gates apply when campaigns are approved after legal review. Already in place and tested: the default-deny eligibility matrix, immediate suppression, re-import stays suppressed, signed one-click unsubscribe, ineligible recipients cannot be scheduled.

---

## 4. Acceptance matrix (expanded from the specification)

| # | Test | Expected |
| --- | --- | --- |
| 1 | CSS/JS string resembling an email | rejected |
| 2 | URL-encoded `mailto:` | correctly decoded + normalized |
| 3 | Duplicate emails across pages | one email row, multiple evidence rows |
| 4 | Third-party widget email | not associated with the company |
| 5 | Private IP target | blocked |
| 6 | Redirect to internal IP | blocked |
| 7 | HTTP 429 | domain cooldown, no retry flood |
| 8 | Missing MX | classified, not deliverable |
| 9 | Catch-all domain | never claimed as verified inbox |
| 10 | Unsubscribe | immediate global suppression |
| 11 | Unknown recipient country | campaign blocked |
| 12 | Re-import suppressed email | remains suppressed |
| 13 | SMTP open relay | rejected |
| 14 | Database restore | successful, row counts match |
| 15 | Cross-organization access | 404 |
| 16 | LLM returns invented email | rejected by schema + provenance check |
| 17 | Prompt injection text in page | classification unaffected, no action taken |
| 18 | CSV cell starting with `=` | escaped on export |
| 19 | Stale eligibility decision | send blocked, re-evaluated |
| 20 | Campaign paused mid-run | no sends after pause within one batch |
| 21 | Duplicate job delivery | idempotent, single side effect |
| 22 | Artifact replay | identical candidates for same extractor version |

---

## 5. CI pipeline

`.github/workflows/ci.yml`, all jobs required:

| Job | Checks |
| --- | --- |
| node | install, Prisma generate, migrations on PostGIS, **schema drift check**, reference data + seed, typecheck, compliance and pipeline unit tests, API integration tests, worker integration tests, production build |
| python | ruff, mypy (strict), all migrations via psql, pytest (SSRF/rebinding, extraction, adapters, AI grounding, crawl + discovery integration, **golden-set precision gate**) |
| compose | config validity for all profiles and the dev overlay |
| docker | build all images, start the stack with the crawler, health, seed, API smoke (geography, taxonomy, projects, metrics auth, campaigns frozen = 404), crawler running |
| secrets | tracked-tree secret scan |

Fail-closed: no merge on red. Run `node scripts/load-test.mjs` before releases that touch queries or indexes.

---

## 6. Release checklist

0.2.0 (2026-11-18):

- [x] All phase gates for the target phase signed (section 3; operator items listed there)
- [x] Migrations applied in CI on a fresh database and on the development database with existing data; this release adds a CHECK constraint and staging foreign keys, each validated against existing rows (the foreign-key migration removes orphans first)
- [x] Changelog + docs updated ([CHANGELOG](../CHANGELOG.md))
- [x] `decisions.md` updated for any architectural change (ADR-0025)
- [x] Rollback plan written (deployment §9: restore the pre-upgrade backup, redeploy the previous tag; migrations forward-only)
- [x] Post-deploy smoke: login, companies, geography, discovery projects, health endpoint (CI `docker` job; same script run locally)
- [x] Restore drill logged within the last quarter ([runbooks](./runbooks.md#restore-drill-log))
- Per deployment (operator): backup taken before deploy (`scripts/backup.sh`), and the upgrade rehearsed on a copy of production once one exists (deployment §9)
