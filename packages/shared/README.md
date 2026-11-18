# @leadforge/shared

Cross-cutting TypeScript: types, Zod contracts, the HTTP error envelope, and the cross-language job schemas.

**Phase:** 1

## Contents

- `contracts/` — Zod schemas; exported to JSON Schema for Python/Pydantic consumers.
- `http/` — response envelope, cursor pagination helpers, problem+json errors.
- `types/` — branded IDs, enums mirroring the DB.

## Rules

- The contract is the source of truth for both runtimes; CI verifies both sides compile to the same schema hash.
- Breaking contract changes bump a version field and dual-read for one release.
