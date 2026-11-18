# @leadforge/config

Typed, validated configuration for the TypeScript runtime.

**Phase:** 1

## Contents

- One schema (Zod) per process: `web`, `api`, `campaign-worker`.
- Boot-time validation with fail-fast errors that never echo secret values.
- No scattered `process.env` reads anywhere else in the codebase.

## Rule

If a value has a default, the default must be safe in production, not convenient in development.
