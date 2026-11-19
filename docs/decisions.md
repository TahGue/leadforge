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

---

## ADR-0020 — Adopt the v1.0 specification as the controlling plan

**Status:** Accepted (2026-11-18)

**Context:** The first implementation followed an outreach-centred plan (now `docs/archive/MEGA-PLAN-v0.md`). The product owner's specification v1.0 is geography- and company-first and puts campaigns in a separately approved Phase 9.

**Decision:** `docs/MEGA-PLAN.md` is now specification v1.0. The code is realigned according to `docs/REALIGNMENT-PLAN.md`. Campaign and delivery code is frozen behind `FEATURE_CAMPAIGNS` (default `false`) rather than deleted.

**Consequences:** Discovery capabilities (geography, taxonomy, project builder, source adapters) take priority. The campaign code keeps its tests but serves no traffic until legal review approves Phase 9.

---

## ADR-0021 — BullMQ for orchestration, Postgres claims for crawling (amends ADR-0019)

**Status:** Accepted (2026-11-18)

**Context:** Spec §17 asks for Redis + BullMQ, with Postgres as the system of record. BullMQ has no maintained Python consumer, and the crawler already claims work safely with `FOR UPDATE SKIP LOCKED`.

**Decision:** TypeScript orchestration queues (`discovery`, `source_search`, `company_normalization`, `deduplicate`, `verify`, `classify`, `export`, `refresh`) run on BullMQ. Job IDs are deterministic, retries are bounded with exponential backoff, and exhausted jobs move to a `dead-letter` queue. Python stages (`source_search` adapters, `crawl`, `extract`, `classify`) claim rows from Postgres job tables (`discovery_runs`, `crawl_jobs`). Policy denials are terminal states (`BLOCKED`), never retries.

**Consequences:** Queue state is still reconstructible from Postgres. Redis loss delays orchestration but never loses business state: a `refresh` sweep re-enqueues pending work from Postgres.

---

## ADR-0022 — PostGIS is required; local development uses a container

**Status:** Accepted (2026-11-18)

**Context:** Geography (spec §6) needs spatial types and radius queries. The embedded-Postgres fallback can't load extensions.

**Decision:** Every environment runs `postgis/postgis:16-3.5`. Local development starts it with `docker compose up -d postgres redis`. The embedded-Postgres and pglite fallbacks are removed.

**Consequences:** Docker is a prerequisite for development. Spatial columns use `geography(Point,4326)` managed by SQL migrations (Prisma treats them as `Unsupported`).

---

## ADR-0023 — UI components: Tailwind with local shadcn-style primitives, TanStack Table, React Hook Form

**Status:** Accepted (2026-11-18)

**Context:** Spec §8 names shadcn/ui. shadcn is a generator that copies component source into the repo; it isn't a runtime dependency.

**Decision:** Primitives live in `apps/web/src/components/ui/`, written in the shadcn style (Tailwind classes, no runtime theme library). Tables use `@tanstack/react-table`, forms use `react-hook-form` with Zod schemas shared from `@leadforge/shared`, and maps use `maplibre-gl` with an operator-configured tile style (`NEXT_PUBLIC_MAP_STYLE_URL`).

**Consequences:** No Radix dependency until a component needs it. The default map shows no basemap tiles unless the operator configures a permitted tile source (spec §21).

---

## ADR-0024 — Geography seed is bundled; full GeoNames import is operator-run

**Status:** Accepted (2026-11-18)

**Context:** GeoNames dumps are large (hundreds of MB) and licensed CC BY 4.0, which requires attribution.

**Decision:** The repo ships continents, all ISO 3166-1 countries, and a curated Nordic set of regions and cities in `data/geography/seed/`. `scripts/import-geonames.mjs` imports `countryInfo.txt`, `admin1CodesASCII.txt` and `citiesNNNN.txt` that the operator downloads. Each import is recorded in `geo_import_batches` with its licence and attribution.

**Consequences:** A fresh install works offline for the initial scope. Wider coverage is one documented command away.

---

## ADR-0025 — Default classification model: qwen3.8:27b

**Status:** Accepted (2026-11-18)

**Context:** Spec §12 requires benchmarking local models on labelled data before choosing a default. The only model available on the reference workstation was `qwen3.8:27b` (Q4_K_M).

**Decision:** Default `OLLAMA_CLASSIFICATION_MODEL=qwen3.8:27b`. Benchmark: 96% accuracy, 1 false store in 24, correct handling of a prompt-injection item, 18.5 s p50 ([performance](./performance.md#local-ai-classification)). Classification stays opt-in (`OLLAMA_ENABLED=false` by default).

**Consequences:** Needs about 18 GB of GPU or system memory. Operators on smaller hosts must benchmark a smaller model with `leadforge.ai_eval` and override the variable. Revisit when the labelled set includes real companies.

---

## ADR-0026 — A trained triage classifier decides clear cases before the LLM

**Status:** Accepted (2026-11-19)

**Context:** On the Italy olive oil run, the LLM classified one company every 5–18 seconds, so 1,100 crawled sites waited hours. Most of them look like companies the LLM had already labelled.

**Decision:** The classification role first runs a small classifier per organization (TF-IDF character and word features, logistic regression; scikit-learn), trained on that organization's `AI` and `MANUAL` industry labels and on the companies the LLM found no industry for. It is retrained every `TRIAGE_RETRAIN_SECONDS` once there are `TRIAGE_MIN_EXAMPLES` labels. At `TRIAGE_ACCEPT_PROBABILITY` or above it stores an industry with method `MODEL` (confidence capped at 0.6, below the LLM's 0.7, with the words that drove the decision as evidence) or records "no industry fits" as a classification attempt. Everything else goes to the LLM. `MODEL` and `KEYWORD` rows are never used as training labels.

**Consequences:** Clear cases are decided in milliseconds and the LLM only sees the uncertain ones. The classifier copies the LLM's mistakes and cannot learn an industry it has seen fewer than `TRIAGE_MIN_PER_CLASS` times. Labels never cross organizations. On the Italy set it agreed with the LLM 80% of the time in 5-fold cross-validation. Disable with `TRIAGE_ENABLED=false`.
