# LeadForge — Roadmap

Companion to [`MEGA-PLAN.md`](./MEGA-PLAN.md) §17. Estimates assume one full-time engineer, part-time legal review, and a working Ubuntu workstation.

**Rule:** a phase is done when its exit criteria pass, not when the calendar says so. If a phase overruns by more than 4 weeks, cut scope from the *next* phase, never quality from the current one.

---

## Phase 0 — Proving ground (weeks 1–2)

**Thesis being tested:** can we produce usable, evidenced contact records from public websites at a useful rate?

| Deliverable | Detail |
| --- | --- |
| Seed list | 50 real companies across 3 countries, mixed site quality |
| CLI harness | `python -m leadforge.probe fetch <url>` → artifact; `extract` → candidates; `verify` → status |
| Safety minimum | URL validator + SSRF denylist + robots check (even for the spike) |
| Measurement | pages fetched, emails found, valid-for-sending-basis candidates, false-positive sample |
| Golden seeds | 25 pages hand-labeled before the run, 25 after, to estimate precision |
| Write-up | `docs/phase-0-findings.md` with yield tables and a go/no-go |

**Exit criteria**
- 50 companies crawled without a single enforcement block or complaint.
- ≥ 15 companies with at least one usable business email.
- Hand-checked precision ≥ 85% on a 25-email sample.
- No unhandled SSRF/robots violation in the fixture suite.

**If it fails:** re-scope to directory-first sourcing (structured sources, less crawling) before building any UI.

---

## Phase 1 — Foundation (weeks 3–4)

| Area | Work |
| --- | --- |
| Monorepo | pnpm workspaces, Python `uv` workspace, shared lint/format/typecheck, CI |
| Infra | `docker-compose` with Postgres 16, Redis 7, MinIO; healthchecks; loopback-only ports |
| Database | Prisma schema v0.1 (org, user, company, domain, contact, email, source, evidence), RLS policies, seed |
| Auth | email+password (Argon2id), sessions, org bootstrap, RBAC skeleton |
| API shell | `/api/v1` structure, error envelope, Zod validation, request ids, audit hook |
| Web shell | Next.js app, layout, login, empty dashboard |

**Exit criteria**
- `docker compose up` → healthy stack in < 2 min on a clean machine.
- Login → dashboard works; unauthorized routes redirect.
- Tenant-leak test suite exists and passes on 3 sample endpoints.
- CI: typecheck, lint, unit tests, schema drift check.

---

## Phase 2 — CRM (weeks 5–6)

Companies, domains, contacts, emails CRUD; cursor pagination; CSV import (domains + companies) with idempotency; dedupe on domain/email; search (Postgres FTS); bulk actions; audit on mutations.

**Exit criteria**
- 100k-row CSV import completes < 10 min with a resumable error report.
- Duplicate domain import is a no-op (idempotency key verified).
- List endpoints return p95 < 300ms at 100k companies (seeded).
- Every mutation produces an audit row.

---

## Phase 3 — Sources + discovery (weeks 7–8)

Source registry with policy approval workflow; discovery projects (ICP criteria → targets); adapter interface; CSV domain adapter; one directory adapter; priority queue into Redis Streams; budget caps.

**Exit criteria**
- Cannot create a crawl target for a source with `permitted = false` (tested).
- Project budget caps enforced in the worker.
- Discovery run produces deduped targets and a yield report.
- Source policy change is audited and versioned.

---

## Phase 4 — Safe crawler (weeks 9–10)

HTTPX fetcher, robots cache, per-domain token bucket, redirect validation, content-type/size caps, artifact storage in MinIO (content-addressed, zstd), Playwright fallback, cooldown on 401/403/429, kill switch.

**Exit criteria**
- SSRF fixture suite green in Python and in the TypeScript guard.
- Robots disallow respected across 20 test domains; `Crawl-delay` honored.
- 429 storm test: worker backs off, no retry flood.
- Artifacts replay byte-identical (hash check).
- Zero requests to private IPs in a 10k-URL fuzz run.

---

## Phase 5 — Extraction (weeks 11–12)

Deterministic extractors (mailto, JSON-LD, DOM contact blocks, contact-page routing, footer), normalization pipeline, candidate staging, evidence writes, review queue UI, replay command, extractor versioning.

**Exit criteria**
- Golden set (500 pages): precision ≥ 90%, recall ≥ 70% for business emails.
- False-positive corpus (assets, widgets, examples, obfuscated script strings) yields zero promotions.
- Replay of 1,000 stored pages < 5 min.
- Every promoted record has ≥ 1 evidence row (DB constraint + test).

---

## Phase 6 — Verification (week 13)

Syntax validation, normalization, DNS/MX resolution with cache, status lattice, freshness TTL, bulk verification with Polars, verification UI.

**Exit criteria**
- Status transitions match the lattice; no path from MX to "deliverable".
- Missing MX, NXDOMAIN, timeout, catch-all suspected all classified distinctly.
- Re-verification job flags expired records; sending blocked on stale status.
- No SMTP probing code exists (grep test in CI).

---

## Phase 7 — Compliance (weeks 14–15)

Jurisdiction profiles (3 countries, DRAFT), eligibility engine, decision records, suppression management, unsubscribe tokens, DSR workflow skeleton, compliance UI (preview + explain).

**Exit criteria**
- Default-deny matrix fully covered by tests (unknown country, missing basis, stale decision, suppressed, role account, no unsubscribe config).
- Decisions are append-only and cite rule set version.
- Suppression applies immediately to a queued campaign.
- Re-import of suppressed address remains suppressed.

---

## Phase 8 — Campaign drafts (weeks 16–17)

Campaign builder, template variables, segment snapshots, eligibility preview, approval flow, dry-run recipient list, export.

**Exit criteria**
- A campaign with any `NOT_ELIGIBLE` recipient cannot be scheduled (tested).
- Recipient snapshot is immutable after scheduling.
- Preview counts reconcile with actual queue.
- Approval is audited with actor + timestamp.

---

## Phase 9 — SMTP, gated (weeks 18–20)

Postfix + OpenDKIM in Compose, submission auth, test-inbox delivery, DKIM/SPF/DMARC verification tooling, warmup state machine, bounce ingestion (DSN), unsubscribe handling, kill switch, send audit.

**Exit criteria**
- Seed inboxes (Gmail/Outlook/Yahoo) pass SPF, DKIM, DMARC alignment.
- Open-relay test rejected from an unauthenticated host.
- Bounce → suppression within one processing cycle.
- Warmup ramp pauses automatically at threshold breach.
- **No public production sending until legal sign-off on at least one jurisdiction profile.**

---

## Phase 10 — Hardening (weeks 21–24)

Load tests (1M contacts), query/index tuning, monitoring dashboards + alerts, backup/restore drills, pen-test pass, runbooks, retention jobs, documentation, MCP server (stretch).

**Exit criteria**
- p95 list query < 300ms at 1M contacts.
- Restore drill: RTO < 4h, RPO < 24h, verified by a real restore.
- Zero critical/high findings open from the security review.
- All SLOs instrumented, alerting tested by induced failure.

---

## Timeline shape

```
w1-2    Phase 0  ██
w3-4    Phase 1  ░░██
w5-6    Phase 2  ░░░░██
w7-8    Phase 3  ░░░░░░██
w9-10   Phase 4  ░░░░░░░░██
w11-12  Phase 5  ░░░░░░░░░░██
w13     Phase 6  ░░░░░░░░░░░░█
w14-15  Phase 7  ░░░░░░░░░░░░░██
w16-17  Phase 8  ░░░░░░░░░░░░░░░██
w18-20  Phase 9  ░░░░░░░░░░░░░░░░░███
w21-24  Phase 10 ░░░░░░░░░░░░░░░░░░░░████
```

Critical path: Phase 0 → 1 → 4 → 5 → 7 → 8. Phases 2/3/6 can overlap with 4/5 if the same person is not the bottleneck. Realistically, expect 25–30% schedule pressure from extraction quality tuning; that is normal and is why the golden set exists.

---

## v1 definition of done

An operator can: import domains → run discovery → crawl → review extracted candidates → promote companies/contacts → verify emails → see why each record is believed → build a segment → preview eligibility → export a clean CSV or create a campaign draft that is provably blocked from sending until compliance and SMTP gates pass.

That is a complete, defensible product even without a single outbound email.
