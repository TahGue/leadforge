# LeadForge

Self-hosted B2B lead discovery, company intelligence, email extraction, verification, CRM and outreach — built to own its data end to end.

**Status:** pre-alpha · Phase 0 (proving ground) · see [`docs/roadmap.md`](docs/roadmap.md)

---

## Why this exists

Commercial lead databases charge per seat and per credit, hide their sources, and degrade quietly as records go stale. LeadForge takes the opposite position:

- **Every record is evidenced.** Field → source URL → fetch timestamp → content hash.
- **Discovery is not permission.** Collection, processing, and sending are separate systems with separate gates. Nothing gets emailed because it was found.
- **Your data is yours.** Postgres on your hardware, export whenever, no vendor in the critical path.
- **No evasion.** Robots honored, no login-wall bypass, no proxy rotation, no SMTP probing.

Read the full thesis in [`docs/MEGA-PLAN.md`](docs/MEGA-PLAN.md).

---

## Architecture in one picture

```
Next.js web + API ──► PostgreSQL (truth) ──► Redis Streams ──► Python workers
        │                    │                                  crawl · extract · verify
        │                    └──► MinIO (raw page artifacts)      │
        │                                                         ▼
        └──► compliance engine ──► campaign engine ──► Postfix + OpenDKIM (gated)
```

Modular monolith for the application, independently scalable workers for the data pipeline. Twelve containers, one repo, one database.

---

## Repository layout

```
apps/web                 Next.js dashboard + /api/v1 route handlers
services/                Python data engine + Node campaign/mail workers
  discovery/             source adapters, project targeting
  crawler/               safe HTTP + Playwright fetching
  extractor/             DOM/JSON-LD/mailto extraction
  verifier/              syntax, DNS, MX
  campaign/              eligibility → recipients → sends
  mail-ingestion/        DSN/ARF bounce + complaint processing
packages/                shared TS: database, contracts, config, compliance, templates
infrastructure/          compose, postfix, opendkim, dns, monitoring, backup
scripts/                 bootstrap, health-check, backup
docs/                    the plan, architecture, data model, compliance, gates
tests/golden/            labelled extraction corpus
```

---

## Quickstart (development)

Prerequisites: Docker, Node 24+, pnpm, Python 3.12+ with `uv`.

```bash
cp .env.example .env
docker compose up -d          # Postgres + Redis on loopback
./scripts/bootstrap.sh        # checks toolchain, installs deps, seeds
./scripts/health-check.sh
```

The app itself arrives in Phase 1 (`apps/web` is scaffolded then, not now). Until then this repo is the plan plus the environment.

> Windows: run the equivalent commands from `scripts/dev.ps1` (PowerShell), or use WSL2. The product targets a Linux host; development on Windows is supported through Docker.

---

## Documentation

| Doc | Contents |
| --- | --- |
| [MEGA-PLAN](docs/MEGA-PLAN.md) | vision, bets, scope ladder, architecture, risks, roadmap |
| [architecture](docs/architecture.md) | containers, streams, flows, failure handling |
| [data model](docs/data-model.md) | tables, invariants, tenancy, partitioning |
| [compliance](docs/compliance.md) | three-question model, eligibility engine, jurisdiction profiles |
| [security](docs/security.md) | threat model, SSRF, secrets, incident response |
| [roadmap](docs/roadmap.md) | phases, exit criteria, timeline |
| [quality gates](docs/quality-gates.md) | test strategy, golden set, acceptance matrix |
| [decisions](docs/decisions.md) | ADRs |
| [backlog](docs/backlog.md) | issues by epic |
| [open questions](docs/open-questions.md) | decisions needed from the operator |

---

## Non-negotiable rules

1. Evidence or it does not exist.
2. Discovery never authorizes sending.
3. Default deny: unknown jurisdiction or missing basis blocks the send.
4. The LLM classifies; it never invents contacts or permissions.
5. Secrets never in git; databases never on a public port.
6. Every mutation is audited; eligibility decisions are immutable and expiring.

Violating any of these is a release blocker, not a code review comment.

---

## License

Not yet chosen. Treat as all rights reserved until a `LICENSE` file lands.
