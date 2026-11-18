# Contributing

Solo project for now, but written as if someone else will join — because the highest-risk dependency is one person's memory.

## Before you change anything

1. Read [`docs/MEGA-PLAN.md`](docs/MEGA-PLAN.md) §3 (principles) and the relevant supporting doc.
2. If the change alters an architectural choice, write an ADR in [`docs/decisions.md`](docs/decisions.md) instead of just changing code.
3. If the change touches compliance, security, or sending, read the corresponding doc first and add tests.

## Conventions

### Commits

```
<area>: <imperative summary>

<why, not what — the diff shows what>
Refs: LF-042, ADR-0012
```

Areas: `web`, `api`, `db`, `crawl`, `extract`, `verify`, `compliance`, `mail`, `infra`, `docs`, `chore`.

### Branches

`feat/<slug>`, `fix/<slug>`, `chore/<slug>`. Squash-merge; the PR description carries the detail.

### TypeScript

- `strict: true`; no `any` without a comment explaining why.
- Zod at every boundary (HTTP, queue, env, webhook).
- Server components by default; `"use client"` needs a reason.
- No `dangerouslySetInnerHTML` except in the reviewed sanitized renderer.

### Python

- `ruff` clean, `mypy --strict` for new modules.
- Pydantic models for anything crossing a boundary.
- No blocking I/O in async paths; no bare `except`.
- Deterministic extraction code must not import the LLM client.

### SQL / Prisma

- One logical change per migration, forward-only.
- Additive first: add → backfill → switch reads → drop later.
- Every new table: `organization_id` (if org-scoped), `created_at`, `updated_at`, and an index for the query you intend to run.

## Definition of done

- Tests for the behaviour, not the implementation.
- Docs updated in the same PR (plan, data model, or runbook — whichever is now wrong).
- No new secret, no new public port, no new `latest` tag.
- `pnpm lint && pnpm typecheck && pnpm test` and `uv run ruff check . && uv run pytest` pass.

## Never

- Commit `.env`, keys, dumps, or scraped data.
- Bypass robots, CAPTCHAs, or auth walls — even "just to test".
- Send email outside test mode without an approved jurisdiction profile.
- Merge with a failing gate because "it's just docs".
