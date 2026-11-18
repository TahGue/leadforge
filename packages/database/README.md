# @leadforge/database

Prisma schema, migrations, seed data and the hand-written SQL that Prisma cannot express.

**Phase:** 1

## Contents

- `prisma/schema.prisma` — tables and relations.
- `sql/` — RLS policies, partitions, generated columns, trigram/partial indexes.
- `seed/` — idempotent development fixtures.

## Rules

- One logical change per migration; forward-only in production.
- Destructive changes use expand/contract.
- No `prisma db push` outside local development.
- RLS lives here, not only in application code (ADR-0012, ADR-0013).

## Status

Schema is specified in [`docs/data-model.md`](../../docs/data-model.md); implementation lands in Phase 1.
