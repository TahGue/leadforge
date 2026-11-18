# LeadForge — Mega-Plan

**Version:** 1.0 · **Status:** Approved for Phase 0 · **Date:** 2026-11-18
**Owner:** Founding engineer · **Target:** self-hosted B2B lead intelligence, 1M+ contacts

---

## How to read this document

This is the controlling plan. Everything else elaborates on it:

| Document | Question it answers |
| --- | --- |
| [`architecture.md`](./architecture.md) | How do the processes fit together? |
| [`data-model.md`](./data-model.md) | What is stored, and what invariants hold? |
| [`compliance.md`](./compliance.md) | When is data allowed to be processed and mailed? |
| [`roadmap.md`](./roadmap.md) | In what order, with what exit criteria? |
| [`security.md`](./security.md) | What can go wrong, and what stops it? |
| [`quality-gates.md`](./quality-gates.md) | What must be true before a phase ships? |
| [`decisions.md`](./decisions.md) | Why were the big choices made? |
| [`backlog.md`](./backlog.md) | What are the concrete work items? |
| [`open-questions.md`](./open-questions.md) | What still needs a human decision? |

If a supporting document contradicts this one, this one wins until an ADR amends it.

---

## 0. TL;DR

1. **The hard problem is not the dashboard.** It is producing a contact record that is accurate, evidenced, deduplicated, legally gated, and fresh — repeatedly, at volume, without paid APIs.
2. **Five bets** define the product (Section 2): evidence-first data, replayable pipeline, compliance-as-code, honest deliverability, and an agent-ready API.
3. **Build the engine before the CRM.** Phase 0 is a two-week spike that crawls 50 real companies end-to-end and measures yield. If yield is bad, the whole product thesis changes — find that out before writing UI.
4. **v1 is deliberately small:** import domains → crawl → extract → verify → review → suppress → draft a campaign with an eligibility preview. No outbound mail to the public internet in v1. That is a Phase 8 gate.
5. **The non-negotiable line:** discovering an email never authorizes contacting it. Discovery, eligibility, and delivery are three separate systems with three separate data models.

---

## 1. What LeadForge is — and is not

### It is

A **self-hosted lead intelligence system**: it discovers companies from permitted public sources, extracts business contact data with provenance, verifies what can be verified, stores it in a queryable CRM, and drives compliant outreach from the same database.

A **data-ownership play**. Every record lives in your Postgres. Every field can be traced to the URL, fetch time, and content hash it came from. Export is a first-class feature, not a hostage negotiation.

An **evidence engine**. Competitors sell rows; LeadForge sells rows plus "why should I believe this row, and when was it last true?"

### It is not

- A bulk email cannon. Volume without permission is how domains die.
- A stealth scraper. No residential proxy rotation, no CAPTCHA solving, no login-wall bypass, no robots.txt evasion. Those "features" are business-ending liabilities, not features.
- A data marketplace. No reselling of third-party personal data.
- A real-time intent-data product (job postings, funding, tech-install signals). That is a v2+ layer with different sourcing and legal questions.
- A multi-tenant SaaS on day one. The schema is org-scoped from the first migration so it *can* become one; v1 runs single-org.

---

## 2. The enhanced thesis — five bets

The original specification is a good component inventory. A component inventory is not a strategy. These five bets are what make the inventory worth building.

### Bet 1 — Provenance is the product

Most lead databases degrade because nobody can tell where a value came from or whether it is still true. LeadForge makes provenance structural:

- No field is stored without a `source_evidence` row (URL, fetch timestamp, content hash, extractor version).
- Every contact has a **confidence score** derived from evidence type, recency, and corroboration count.
- The UI always answers "why do we believe this?" and "when did we last see it?"
- Stale data is *marked* stale, never silently served as fresh.

Consequence for the schema: `evidence` is not a side table, it is the spine. Extraction writes candidates; promotion writes records *with* evidence in the same transaction.

### Bet 2 — Replay beats re-crawl

Crawling is expensive, slow, and rate-limited. Extraction logic will change fifty times. Therefore raw pages must be stored immutably (content-addressed, compressed, TTL'd), and the pipeline must be re-runnable from stored pages without touching the network.

- New extractor version → replay the last N days of stored HTML → measure precision change before deploying.
- Parser bug → reprocess, don't re-crawl.
- This turns extraction quality into a measurable, iterable engineering problem instead of a guess.

### Bet 3 — Compliance is executable, not a policy PDF

"Default deny" is only real if it is code with tests. LeadForge ships a **jurisdiction profile engine**: data-driven rules per country/region, an immutable eligibility decision record per send, and an explainability API that says exactly which rule blocked a recipient.

- Rules are versioned artifacts. Every decision cites `rule_set_version`.
- Re-evaluation is mandatory immediately before send; a decision older than 24h is invalid.
- Legal review changes a profile, not a codebase.

### Bet 4 — Deliverability is an engineering discipline, not a checkbox

Self-hosted SMTP is where naive builds die: bad IP reputation, missing PTR, no warmup, no complaint feedback loop, no bounce classification. LeadForge treats sending as a system with its own state machine (domain, IP, warmup day, per-ISP rate, reputation signals) rather than a `sendmail()` call.

- Provider interface (`SmtpProvider`) so an ESP can be swapped in without touching campaign logic.
- Honest scope: v1 sends to internal test inboxes only; public sending is gated behind warmup + authentication proof.

### Bet 5 — The lead graph is agent-ready

The most valuable 2026+ integration surface is not a CSV export. It is a local MCP server + typed REST API so a user's own agents can query the lead graph, draft outreach, and propose segments — with the same eligibility gate enforced server-side.

This is a differentiator incumbents structurally cannot copy: their data is their moat; ours is the user's.

### What we deliberately reject

| Temptation | Why not |
| --- | --- |
| Scrape LinkedIn / gated networks | ToS violation, account bans, legal exposure |
| SMTP mailbox probing to "verify" inboxes | Unreliable, abusive, gets IPs blocklisted |
| Rotating residential proxies | Evasion; contradicts source policy and reputation strategy |
| LLM-generated emails/companies | Hallucinated contacts destroy trust and can create legal exposure |
| Buying a data dump to seed the DB | No provenance, no lawful basis, poisoned dataset |
| Microservices from day one | 12 services × 1 developer = zero features shipped |

---

## 3. Non-negotiable principles

1. **Evidence or it does not exist.** Every promoted field has provenance.
2. **Discovery ≠ permission.** Separate stores, separate services, separate approval gates.
3. **Default deny.** Unknown jurisdiction, missing basis, missing suppression check → blocked.
4. **Robots and source policy are enforced in code**, with a per-source `permitted` flag that defaults to false.
5. **The LLM never authors facts.** It classifies, normalizes, and ranks. It cannot create an email address, a company, or an eligibility decision.
6. **Idempotency everywhere.** Deterministic keys; replays must not duplicate rows or double-send.
7. **Every mutation is auditable.** Immutable audit log; no update/delete privileges for the app role on it.
8. **No secret in the repo, no port on the public internet.** Postgres/Redis/MinIO bind to loopback or a private Docker network.
9. **Freshness is visible.** Age is a first-class attribute in UI and API.
10. **Kill criteria are written before the feature is built** (Section 19).

---

## 4. Users and jobs to be done

**Primary persona — the operator (you).** Runs a small agency or a founder-led sales motion. Needs 200–2,000 qualified companies per month in a niche, with contact routes that survive reply-rate scrutiny. Cares about: source control, cost per lead, "can I actually email this?"

**Secondary persona — the analyst.** Reviews extraction output, resolves duplicates, approves records. Cares about: throughput, keyboard shortcuts, diff views, batch actions, clear confidence signals.

**Tertiary persona — the engineer/integrator.** Consumes the API/MCP server. Cares about: stable contracts, pagination, idempotency, webhooks, OpenAPI schema.

| Job | Success looks like |
| --- | --- |
| "Find companies like my best customers" | ICP definition → discovery project → 500 candidates in a day |
| "Get me a real person or a real inbox" | Contact with role, name where public, verified domain/MX, confidence ≥ threshold |
| "Don't let me spam people" | Eligibility preview blocks the bad 30% before a campaign exists |
| "Prove where this came from" | One click → source URL, snapshot, timestamp, extractor version |
| "Keep it fresh" | Re-crawl scheduler flags records older than N days |
| "Use it from my own tools" | API key + MCP server + webhooks |

---

## 5. Scope ladder

### v0 — Proving ground (2 weeks)

Crawl a fixed list of 50 domains, extract emails/companies, verify, write evidence. CLI + notebook only. **Purpose:** measure real-world yield and decide whether the thesis holds.

### v1 — Usable single-operator system (≈14 weeks)

Auth, companies, contacts, domains, CSV import, source registry, discovery projects, crawler, extractor, evidence + review queue, verification, suppression, jurisdiction profiles for a small set, eligibility preview, campaign drafts, CSV export. **No public sending.**

### v1.5 — Send-capable

Postfix integration, test-inbox delivery, DKIM/SPF/DMARC verification tooling, bounce ingestion, unsubscribe tokens, warmup scheduler, campaign send.

### v2 — Scale + intelligence

OpenSearch, ICP scoring, saved searches + alerts, entity resolution at 1M scale, MCP server, webhooks, multi-org, RBAC, audit exports, re-verification scheduler, segment builder.

### Later / maybe

Signal layer (hiring, tech stack, funding), outreach copilot (local drafting), CRM sync (HubSpot/Salesforce), data-subject request portal, BIMI, deliverability seed testing.

### Never

Login-wall bypass, CAPTCHA solving, proxy rotation for evasion, SMTP probing, LLM-fabricated data, third-party data resale.

---

## 6. Architecture at a glance

```
                       ┌──────────────────────────────┐
                       │  web (Next.js App Router)    │
                       │  dashboard · review · campaigns│
                       └──────────────┬───────────────┘
                                      │ typed fetch / RSC
                       ┌──────────────▼───────────────┐
                       │  api (Next.js route handlers)│
                       │  authz · zod · prisma · audit│
                       └───┬──────────┬──────────┬────┘
                           │          │          │
             ┌─────────────▼──┐  ┌────▼─────┐  ┌─▼──────────────┐
             │ Postgres       │  │ Redis    │  │ MinIO (pages)  │
             │ source of truth│  │ streams  │  │ content-addr.  │
             └───────▲────────┘  └────┬─────┘  └────────────────┘
                     │                │ consumer groups
     ┌───────────────┴────────────────┴───────────────────────────┐
     │  Python workers: discovery · crawl · extract · verify      │
     │  Node workers: campaign · mail-ingestion                   │
     └───────────────┬───────────────────────────────────────────┘
                     │
        ┌────────────▼─────────────┐   ┌──────────────────────┐
        │ Ollama (classification)  │   │ Postfix + OpenDKIM   │
        │ never authors facts      │   │ v1.5+, gated         │
        └──────────────────────────┘   └──────────────────────┘
```

### 6.1 The event spine

Two distinct mechanisms, deliberately:

- **Commands (work to do)**: Redis Streams with consumer groups. At-least-once delivery, explicit ack, retry with backoff, dead-letter stream. Used for `crawl.fetch`, `extract.page`, `verify.email`, `campaign.send`.
- **Facts (what happened)**: Postgres `domain_events` written in the same transaction as the state change (transactional outbox). Used for audit, analytics, integrations, and rebuilding derived state.

Why not one mechanism? BullMQ is excellent inside Node but awkward to consume from Python; Redis Streams are natively understood by both and give us durable consumer groups. Why not Kafka? Operational overkill at this scale; Redis is already required.

### 6.2 Replayability contract

Every pipeline artifact is addressable and immutable:

```
fetch(page)   -> fetch_artifact  (url, status, headers_hash, body_sha256, stored_at)
extract(fetch)-> extraction_run  (extractor_version, model_version, candidates[])
promote(cand) -> company/contact/email + evidence rows (same transaction)
```

Re-running `extract` over `fetch_artifact` is a supported operation with a dedicated CLI and a golden-set regression check.

### 6.3 Language boundary

- **TypeScript**: web, API, business rules, campaign engine, compliance evaluation (it is rule logic and belongs next to the data).
- **Python**: crawling, parsing, extraction, verification, bulk data ops (Polars), NLP/LLM calls.
- **Contract**: JSON Schema generated from Zod, checked into `packages/shared/contracts`, consumed by Pydantic models. Contract tests on both sides in CI.

---

## 7. The pipeline, stage by stage

### 7.1 Discovery — "what should we look at?"

Input: ICP definition or explicit domain list.
Output: prioritized `crawl_target` rows: url, source_id, priority, reason, dedupe key (canonical URL hash).

- Adapters implement a narrow interface: `search(query, cursor) -> [Candidate]`, plus `policy()` metadata.
- Registry order: user CSV (P0) → company websites (P0) → directories (P1) → permitted search APIs (P1) → public registries (P2).
- Discovery never claims facts. A search result is a hint with a URL; only a fetch can produce evidence.
- Budget: each project has `max_targets`, `max_pages_per_domain`, `max_depth`. Hard caps enforced in the worker, not the UI.

### 7.2 Crawl — "fetch safely, once"

The crawler is the most dangerous component in the system (SSRF, abuse complaints, resource exhaustion). Design it defensively:

- URL validation before every request *and* after every redirect: scheme allowlist (http/https), no credentials in URL, no non-standard ports, no IP literals unless explicitly allowed, block private/loopback/link-local/CGNAT/multicast/metadata ranges (169.254.169.254, ::1, fc00::/7, etc.).
- **DNS pinning**: resolve once, validate all resolved IPs, connect to the validated IP with the original Host header — defeats DNS rebinding.
- Per-domain token bucket + global semaphore; `max_concurrent_domains=10`, `1` per domain, 2s delay default, jittered.
- Robots: fetch and cache `robots.txt` per domain (TTL 24h), honor `Disallow`/`Crawl-delay`, identify a real UA with contact URL.
- HTTP first; Playwright only when a JS signal is detected (empty body, framework shell, `<noscript>` hint) and budget remains.
- Stop conditions: 401/403/429/451/paywall/CAPTCHA → mark domain cooldown, never retry aggressively.
- Size caps (2 MB), timeout (20s HTTP / 45s browser), redirect cap (10), content-type allowlist.
- Raw body stored content-addressed (sha256) + zstd in MinIO; `fetch_artifact` row holds metadata. TTL default 90 days, configurable.

### 7.3 Extraction — "turn bytes into candidates"

Deterministic first, AI last:

1. `mailto:` links (decode, strip query/fragment/tracking params).
2. JSON-LD / Schema.org (`Organization`, `ContactPoint`, `email`).
3. Visible contact blocks (regex + DOM heuristics, obfuscation handling: `[at]`, `&#64;`, Cloudflare email protection decode).
4. Contact/about/team/impressum pages (routed by URL + link text, multi-locale: kontakt, contacto, impressum, mentions légales).
5. Footer/structured microdata.
6. Ollama classification of *page type* and *role/seniority* — never to generate or repair an address.

Guards against classic false positives:

- Skip emails inside `<script>`, `<style>`, comments, hidden nodes.
- Reject asset filenames (`logo@2x.png`), example/test domains, placeholder addresses (`noreply@`, `sentry@`, `wixpress.com`), third-party widget vendors (Intercom, HubSpot, Calendly, Shopify) unless page is that vendor's own site.
- Deduplicate by normalized address; record every occurrence as evidence but promote once.
- Every candidate carries: extractor version, method, DOM path/selector, surrounding text snippet, confidence.

### 7.4 Verification — "how much do we actually know?"

Statuses are a lattice, not a boolean, and are never conflated:

`DISCOVERED → SYNTAX_VALID → DNS_VALID → MX_VALID → (DELIVERABILITY_UNKNOWN) → SUPPRESSED | UNDELIVERABLE`

- Syntax: RFC-compliant validator + strict normalization (lowercase domain, preserve local-part case only if meaningful, IDN → punycode for DNS, Unicode → NFC).
- DNS: A/AAAA and MX with timeout, retry, and caching; implicit MX (A record fallback) handled explicitly.
- No SMTP probing. Ever. MX does not prove an inbox exists, and probing burns reputation.
- Enrichment signals kept separate from verification: disposable-domain list, role-account classification (`info@`, `sales@` = generic business), free-provider flag, domain age, pattern inference (`first.last@` inferred → labeled **INFERRED**, never eligible without review).
- Freshness TTL: re-verify MX every 90 days; re-crawl high-value domains every 30–90 days.

### 7.5 Review & promotion — "humans where it matters"

- Candidate records land in a **review queue** with a confidence score and reason codes.
- Bulk actions, keyboard-first, side-by-side evidence drawer (render sanitized text, never raw HTML).
- Auto-promote only above a high threshold for low-risk types (generic business inbox on a corporate domain with MX + corroboration ≥ 2); everything personal goes to review in v1.
- Promotion is transactional and writes evidence rows; rejection records a reason (feeds extractor tuning).

### 7.6 Compliance gate — see Section 9.

### 7.7 Campaign & send — see Section 10.

---

## 8. The data core

Full detail in [`data-model.md`](./data-model.md). The invariants that matter:

1. **Org-scoped everything.** Every business table carries `organization_id`; Postgres RLS enforces it in addition to app filters. A missing org filter must fail closed, not leak.
2. **Domain is an entity, not a string.** `domains` owns crawl state, robots cache, policy, cooldown, reputation. `company_domains` links company↔domain (unique domain).
3. **Emails are global-ish, contacts are org-scoped.** `email_addresses.normalized` is globally unique (dedupe across orgs), while `contacts`/`companies` are org-owned. Evidence and verification attach to the email, eligibility attaches to (org, email, campaign).
4. **Candidates are separate from records.** `extraction_candidates` is an append-only staging table; promotion creates `contacts`/`email_addresses` rows. This keeps the crawler from writing directly into the CRM.
5. **Eligibility decisions are immutable and expiring.** `eligibility_decisions` rows are append-only with `rule_set_version`, `inputs_hash`, `expires_at`.
6. **Suppression is org-wide and permanent until explicitly lifted**, checked at send time and at list-build time.
7. **Audit log is append-only**, partitioned monthly, with no UPDATE/DELETE for the app role.

Partitioning and indexing plan (hit at scale, designed now): `email_events`, `audit_logs`, `fetch_artifacts`, `extraction_candidates` partitioned by month; BRIN on time columns; GIN trigram on `companies.name`; btree on `(organization_id, created_at desc)` for cursor pagination.

---

## 9. Compliance-as-code

Full detail in [`compliance.md`](./compliance.md). The engine:

```
evaluate(org, email, campaign_context) -> {
  outcome: ELIGIBLE | NOT_ELIGIBLE | NEEDS_REVIEW | SUPPRESSED | UNKNOWN_JURISDICTION,
  rule_set_version, reasons[], required_actions[], expires_at
}
```

Design rules:

- **Three separate questions**, never merged: (a) may we collect/store this? (b) may we process it for this purpose? (c) may we send marketing to it now?
- Jurisdiction is resolved from domain TLD + company country + recipient entity type; ambiguity → `UNKNOWN_JURISDICTION` → block.
- Corporate vs individual recipient is a first-class distinction (PECR corporate subscriber, Swedish Marketing Act natural-person consent rule, CAN-SPAM's broader commercial-email scope).
- Every campaign requires a documented lawful basis and a balancing assessment where legitimate interest is used.
- Sender identity, physical address, and a functioning one-click unsubscribe are structural requirements, not template suggestions.
- All rule profiles are **draft pending counsel review**; enabling a country requires a signed-off profile version (see `open-questions.md`).

**Default-deny matrix:** missing country, missing basis, missing suppression check, unverified domain, stale decision, generic role account without org-level basis, or any open objection → block.

---

## 10. Deliverability engineering

The part most self-hosted lead tools get catastrophically wrong. v1.5 scope:

- **Identity**: dedicated subdomain for cold outreach (e.g. `outreach.example.com`), separate from transactional; SPF, DKIM (2048-bit), DMARC `p=none` → `quarantine` → `reject` progression with reporting.
- **Network**: static IP with matching PTR/A, port 25 outbound, TLS, no residential IP, no shared IP with other senders.
- **Warmup state machine**: day 1: 20 sends to engaged/internal, ramp schedule, per-ISP caps (Google/Microsoft/Yahoo separated), automatic pause on bounce/complaint threshold breach.
- **Reputation gates**: hard bounce < 2%, complaint < 0.1%, spam-trap hits = 0 → else auto-pause campaign and surface an incident.
- **Hygiene**: sunset policy for unengaged recipients, re-verification before large sends, no purchased lists, seeded test inboxes (Gmail/Outlook/Yahoo) before first send.
- **Content linting**: local rule set (link ratio, image/text ratio, spammy phrases, tracking pixel sanity), no external spam-score API dependency.
- **Bounce classification**: parse DSNs (5.x.x hard, 4.x.x soft), map to suppression, feed back into verification status.
- **FBL/complaint loop**: ARF parsing at `mail-ingestion`, immediate suppression, campaign incident record.

Honest caveat, stated up front to the user: self-hosted cold outreach at scale is reputation war, not a configuration task. The architecture keeps an ESP swap one interface away.

---

## 11. AI with guardrails (Ollama)

Allowed: page-type classification, industry mapping, job-title normalization, duplicate-candidate ranking, extraction-review assistance, drafting *suggestions* for humans.

Forbidden: inventing emails/companies/people, deciding eligibility, generating final send content without human approval, executing tools or fetching URLs.

Implementation:

- Strict JSON schema output (`format: json` + Pydantic validation + repair-once + reject on second failure).
- Prompt + model versions recorded on every AI-derived row; A/B against a golden set.
- **Prompt injection defense**: page content is wrapped as data, never instructions; model has no tools; output schema cannot express "send" or "eligible".
- Fallback: if Ollama is down, pipeline continues deterministically (classification fields stay null, not guessed).
- Embeddings (`nomic-embed-text`) in Postgres via `pgvector` for dedupe and semantic search — no separate vector DB.

---

## 12. UX surface map

| Screen | Core interaction | Why it exists |
| --- | --- | --- |
| Dashboard | pipeline health, review backlog, recent discoveries | one glance: is the machine working? |
| Companies | virtualized table, filters, saved views | the inventory |
| Company detail | evidence drawer, contacts, crawl history, freshness | the "why believe this" surface |
| Review queue | keyboard triage, approve/reject/bulk, confidence | throughput bottleneck lives here |
| Discovery projects | ICP → targets → yield stats | repeatable sourcing |
| Sources | policy status, yield, error rate, cooldowns | governance + ROI |
| Verification | status distribution, stale queue, re-run | trust maintenance |
| Suppression | search/add/import, reason audit | legal safety |
| Campaigns | builder → eligibility preview → approval → schedule | the payoff |
| Settings | org, users, API keys, jurisdiction profiles, retention | control |

Design constraints: server-side pagination only, no client-side 1M-row tables; every list has a cursor; every mutation optimistic with server reconciliation; empty states teach the pipeline.

---

## 13. Security posture

Summary here, full model in [`security.md`](./security.md).

- SSRF guard shared by HTTP and browser fetch paths (allowlist + IP validation + DNS pinning + redirect re-validation).
- Stored-XSS defense: scraped HTML is never rendered raw; evidence viewer shows extracted text + sanitized excerpt.
- Multi-tenant isolation: app-level scoping + Postgres RLS + tests that attempt cross-org reads on every endpoint.
- Auth: Argon2id password hashing, short-lived sessions, TOTP optional, API keys hashed at rest with prefix lookup.
- Secrets: `.env` for dev, Docker secrets / age-encrypted file for prod; never in git; rotation runbook.
- PII at rest: column-level encryption for consent evidence and contact PII where jurisdiction requires; encryption keys outside DB.
- Export safety: CSV formula injection escaping; import size/row caps; zip-bomb limits.
- Mail: submission requires auth, relay restricted to authenticated senders only, rate limits per account, open-relay test in CI.

---

## 14. Capacity and performance model

Planning assumptions, not promises. Re-measure in Phase 0.

| Dimension | Assumption | Implication |
| --- | --- | --- |
| Pages/day (dev host) | 20k–50k | 1–2 crawl workers; 10 concurrent domains |
| Avg page | 120 KB | 2.4–6 GB/day raw; ~3x compression in MinIO → < 2 GB/day |
| Raw retention | 90 days | ~150–250 GB MinIO; extract JSON kept forever |
| Contacts | 1M | ~2–5 GB core tables; 20–60 GB with evidence |
| DB size | 100–300 GB at 1M w/ 90d evidence | partition + autovacuum tuning; 32 GB RAM comfortable |
| Verification | 50 emails/s cached DNS | batch + cache; Polars for bulk passes |
| Search | Postgres FTS first | OpenSearch only when FTS p95 > 200ms or > 5M docs |

Query discipline: cursor pagination everywhere; covering indexes for list screens; `COPY`/batch upsert for imports; no N+1 (Prisma `select` discipline reviewed in code review); `EXPLAIN` budget on the five hot queries.

---

## 15. Observability and SLOs

- **Metrics**: pages fetched, fetch success rate by status class, extraction yield/page, candidates promoted, verification pass rate, queue depth/lag, DLQ size, review backlog age, eligibility block reasons, send/bounce/complaint rates.
- **Traces**: one trace per crawl target and per extraction run; OpenTelemetry, local Grafana + Prometheus + Loki in `infrastructure/monitoring`.
- **Logs**: structured JSON, correlation id threaded web → API → stream → worker.
- **SLOs (internal)**: API p95 < 300ms; crawl worker success > 90% (excluding intentional blocks); replay of 1k pages < 5 min; zero cross-org leakage; zero sends to suppressed addresses.

---

## 16. Quality gates

Each phase exits only when the gates in [`quality-gates.md`](./quality-gates.md) pass. Highlights:

- **Golden set**: 500 hand-labeled pages (emails, companies, false positives) with precision/recall floor per extractor version.
- **Adversarial fixtures**: JS-obfuscated emails, URL-encoded mailto, `logo@2x.png`, third-party widget addresses, redirect-to-localhost, 429 storm, catch-all domains, unicode homoglyphs.
- **Compliance tests**: unknown country blocks, stale decision blocks, suppressed always blocks, re-import re-suppresses.
- **Security tests**: cross-org access denied on every resource; SSRF suite; CSV injection; webhook signature.
- **Restore drill**: documented RTO/RPO; database restore verified each phase.

---

## 17. Roadmap

Condensed; details and exit criteria in [`roadmap.md`](./roadmap.md).

| Phase | Weeks | Outcome | Hard gate |
| --- | --- | --- | --- |
| 0 · Spike | 1–2 | 50 domains → evidence-backed records; yield measured | Is yield ≥ 15 usable contacts / 50 companies? |
| 1 · Foundation | 3–4 | monorepo, Docker, Postgres, Prisma, auth, RLS | cross-org tests green |
| 2 · CRM | 5–6 | companies, contacts, domains, CSV import | 100k-row import < 10 min |
| 3 · Sources + discovery | 7–8 | registry, policy gate, projects, queue | no target without approved source |
| 4 · Crawler | 9–10 | safe fetch, robots, SSRF suite, artifacts | SSRF + robots suite green |
| 5 · Extraction | 11–12 | deterministic extractors, evidence, replay | golden-set precision ≥ 90% |
| 6 · Verification | 13 | syntax/DNS/MX, statuses, freshness | no SMTP probing in codebase |
| 7 · Compliance | 14–15 | profiles, eligibility API, suppression | default-deny matrix passes |
| 8 · Campaign drafts | 16–17 | builder, preview, approval | blocked recipients cannot be queued |
| 9 · SMTP (gated) | 18–20 | Postfix, DKIM, bounce, unsubscribe | seed-inbox pass + auth proof |
| 10 · Hardening | 21–24 | scale tests, monitoring, backup, pen-test | restore drill + load test |

---

## 18. Metrics

**North star:** *verified, evidence-backed, eligible contacts delivered per operator-hour.*

Supporting: extraction precision/recall, discovery yield per source, review throughput (records/min), time-to-first-lead, staleness ratio, eligibility block rate, bounce/complaint rates, cost per 1k contacts (infra only), crawl success rate, dedupe rate.

---

## 19. Risks and kill criteria

| Risk | Likelihood | Impact | Mitigation | Kill criterion |
| --- | --- | --- | --- | --- |
| Extraction yield too low | Medium | Fatal | Phase 0 measurement; multiple source classes | < 5 usable per 50 companies → re-scope |
| Source access revoked / blocked | High | High | Source diversity, policy registry, no evasion | > 50% of sources blocked → pivot sourcing |
| Deliverability failure | High | High | Warmup, provider abstraction, honest gating | Reputation unrecoverable after 3 attempts → ESP-only mode |
| Legal exposure | Medium | Fatal | Default-deny, counsel review, jurisdiction profiles | Counsel says model unlawful in target market → restrict scope |
| Scope creep | High | High | Scope ladder, gates, "never" list | Phase slips > 4 weeks → cut scope, not quality |
| Data quality distrust | Medium | High | Provenance, confidence, review | Users ignore records → rebuild trust surfaces |
| Single-developer bus factor | Certain | High | Docs, ADRs, runbooks, boring tech | — |
| LLM cost/latency | Low (local) | Low | Classification only, fallbacks | — |

---

## 20. Cost model (self-hosted, monthly, approximate)

| Item | Dev workstation | Production (1M contacts) |
| --- | --- | --- |
| Compute | existing RTX 4090 box | 1 app node (8c/32GB) + 1 worker node (16c/64GB) |
| Storage | 1 TB NVMe | 2 TB NVMe + object storage |
| Mail server | none | small VPS w/ static IP + PTR + port 25 (~€10–20) |
| Backups | local | offsite object storage (~€10–30) |
| Software | €0 (all OSS) | €0 + optional ESP relay |

No per-seat, per-credit, or per-record costs. The honest trade: you pay in engineering time and operational attention instead of subscription fees.

---

## 21. Legal and ethical posture

- Only publicly accessible pages; honor robots and terms; no login-protected content.
- Personal data processed under documented bases, minimized, retained on a schedule, and erasable.
- Marketing only with a jurisdiction-appropriate basis; unsubscribe honored immediately and permanently.
- Data-subject requests supported by an internal workflow (access, erasure, objection) even in v1 (manual + audited).
- All jurisdiction profiles ship as `DRAFT` and require explicit human sign-off before enabling real sending.

---

## 22. Open questions

Tracked in [`open-questions.md`](./open-questions.md). Blocking decisions for Phase 1:

1. Primary operating jurisdiction and target markets (drives profile priority).
2. Is v1 single-org or multi-tenant? (plan assumes single-org, schema org-scoped)
3. Sending identity: which domain/subdomain, who owns PTR?
4. Is a public sector/registry dataset integration (e.g. Bolagsverket, Companies House) in scope for v1? (recommended: yes, Phase 6)
5. Acceptable monthly infra budget.
6. Does the operator want MCP/agent access in v1 or v2?

---

## 23. Immediate next actions

1. Approve this plan and phase gates.
2. Scaffold `apps/web` (Next.js) and `packages/database` (Prisma) per Phase 1.
3. Write SSRF guard + URL validator as the first shared security library (before any crawler code).
4. Build the Phase 0 spike harness in `services/crawler` + `services/extractor` (CLI, no UI).
5. Build the 500-page golden set labeling sheet with 50 seed domains.
6. Draft jurisdiction profiles for the top 3 target countries; mark DRAFT.
7. Stand up `docker-compose` with Postgres + Redis and health checks.
8. Open the Phase 1 issue set from `backlog.md`.
