# LeadForge — Backlog

Issue-level breakdown of the [roadmap](./roadmap.md). Sizes: **S** ≤ 1 day, **M** 2–3 days, **L** 4–5 days, **XL** > 1 week (should be split).

Labels: `phase/0`…`phase/10`, `area/{infra,api,web,db,crawl,extract,verify,compliance,mail,security}`, `kind/{feature,chore,bug,spike,test}`, `risk/{high,medium,low}`.

---

## Epic 1 — Repository & environment (Phase 1)

| ID | Title | Size | Acceptance |
| --- | --- | --- | --- |
| LF-001 | Scaffold monorepo (pnpm + uv workspaces, lint, format, typecheck) | M | `pnpm lint` and `ruff check` pass on a clean clone |
| LF-002 | CI pipeline (lint, typecheck, unit, build) | M | green on PR, < 10 min |
| LF-003 | Docker Compose: Postgres + Redis with healthchecks, loopback ports | S | `docker compose up -d` healthy in < 2 min |
| LF-004 | `.env.example` + config loader with boot validation | S | missing required var fails fast with a clear message |
| LF-005 | Make/Dev scripts: bootstrap, reset, seed, logs | S | one command from clone to running stack |
| LF-006 | ADR process + template | S | `docs/decisions.md` referenced from CONTRIBUTING |

## Epic 2 — Database & tenancy (Phase 1)

| ID | Title | Size | Acceptance |
| --- | --- | --- | --- |
| LF-010 | Prisma schema v0.1 (org, user, membership, company, domain, contact, email, source, evidence) | L | `prisma migrate dev` clean; seed idempotent |
| LF-011 | RLS policies + `app.organization_id` transaction helper | L | cross-org select returns zero rows in test |
| LF-012 | Tenant-leak test harness | M | suite covers every read endpoint added later |
| LF-013 | Cursor pagination helper + tests | S | stable ordering under concurrent inserts |
| LF-014 | Audit log + append-only grants | M | UPDATE/DELETE denied for app role |
| LF-015 | Migration policy + CI drift check | S | `prisma migrate diff` fails build on drift |

## Epic 3 — Auth & RBAC (Phase 1)

| ID | Title | Size | Acceptance |
| --- | --- | --- | --- |
| LF-020 | Local auth (Argon2id, sessions, lockout) | L | OWASP params, session rotation on login |
| LF-021 | Role model + `requireRole` guard + route lint | M | every mutating route asserts a role |
| LF-022 | First-run org bootstrap | S | creates org + owner atomically |
| LF-023 | API keys (scoped, hashed, revocable) | M | key shown once; revocation immediate |

## Epic 4 — CRM (Phase 2)

| ID | Title | Size | Acceptance |
| --- | --- | --- | --- |
| LF-030 | Companies CRUD + list/filter/search | L | p95 < 300ms at 100k rows |
| LF-031 | Domains + company-domain linking, unique constraints | M | duplicate domain rejected |
| LF-032 | Contacts + emails CRUD with evidence requirement | L | promote without evidence fails |
| LF-033 | CSV import (domains/companies) with idempotency + error report | L | 100k rows < 10 min, resumable |
| LF-034 | Postgres FTS + trigram search | M | search returns in < 200ms at 100k |
| LF-035 | Bulk actions + saved views | M | 500-row bulk op audited |

## Epic 5 — Sources & discovery (Phase 3)

| ID | Title | Size | Acceptance |
| --- | --- | --- | --- |
| LF-040 | Source registry + policy approval workflow | M | unapproved source cannot be crawled |
| LF-041 | Discovery project model + ICP criteria | L | project versioned, reproducible |
| LF-042 | Adapter interface + CSV domain adapter | M | contract tests for adapter |
| LF-043 | One directory adapter (spike → implement) | L | respects policy + rate limit |
| LF-044 | Redis Streams producer/consumer library (TS + Python) | L | at-least-once, DLQ, sweep |
| LF-045 | Budget caps + priority scheduling | M | caps enforced worker-side |

## Epic 6 — Crawler (Phase 4)

| ID | Title | Size | Acceptance |
| --- | --- | --- | --- |
| LF-050 | URL validator + SSRF guard (both languages, shared fixtures) | L | full adversarial corpus blocked |
| LF-051 | HTTPX fetcher with limits, retries, timeouts | L | 429/403 cooldown verified |
| LF-052 | robots.txt fetch/cache/honor | M | 20-domain conformance test |
| LF-053 | Per-domain token bucket + global semaphore | M | never exceeds configured concurrency |
| LF-054 | Content-addressed artifact storage in MinIO | L | replay hash-identical |
| LF-055 | Playwright fallback (JS detection only) | L | budget respected; no stealth flags |
| LF-056 | Kill switch + egress egress-only network policy | S | crawl stops < 60s |

## Epic 7 — Extraction (Phase 5)

| ID | Title | Size | Acceptance |
| --- | --- | --- | --- |
| LF-060 | Normalizer (case, IDN, mailto decode, obfuscation) | M | fixture suite passes |
| LF-061 | mailto + JSON-LD extractors | M | golden-set precision tracked |
| LF-062 | DOM contact-block + contact-page routing | L | precision ≥ 90% on golden set |
| LF-063 | False-positive filter (assets, widgets, examples, hidden nodes) | L | zero trap promotions |
| LF-064 | Candidate staging + review queue API | L | promote/reject audited |
| LF-065 | Review queue UI (keyboard, evidence drawer) | L | ≥ 20 records/min throughput |
| LF-066 | Replay CLI + golden-set regression job | M | 1k pages < 5 min |
| LF-067 | Ollama page-type + role classification (optional enrichment) | M | schema-validated; fallback works |

## Epic 8 — Verification (Phase 6)

| ID | Title | Size | Acceptance |
| --- | --- | --- | --- |
| LF-070 | Syntax + normalization verification | S | RFC edge cases covered |
| LF-071 | DNS/MX resolver with cache + retries | M | NXDOMAIN/no-MX/timeout distinguished |
| LF-072 | Status lattice + transition guard | M | illegal transitions impossible |
| LF-073 | Freshness TTL + re-verification scheduler | M | stale blocks send |
| LF-074 | Bulk verification with Polars | S | 100k < 15 min |
| LF-075 | Role/disposable/free-provider classification | S | labeled test set ≥ 95% |

## Epic 9 — Compliance (Phase 7)

| ID | Title | Size | Acceptance |
| --- | --- | --- | --- |
| LF-080 | Jurisdiction profile schema + loader + validator | L | invalid profile fails CI |
| LF-081 | Profiles for 3 countries (DRAFT) | M | counsel checklist attached |
| LF-082 | Eligibility engine + decision records | XL | default-deny matrix passes |
| LF-083 | Suppression management (global/org/domain) | L | immediate effect on queued campaign |
| LF-084 | Unsubscribe tokens + endpoint (signed, idempotent) | M | forged/expired/replayed rejected |
| LF-085 | DSR workflow (manual, audited, SLA) | M | overdue surfaced in dashboard |
| LF-086 | Compliance UI: preview + "why blocked" | L | every outcome explainable |

## Epic 10 — Campaigns (Phase 8)

| ID | Title | Size | Acceptance |
| --- | --- | --- | --- |
| LF-090 | Segment builder + snapshot | L | immutable after scheduling |
| LF-091 | Campaign builder + template variables | L | preview renders correctly |
| LF-092 | Eligibility preview + batch exclusion | M | ineligible cannot be queued |
| LF-093 | Approval flow (four-eyes when available) | M | audited approvals |
| LF-094 | Frequency caps | S | second send within window blocked |

## Epic 11 — SMTP (Phase 9, gated)

| ID | Title | Size | Acceptance |
| --- | --- | --- | --- |
| LF-100 | Postfix + OpenDKIM compose stack | L | seed inbox auth pass |
| LF-101 | SMTP provider interface + test mode | M | test mode only allowlisted |
| LF-102 | DKIM/SPF/DMARC verification tooling | M | report per domain |
| LF-103 | Warmup state machine + auto-pause | L | respects per-ISP caps |
| LF-104 | DSN/ARF ingestion + bounce classification | L | hard bounce → suppression ≤ 1 cycle |
| LF-105 | Kill switch + volume anomaly alert | S | halts < 60s |
| LF-106 | Open-relay regression test | S | rejected from unauthenticated host |

## Epic 12 — Hardening (Phase 10)

| ID | Title | Size | Acceptance |
| --- | --- | --- | --- |
| LF-110 | Load test at 1M contacts + index tuning | L | p95 < 300ms |
| LF-111 | Monitoring stack (Prometheus/Grafana/Loki) + alerts | L | induced failure triggers alert |
| LF-112 | Backup/restore automation + drill | L | RTO < 4h verified |
| LF-113 | Retention/purge jobs with dry-run | M | legal holds respected |
| LF-114 | Security review + pen-test fixes | L | no critical/high open |
| LF-115 | Runbooks + on-call doc | M | every alert has a runbook |
| LF-116 | MCP server (stretch) | L | read-only tools; eligibility enforced |

---

## Suggested first 10 issues

1. LF-001 monorepo scaffold
2. LF-003 compose stack
3. LF-010 Prisma schema
4. LF-011 RLS
5. LF-020 auth
6. LF-042 CSV adapter (Phase 0 uses a file, not the adapter)
7. LF-050 SSRF guard
8. LF-051 fetcher
9. LF-060 normalizer
10. LF-061 mailto/JSON-LD extractors

Phase 0 spike items are intentionally *not* tracked as product issues; they live in `docs/phase-0-findings.md` so throwaway code does not pollute the backlog.

---

## Creating these in GitHub

```bash
gh label create "phase/1" --color BFD4F2
gh issue create --title "LF-001 Scaffold monorepo" \
  --body "Acceptance: pnpm lint and ruff check pass on a clean clone." \
  --label "phase/1,area/infra,kind/chore"
```

Keep the ID in the title so commits, ADRs, and docs can reference a stable key.
