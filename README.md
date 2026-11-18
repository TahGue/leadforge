# LeadForge

**Self-hosted B2B company and business-contact discovery.** Pick a geography (city, region, country, continent or worldwide) and an industry, and LeadForge discovers companies from permitted sources, deduplicates them, crawls their websites within policy limits, and extracts evidence-backed business contacts. Every value keeps its source URL, observation time, method and confidence.

Discovery, legal basis, campaign eligibility and delivery are separate stages. **Finding an email address never grants permission to market to it.** Campaigns are frozen until a separately approved Phase 9 ([ADR-0020](docs/decisions.md)).

- **Specification:** [`docs/MEGA-PLAN.md`](docs/MEGA-PLAN.md) (v1.0, controlling)
- **How the code got here:** [`docs/REALIGNMENT-PLAN.md`](docs/REALIGNMENT-PLAN.md)
- **Operating it:** [`docs/deployment.md`](docs/deployment.md) · [`docs/runbooks.md`](docs/runbooks.md)

## What it does

| Area | What you get |
| --- | --- |
| Market Explorer | MapLibre map, geography and industry browsers over your data, "create a project from this selection" |
| Discovery projects | 9-step wizard: geography (stable IDs, include/exclude, radius, postal prefix), industry tree with NACE codes, company/website/language/contact filters, sources, quality and exclusions, crawl budget, preview with policy warnings; start, pause, resume, cancel, live progress |
| Sources | Policy registry with terms, licence, permitted use, attribution, rate limit and retention. A source runs only after a person approves it. Adapters: user-provided domains, open dataset files (registry exports), OpenStreetMap via Overpass (ODbL) |
| Normalization | Geography resolution through aliases within a country, taxonomy classification (NACE/SNI codes, aliases), merge only on domain or registration number, lookalikes sent to duplicate review |
| Crawling | Async HTTPX with connection-time SSRF and DNS-rebinding protection, robots.txt (RFC 9309), rate limits, policy stops on 401/403/429/CAPTCHA (never retried), bounded optional Playwright rendering |
| Extraction | `mailto:`/`tel:`, JSON-LD, visible text, forms; contact categories; names and titles only when explicitly published; language, technologies, social profiles. Only deterministic, on-domain role contacts are auto-promoted; everything else goes to review |
| Local AI | Ollama classifies unclassified companies. Output must match a Pydantic schema, use a taxonomy code and quote evidence that appears verbatim, or it is rejected |
| Verification | Separate syntax, DNS and MX statuses (with implicit-MX fallback and null-MX handling), provider category, time-bound re-checks. Never probes mailboxes |
| Data quality | Explainable confidence components, freshness, duplicate review, data-quality dashboard, review queues |
| Governance | Suppression list (address or domain), erasure requests that keep a suppression, retention jobs, audit log, Prometheus metrics, RBAC and API keys |

## Quick start

Requires Docker with Compose.

```bash
cp .env.example .env                        # set POSTGRES_PASSWORD and SESSION_SECRET (32+ chars)
docker compose up -d --build                # postgres+PostGIS, redis, migrate (+ reference data), web, worker
docker compose exec web node packages/database/prisma/seed.mjs   # demo org + admin (change the password)
docker compose --profile crawler up -d      # Python discovery + crawl worker (makes outbound requests)
```

Open http://localhost:3000. Before crawling, set `CRAWLER_USER_AGENT` to a truthful agent with a contact URL (spec 24), and review the sources under **Sources**.

Optional profiles: `--profile ai` (Ollama, then `OLLAMA_ENABLED=true` for the crawler), `--profile monitoring` (Prometheus and Grafana on 127.0.0.1:3001).

## Local development

```bash
pnpm install
uv sync                                     # Python engine (or: python -m venv .venv && pip install -e .)
pnpm local                                  # PostGIS+Redis in Docker, migrations, reference data, seed, web + worker
python -m leadforge.worker                  # crawler/discovery worker, in another terminal
```

`DEV_PG_PORT` and `DEV_REDIS_PORT` move the dev database ports if 5432/6379 are taken.

### Tests

```bash
pnpm -r typecheck
pnpm --filter @leadforge/pipeline test      # unit: geography, taxonomy, dedup prechecks, verification, scoring
pnpm --filter @leadforge/web test           # API integration against PostGIS (DATABASE_URL)
pnpm --filter @leadforge/worker test        # orchestration sweep, campaign gate
uv run pytest                               # SSRF, extraction, adapters, AI grounding, crawl+discovery integration, golden set
node scripts/check-schema-drift.mjs         # schema has a migration for every change
```

## Repository layout

```
apps/web            Next.js UI and /api/v1 (route handlers)
apps/worker         Orchestration worker: BullMQ consumers + Postgres sweep
packages/pipeline   Normalization, geography, taxonomy, lifecycle, preview, verification, dedup, search, exports
packages/database   Prisma schema, migrations, reference-data loader, seed
packages/shared     Zod contracts, name/domain normalization, email helpers
packages/compliance Default-deny eligibility engine (Phase 9)
services/leadforge  Python engine: source adapters, crawler, extraction, Ollama, spike and evaluation tools
data/               Geography seed, industry taxonomy, operator imports
infrastructure/     Monitoring, backup, mail (Phase 9) notes
scripts/            Local runner, GeoNames import, load test, drift check, backup/restore
docs/               Specification, ADRs, runbooks
```

## Documentation

| Document | Contents |
| --- | --- |
| [MEGA-PLAN](docs/MEGA-PLAN.md) | The controlling specification |
| [REALIGNMENT-PLAN](docs/REALIGNMENT-PLAN.md) | Phase-by-phase realignment and its status |
| [architecture](docs/architecture.md) | Processes, pipeline stages, queues |
| [data-model](docs/data-model.md) | Spec tables mapped to the schema, migration rules |
| [decisions](docs/decisions.md) | Architecture decision records |
| [deployment](docs/deployment.md) | Install, configure, upgrade, production checklist |
| [runbooks](docs/runbooks.md) | Day-to-day operations, incidents, restore drill log |
| [security](docs/security.md) | Threat model and controls |
| [compliance](docs/compliance.md) | Source, privacy and marketing rules |
| [performance](docs/performance.md) | Load test at 100,000 records |
| [phase-0-spike](docs/phase-0-spike.md) | Measuring extraction yield before scaling |
| [backlog](docs/backlog.md) | Spec epics with status |

This is an engineering framework, not legal advice. Get jurisdiction-specific legal review before any outreach.
