# @leadforge/pipeline

Thin, shared job plumbing for Redis Streams: naming, payload validation, retry/backoff, DLQ, and the sweep for stale pending entries.

**Phase:** 1 (interfaces) / 3 (implementation)

## Contents

- `streams.ts` / `streams.py` — mirrored producer/consumer with identical semantics.
- `idempotency.ts` — deterministic keys per job type.
- `sweep` — `XAUTOCLAIM` for entries stuck past visibility timeout.

## Rules

- At-least-once by default; every consumer must be idempotent.
- Max 5 attempts, exponential backoff with jitter, then DLQ with the original payload.
- Payloads are validated against the shared contract before execution; unknown shapes are rejected, not guessed.
