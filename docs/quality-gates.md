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

Each gate is a checklist with an owner and evidence link. CI + a manual sign-off row.

### G0 — Phase 0 go/no-go
- [ ] 50 companies crawled, zero policy incidents
- [ ] ≥ 15 with usable business email
- [ ] precision ≥ 85% on 25-email sample
- [ ] findings doc written, decision recorded in `decisions.md`

### G1 — Foundation
- [ ] clean-machine `docker compose up` < 2 min
- [ ] auth + RBAC tests green
- [ ] tenant-leak suite green (≥ 3 endpoints)
- [ ] CI green on a clean clone
- [ ] secret scan clean

### G2 — CRM
- [ ] 100k import < 10 min, resumable
- [ ] duplicate import is idempotent
- [ ] p95 list < 300ms at 100k
- [ ] audit row per mutation
- [ ] cursor pagination has no offset usage (lint check)

### G3 — Sources
- [ ] no target without approved source (test)
- [ ] budget caps enforced in worker
- [ ] policy change audited + versioned
- [ ] adapter contract tests for 2 adapters

### G4 — Crawler
- [ ] SSRF suite green in both languages, identical fixtures
- [ ] robots/`Crawl-delay` honored (20-domain test)
- [ ] 429 storm backoff verified
- [ ] artifact replay hash-identical
- [ ] 10k-URL fuzz: zero private-IP requests

### G5 — Extraction
- [ ] precision ≥ 90%, recall ≥ 70%
- [ ] zero trap promotions
- [ ] replay 1k pages < 5 min
- [ ] every promoted record has evidence (DB constraint)
- [ ] extractor version recorded on every candidate

### G6 — Verification
- [ ] status lattice tests exhaustive (allowed/forbidden transitions)
- [ ] NXDOMAIN / no-MX / timeout / catch-all distinguished
- [ ] stale status blocks sending
- [ ] `grep` test: no SMTP probe implementation

### G7 — Compliance
- [ ] default-deny matrix fully covered
- [ ] decisions append-only + versioned
- [ ] suppression takes effect immediately on queued campaign
- [ ] re-import stays suppressed
- [ ] unsubscribe token: forged/expired/replayed all rejected

### G8 — Campaigns
- [ ] ineligible recipient cannot be scheduled (test)
- [ ] snapshot immutable after schedule
- [ ] preview counts reconcile
- [ ] approval audited

### G9 — SMTP
- [ ] SPF/DKIM/DMARC pass on seed inboxes
- [ ] open-relay test rejected
- [ ] bounce → suppression ≤ 1 cycle
- [ ] warmup auto-pause works
- [ ] kill switch halts within 60s
- [ ] legal sign-off recorded for enabled jurisdiction

### G10 — Hardening
- [ ] p95 < 300ms at 1M rows
- [ ] restore drill RTO < 4h, RPO < 24h
- [ ] no critical/high security findings
- [ ] alerting tested via induced failure
- [ ] runbooks reviewed

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

- [ ] All phase gates for the target phase signed
- [ ] Migrations tested on a production-sized anonymized dump
- [ ] Changelog + docs updated
- [ ] `decisions.md` updated for any architectural change
- [ ] Rollback plan written (previous image tag + migration reversibility or forward-fix)
- [ ] Backup taken before deploy
- [ ] Post-deploy smoke: login, companies, geography, discovery projects, health endpoint
- [ ] Restore drill logged within the last quarter
