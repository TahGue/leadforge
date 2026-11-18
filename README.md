# LeadForge

Self-hosted B2B lead discovery, company intelligence, email extraction, verification, CRM and compliant outreach — built to own its data end to end.

**Status:** v1 implemented · mail delivery gated behind `MAIL_ENABLED` · see [`docs/deployment.md`](docs/deployment.md) and [`docs/roadmap.md`](docs/roadmap.md)

---

## Why this exists

Commercial lead databases charge per seat and per credit, hide their sources, and degrade quietly as records go stale. LeadForge takes the opposite position:

- **Every record is evidenced.** Field → source URL → fetch timestamp → content hash.
- **Discovery is not permission.** Collection, processing, and sending are separate systems with separate gates.
- **Your data is yours.** Postgres on your hardware, export whenever, no vendor in the critical path.
- **No evasion.** Robots honored, no login-wall bypass, no proxy rotation, no SMTP probing.

Read the full thesis in [`docs/MEGA-PLAN.md`](docs/MEGA-PLAN.md).

---

## What is implemented

| Area | State |
| --- | --- |
| PostgreSQL schema (36 tables), migrations, RLS hooks, seed | ✅ |
| Auth: Argon2id, DB sessions, RBAC, API keys | ✅ |
| Companies, contacts, domains, evidence, CSV import | ✅ |
| Sources with policy approval gate | ✅ |
| Discovery projects → crawl targets | ✅ |
| Safe crawler: SSRF guard, robots, redirects, cooldowns, artifacts | ✅ (Python) |
| Deterministic extraction: mailto, JSON-LD, DOM/text, false-positive filters | ✅ |
| Review queue with promote/reject + evidence writes | ✅ |
| Verification: syntax, DNS, MX, freshness (no mailbox probing) | ✅ |
| Jurisdiction profiles, default-deny eligibility engine, decision records | ✅ |
| Campaigns: segment → prepare → eligibility snapshot → approval → send worker | ✅ |
| Suppression: global/org, unsubscribe link, bounce/complaint ingestion | ✅ |
| SMTP delivery + warmup controls | ✅ behind gates (test mode by default) |
| Docker Compose deployment, health checks, backups | ✅ |
| Tests: 19 compliance unit, 14 API integration, 45 Python | ✅ |

Deliberately not built yet: OpenSearch (Postgres FTS first), ICP scoring, MCP server, multi-org UI, signal data, CRM sync. See the scope ladder in [`docs/MEGA-PLAN.md`](docs/MEGA-PLAN.md) §5.

---

## Architecture

```
Next.js web + API ──► PostgreSQL (truth) ──► Python worker (SKIP LOCKED queue)
        │                    │                        crawl · extract
        │                    └── artifacts (volume)   │
        │                                              ▼
        └──► compliance engine ──► campaign worker ──► SMTP (gated)
```

Modular monolith for the application, independent workers for the data pipeline and sending.
Queue decision: [`ADR-0019`](docs/decisions.md); no Redis on the correctness path.

---

## Quickstart (Docker)

```bash
cp .env.example .env
# set POSTGRES_PASSWORD, SESSION_SECRET, UNSUBSCRIBE_SIGNING_KEY, MAIL_POSTAL_ADDRESS
docker compose up -d --build
docker compose exec web node node_modules/tsx/dist/cli.mjs packages/database/prisma/seed.mjs
```

Open http://localhost:3000 and sign in with the seeded owner (`admin@leadforge.local` / `ChangeMe123!` unless you set `SEED_ADMIN_*`). **Change the password immediately.**

Enable crawling (it makes outbound requests):

```bash
docker compose --profile crawler up -d crawler
```

Mail stays in test mode until the gates in [`docs/deployment.md`](docs/deployment.md) §7 pass.

---

## Quickstart (local development, no Docker)

```bash
pnpm install
uv sync
node scripts/dev-db.mjs            # Postgres wire protocol on 127.0.0.1:5432
node scripts/db-apply.mjs          # apply migrations
pnpm --filter @leadforge/database seed
pnpm dev
```

In another terminal:

```bash
uv run python -m leadforge.worker   # crawl/extract
pnpm worker                         # campaign sends
```

> The bundled `dev-db.mjs` is a PGlite server for workstations without Docker. It requires
> `?pgbouncer=true&connection_limit=1` on `DATABASE_URL` (already in `.env.example`).

---

## Layout

```
apps/web          Next.js dashboard + /api/v1
apps/worker       campaign sending + bounce-driven state
services/leadforge Python crawler, extractor, verification helpers
packages/         database (Prisma), shared contracts, compliance engine
infrastructure/   postfix, opendkim, dns, monitoring, backup guidance
tests/            golden-set scaffold + Python unit/integration tests
docs/             plan, architecture, data model, compliance, deployment
```

---

## Tests

```bash
pnpm --filter @leadforge/compliance test   # 19 eligibility tests
pnpm --filter @leadforge/web test          # 14 API integration tests (needs DB)
uv run pytest                              # 45 Python tests
```

---

## Non-negotiable rules

1. Evidence or it does not exist.
2. Discovery never authorizes sending.
3. Default deny: unknown jurisdiction, missing basis, or suppression blocks the send.
4. The LLM classifies; it never invents contacts or permissions.
5. Secrets never in git; databases never on a public port.
6. Every mutation is audited; eligibility decisions are immutable and expiring.

Violating any of these is a release blocker.

---

## Documentation

| Doc | Contents |
| --- | --- |
| [MEGA-PLAN](docs/MEGA-PLAN.md) | vision, bets, scope ladder, architecture, risks |
| [deployment](docs/deployment.md) | production setup, backup, mail gates |
| [architecture](docs/architecture.md) | containers, flows, failure handling |
| [data model](docs/data-model.md) | tables, invariants, tenancy |
| [compliance](docs/compliance.md) | eligibility engine, jurisdiction profiles |
| [security](docs/security.md) | threat model, SSRF, secrets, incidents |
| [quality gates](docs/quality-gates.md) | acceptance matrix and test strategy |
| [decisions](docs/decisions.md) | ADRs |
| [backlog](docs/backlog.md) | remaining work by epic |

---

## License

Not yet chosen. Treat as all rights reserved until a `LICENSE` file lands.
