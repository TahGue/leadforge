# LeadForge — Architecture Decision Records

Append-only. A decision is changed by adding a new ADR that supersedes it, never by editing history.

Format: **Status** · **Context** · **Decision** · **Consequences**.

---

## ADR-0001 — Modular monolith with independent workers

**Status:** Accepted (2026-11-18)

**Context:** The platform needs crawling, extraction, verification, campaign, and mail processing. Microservices would multiply deploys, contracts, and failure modes for a single-operator project.

**Decision:** One monorepo, one database, one deployable web/API, plus independently deployable worker processes per pipeline stage. Clear module boundaries enforced by folder structure and import linting.

**Consequences:** Fast iteration, single migration path, easy local dev. Workers can still scale horizontally per stage. Risk: module boundaries erode — mitigated by lint rules and code review.

---

## ADR-0002 — PostgreSQL is the only source of truth

**Status:** Accepted

**Context:** Search and caching could compete for authority.

**Decision:** All business state lives in Postgres. OpenSearch (later) and Redis are derived, rebuildable projections. Any feature must work correctly with the search index deleted.

**Consequences:** Rebuild jobs required; search latency eventually lags. In exchange: no dual-write consistency bugs, one backup target.

---

## ADR-0003 — Redis Streams for commands, Postgres outbox for facts

**Status:** Accepted

**Context:** BullMQ is Node-only; Python workers need jobs; we also need reliable domain events.

**Decision:** Commands (work to be done) go through Redis Streams with consumer groups, at-least-once delivery, explicit ack, DLQ. Facts (what happened) go through a transactional outbox table in Postgres.

**Consequences:** Two mechanisms to learn, but each is used for what it is good at. Duplicate delivery is expected; every consumer must be idempotent. Losing Redis loses queued work but not data — the scheduler can re-derive pending work from DB state.

---

## ADR-0004 — Workers write directly to the database

**Status:** Accepted

**Context:** A worker-to-API design would require internal auth, schema duplication, and chatty calls for bulk writes.

**Decision:** Workers use the same migrations and connect to Postgres directly, with a service role and org context, while business invariants remain in shared SQL constraints and migration-level policies. The API is not in the bulk data path.

**Consequences:** Strong coupling to the schema (acceptable inside one repo). Requires discipline: schema changes are breaking changes for workers, so migrations must be expand/contract and deployed in lockstep.

---

## ADR-0005 — TypeScript for the product, Python for the data engine

**Status:** Accepted

**Context:** Team skill and ecosystem fit differ by task.

**Decision:** Next.js/TypeScript for web, API, CRM logic, campaign engine, compliance evaluation. Python for crawling, parsing, extraction, verification, bulk processing.

**Consequences:** Two toolchains in CI. Cross-language contract must be machine-checked (JSON Schema generated from Zod, validated by Pydantic). Compliance logic stays in one language to avoid drift.

---

## ADR-0006 — Content-addressed page artifacts with replay

**Status:** Accepted

**Context:** Extraction logic changes constantly; re-crawling is slow, rate-limited, and sometimes impossible.

**Decision:** Store every fetched body once, keyed by SHA-256, compressed, with TTL. Extraction runs are idempotent on `(artifact, extractor_version)` and can be replayed offline.

**Consequences:** Storage grows (bounded by TTL + dedupe). Gives measurable extractor iteration, reproducible bug analysis, and the ability to improve old records without new network traffic.

---

## ADR-0007 — No SMTP mailbox probing

**Status:** Accepted

**Context:** "Verify the inbox" is the most requested and most abused feature in lead tooling.

**Decision:** Verification stops at syntax, DNS, MX, and policy signals. No `RCPT TO` probing, no catch-all testing via SMTP.

**Consequences:** We cannot claim inbox-level certainty; the UI says "domain accepts mail" not "verified". Sending IP reputation is protected. Catch-all domains remain `RISKY`. This is a product-positioning choice as much as a technical one.

---

## ADR-0008 — Default-deny eligibility with immutable, expiring decisions

**Status:** Accepted

**Context:** "Discovered" and "allowed to email" are different facts, and laws change.

**Decision:** A dedicated eligibility engine evaluates every recipient, returns one of five outcomes, writes an append-only decision record with rule set version and 24h expiry, and is re-run immediately before send.

**Consequences:** Some legitimate sends will be blocked until evidence is recorded — accepted. Requires UX to explain blocks clearly. Legal review changes profiles, not code.

---

## ADR-0009 — Jurisdiction rules are data, not code

**Status:** Accepted

**Context:** Rules vary by country and change over time; engineers should not deploy to change a legal rule.

**Decision:** Jurisdiction profiles are versioned JSON stored in the DB, with `DRAFT → APPROVED → RETIRED` lifecycle and named approver. The engine interprets them; it has no `if (country === 'SE')` branches.

**Consequences:** Profiles need schema validation and tests. Enabling a country is an operational act with an audit trail. Fast legal iteration.

---

## ADR-0010 — LLM classifies, never authors facts

**Status:** Accepted

**Context:** Local models are cheap but hallucinate; fabricated contact data is worse than missing data.

**Decision:** Ollama is limited to classification, normalization, ranking, and review assistance with schema-constrained output. It never writes an email address, company, person, or eligibility outcome. AI-derived fields carry model + prompt version; deterministic fallback always exists.

**Consequences:** Some pages yield less data. Trust preserved. Prompt injection has a small blast radius.

---

## ADR-0011 — Sending behind a provider interface

**Status:** Accepted

**Context:** Self-hosted SMTP is required by the project, but deliverability may force an ESP relay.

**Decision:** `MailProvider` interface with `SmtpProvider` (Postfix) as the default and a future `EspProvider`. Campaign logic depends only on the interface.

**Consequences:** No rewrite if infrastructure changes. Slightly more abstraction than a direct `nodemailer` call. Sending identity (domain, IP, DKIM) is configuration, not code.

---

## ADR-0012 — Defense in depth for tenancy: app scoping + Postgres RLS

**Status:** Accepted

**Context:** A single missing `where organization_id = ...` is a breach.

**Decision:** All queries are org-scoped in the application layer, and RLS policies enforce the same rule at the database. The request transaction sets `app.organization_id`.

**Consequences:** Slight query overhead and migration complexity; strong protection against the most common multi-tenant bug. Requires a service-role path for background jobs, audited.

---

## ADR-0013 — Prisma plus hand-written SQL for what Prisma cannot express

**Status:** Accepted

**Context:** RLS, partitions, generated columns, partial indexes, trigram indexes are outside Prisma's schema language.

**Decision:** Prisma models the tables and handles CRUD/migrations; a versioned SQL step applies policies, partitions, and special indexes after `prisma migrate deploy`.

**Consequences:** Two places to look; a CI check ensures they stay in sync. Avoids fighting the ORM.

---

## ADR-0014 — Cursor pagination only

**Status:** Accepted

**Context:** Offset pagination degrades badly at 1M rows and breaks under concurrent writes.

**Decision:** All list endpoints use keyset pagination on `(sort_key, id)` with opaque cursors. No `skip` in API contracts.

**Consequences:** Slightly more code per endpoint; stable, fast lists at any size. UI must support "load more", not "jump to page 500" (acceptable).

---

## ADR-0015 — Defer OpenSearch until Postgres FTS proves insufficient

**Status:** Accepted

**Context:** Operating a search cluster for a single-operator system is real cost.

**Decision:** v1 search uses Postgres full-text + trigram. OpenSearch is introduced only when a measured threshold is crossed (p95 > 200ms or > 5M searchable docs or complex faceting needs).

**Consequences:** Simpler ops early; a known scaling path later. Search API is designed so the backing store can change without breaking clients.

---

## ADR-0016 — pgvector instead of a dedicated vector database

**Status:** Accepted

**Context:** Dedupe and semantic search need embeddings.

**Decision:** `pgvector` inside Postgres, with HNSW indexes.

**Consequences:** One less service, transactional consistency with records. At 1M+ embeddings, memory sizing must be watched; acceptable at target scale.

---

## ADR-0017 — Phase 0 spike before UI

**Status:** Accepted

**Context:** The riskiest assumption is that public web data yields enough usable contacts, not that a dashboard can be built.

**Decision:** Two-week CLI-only spike measures yield and precision on 50 real companies before Phase 1 begins.

**Consequences:** Delays visible product by two weeks; may invalidate or reshape the plan cheaply. This is the cheapest possible insurance.

---

## ADR-0018 — Single-org v1 with org-scoped schema

**Status:** Accepted

**Context:** Multi-tenancy adds auth, billing, and isolation complexity that does not serve the first user.

**Decision:** v1 runs one organization. Schema, RLS, and API are org-scoped from day one so multi-org is a feature flag, not a rewrite.

**Consequences:** Some UI simplification (no org switcher). Migration to multi-org is additive.

---

## ADR-0019 - Postgres `SKIP LOCKED` queue for v1 (supersedes Redis Streams for commands)

**Status:** Accepted (2026-11-18) - supersedes the transport choice in ADR-0003

**Context:** The first deployable version needs one durable queue that both TypeScript and Python can use without a second broker. Redis was in the original design, but it adds a failure domain and a second consistency story for a single-operator deployment.

**Decision:** Crawl targets are claimed directly from Postgres with `FOR UPDATE SKIP LOCKED`. Campaign recipients are claimed with an atomic status transition. Redis remains available for cache and future high-throughput fan-out, but is not on the correctness path.

**Consequences:** One source of truth, trivially observable queue state (`status`, `attempts`, `scheduledFor`), and no cross-language serialization layer. Throughput is bounded by Postgres (adequate well past 1M contacts for this workload). Revisit Redis Streams if sustained queue depth exceeds what `SKIP LOCKED` can serve or if fan-out to many workers per stage becomes necessary.
