# LeadForge — Architecture

Companion to [`MEGA-PLAN.md`](./MEGA-PLAN.md) §6. This document is the implementation-level view.

---

## 1. System context (C4 level 1)

```
                    ┌─────────────────────────────────────────────┐
                    │              THE INTERNET                    │
                    │  company sites · directories · registries    │
                    │  recipient mail servers · DNS                │
                    └───────────────┬──────────────┬──────────────┘
                                    │ HTTPS        │ SMTP
                    ┌───────────────▼──────────────▼──────────────┐
                    │                LEADFORGE                     │
                    │  discovery → crawl → extract → verify        │
                    │  → review → CRM → eligibility → campaign     │
                    └───────────────┬──────────────┬──────────────┘
                                    │              │
                    ┌───────────────▼──┐      ┌────▼─────────────┐
                    │  OPERATOR        │      │  OPERATOR AGENTS  │
                    │  browser         │      │  MCP / REST /     │
                    │  (dashboard)     │      │  webhooks         │
                    └──────────────────┘      └───────────────────┘
```

External dependencies are deliberately boring: HTTPS, DNS, SMTP. No SaaS in the critical path. Optional outbound: a search API for discovery and an ESP relay for sending — both behind interfaces so they can be absent.

---

## 2. Container view (C4 level 2)

| Container | Tech | State it owns | Scaling model | Failure mode |
| --- | --- | --- | --- | --- |
| `web` | Next.js App Router, RSC, Tailwind, shadcn/ui | none (uses API) | stateless, N replicas | UI unavailable; pipeline unaffected |
| `api` | Next.js route handlers `/api/v1` | none (writes DB) | stateless, N replicas | UI read-only failure; workers keep running |
| `scheduler` | Node cron + agenda-style leases | `scheduled_jobs` | single active lease | no new jobs; running jobs finish |
| `discovery-worker` | Python | none | N | discovery stalls; crawl continues |
| `crawl-worker` | Python, HTTPX + Playwright | MinIO artifacts + `fetch_artifacts` | N, domain-partitioned | crawl stalls; extraction continues on backlog |
| `extract-worker` | Python, Selectolax, lxml | `extraction_runs`, candidates | N | queue backs up; no data corruption |
| `verify-worker` | Python, dnspython | `email_verifications` | N | stale statuses; sends blocked by TTL |
| `campaign-worker` | Node | `campaign_recipients`, sends | 1–N with row leases | sends pause; no duplicate sends |
| `mail-ingestion` | Node | `email_events`, suppressions | 1 | bounces unprocessed → send gate blocks |
| `postfix` + `opendkim` | Postfix, OpenDKIM | mail queue | single instance | sending stops; no data loss |
| `postgres` | PostgreSQL 16 | everything | primary + read replica (later) | system down; restore from backup |
| `redis` | Redis 7 | streams, locks, cache | single primary | jobs pause; DB is source of truth |
| `minio` | MinIO | page artifacts, exports | single node → distributed later | replay impossible; crawl still works |
| `ollama` | Ollama + models | none | 1 GPU | AI fields null; deterministic path continues |
| `opensearch` | OpenSearch 2.x | rebuildable index | 1 node | search falls back to Postgres |

**Key property:** no worker owns business truth. Truth lives in Postgres. Redis and MinIO are recoverable infrastructure; losing them loses time, not data.

---

## 3. Communication contracts

### 3.1 Synchronous (request/response)

- Browser → `api` over HTTPS, session cookie (httpOnly, SameSite=Lax).
- `api` → `postgres` via Prisma.
- `api` → `redis` only for enqueue + lightweight locks.
- Workers → `api` only for low-volume callbacks (never for bulk data); default is workers write their own tables directly with the same migrations. This avoids a chatty internal API while keeping one schema.

> Decision: workers share the database, not the API. ADR-0004.

### 3.2 Asynchronous commands (Redis Streams)

Stream naming: `lf:<domain>:<action>[:<priority>]`

| Stream | Producer | Consumer group | Payload (abridged) |
| --- | --- | --- | --- |
| `lf:discover:run` | api | `discovery` | `project_id`, `cursor`, `budget` |
| `lf:crawl:fetch` | api, discovery | `crawl` | `target_id`, `url`, `source_id`, `priority`, `attempt` |
| `lf:extract:page` | crawl | `extract` | `fetch_artifact_id`, `extractor_version` |
| `lf:verify:email` | extract, api, scheduler | `verify` | `email_id`, `method_set` |
| `lf:campaign:send` | api, scheduler | `campaign` | `campaign_id`, `batch_cursor` |
| `lf:mail:ingest` | postfix pipe | `mail-ingestion` | `raw_path` |

Rules:

- At-least-once; every consumer is idempotent on a deterministic key (`target_id:attempt`, `artifact_id:extractor_version`).
- Max 5 attempts with exponential backoff + jitter; then `lf:<domain>:dlq` with the original payload and error.
- Consumer `PEL` (pending entries list) monitored; entries older than 10 min trigger an alert.
- Streams trimmed by `MAXLEN ~ 1e6` only after ack + audit of completion.
- Visibility timeout handled by `XAUTOCLAIM` sweeper.

### 3.3 Asynchronous facts (Postgres outbox)

`domain_events(id, org_id, type, aggregate_type, aggregate_id, payload jsonb, occurred_at)` written in the same transaction as the state change. A relay publishes to webhooks and to analytics. Events are append-only; consumers must tolerate duplicates.

Event catalog (v1): `company.created`, `company.updated`, `contact.promoted`, `email.verified`, `eligibility.evaluated`, `campaign.approved`, `campaign.sent`, `email.bounced`, `email.complained`, `suppression.created`, `import.completed`.

---

## 4. End-to-end data flow

```
CSV domains ──► import ──► domains + companies (unverified)
                              │
ICP definition ──► discovery project ──► crawl_targets
                              │
                    lf:crawl:fetch
                              ▼
                    URL guard ──► robots ──► HTTP fetch ──► artifact (MinIO)
                              │                          │
                              └── cooldown/stop ◄────────┘
                                                         ▼
                                              lf:extract:page
                                                         ▼
                                  deterministic extractors ──► candidates
                                                         │        │
                                                         │   (page type / role)
                                                         │        ▼
                                                         │      Ollama
                                                         ▼
                                                   review queue
                                                         │ promote
                                                         ▼
                                    company / contact / email + evidence
                                                         │
                                              lf:verify:email
                                                         ▼
                                                verification status
                                                         │
                                              eligibility.evaluate
                                                         ▼
                                  campaign recipients (snapshot) ──► send gate
```

---

## 5. Deployment topology

### 5.1 Development (this workstation)

Docker Compose, all ports bound to `127.0.0.1`. Hot reload for `web`. Workers run natively (Python venv) for fast iteration; Postgres/Redis/MinIO/Ollama in containers. OpenSearch off by default.

### 5.2 Production (single host or two hosts)

```
host A (app)                     host B (data+mail)
  web, api, scheduler              postgres, redis, minio
  nginx/caddy TLS                  ollama (GPU host)
  campaign, mail-ingestion         postfix + opendkim
```

Later split: crawler workers on host C with egress-only network. Egress policy: only 80/443 outbound; no inbound.

### 5.3 Compose service contract

Every service declares: pinned image digest/tag, `restart: unless-stopped`, healthcheck, resource limits, log rotation, named volume or bind mount, and membership in `leadforge_net` (internal) plus `edge` (only web/mail). No `latest` tags. No host networking. No port publishing except `web` (and mail submission in production).

---

## 6. Failure handling

| Failure | Behaviour |
| --- | --- |
| Postgres unavailable | API returns 503; workers retry with backoff; commands stay in stream (no ack) |
| Redis flush | queue lost; scheduler re-derives pending work from DB state (`crawl_targets.status='QUEUED'`) |
| Worker crash mid-task | unacked entry reclaimed by sweeper; idempotency key prevents duplicate side effects |
| Ollama down | AI classification skipped, candidates still produced, `ai_status='SKIPPED'` |
| MinIO full | crawl pauses with `STORAGE_BACKPRESSURE`; extraction continues on existing artifacts |
| Postfix down | campaign worker pauses, recipients stay `PENDING`, no partial batch loss |
| DNS resolver failure | verify retries with backoff; email stays at prior status, TTL blocks sends if stale |

**Backpressure:** each worker checks a queue-depth gauge and pauses intake above threshold rather than growing unbounded backlog.

---

## 7. Configuration

Single typed config object per runtime (`packages/config` for TS, `pydantic-settings` for Python), sourced from env with `.env` in dev and Docker secrets in prod. No scattered `process.env`. Every config value has a default, a type, and validation at boot (fail fast).

Crawler defaults live in `config/crawler.yaml`, versioned with code, overridable per source via `sources.policy`.

---

## 8. Contract management across languages

- Zod schemas in `packages/shared/contracts` generate JSON Schema (`zod-to-json-schema`) at build time.
- Python `pydantic` models are generated or mirrored, with a CI check that both sides hash-compile the same schema.
- Breaking changes require a version bump on the stream payload (`v` field) and dual-read period.

---

## 9. What is deliberately absent

| Absent | Rationale |
| --- | --- |
| Kubernetes | one operator, 12 containers — Compose is correct |
| Kafka | Redis Streams sufficient under ~10k msg/s |
| Separate vector DB | pgvector inside Postgres |
| GraphQL | REST + typed clients is simpler; add later if needed |
| Service mesh | no |
| Event sourcing of business entities | outbox + audit is enough; full ES is complexity tax |
